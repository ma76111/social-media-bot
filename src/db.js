'use strict';

/**
 * db.js - طبقة البيانات الكاملة
 * كل مهمة لها ملف JSON مستقل في data/tasks/<id>.json
 * بيانات المستخدمين (الرصيد) في data/users.json
 */

const fs   = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const TASKS_DIR  = path.join(__dirname, '..', 'data', 'tasks');
const USERS_FILE = path.join(__dirname, '..', 'data', 'users.json');

// تأكيد وجود المجلدات
fs.mkdirSync(TASKS_DIR, { recursive: true });
fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────

function now() {
  const d = new Date();
  // التوقيت المصري Africa/Cairo
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year:     'numeric',
    month:    '2-digit',
    day:      '2-digit',
    hour:     '2-digit',
    minute:   '2-digit',
    second:   '2-digit',
    hour12:   false,
  }).formatToParts(d);

  const get = (type) => parts.find(p => p.type === type)?.value || '00';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

function taskPath(taskId) {
  return path.join(TASKS_DIR, `${taskId}.json`);
}

// ─────────────────────────────────────────────
//  Atomic write helper
//  يكتب لملف مؤقت أولاً ثم يعمل rename
//  يحمي من corruption لو مات البروسيس أثناء الكتابة
// ─────────────────────────────────────────────
function atomicWrite(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, filePath);
}

// ─────────────────────────────────────────────
//  Simple async mutex for balance-sensitive ops
//  Node.js is single-threaded but async interleaving
//  can cause read-modify-write races on the JSON files
// ─────────────────────────────────────────────
const _locks = new Map();

async function withLock(key, fn) {
  while (_locks.get(key)) {
    await new Promise(r => setTimeout(r, 5));
  }
  _locks.set(key, true);
  try {
    return await fn();
  } finally {
    _locks.delete(key);
  }
}

function loadTask(taskId) {
  const p = taskPath(taskId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.error(`[DB] Corrupted task file: ${p} — ${e.message}`);
    return null;
  }
}

function saveTask(task) {
  atomicWrite(taskPath(task.id), JSON.stringify(task, null, 2));
}

function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch (e) {
    console.error(`[DB] Corrupted users file — ${e.message}`);
    return {};
  }
}

function saveUsers(users) {
  atomicWrite(USERS_FILE, JSON.stringify(users, null, 2));
  _usersCache = null;
}

// ── In-memory cache للمستخدمين ──────────────
let _usersCache = null;

function loadUsersCached() {
  if (_usersCache) return _usersCache;
  _usersCache = loadUsers();
  return _usersCache;
}

function invalidateUsersCache() { _usersCache = null; }

function listTaskIds() {
  if (!fs.existsSync(TASKS_DIR)) return [];
  return fs.readdirSync(TASKS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.slice(0, -5));
}

function recalcStats(task) {
  const stats = { total: 0, pending: 0, approved: 0, rejected: 0, exported: 0 };
  for (const s of task.submissions) {
    stats.total++;
    if (s.status === 'pending')  stats.pending++;
    if (s.status === 'approved') stats.approved++;
    if (s.status === 'rejected') stats.rejected++;
    if (s.exported === 1)        stats.exported++;
  }
  task.stats = stats;
}

// ─────────────────────────────────────────────
//  TASKS
// ─────────────────────────────────────────────

/**
 * إنشاء مهمة جديدة
 * الحقول النصية (name, shortDesc, fullDesc) تدعم:
 *   - string: نص عادي (يُعرض لكل اللغات)
 *   - object: { ar: '...', en: '...', ... } (i18n)
 * @returns {object} المهمة الجديدة
 */
function createTask({ name, shortDesc, fullDesc, reward,
                       videoFileId = null,
                       maxPerUser = null,
                       isOpen = true }) {
  const task = {
    id: uuidv4(),
    name,        // string | { ar, en, ... }
    shortDesc,   // string | { ar, en, ... }
    fullDesc,    // string | { ar, en, ... }
    videoFileId,
    reward: Number(reward),
    maxPerUser: maxPerUser ? Number(maxPerUser) : null,
    isOpen,
    order: 9999,
    createdAt: now(),
    fields: [],
    features: [],
    submissions: [],
    stats: { total: 0, pending: 0, approved: 0, rejected: 0, exported: 0 },
  };
  saveTask(task);
  return task;
}

