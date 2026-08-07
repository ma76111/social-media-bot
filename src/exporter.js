'use strict';

/**
 * exporter.js — وحدة التصدير
 *
 * المنطق:
 *   - exported = 0 → لم يُصدَّر بعد
 *   - exported = 1 → تم تصديره
 *
 * الدوال:
 *   exportUnexported(taskId, n?)          → تصدير غير المصدَّرة (كل أو N) → exported=1
 *   exportForReview(taskId, status, n?)   → تصدير للمراجعة بدون تغيير exported
 *   sendApprovedAndNotify(bot, taskId)    → إرسال approved وقبولها + إشعارات
 *   sendRejectedAndNotify(bot, taskId)    → إرسال rejected ورفضها + إشعارات
 *   undoExportedIds(taskId, ids)          → إرجاع exported=0 لمعرفات محددة
 *   undoExportedAll(taskId)               → إرجاع exported=0 للكل
 */

const fs   = require('fs');
const path = require('path');
const db   = require('./db');

const EXPORTS_DIR = path.join(__dirname, '..', 'exports');
fs.mkdirSync(EXPORTS_DIR, { recursive: true });

// ─────────────────────────────────────────────
//  تنظيف تلقائي لملفات التصدير القديمة
//  يحذف الملفات الأقدم من 7 أيام كل 6 ساعات
// ─────────────────────────────────────────────
const EXPORTS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;  // 7 أيام

function cleanOldExports() {
  try {
    const now   = Date.now();
    const files = fs.readdirSync(EXPORTS_DIR);
    let deleted = 0;
    for (const file of files) {
      const filePath = path.join(EXPORTS_DIR, file);
      const stat     = fs.statSync(filePath);
      if (now - stat.mtimeMs > EXPORTS_MAX_AGE_MS) {
        fs.unlinkSync(filePath);
        deleted++;
      }
    }
    if (deleted > 0) console.log(`[Exporter] تم حذف ${deleted} ملف تصدير قديم.`);
  } catch (err) {
    console.warn('[Exporter] فشل تنظيف ملفات التصدير:', err.message);
  }
}

// تشغيل فوري عند البدء ثم كل 6 ساعات
cleanOldExports();
setInterval(cleanOldExports, 6 * 60 * 60 * 1000);

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────

function exportFilePath(taskId, taskName, suffix = '') {
  const safe = taskName.replace(/[^a-zA-Z0-9\u0600-\u06FF_-]/g, '_').substring(0, 30);
  const ts   = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 16);
  return path.join(EXPORTS_DIR, `${safe}_${taskId.substring(0,8)}${suffix}_${ts}.txt`);
}

function getFields(task) {
  return [...task.fields].sort((a, b) => a.order - b.order);
}

// خريطة نوع الحقل → الاسم الإنجليزي الثابت في الملف
const TYPE_EXPORT_LABEL = {
  email:    'email',
  password: 'password',
  phone:    'phone',
  url:      'url',
  number:   'number',
  image:    'image',
  file:     'file',
  // text → يستخدم label الحقل كما هو
};

function fieldExportLabel(field) {
  return TYPE_EXPORT_LABEL[field.type] || field.label;
}

/**
 * يبني محتوى الملف:
 * السطر الأول: أسماء الحقول (إنجليزي حسب النوع)
 * السطر الثاني فصاعداً: قيم كل تسليم بنفس الترتيب
 *
 * مثال:
 *   email:password:phone
 *   test@gmail.com:pass123:0501234567
 */
