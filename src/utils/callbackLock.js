'use strict';

/**
 * callbackLock.js — حماية من الضغط المزدوج على أزرار الـ inline
 *
 * المشكلة:
 *   لما المستخدم يضغط الزرار وينتظر ما يجيش رد (بسبب بطء النت)
 *   يضغط تاني مرة → عمليتان تنفذان معاً → تكرار السحب / القبول
 *
 * الحل:
 *   نحفظ userId:callbackData كـ lock لمدة CB_LOCK_TTL ms
 *   أي ضغطة جديدة بنفس البيانات خلال هذه المدة تُتجاهل فوراً
 *
 * الاستخدام:
 *   const { acquireLock, releaseLock } = require('../utils/callbackLock');
 *
 *   bot.on('callback_query', async (query) => {
 *     if (!acquireLock(query.from.id, query.data)) {
 *       bot.answerCallbackQuery(query.id).catch(() => {});
 *       return;
 *     }
 *     try {
 *       // ... معالجة الـ callback
 *     } finally {
 *       releaseLock(query.from.id, query.data);
 *     }
 *   });
 */

const _locks = new Map(); // `${userId}:${data}` → timestamp

// مدة الـ lock: 8 ثواني (كافية لأي عملية async تنتهي)
const LOCK_TTL_MS = 8000;

// الزرارات التي لا تحتاج lock (navigation فقط، بلا side effects)
const NO_LOCK_PREFIXES = [
  'pending_page:',
  'subs_show:',
  'usrs_list:',
  'usrs_page:',
  'adm_tasks_list',
  'adm_task:',
  'adm_fields:',
  'feat_list:',
  'feat_detail:',
  'subs_list:',
  'wda_list:',
  'wda_menu',
  'wda_detail:',
  'usr_view:',
];

function _isNoLock(data) {
  return NO_LOCK_PREFIXES.some(p => data === p || data.startsWith(p));
}

/**
 * يحاول الحصول على lock
 * @param {number|string} userId
 * @param {string} data  — query.data
 * @returns {boolean} true = مسموح، false = مكرر → تجاهل
 */
function acquireLock(userId, data) {
  if (!data || _isNoLock(data)) return true;

  const key = `${userId}:${data}`;
  const now = Date.now();
  const last = _locks.get(key);

  if (last && now - last < LOCK_TTL_MS) return false;

  _locks.set(key, now);
  return true;
}

/**
 * يحرر الـ lock بعد انتهاء المعالجة
 * @param {number|string} userId
 * @param {string} data
 */
function releaseLock(userId, data) {
  if (!data || _isNoLock(data)) return;
  _locks.delete(`${userId}:${data}`);
}

// تنظيف الـ locks المنتهية كل دقيقة
setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of _locks.entries()) {
    if (now - ts > LOCK_TTL_MS) _locks.delete(key);
  }
}, 60_000);

module.exports = { acquireLock, releaseLock };