/**
 * جلب نص مهمة بلغة معينة مع fallback
 * @param {object} task
 * @param {'name'|'shortDesc'|'fullDesc'} field
 * @param {string} lang  'ar' | 'en' | ...
 * @returns {string}
 */
function getTaskText(task, field, lang = 'ar') {
  const val = task[field];
  if (!val) return '';
  if (typeof val === 'string') return val;   // قديم — نص عادي
  // i18n object: ابحث عن اللغة المطلوبة، ثم عربي، ثم أول قيمة موجودة
  return val[lang] || val['ar'] || Object.values(val).find(v => v) || '';
}

/**
 * تعيين نص i18n لحقل معين في المهمة
 * @param {object} task
 * @param {'name'|'shortDesc'|'fullDesc'} field
 * @param {string} lang
 * @param {string} value
 */
function setTaskText(taskId, field, lang, value) {
  const task = loadTask(taskId);
  if (!task) return null;
  const current = task[field];
  if (!current || typeof current === 'string') {
    // حوّل من string إلى i18n object
    const base = current || '';
    task[field] = { ar: base, en: base };
  }
  task[field][lang] = value;
  saveTask(task);
  return task;
}

/**
 * جلب مهمة بالـ ID
 */
function getTask(taskId) {
  return loadTask(taskId);
}

/**
 * تعديل بيانات المهمة
 * يقبل أي مجموعة من: name, shortDesc, fullDesc, videoFileId,
 *   reward, maxPerUser, isOpen, order, fields
 */
function updateTask(taskId, updates) {
  const task = loadTask(taskId);
  if (!task) return null;
  const allowed = ['name','shortDesc','fullDesc','videoFileId',
                   'reward','maxPerUser','isOpen','order','fields'];
  for (const k of allowed) {
    if (k in updates) task[k] = updates[k];
  }
  saveTask(task);
  return task;
}

/**
 * حذف مهمة
 */
function deleteTask(taskId) {
  const p = taskPath(taskId);
  if (fs.existsSync(p)) { fs.unlinkSync(p); return true; }
  return false;
}

/**
 * قائمة كل المهام مرتبة
 * @param {boolean} openOnly - المهام المفتوحة فقط
 */
function listTasks(openOnly = false) {
  const tasks = [];
  for (const id of listTaskIds()) {
    const t = loadTask(id);
    if (!t) continue;
    if (openOnly && !t.isOpen) continue;
    tasks.push(t);
  }
  tasks.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.createdAt.localeCompare(b.createdAt);
  });
  return tasks;
}

// ─────────────────────────────────────────────
//  FIELDS
// ─────────────────────────────────────────────

/**
 * أنواع الحقول المدعومة
 */
const FIELD_TYPES = ['text','password','email','url','phone','image','file','number'];

/**
 * إضافة حقل للمهمة
 */
function addField(taskId, { label, type, required = true }) {
  const task = loadTask(taskId);
  if (!task) return null;
  const field = {
    id: uuidv4(),
    label,
    type: FIELD_TYPES.includes(type) ? type : 'text',
    required: Boolean(required),
    order: task.fields.length,
    altType: null,       // null | string — نوع بديل مقبول أيضاً
    mergedWith: null,    // deprecated — احتُفظ به للتوافق مع البيانات القديمة
    mergeSeparator: ':',
  };
  task.fields.push(field);
  saveTask(task);
  return field;
}

/**
 * تعديل حقل
 */
function updateField(taskId, fieldId, updates) {
  const task = loadTask(taskId);
  if (!task) return false;
  const field = task.fields.find(f => f.id === fieldId);
  if (!field) return false;
  for (const k of ['label','type','required','order','mergedWith','mergeSeparator','altType']) {
    if (k in updates) field[k] = updates[k];
  }
  task.fields.sort((a, b) => a.order - b.order);
  saveTask(task);
  return true;
}

/**
 * حذف حقل
 */
function deleteField(taskId, fieldId) {
  const task = loadTask(taskId);
  if (!task) return false;
  const before = task.fields.length;
  task.fields = task.fields.filter(f => f.id !== fieldId);
  if (task.fields.length < before) { saveTask(task); return true; }
  return false;
}

