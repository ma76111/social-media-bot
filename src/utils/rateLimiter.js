'use strict';
/**
 * rateLimiter.js — حماية بسيطة من الإرسال الكثير
 * كل مستخدم عنده حد أقصى X رسالة في Y ثانية
 */

const limits = new Map();   // userId → { count, resetAt, warned }

const MAX_MESSAGES  = 10;   // أكثر من 10 رسائل
const WINDOW_MS     = 5000; // في 5 ثواني → blocked

/**
 * @returns {boolean} true = مسموح، false = محظور
 */
function check(userId) {
  const now  = Date.now();
  const uid  = String(userId);
  const data = limits.get(uid);

  if (!data || now > data.resetAt) {
    limits.set(uid, { count: 1, resetAt: now + WINDOW_MS, warned: false });
    return true;
  }

  data.count++;
  if (data.count > MAX_MESSAGES) return false;
  return true;
}

/**
 * هل هذه أول مرة يُحجب فيها المستخدم في هذه الدورة؟
 * (لإرسال رسالة تحذير مرة واحدة فقط)
 * @returns {boolean}
 */
function isFirstBlock(userId) {
  const uid  = String(userId);
  const data = limits.get(uid);
  if (!data || data.warned) return false;
  data.warned = true;
  return true;
}

// تنظيف الـ map كل دقيقة
setInterval(() => {
  const now = Date.now();
  for (const [uid, data] of limits.entries()) {
    if (now > data.resetAt) limits.delete(uid);
  }
}, 60_000);

module.exports = { check, isFirstBlock };