function buildFile(subs, fields, filePath) {
  const header = fields.map(f => fieldExportLabel(f)).join(':');

  const rows = subs
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
    .map(s => fields.map(f => {
      const val = s.data[f.id] ?? '';
      if (f.type === 'image' || f.type === 'file') return val ? '[file]' : '';
      return val;
    }).join(':'));

  const content = [header, ...rows].join('\n');
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

// ─────────────────────────────────────────────
//  📤 تصدير غير المصدَّرة (pending + exported=0) ← يغيّر exported=1
// ─────────────────────────────────────────────

function exportUnexported(taskId, n = null) {
  const task = db.getTask(taskId);
  if (!task) throw new Error('المهمة غير موجودة');
  const fields = getFields(task);

  // فقط التسليمات pending التي لم تُصدَّر بعد
  let subs = db.getSubmissions(taskId, 'pending', 0);
  if (n) subs = subs.slice(0, n);
  if (!subs.length) return { filePath: null, count: 0 };

  const filePath = buildFile(subs, fields, exportFilePath(taskId, db.getTaskText(task, 'name', 'ar')));
  db.setExported(taskId, subs.map(s => s.id), 1);
  return { filePath, count: subs.length };
}

// ─────────────────────────────────────────────
//  📦 تصدير للمراجعة (بدون تغيير exported)
// ─────────────────────────────────────────────

function exportForReview(taskId, status = null, n = null) {
  const task = db.getTask(taskId);
  if (!task) throw new Error('المهمة غير موجودة');
  const fields = getFields(task);

  let subs = db.getSubmissions(taskId, status);
  if (n) subs = subs.slice(0, n);
  if (!subs.length) return { filePath: null, count: 0 };

  const suffix = status ? `_${status}` : '_review';
  const filePath = buildFile(subs, fields, exportFilePath(taskId, db.getTaskText(task, 'name', 'ar'), suffix));
  // لا نغيّر exported — للمراجعة فقط
  return { filePath, count: subs.length };
}

// ─────────────────────────────────────────────
//  ✅ إرسال المقبولة وقبولها + إشعارات
//  (بغض النظر عن exported)
// ─────────────────────────────────────────────

async function sendApprovedAndNotify(bot, taskId, notifyApprovedFn) {
  const task = db.getTask(taskId);
  if (!task) throw new Error('المهمة غير موجودة');
  const fields = getFields(task);

  const subs = db.getSubmissions(taskId, 'approved');
  if (!subs.length) return { filePath: null, count: 0 };

  const filePath = buildFile(subs, fields, exportFilePath(taskId, db.getTaskText(task, 'name', 'ar'), '_approved'));

  // إضافة رصيد وإشعار لكل مستخدم — مع مراعاة rewardOverride
  for (const sub of subs) {
    const reward = db.getEffectiveReward(sub.userId, task);
    db.addBalance(sub.userId, reward);
    if (notifyApprovedFn) await notifyApprovedFn(bot, sub, task);
  }

  // حذف بعد الإشعار
  db.bulkDeleteSubmissions(taskId, subs.map(s => s.id));

  return { filePath, count: subs.length };
}

// ─────────────────────────────────────────────
//  ❌ إرسال المرفوضة + إشعارات
//  (بغض النظر عن exported)
// ─────────────────────────────────────────────

async function sendRejectedAndNotify(bot, taskId, notifyRejectedFn, reason = null) {
  const task = db.getTask(taskId);
  if (!task) throw new Error('المهمة غير موجودة');
  const fields = getFields(task);

  const subs = db.getSubmissions(taskId, 'rejected');
  if (!subs.length) return { filePath: null, count: 0 };

  const filePath = buildFile(subs, fields, exportFilePath(taskId, db.getTaskText(task, 'name', 'ar'), '_rejected'));

  for (const sub of subs) {
    if (notifyRejectedFn) await notifyRejectedFn(bot, sub, task, reason || sub.rejectReason);
  }

  // حذف بعد الإشعار
  db.bulkDeleteSubmissions(taskId, subs.map(s => s.id));

  return { filePath, count: subs.length };
}

// ─────────────────────────────────────────────
//  ↩️ إرجاع من التصدير
// ─────────────────────────────────────────────

function undoExportedIds(taskId, ids) {
  const updated = db.setExported(taskId, ids, 0);
  return updated.length;
}

function undoExportedAll(taskId) {
  const subs = db.getSubmissions(taskId, null, 1);  // exported=1
  if (!subs.length) return 0;
  return undoExportedIds(taskId, subs.map(s => s.id));
}

// ─────────────────────────────────────────────
//  Legacy wrappers (للتوافق مع الكود القديم)
// ─────────────────────────────────────────────

function exportSubmissions(taskId, submissionIds) {
  const task = db.getTask(taskId);
  if (!task) return { filePath: null, count: 0 };
  const fields = getFields(task);
  const subs   = submissionIds
    .map(id => task.submissions.find(s => s.id === id))
    .filter(Boolean);
  if (!subs.length) return { filePath: null, count: 0 };
  const filePath = buildFile(subs, fields, exportFilePath(taskId, db.getTaskText(task, 'name', 'ar')));
  db.setExported(taskId, subs.map(s => s.id), 1);
  return { filePath, count: subs.length };
}

module.exports = {
  exportUnexported,
  exportForReview,
  sendApprovedAndNotify,
  sendRejectedAndNotify,
  undoExportedIds,
  undoExportedAll,
  exportSubmissions,   // legacy
  exportFilePath,
};
