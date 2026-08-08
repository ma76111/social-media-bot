'use strict';

/**
 * membership.js — فحص اشتراك المستخدم في القناة/المجموعة المطلوبة
 *
 * يستخدم Telegram getChatMember API.
 * الحالات المقبولة: member, creator, administrator
 * الحالات المرفوضة: left, kicked, restricted
 */

const db = require('../db');

/**
 * هل الاشتراك الإجباري مفعَّل وإعداداته مكتملة؟
 * @returns {{ enabled: boolean, channelId: string, label: string, url: string }}
 */
function getJoinConfig() {
  const s = db.getSettings();
  return {
    enabled:   !!s.joinEnabled && !!s.joinChannelId,
    channelId: s.joinChannelId  || '',
    label:     s.joinChannelLabel || s.joinChannelId || '',
    url:       s.joinChannelUrl   || '',
  };
}

/**
 * فحص أن المستخدم مشترك في القناة/المجموعة
 * @param {TelegramBot} bot
 * @param {number}      userId
 * @returns {Promise<boolean>}
 */
async function isMember(bot, userId) {
  const cfg = getJoinConfig();
  if (!cfg.enabled) return true;   // الاشتراك الإجباري معطَّل → اسمح للجميع

  try {
    const member = await bot.getChatMember(cfg.channelId, userId);
    return ['creator', 'administrator', 'member'].includes(member.status);
  } catch (e) {
    // لو فشل الاستعلام (البوت مش في القناة مثلاً) → نسمح بالمرور ونسجّل تحذير
    console.warn(`[Membership] فشل فحص الاشتراك للمستخدم ${userId}: ${e.message}`);
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
  const cfg = getJoinConfig();
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

module.exports = { isMember, sendJoinPrompt, getJoinConfig };