/**
 * إعادة ترتيب الحقول
 * @param {string[]} orderedIds - معرفات الحقول بالترتيب الجديد
 */
function reorderFields(taskId, orderedIds) {
  const task = loadTask(taskId);
  if (!task) return false;
  const map = Object.fromEntries(task.fields.map(f => [f.id, f]));
  task.fields = orderedIds
    .filter(id => map[id])
    .map((id, i) => { map[id].order = i; return map[id]; });
  saveTask(task);
  return true;
}

// ─────────────────────────────────────────────
//  FEATURES  (ميزات المهمة)
// ─────────────────────────────────────────────
//
//  feature = {
//    id:     uuid,
//    type:   'random_names',   // النوع (قابل للتوسع)
//    label:  'احصل على اسم',   // نص الزرار
//    data:   { names: ['...', ...] }  // بيانات خاصة بالنوع
//  }

function addFeature(taskId, feature) {
  const task = loadTask(taskId);
  if (!task) return null;
  if (!task.features) task.features = [];
  const newFeat = { id: uuidv4(), ...feature };
  task.features.push(newFeat);
  saveTask(task);
  return newFeat;
}

function updateFeature(taskId, featureId, updates) {
  const task = loadTask(taskId);
  if (!task) return false;
  const feat = (task.features || []).find(f => f.id === featureId);
  if (!feat) return false;
  Object.assign(feat, updates);
  saveTask(task);
  return true;
}

function deleteFeature(taskId, featureId) {
  const task = loadTask(taskId);
  if (!task) return false;
  const before = (task.features || []).length;
  task.features = (task.features || []).filter(f => f.id !== featureId);
  if (task.features.length < before) { saveTask(task); return true; }
  return false;
}

function getFeatures(taskId) {
  const task = loadTask(taskId);
  return task?.features || [];
}

// ─────────────────────────────────────────────
//  SUBMISSIONS
// ─────────────────────────────────────────────

/**
 * إضافة تسليم جديد
 * @param {object} data - { fieldId: value, ... }
 */
function addSubmission(taskId, { userId, username, data }) {
  const task = loadTask(taskId);
  if (!task) return null;
  const submission = {
    id: uuidv4(),
    userId,
    username,
    submittedAt: now(),
    data,
    status: 'pending',    // pending | approved | rejected
    exported: 0,          // 0 = لم يُصدَّر | 1 = تم تصديره
    rejectReason: null,
    exportedAt: null,
  };
  task.submissions.push(submission);
  recalcStats(task);
  saveTask(task);
  return submission;
}

/**
 * جلب تسليم واحد
 */
function getSubmission(taskId, submissionId) {
  const task = loadTask(taskId);
  if (!task) return null;
  return task.submissions.find(s => s.id === submissionId) || null;
}

/**
 * جلب قائمة التسليمات مع فلتر اختياري
 * @param {string|null} status   - pending | approved | rejected | null (الكل)
 * @param {number|null} exported - 0 | 1 | null (الكل)
 */
function getSubmissions(taskId, status = null, exported = null) {
  const task = loadTask(taskId);
  if (!task) return [];
  // migrate: القديمة كانت status='exported' أو exported=undefined — نصلحها ونحفظ
  let needsSave = false;
  for (const s of task.submissions) {
    if (s.status === 'exported') {
      s.status   = 'approved';
      s.exported = 1;
      needsSave  = true;
    }
    if (s.exported === undefined) {
      s.exported = 0;
      needsSave  = true;
    }
  }
  if (needsSave) {
    recalcStats(task);
    saveTask(task);
  }
  let subs = task.submissions;
  if (status   !== null) subs = subs.filter(s => s.status === status);
  if (exported !== null) subs = subs.filter(s => s.exported === exported);
  return [...subs].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
}

/**
 * تحديث حالة تسليم واحد
 */
function updateSubmissionStatus(taskId, submissionId, newStatus, rejectReason = null) {
  const task = loadTask(taskId);
  if (!task) return null;
  const sub = task.submissions.find(s => s.id === submissionId);
  if (!sub) return null;
  // migrate قديم
  if (sub.status === 'exported') { sub.status = 'approved'; sub.exported = 1; }
  if (sub.exported === undefined) sub.exported = 0;

  sub.status = newStatus;
  if (rejectReason !== null) sub.rejectReason = rejectReason;
  recalcStats(task);
  saveTask(task);
  return sub;
}

