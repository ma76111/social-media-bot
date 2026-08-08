'use strict';

/**
 * membership.js — فحص اشتراك المستخدم في القناة/المجموعة المطلوبة
 *
 * يستخدم Telegram getChatMember API مع cache في الذاكرة.
 * الحالات المقبولة: member, creator, administrator
 * الحالات المرفوضة: left, kicked, restricted
 *
 * ── Cache strategy ──────────────────────────────────────
 *  • نتيجة "مشترك"   → تُحفظ MEMBER_TTL ms  (10 دقائق)
 *  • نتيجة "غير مشترك" → تُحفظ NON_MEMBER_TTL ms (30 ثانية)
 *    (قصيرة عشان بعد ما يشترك يتحقق بسرعة بزرار "تحققت")
 *  • عند الضغط على "تحققت" → يُمسح الـ cache يدوياً → فحص فوري
 * ──────────────────────────────────────────────────────
 */

const db = require('../db');

const MEMBER_TTL     = 10 * 60 * 1000;  // 10 دقائق
const NON_MEMBER_TTL = 30 * 1000;       // 30 ثانية

// Map: userId → { result: boolean, expiresAt: number }
const _cache = new Map();

// تنظيف دوري كل 15 دقيقة لمنع تراكم entries منتهية
setInterval(() => {
  const now = Date.now();
  for (const [uid, entry] of _cache.entries()) {
    if (now >= entry.expiresAt) _cache.delete(uid);
  }
}, 15 * 60 * 1000);

/**
 * مسح cache مستخدم معين (يُستدعى عند الضغط على "تحققت")
 */
function invalidateMemberCache(userId) {
  _cache.delete(String(userId));
}

/**
 * هل الاشتراك الإجباري مفعَّل وإعداداته مكتملة؟
 * @returns {{ enabled: boolean, channelId: string, label: string, url: string }}
 */
function getJoinConfig() {
  const s = db.getSettings();
  return {
    enabled:   !!s.joinEnabled && !!s.joinChannelId,
    channelId: s.joinChannelId   || '',
    label:     s.joinChannelLabel || s.joinChannelId || '',
    url:       s.joinChannelUrl   || '',
  };
}

/**
 * فحص أن المستخدم مشترك في القناة/المجموعة (مع cache)
 * @param {TelegramBot} bot
 * @param {number}      userId
 * @returns {Promise<boolean>}
 */
async function isMember(bot, userId) {
  const cfg = getJoinConfig();
  if (!cfg.enabled) return true;   // الاشتراك الإجباري معطَّل → اسمح للجميع

  const key   = String(userId);
  const now   = Date.now();
  const entry = _cache.get(key);

  // إذا كان الـ cache لم ينته → ارجع النتيجة المحفوظة
  if (entry && now < entry.expiresAt) {
    return entry.result;
  }

  // فحص حقيقي من Telegram API
  try {
    const member = await bot.getChatMember(cfg.channelId, userId);
    const result = ['creator', 'administrator', 'member'].includes(member.status);
    const ttl    = result ? MEMBER_TTL : NON_MEMBER_TTL;
    _cache.set(key, { result, expiresAt: now + ttl });
    return result;
  } catch (e) {
    // لو فشل الاستعلام (البوت مش في القناة مثلاً) → نسمح بالمرور ونسجّل تحذير
    console.warn(`[Membership] فشل فحص الاشتراك للمستخدم ${userId}: ${e.message}`);
    // لا نحفظ في cache عشان نحاول مرة تانية في الرسالة الجاية
    return true;
  }
}

/**
 * إرسال رسالة "اشترك أولاً" مع زرار الانضمام وزرار "تحققت"
 * @param {TelegramBot} bot
 * @param {number}      chatId
 * @param {string}      lang   'ar' | 'en'
 */
async function sendJoinPrompt(bot, chatId, lang) {
  const cfg  = getJoinConfig();
  const isAr = lang !== 'en';

  const text = isAr
    ? `🔒 *للوصول إلى البوت، يجب الاشتراك في قناتنا أولاً!*\n\n` +
      `📢 القناة: *${cfg.label}*\n\n` +
      `1️⃣ اضغط زرار الاشتراك\n` +
      `2️⃣ اضغط ✅ تحققت بعد الاشتراك`
    : `🔒 *To use the bot, you must join our channel first!*\n\n` +
      `📢 Channel: *${cfg.label}*\n\n` +
      `1️⃣ Press the Join button\n` +
      `2️⃣ Press ✅ Verified after joining`;

  const buttons = [];
  if (cfg.url) {
    buttons.push({ text: isAr ? '📢 اشترك الآن' : '📢 Join Now', url: cfg.url });
  }
  buttons.push({
    text: isAr ? '✅ تحققت' : '✅ Verified',
    callback_data: 'join_check',
  });

  await bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: [buttons] },
  });
}

module.exports = { isMember, sendJoinPrompt, getJoinConfig, invalidateMemberCache };
