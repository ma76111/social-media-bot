'use strict';

/**
 * onboarding.js
 * اختيار اللغة والعملة في الـ reply keyboard السفلي
 */

const db = require('../db');
const { t, LANG_NAMES, CURRENCY_NAMES } = require('../i18n');

// ─────────────────────────────────────────────
//  هل المستخدم أكمل الـ onboarding؟
// ─────────────────────────────────────────────
function needsOnboarding(userId) {
  const user = db.getUser(userId);
  return !user.lang || !user.currency;
}

// ─────────────────────────────────────────────
//  نصوص الأزرار (ثابتة للتعرف عليها)
// ─────────────────────────────────────────────
const BTN_LANG_AR   = LANG_NAMES.ar;       // 'العربية 🇦🇪'
const BTN_LANG_EN   = LANG_NAMES.en;       // 'English 🇬🇧'
const BTN_CUR_EGP   = CURRENCY_NAMES.egp;  // 'جنيه مصري 🇪🇬'
const BTN_CUR_USDT  = CURRENCY_NAMES.usdt; // 'USDT 🟡'

// ─────────────────────────────────────────────
//  Keyboards (reply keyboards)
// ─────────────────────────────────────────────

function langReplyKeyboard() {
  return {
    keyboard: [
      [{ text: BTN_LANG_AR }, { text: BTN_LANG_EN }],
    ],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

function currencyReplyKeyboard() {
  return {
    keyboard: [
      [{ text: BTN_CUR_EGP }, { text: BTN_CUR_USDT }],
    ],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

// settings inline (تبقى inline لأنها تظهر في رسالة محددة)
function settingsInlineKeyboard(lang) {
  return {
    inline_keyboard: [[
      { text: t('btn_change_lang',     lang), callback_data: 'set_lang'     },
      { text: t('btn_change_currency', lang), callback_data: 'set_currency' },
    ]],
  };
}

// ─────────────────────────────────────────────
//  Onboarding flow
// ─────────────────────────────────────────────

function sendLangChoice(bot, chatId) {
  bot.sendMessage(
    chatId,
    t('welcome_lang', 'ar'),
    { parse_mode: 'Markdown', reply_markup: langReplyKeyboard() }
  );
}

function sendCurrencyChoice(bot, chatId, lang) {
  bot.sendMessage(
    chatId,
    t('welcome_currency', lang),
    { parse_mode: 'Markdown', reply_markup: currencyReplyKeyboard() }
  );
}

// ─────────────────────────────────────────────
//  Settings page
// ─────────────────────────────────────────────

function sendSettingsPage(bot, chatId, userId) {
  const user = db.getUser(userId);
  const lang = user.lang     || 'ar';
  const cur  = user.currency || 'egp';
  bot.sendMessage(
    chatId,
    `${t('settings_title', lang)}\n\n${t('settings_current', lang, LANG_NAMES[lang], CURRENCY_NAMES[cur])}`,
    { parse_mode: 'Markdown', reply_markup: settingsInlineKeyboard(lang) }
  );
}

// ─────────────────────────────────────────────
//  register
// ─────────────────────────────────────────────

function register(bot, onDone) {

  // ── استقبال اختيار اللغة (reply keyboard) ─────────────────
  bot.on('message', async (msg) => {
    const userId = msg.from.id;
    const text   = msg.text;
    if (!text) return;

    const user = db.getUser(userId);

    // المستخدم في مرحلة اختيار اللغة
    if (!user.lang && (text === BTN_LANG_AR || text === BTN_LANG_EN)) {
      const lang = text === BTN_LANG_AR ? 'ar' : 'en';
      db.updateUserSettings(userId, { lang });
      // إذا عنده عملة مسبقاً → اكتمل الـ onboarding
      if (user.currency) {
        await bot.sendMessage(msg.chat.id, t('onboarding_done', lang), { parse_mode: 'Markdown' });
        if (typeof onDone === 'function') onDone(bot, msg.chat.id, userId, msg.from.first_name);
      } else {
        sendCurrencyChoice(bot, msg.chat.id, lang);
      }
      return;
    }

    // المستخدم في مرحلة اختيار العملة
    if (user.lang && !user.currency && (text === BTN_CUR_EGP || text === BTN_CUR_USDT)) {
      const currency = text === BTN_CUR_EGP ? 'egp' : 'usdt';
      const lang     = user.lang;
      db.updateUserSettings(userId, { currency });
      await bot.sendMessage(msg.chat.id, t('onboarding_done', lang), { parse_mode: 'Markdown' });
      if (typeof onDone === 'function') onDone(bot, msg.chat.id, userId, msg.from.first_name);
      return;
    }
  });

  // ── Callbacks (settings page) ─────────────────────────────
  bot.on('callback_query', async (query) => {
    if (query._blocked) return;   // Idempotency Gate
    const data   = query.data;
    const userId = query.from.id;
    const chatId = query.message.chat.id;

    // تغيير اللغة من التفضيلات → reply keyboard
    if (data === 'set_lang') {
      await bot.answerCallbackQuery(query.id);
      const lang = db.getUser(userId).lang || 'ar';
      bot.sendMessage(chatId, t('settings_lang_q', lang), {
        parse_mode: 'Markdown',
        reply_markup: langReplyKeyboard(),
      });
      // نضع المستخدم في حالة تغيير اللغة مؤقتاً
      _pendingLangChange.set(userId, Date.now());
      return;
    }

    // تغيير العملة من التفضيلات → reply keyboard
    if (data === 'set_currency') {
      await bot.answerCallbackQuery(query.id);
      const lang = db.getUser(userId).lang || 'ar';
      bot.sendMessage(chatId, t('settings_currency_q', lang), {
        parse_mode: 'Markdown',
        reply_markup: currencyReplyKeyboard(),
      });
      _pendingCurChange.set(userId, Date.now());
      return;
    }
  });

  // ── استقبال تغيير اللغة/العملة من التفضيلات ─────────────────
  bot.on('message', async (msg) => {
    const userId = msg.from.id;
    const text   = msg.text;
    if (!text) return;

    // تغيير اللغة
    if (_pendingLangChange.has(userId) && (text === BTN_LANG_AR || text === BTN_LANG_EN)) {
      _pendingLangChange.delete(userId);
      const lang = text === BTN_LANG_AR ? 'ar' : 'en';
      db.updateUserSettings(userId, { lang });
      await bot.sendMessage(msg.chat.id, t('settings_saved', lang), { parse_mode: 'Markdown' });
      sendSettingsPage(bot, msg.chat.id, userId);
      if (typeof onDone === 'function') onDone(bot, msg.chat.id, userId, msg.from.first_name);
      return;
    }

    // تغيير العملة
    if (_pendingCurChange.has(userId) && (text === BTN_CUR_EGP || text === BTN_CUR_USDT)) {
      _pendingCurChange.delete(userId);
      const currency = text === BTN_CUR_EGP ? 'egp' : 'usdt';
      const lang     = db.getUser(userId).lang || 'ar';
      db.updateUserSettings(userId, { currency });
      await bot.sendMessage(msg.chat.id, t('settings_saved', lang), { parse_mode: 'Markdown' });
      sendSettingsPage(bot, msg.chat.id, userId);
      return;
    }
  });
}

// pending sets لتتبع من يغير إعداداته
// Map بدلاً من Set لدعم TTL (10 دقائق)
const PENDING_TTL_MS = 10 * 60 * 1000;
const _pendingLangChange = new Map(); // userId → timestamp
const _pendingCurChange  = new Map();

// تنظيف دوري كل 15 دقيقة
setInterval(() => {
  const now = Date.now();
  for (const [k, ts] of _pendingLangChange.entries()) if (now - ts > PENDING_TTL_MS) _pendingLangChange.delete(k);
  for (const [k, ts] of _pendingCurChange.entries())  if (now - ts > PENDING_TTL_MS) _pendingCurChange.delete(k);
}, 15 * 60 * 1000);

module.exports = { register, needsOnboarding, sendLangChoice, sendSettingsPage };