function setExported(taskId, submissionIds, flag) {
  const task = loadTask(taskId);
  if (!task) return [];
  const idSet   = new Set(submissionIds);
  const updated = [];
  for (const sub of task.submissions) {
    if (idSet.has(sub.id)) {
      sub.exported = flag;
      if (flag === 1) sub.exportedAt = now();
      updated.push(sub);
    }
  }
  recalcStats(task);
  saveTask(task);
  return updated;
}

function bulkUpdateStatus(taskId, submissionIds, newStatus, rejectReason = null) {
  const task = loadTask(taskId);
  if (!task) return [];
  const idSet = new Set(submissionIds);
  const updated = [];
  for (const sub of task.submissions) {
    if (idSet.has(sub.id)) {
      // migrate قديم
      if (sub.status === 'exported') { sub.status = 'approved'; sub.exported = 1; }
      if (sub.exported === undefined) sub.exported = 0;
      sub.status = newStatus;
      if (rejectReason !== null) sub.rejectReason = rejectReason;
      updated.push(sub);
    }
  }
  recalcStats(task);
  saveTask(task);
  return updated;
}

/**
 * هل هذه البيانات موجودة مسبقاً في أي تسليم لأي مستخدم؟
 * يُستخدم لمنع التسليم بنفس البيانات من أكونت مختلف
 *
 * @param {string}   taskId
 * @param {object}   data        — { fieldId: value }
 * @param {string}   excludeUserId — استثناء المستخدم الحالي (لتجاهل تسليماته القديمة)
 * @returns {object|null} التسليم المكرر أو null
 */
function hasSubmittedData(taskId, data, excludeUserId = null) {
  const task = loadTask(taskId);
  if (!task) return null;

  // نحضر الحقول النصية فقط (بدون image/file)
  const textFields = task.fields.filter(f => f.type !== 'image' && f.type !== 'file');
  if (!textFields.length) return null;

  for (const sub of task.submissions) {
    if (excludeUserId && String(sub.userId) === String(excludeUserId)) continue;
    if (sub.status === 'rejected') continue; // المرفوضة لا تُحسب

    const isDuplicate = textFields.every(f => {
      const newVal = (data[f.id] || '').toString().trim().toLowerCase();
      const subVal = (sub.data[f.id] || '').toString().trim().toLowerCase();
      return newVal === subVal;
    });

    if (isDuplicate) return sub;
  }
  return null;
}

/**
 * جلب كل التسليمات المعلقة لمستخدم في مهمة معينة
 * (للتراجع عنها قبل القبول)
 */
function getUserPendingInTask(taskId, userId) {
  const task = loadTask(taskId);
  if (!task) return [];
  return task.submissions.filter(
    s => String(s.userId) === String(userId) && s.status === 'pending'
  );
}

/**
 * جلب كل التسليمات المعلقة لمستخدم عبر كل المهام
 * (للتراجع عنها قبل قبول أي تسليم له)
 */
function getAllPendingForUser(userId) {
  const result = [];
  for (const id of listTaskIds()) {
    const task = loadTask(id);
    if (!task) continue;
    const pending = task.submissions.filter(
      s => String(s.userId) === String(userId) && s.status === 'pending'
    );
    for (const sub of pending) result.push({ taskId: id, sub });
  }
  return result;
}
function countUserSubmissions(taskId, userId) {
  const task = loadTask(taskId);
  if (!task) return 0;
  return task.submissions.filter(
    s => String(s.userId) === String(userId) && s.status !== 'rejected'
  ).length;
}

function deleteSubmission(taskId, submissionId) {
  const task = loadTask(taskId);
  if (!task) return false;
  const before = task.submissions.length;
  task.submissions = task.submissions.filter(s => s.id !== submissionId);
  if (task.submissions.length < before) {
    recalcStats(task);
    saveTask(task);
    return true;
  }
  return false;
}

function bulkDeleteSubmissions(taskId, submissionIds) {
  const task = loadTask(taskId);
  if (!task) return 0;
  const idSet  = new Set(submissionIds);
  const before = task.submissions.length;
  task.submissions = task.submissions.filter(s => !idSet.has(s.id));
  const deleted = before - task.submissions.length;
  if (deleted > 0) { recalcStats(task); saveTask(task); }
  return deleted;
}

// ─────────────────────────────────────────────
//  USERS — uid تسلسلي + حظر + override سعر
// ─────────────────────────────────────────────

const COUNTER_FILE = path.join(__dirname, '..', 'data', 'counter.json');

function loadCounter() {
  if (!fs.existsSync(COUNTER_FILE)) return { nextUid: 1 };
  try {
    return JSON.parse(fs.readFileSync(COUNTER_FILE, 'utf8'));
  } catch { return { nextUid: 1 }; }
}
function saveCounter(c) {
  atomicWrite(COUNTER_FILE, JSON.stringify(c, null, 2));
}
function nextUid() {
  const c = loadCounter();
  const uid = c.nextUid;
  c.nextUid++;
  saveCounter(c);
  return uid;
}

function getUser(userId) {
  const users = loadUsersCached();
  const uid = String(userId);
  if (!users[uid]) {
    users[uid] = {
      id:          userId,
      uid:         nextUid(),      // معرف تسلسلي داخلي  #1, #2, ...
      username:    null,
      firstName:   null,
      balance:     0,
      totalEarned: 0,
      lang:        null,
      currency:    null,
      isBanned:    false,
      bannedAt:    null,
      banReason:   null,
      joinedAt:    now(),
      rewardOverrides: {},         // { taskId: customReward }
    };
    saveUsers(users);
  }
  // migrate حقول المستخدمين القدامى
  let dirty = false;
  const defaults = {
    lang: null, currency: null, isBanned: false,
    bannedAt: null, banReason: null, joinedAt: null,
    rewardOverrides: {}, uid: null, username: null, firstName: null,
  };
  for (const [k, v] of Object.entries(defaults)) {
    if (!(k in users[uid])) { users[uid][k] = v; dirty = true; }
  }
  if (!users[uid].uid) { users[uid].uid = nextUid(); dirty = true; }
  if (dirty) saveUsers(users);
  return users[uid];
}

function updateUserMeta(userId, { username, firstName } = {}) {
  const users = loadUsersCached();
  const uid   = String(userId);
  if (!users[uid]) getUser(userId);
  if (username  !== undefined) users[uid].username  = username;
  if (firstName !== undefined) users[uid].firstName = firstName;
  saveUsers(users);
}

function updateUserSettings(userId, { lang, currency } = {}) {
  const users = loadUsersCached();
  const uid   = String(userId);
  if (!users[uid]) getUser(userId);
  if (lang     !== undefined) users[uid].lang     = lang;
  if (currency !== undefined) users[uid].currency = currency;
  saveUsers(users);
  return users[uid];
}

function addBalance(userId, amount) {
  const users = loadUsersCached();
  const uid = String(userId);
  if (!users[uid]) getUser(userId);
  // حد أدنى: الرصيد لا يقل عن صفر عند الخصم التلقائي
  const newBal = Math.round((users[uid].balance + amount) * 10000) / 10000;
  users[uid].balance     = newBal;
  users[uid].totalEarned = Math.round((users[uid].totalEarned + (amount > 0 ? amount : 0)) * 10000) / 10000;
  saveUsers(users);
  return users[uid].balance;
}

function setBalance(userId, amount) {
  const users = loadUsersCached();
  const uid   = String(userId);
  if (!users[uid]) getUser(userId);
  users[uid].balance = Math.round(Number(amount) * 10000) / 10000;
  saveUsers(users);
  return users[uid].balance;
}

function banUser(userId, reason = null) {
  const users = loadUsersCached();
  const uid   = String(userId);
  if (!users[uid]) getUser(userId);
  users[uid].isBanned  = true;
  users[uid].bannedAt  = now();
  users[uid].banReason = reason;
  saveUsers(users);
}

function unbanUser(userId) {
  const users = loadUsersCached();
  const uid   = String(userId);
  if (!users[uid]) return;
  users[uid].isBanned  = false;
  users[uid].bannedAt  = null;
  users[uid].banReason = null;
  saveUsers(users);
}

function setRewardOverride(userId, taskId, reward) {
  const users = loadUsersCached();
  const uid   = String(userId);
  if (!users[uid]) getUser(userId);
  if (!users[uid].rewardOverrides) users[uid].rewardOverrides = {};
  if (reward === null) {
    delete users[uid].rewardOverrides[taskId];
  } else {
    users[uid].rewardOverrides[taskId] = Number(reward);
  }
  saveUsers(users);
}

function getEffectiveReward(userId, task) {
  const users = loadUsersCached();
  const uid   = String(userId);
  const overrides = users[uid]?.rewardOverrides || {};
  return overrides[task.id] !== undefined ? overrides[task.id] : task.reward;
}

function listUsers() {
  const users = loadUsersCached();
  return Object.values(users).sort((a, b) => (a.uid || 0) - (b.uid || 0));
}

function findUserByUid(uid) {
  const users = loadUsersCached();
  return Object.values(users).find(u => u.uid === Number(uid)) || null;
}

function findUserByUsername(username) {
  const clean = username.replace(/^@/, '').toLowerCase();
  const users = loadUsersCached();
  return Object.values(users).find(u =>
    u.username && u.username.replace(/^@/, '').toLowerCase() === clean
  ) || null;
}

// ─────────────────────────────────────────────
//  SETTINGS  (إعدادات النظام)
// ─────────────────────────────────────────────

const SETTINGS_FILE = path.join(__dirname, '..', 'data', 'settings.json');

const DEFAULT_SETTINGS = {
  minWithdrawal:   50,
  maxWithdrawal:   5000,
  botEnabled:      true,
  referralEnabled: false,
  referralReward:  0,
  maintenanceMsg:  '',   // رسالة مخصصة لوضع الصيانة
};

let _settingsCache = null;

function loadSettings() {
  if (!fs.existsSync(SETTINGS_FILE)) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2), 'utf8');
    return { ...DEFAULT_SETTINGS };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    // merge مع الافتراضي لضمان وجود كل الحقول
    return { ...DEFAULT_SETTINGS, ...raw };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  atomicWrite(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  _settingsCache = null;
}

function getSettings() {
  if (!_settingsCache) _settingsCache = loadSettings();
  return _settingsCache;
}

function getSetting(key) {
  return getSettings()[key] ?? DEFAULT_SETTINGS[key];
}

function setSetting(key, value) {
  const settings = loadSettings();
  settings[key]  = value;
  saveSettings(settings);
  _settingsCache = settings;
  return settings;
}

// ─────────────────────────────────────────────
//  ADMINS  (أدمنز إضافيون — يُحفظون في settings)
// ─────────────────────────────────────────────

/**
 * جلب قائمة الأدمنز الإضافيين (مش الرئيسيين من .env)
 * @returns {Array<{id: number, addedAt: string}>}
 */
function getExtraAdmins() {
  return getSettings().extraAdmins || [];
}

/**
 * إضافة أدمن جديد
 * @param {number} userId
 * @returns {boolean} true لو أُضيف، false لو موجود مسبقاً
 */
function addExtraAdmin(userId) {
  const settings = loadSettings();
  if (!settings.extraAdmins) settings.extraAdmins = [];
  if (settings.extraAdmins.find(a => a.id === userId)) return false;
  settings.extraAdmins.push({ id: userId, addedAt: now() });
  saveSettings(settings);
  _settingsCache = settings;
  return true;
}

/**
 * حذف أدمن
 * @param {number} userId
 * @returns {boolean} true لو اتحذف، false لو مش موجود
 */
function removeExtraAdmin(userId) {
  const settings = loadSettings();
  if (!settings.extraAdmins) return false;
  const before = settings.extraAdmins.length;
  settings.extraAdmins = settings.extraAdmins.filter(a => a.id !== userId);
  if (settings.extraAdmins.length === before) return false;
  saveSettings(settings);
  _settingsCache = settings;
  return true;
}

// ─────────────────────────────────────────────
//  WITHDRAWALS  (طلبات السحب)
// ─────────────────────────────────────────────
//
//  كل طلب:
//  {
//    id, userId, username,
//    method: 'cash_eg' | 'binance' | 'usdt_trc20' | 'usdt_bep20',
//    details: string,   ← رقم الهاتف (كاش) | Binance ID | عنوان USDT
//    amount: number,
//    status: 'pending' | 'approved' | 'rejected',
//    rejectReason: null | string,
//    createdAt, updatedAt
//  }

const WITHDRAWALS_FILE = path.join(__dirname, '..', 'data', 'withdrawals.json');

function loadWithdrawals() {
  if (!fs.existsSync(WITHDRAWALS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(WITHDRAWALS_FILE, 'utf8'));
  } catch (e) {
    console.error(`[DB] Corrupted withdrawals file — ${e.message}`);
    return [];
  }
}

function saveWithdrawals(list) {
  atomicWrite(WITHDRAWALS_FILE, JSON.stringify(list, null, 2));
}

async function createWithdrawal({ userId, username, method, details, amount }) {
  return withLock(`balance:${userId}`, () => {
    // إعادة قراءة الرصيد من داخل الـ lock لضمان freshness
    const users = loadUsers(); // قراءة مباشرة من disk
    const uid = String(userId);

    // تحقق مرة أخيرة من الرصيد داخل الـ lock
    if (!users[uid] || users[uid].balance < amount) {
      return null; // رصيد غير كافٍ — الـ handler سيتعامل مع null
    }

    const list = loadWithdrawals();
    const req = {
      id: uuidv4(),
      userId,
      username,
      method,
      details,
      amount: Number(amount),
      status: 'pending',
      rejectReason: null,
      createdAt: now(),
      updatedAt: now(),
    };
    list.push(req);
    saveWithdrawals(list);

    // خصم الرصيد داخل نفس الـ lock
    users[uid].balance = Math.round((users[uid].balance - amount) * 10000) / 10000;
    saveUsers(users);
    _usersCache = null; // invalidate cache بعد الكتابة المباشرة

    return req;
  });
}

function getWithdrawals(status = null) {
  let list = loadWithdrawals();
  if (status) list = list.filter(w => w.status === status);
  return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function getUserWithdrawals(userId, status = null) {
  return getWithdrawals(status).filter(w => w.userId === userId);
}

async function updateWithdrawalStatus(id, newStatus, rejectReason = null) {
  return withLock(`wd:${id}`, () => {
    const list = loadWithdrawals();
    const req  = list.find(w => w.id === id);
    if (!req) return null;

    // منع re-approval: لو مش pending → لا تعدّل
    if (newStatus === 'approved' && req.status !== 'pending') return null;

    const old = req.status;
    req.status    = newStatus;
    req.updatedAt = now();
    if (rejectReason !== null) req.rejectReason = rejectReason;

    // لو رُفض → أعد الرصيد للمستخدم (قراءة مباشرة من disk داخل الـ lock)
    if (newStatus === 'rejected' && old === 'pending') {
      const users = loadUsers();
      const uid = String(req.userId);
      if (users[uid]) {
        users[uid].balance = Math.round((users[uid].balance + req.amount) * 10000) / 10000;
        saveUsers(users);
        _usersCache = null;
      }
    }

    saveWithdrawals(list);
    return req;
  });
}

// ─────────────────────────────────────────────
//  Exports
// ─────────────────────────────────────────────

module.exports = {
  // Tasks
  createTask, getTask, updateTask, deleteTask, listTasks,
  getTaskText, setTaskText,
  // Fields
  FIELD_TYPES, addField, updateField, deleteField, reorderFields,
  // Submissions
  addSubmission, getSubmission, getSubmissions,
  updateSubmissionStatus, bulkUpdateStatus, setExported,
  deleteSubmission, bulkDeleteSubmissions,
  countUserSubmissions,
  hasSubmittedData, getUserPendingInTask, getAllPendingForUser,
  // Users
  getUser, updateUserMeta, updateUserSettings,
  addBalance, setBalance,
  banUser, unbanUser,
  setRewardOverride, getEffectiveReward,
  listUsers, findUserByUid, findUserByUsername,
  // Features
  addFeature, updateFeature, deleteFeature, getFeatures,
  // Settings
  getSettings, getSetting, setSetting,
  DEFAULT_SETTINGS,
  // Admins
  getExtraAdmins, addExtraAdmin, removeExtraAdmin,
  // Withdrawals
  createWithdrawal, getWithdrawals, getUserWithdrawals, updateWithdrawalStatus,
  // Lock utility (للاستخدام في handlers عند الحاجة)
  withLock,
};
