'use strict';

const db = require('../db');
const { t, currencySymbol, LANG_NAMES, CURRENCY_NAMES } = require('../i18n');
const { formatAmount, getUsdtEgpRate } = require('../utils/price');
const { notifyUser } = require('./user');
const rateLimiter = require('../utils/rateLimiter');
const { escMd } = require('../utils/escMd');

// ─────────────────────────────────────────────
//  Sessions
// ─────────────────────────────────────────────
const sessions = {};
function setSession(id, step, data = {}) { sessions[id] = { step, data }; }
function getSession(id) { return sessions[id] || null; }
function clearSession(id) { delete sessions[id]; }

// ─────────────────────────────────────────────
//  Constants — تُقرأ من Settings ديناميكياً
// ─────────────────────────────────────────────
function getMinWithdrawal() { return db.getSetting('minWithdrawal') || 50; }
function getMaxWithdrawal() { return db.getSetting('maxWithdrawal') || 0; }

// ─────────────────────────────────────────────
//  Prefs helpers
// ─────────────────────────────────────────────
function getLang(uid)     { return db.getUser(uid).lang     || 'ar'; }
function getCurrency(uid) { return db.getUser(uid).currency || 'egp'; }

// ─────────────────────────────────────────────
//  Method labels  (ثنائي اللغة)
// ─────────────────────────────────────────────
const METHOD_LABELS = {
  cash_eg:    { ar: '🏦 كاش مصري',   en: '🏦 Egyptian Cash' },
  binance:    { ar: '🟡 Binance ID',  en: '🟡 Binance ID'   },
  usdt_trc20: { ar: '💎 USDT TRC20',  en: '💎 USDT TRC20'   },
  usdt_bep20: { ar: '💎 USDT BEP20',  en: '💎 USDT BEP20'   },
};
function methodLabel(method, lang) {
  return METHOD_LABELS[method]?.[lang] || method;
}
function isUsdt(method) {
  return method === 'usdt_trc20' || method === 'usdt_bep20';
}

// ─────────────────────────────────────────────
//  Helper — صف طلب واحد في قائمة الأدمن
// ─────────────────────────────────────────────
function wdPendingRow(w, page) {
  const netTag = isUsdt(w.method)
    ? ` (${w.method === 'usdt_trc20' ? 'TRC20' : 'BEP20'})`
    : '';
  return [
    {
      text: `👤 ${w.username}  💰 ${w.amount} EGP  ${methodLabel(w.method, 'ar')}${netTag}`,
      callback_data: `wda_detail:${w.id}:pending:${page}`,
    },
    {
      text: '✅ تم الدفع',
      callback_data: `wda_paid:${w.id}:${page}`,
    },
  ];
}

// ─────────────────────────────────────────────
//  Reply keyboard للإلغاء — يظهر في القائمة السفلية
// ─────────────────────────────────────────────
function cancelReplyKeyboard(lang) {
  return {
    keyboard: [[{ text: t('btn_cancel', lang) }]],
    resize_keyboard: true,
    one_time_keyboard: false,
  };
}

// ─────────────────────────────────────────────
//  Keyboards
// ─────────────────────────────────────────────
function methodKeyboard(lang) {
  return {
    inline_keyboard: [
      [{ text: methodLabel('cash_eg', lang), callback_data: 'wd_method:cash_eg' }],
      [{ text: methodLabel('binance', lang), callback_data: 'wd_method:binance' }],
      [{ text: lang === 'ar' ? '💎 USDT (TRC20 / BEP20)' : '💎 USDT (TRC20 / BEP20)', callback_data: 'wd_usdt_net' }],
      [{ text: t('btn_cancel', lang), callback_data: 'wd_cancel' }],
    ],
  };
}

function usdtNetKeyboard(lang) {
  return {
    inline_keyboard: [
      [{ text: '💎 TRC20 (Tron)', callback_data: 'wd_method:usdt_trc20' }],
      [{ text: '💎 BEP20 (BSC)',  callback_data: 'wd_method:usdt_bep20' }],
      [{ text: lang === 'ar' ? '🔙 رجوع' : '🔙 Back', callback_data: 'wd_back_method' }],
    ],
  };
}

function confirmWdKeyboard(lang) {
  return {
    inline_keyboard: [[
      { text: t('btn_confirm_wd', lang), callback_data: 'wd_confirm' },
      { text: t('btn_cancel', lang),     callback_data: 'wd_cancel'  },
    ]],
  };
}

function wdAdminMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '⏳ المعلقة',  callback_data: 'wda_list:pending:0'  },
        { text: '✅ المقبولة', callback_data: 'wda_list:approved:0' },
        { text: '❌ المرفوضة', callback_data: 'wda_list:rejected:0' },
      ],
      [
        { text: '⚡ قبول الكل', callback_data: 'wda_bulk_approve' },
        { text: '⚡ رفض الكل',  callback_data: 'wda_bulk_reject'  },
      ],
    ],
  };
}

// ─────────────────────────────────────────────
//  Keyboard قائمة الطلبات المعلقة
//  يُستخدم في sendWdList و editWdPendingList
// ─────────────────────────────────────────────
function buildWdPendingKeyboard(list, page) {
  const PAGE       = 12;
  const total      = list.length;
  const totalPages = Math.ceil(total / PAGE) || 1;
  const safePage   = Math.max(0, Math.min(page, totalPages - 1));
  const slice      = list.slice(safePage * PAGE, (safePage + 1) * PAGE);

  const rows = slice.map(w => wdPendingRow(w, safePage));

  const nav = [];
  if (safePage > 0)
    nav.push({ text: '◀️ السابق', callback_data: `wda_list:pending:${safePage - 1}` });
  if (safePage < totalPages - 1)
    nav.push({ text: `التالية ➡️ (${total - (safePage + 1) * PAGE} متبقي)`, callback_data: `wda_list:pending:${safePage + 1}` });
  if (nav.length) rows.push(nav);

  return { rows, safePage, totalPages, total };
}

function wdDetailKeyboard(wdId, status, backStatus = 'pending', backPage = 0) {
  const rows = [];
  if (status === 'pending') {
    rows.push([
      { text: '✅ تم الدفع',  callback_data: `wda_paid:${wdId}:${backPage}`      },
      { text: '❌ رفض',       callback_data: `wda_reject_ask:${wdId}:${backPage}` },
    ]);
  }
  rows.push([{ text: '🔙 رجوع', callback_data: `wda_list:${backStatus}:${backPage}` }]);
  return { inline_keyboard: rows };
}

function confirmBulkKeyboard(action) {
  return {
    inline_keyboard: [[
      { text: '✅ نعم', callback_data: `wda_bulk_ok:${action}` },
      { text: '❌ لا',  callback_data: 'wda_menu'              },
    ]],
  };
}

// ─────────────────────────────────────────────
//  Format withdrawal for admin (always Arabic)
// ─────────────────────────────────────────────
function formatWdAdmin(wd, rate) {
  const statusLabel = { pending: '⏳ معلق', approved: '✅ مقبول', rejected: '❌ مرفوض' };
  const usdtLine = rate
    ? `  ≈ \`${(wd.amount / rate).toFixed(4)} USDT\` (سعر: ${rate} EGP)\n`
    : '';
  const networkLine = isUsdt(wd.method)
    ? `🌐 الشبكة: *${wd.method === 'usdt_trc20' ? 'TRC20 (Tron)' : 'BEP20 (BSC)'}*\n`
    : '';
  let text =
    `🆔 \`${wd.id.substring(0, 8)}\`\n` +
    `👤 ${escMd(wd.username)}  |  \`${wd.userId}\`\n` +
    `💳 الطريقة: ${methodLabel(wd.method, 'ar')}\n` +
    networkLine +
    `📋 ${isUsdt(wd.method) ? 'العنوان' : 'التفاصيل'}: \`${escMd(wd.details)}\`\n` +
    `💰 المبلغ: *${wd.amount} EGP*\n` +
    usdtLine +
    `📅 ${wd.createdAt}\n` +
    `📌 الحالة: ${statusLabel[wd.status] || wd.status}`;
  if (wd.rejectReason) text += `\n📝 سبب الرفض: ${escMd(wd.rejectReason)}`;
  return text;
}

// ─────────────────────────────────────────────
//  helper — يعرض شاشة بدء السحب من جديد
// ─────────────────────────────────────────────
async function sendWithdrawStart(bot, chatId, userId, lang) {
  const currency = getCurrency(userId);
  const user     = db.getUser(userId);
  const { display: bal, symbol } = await formatAmount(user.balance, currency);

  const history = db.getUserWithdrawals(userId);
  let historyText = '';
  if (history.length > 0) {
    const statusIcon = { pending: '⏳', approved: '✅', rejected: '❌' };
    historyText = `\n\n📋 *${lang === 'ar' ? 'آخر سحوباتك:' : 'Recent withdrawals:'}*\n`;
    for (const w of history.slice(0, 3)) {
      const { display: wAmt, symbol: wSym } = await formatAmount(w.amount, currency);
      historyText += `${statusIcon[w.status] || '•'} ${wAmt} ${wSym} — ${methodLabel(w.method, lang)} — ${w.createdAt.substring(0, 10)}\n`;
    }
  }

  bot.sendMessage(chatId,
    `${t('wd_title', lang)}\n\n${t('wd_balance_avail', lang, bal, symbol)}${historyText}\n\n${t('wd_choose_method', lang)}`,
    { parse_mode: 'Markdown', reply_markup: methodKeyboard(lang) }
  );
}
async function handleWithdrawText(bot, msg, userId) {
  const session = getSession(userId);
  if (!session) return;
  const { step, data } = session;
  const chatId   = msg.chat.id;
  const text     = msg.text?.trim();
  const lang     = getLang(userId);
  const currency = getCurrency(userId);

  // إلغاء من القائمة السفلية في أي خطوة
  if (text === t('btn_cancel', lang) || text === t('btn_cancel', 'ar') || text === t('btn_cancel', 'en')) {
    clearSession(userId);
    await sendWithdrawStart(bot, chatId, userId, lang);
    return;
  }

  // إدخال التفاصيل (رقم الهاتف أو Binance ID)
  if (step === 'details') {
    if (!text) return bot.sendMessage(chatId, '⚠️ ' + (lang === 'ar' ? 'أدخل البيانات.' : 'Enter valid data.'));
    data.details = text;

    const user = db.getUser(userId);
    // الرصيد بالعملة المختارة
    const { display: balDisplay, symbol, rate } = await formatAmount(user.balance, currency);
    data._rate = rate;    // نحفظ السعر المستخدم

    setSession(userId, 'amount', data);
    return bot.sendMessage(
      chatId,
      `✅ \`${text}\`\n\n${t('wd_enter_amount', lang, balDisplay, symbol)}`,
      { parse_mode: 'Markdown', reply_markup: cancelReplyKeyboard(lang) }
    );
  }

  // إدخال المبلغ
  if (step === 'amount') {
    const inputAmt = parseFloat(text);
    if (isNaN(inputAmt) || inputAmt <= 0)
      return bot.sendMessage(chatId, t('wd_invalid_amount', lang));

    const user = db.getUser(userId);
    const { display: balDisplay, symbol, rate } = await formatAmount(user.balance, currency);

    // تحويل المبلغ المدخل إلى EGP للمقارنة بالرصيد
    let amountEgp;
    if (currency === 'usdt') {
      amountEgp = Math.round(inputAmt * (rate || data._rate || 50) * 100) / 100;
    } else {
      amountEgp = inputAmt;
    }

    if (amountEgp > user.balance) {
      return bot.sendMessage(chatId, t('wd_insufficient', lang, balDisplay, symbol), { parse_mode: 'Markdown' });
    }

    if (amountEgp < getMinWithdrawal()) {
      const { display: minDisplay, symbol: minSym } = await formatAmount(getMinWithdrawal(), currency);
      return bot.sendMessage(chatId,
        lang === 'ar'
          ? `⚠️ الحد الأدنى للسحب هو \`${minDisplay} ${minSym}\`.`
          : `⚠️ Minimum withdrawal is \`${minDisplay} ${minSym}\`.`,
        { parse_mode: 'Markdown' }
      );
    }

    const maxWd = getMaxWithdrawal();
    if (maxWd > 0 && amountEgp > maxWd) {
      const { display: maxDisplay, symbol: maxSym } = await formatAmount(maxWd, currency);
      return bot.sendMessage(chatId,
        lang === 'ar'
          ? `⚠️ الحد الأقصى للسحب هو \`${maxDisplay} ${maxSym}\`.`
          : `⚠️ Maximum withdrawal is \`${maxDisplay} ${maxSym}\`.`,
        { parse_mode: 'Markdown' }
      );
    }

    data.amountEgp   = amountEgp;
    data.amountInput = inputAmt;
    data.symbol      = symbol;
    data._rate       = rate;
    setSession(userId, 'confirm', data);

    const { display: dispAmt, symbol: dispSym } = await formatAmount(amountEgp, currency);

    const networkLine = isUsdt(data.method)
      ? `${lang === 'ar' ? '🌐 الشبكة' : '🌐 Network'}: *${data.method === 'usdt_trc20' ? 'TRC20 (Tron)' : 'BEP20 (BSC)'}*\n`
      : '';

    const summary =
      `${t('wd_review', lang)}\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `${t('wd_method_lbl',  lang, methodLabel(data.method, lang))}\n` +
      networkLine +
      `${t('wd_details_lbl', lang, data.details)}\n` +
      `${t('wd_amount_lbl',  lang, dispAmt, dispSym)}\n` +
      (currency === 'usdt' ? `  ≈ \`${amountEgp} EGP\` (سعر: ${rate})\n` : '') +
      `━━━━━━━━━━━━━━━━━━\n` +
      `${t('wd_confirm_q', lang)}`;

    return bot.sendMessage(chatId, summary, {
      parse_mode: 'Markdown',
      reply_markup: confirmWdKeyboard(lang),  // inline فقط — نشيل reply keyboard
    });
  }

  // سبب رفض (أدمن)
  if (step === 'reject_reason') {
    const reason = (text === 'تخطي' || text === 'skip') ? null : text;
    clearSession(userId);
    const wd = db.updateWithdrawalStatus(data.wdId, 'rejected', reason);
    if (!wd) return bot.sendMessage(chatId, '⚠️ الطلب غير موجود.');
    bot.sendMessage(chatId, `❌ تم رفض الطلب \`${data.wdId.substring(0, 8)}\`.`, { parse_mode: 'Markdown' });
    await notifyUser(bot, wd.userId,
      t('notify_wd_rejected', getLang(wd.userId),
        methodLabel(wd.method, getLang(wd.userId)),
        wd.amount, 'EGP', reason)
    );
    return;
  }
}

// ─────────────────────────────────────────────
//  register
// ─────────────────────────────────────────────
function register(bot, isAdmin) {

  // زرار 💳 سحب / Withdraw (أي لغة)
  bot.onText(/💳 سحب|💳 Withdraw/i, async (msg) => {
    const userId = msg.from.id;
    if (isAdmin(userId)) return;
    const lang     = getLang(userId);
    const currency = getCurrency(userId);
    const user     = db.getUser(userId);
    const { display: bal, symbol } = await formatAmount(user.balance, currency);

    if (user.balance <= 0) {
      return bot.sendMessage(msg.chat.id, t('wd_zero_balance', lang, bal, symbol), { parse_mode: 'Markdown' });
    }

    // حد أقصى طلب سحب معلق واحد في نفس الوقت
    const pendingWds = db.getUserWithdrawals(userId, 'pending');
    if (pendingWds.length > 0) {
      return bot.sendMessage(msg.chat.id,
        lang === 'ar'
          ? `⚠️ لديك طلب سحب معلق بالفعل (${pendingWds[0].amount} EGP).\n\nانتظر حتى تتم معالجته قبل إنشاء طلب جديد.`
          : `⚠️ You already have a pending withdrawal (${pendingWds[0].amount} EGP).\n\nWait for it to be processed before creating a new one.`,
        { parse_mode: 'Markdown' }
      );
    }
    clearSession(userId);

    // عرض تاريخ السحوبات السابقة (آخر 3)
    const history = db.getUserWithdrawals(userId);
    let historyText = '';
    if (history.length > 0) {
      const statusIcon = { pending: '⏳', approved: '✅', rejected: '❌' };
      historyText = `\n\n📋 *${lang === 'ar' ? 'آخر سحوباتك:' : 'Recent withdrawals:'}*\n`;
      for (const w of history.slice(0, 3)) {
        const { display: wAmt, symbol: wSym } = await formatAmount(w.amount, currency);
        historyText += `${statusIcon[w.status] || '•'} ${wAmt} ${wSym} — ${methodLabel(w.method, lang)} — ${w.createdAt.substring(0, 10)}\n`;
      }
    }

    bot.sendMessage(
      msg.chat.id,
      `${t('wd_title', lang)}\n\n${t('wd_balance_avail', lang, bal, symbol)}${historyText}\n\n${t('wd_choose_method', lang)}`,
      { parse_mode: 'Markdown', reply_markup: methodKeyboard(lang) }
    );
  });

  // زرار أدمن
  bot.onText(/📤 طلبات السحب/, (msg) => {
    if (!isAdmin(msg.from.id)) return;
    sendWdAdminMenu(bot, msg.chat.id);
  });

  // استقبال نصوص
  bot.on('message', async (msg) => {
    const userId = msg.from.id;
    if (!getSession(userId)) return;
    if (!msg.text || msg.text.startsWith('/')) return;
    if (/💳 سحب|💳 Withdraw|📤 طلبات السحب/i.test(msg.text)) return;
    // فحص rate limit
    if (!isAdmin(userId) && !rateLimiter.check(userId)) return;
    await handleWithdrawText(bot, msg, userId);
  });

  // Callbacks
  bot.on('callback_query', async (query) => {
    if (query._blocked) return;   // Idempotency Gate
    const data   = query.data;
    const userId = query.from.id;
    const chatId = query.message.chat.id;
    const lang   = getLang(userId);

    if (data.startsWith('wd_method:')) {
      await bot.answerCallbackQuery(query.id);
      const method = data.split(':')[1];
      let hint;
      if (method === 'cash_eg') {
        hint = t('wd_enter_phone', lang);
      } else if (method === 'binance') {
        hint = t('wd_enter_binance', lang);
      } else if (isUsdt(method)) {
        const netName = method === 'usdt_trc20' ? 'TRC20 (Tron)' : 'BEP20 (BSC)';
        hint = lang === 'ar'
          ? `💎 *شبكة ${netName}*\n\nأرسل عنوان محفظة USDT الخاصة بك على شبكة ${netName}:\n\n⚠️ تأكد أن العنوان صحيح وعلى الشبكة الصحيحة — أي خطأ قد يؤدي لضياع الأموال.`
          : `💎 *${netName} Network*\n\nSend your USDT wallet address on ${netName}:\n\n⚠️ Make sure the address is correct and on the right network.`;
      } else {
        hint = t('wd_enter_binance', lang);
      }
      setSession(userId, 'details', { method });
      bot.sendMessage(chatId, hint, {
        parse_mode: 'Markdown',
        reply_markup: cancelReplyKeyboard(lang),
      });
      return;
    }

    // اختيار شبكة USDT
    if (data === 'wd_usdt_net') {
      await bot.answerCallbackQuery(query.id);
      const msg = lang === 'ar'
        ? '💎 *اختر شبكة USDT:*\n\n• *TRC20* — شبكة Tron (رسوم أقل)\n• *BEP20* — شبكة BSC (Binance Smart Chain)'
        : '💎 *Select USDT network:*\n\n• *TRC20* — Tron network (lower fees)\n• *BEP20* — BSC (Binance Smart Chain)';
      bot.sendMessage(chatId, msg, { parse_mode: 'Markdown', reply_markup: usdtNetKeyboard(lang) });
      return;
    }

    if (data === 'wd_back_method') {
      await bot.answerCallbackQuery(query.id);
      clearSession(userId);
      await sendWithdrawStart(bot, chatId, userId, lang);
      return;
    }

    // إلغاء
    if (data === 'wd_cancel') {
      await bot.answerCallbackQuery(query.id);
      clearSession(userId);
      await sendWithdrawStart(bot, chatId, userId, lang);
      return;
    }

    // تأكيد
    if (data === 'wd_confirm') {
      await bot.answerCallbackQuery(query.id);
      const session = getSession(userId);
      if (!session || session.step !== 'confirm') return;
      const { method, details, amountEgp, _rate } = session.data;
      const currency = getCurrency(userId);

      const user = db.getUser(userId);
      if (amountEgp > user.balance) {
        clearSession(userId);
        return bot.sendMessage(chatId, t('wd_balance_changed', lang));
      }

      const username = query.from.username ? `@${query.from.username}` : query.from.first_name;
      const wd = db.createWithdrawal({ userId, username, method, details, amount: amountEgp });
      clearSession(userId);

      const { display, symbol } = await formatAmount(amountEgp, currency);
      bot.sendMessage(chatId,
        t('wd_success', lang, wd.id.substring(0, 8), methodLabel(method, lang), display, symbol),
        { parse_mode: 'Markdown', reply_markup: { remove_keyboard: true } }
      );

      // إشعار الأدمنز بطلب السحب الجديد
      const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
      const networkNote = isUsdt(method)
        ? `🌐 الشبكة: *${method === 'usdt_trc20' ? 'TRC20 (Tron)' : 'BEP20 (BSC)'}*\n`
        : '';
      for (const adminId of ADMIN_IDS) {
        bot.sendMessage(adminId,
          `💳 *طلب سحب جديد!*\n\n` +
          `👤 المستخدم: ${escMd(username)}\n` +
          `🆔 \`${userId}\`\n` +
          `💰 المبلغ: *${display} ${symbol}*\n` +
          `💳 الطريقة: ${methodLabel(method, 'ar')}\n` +
          networkNote +
          `📋 ${isUsdt(method) ? 'العنوان' : 'التفاصيل'}: \`${escMd(details)}\`\n` +
          `📅 ${new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' })}`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                { text: '📤 طلبات السحب', callback_data: 'wda_list:pending:0' },
              ]],
            },
          }
        ).catch(() => {});
      }
      return;
    }

    // ═══════════════════════ ADMIN ═══════════════════════
    if (!isAdmin(userId)) return;

    if (data === 'wda_menu') {
      await bot.answerCallbackQuery(query.id);
      sendWdAdminMenu(bot, chatId);
      return;
    }

    if (data.startsWith('wda_list:')) {
      await bot.answerCallbackQuery(query.id);
      const parts  = data.split(':');
      const status = parts[1];
      const page   = parseInt(parts[2]) || 0;
      sendWdList(bot, chatId, status, page);
      return;
    }

    if (data.startsWith('wda_detail:')) {
      await bot.answerCallbackQuery(query.id);
      const parts      = data.split(':');
      const wdId       = parts[1];
      const backStatus = parts[2] || 'pending';
      const backPage   = parseInt(parts[3]) || 0;
      sendWdDetail(bot, chatId, wdId, backStatus, backPage);
      return;
    }

    // ✅ تم الدفع — يُرسل إشعار تأكيد للمستخدم ويمسح الطلب
    if (data.startsWith('wda_paid:')) {
      await bot.answerCallbackQuery(query.id, { text: '✅ جاري المعالجة...' });
      const parts   = data.split(':');
      const wdId    = parts[1];
      const page    = parseInt(parts[2]) || 0;
      const wd      = db.updateWithdrawalStatus(wdId, 'approved');
      if (!wd) return bot.sendMessage(chatId, '⚠️ الطلب غير موجود أو تم معالجته مسبقاً.');

      // إشعار المستخدم بتأكيد الوصول
      const userLang = getLang(wd.userId);
      const userCur  = getCurrency(wd.userId);
      const { display, symbol } = await formatAmount(wd.amount, userCur);
      const networkNote = isUsdt(wd.method)
        ? `🌐 الشبكة: *${wd.method === 'usdt_trc20' ? 'TRC20 (Tron)' : 'BEP20 (BSC)'}*\n`
        : '';
      await notifyUser(bot, wd.userId,
        `💸 *تم إرسال مبلغ سحبك!*\n\n` +
        `💰 المبلغ: *${display} ${symbol}*\n` +
        `💳 الطريقة: ${methodLabel(wd.method, userLang)}\n` +
        networkNote +
        `📋 ${wd.details}\n\n` +
        `✅ *تأكد من وصول المبلغ في محفظتك.*\n` +
        `📞 لو في أي مشكلة تواصل مع الدعم.`
      );

      // رسالة الجروب بعد الموافقة
      const withdrawalGroup = process.env.WITHDRAWAL_GROUP;
      const botUsername     = process.env.BOT_USERNAME || '';
      if (withdrawalGroup) {
        const userObj   = db.getUser(wd.userId);
        const userMention = userObj?.username ? `@${escMd(userObj.username)}` : escMd(userObj?.firstName || String(wd.userId));
        const { display: egpDisplay } = await formatAmount(wd.amount, 'egp');
        const now = new Date().toLocaleString('ar-EG', {
          timeZone: 'Africa/Cairo',
          year: 'numeric', month: 'numeric', day: 'numeric',
          hour: '2-digit', minute: '2-digit',
        });
        const groupMsg =
          `🎉 *تم صرف مكافأة جديدة!*\n\n` +
          `👤 المستخدم: ${userMention}\n` +
          `💵 القيمة: *${egpDisplay}.00 جنيه*\n` +
          `🕐 الوقت: ${now}\n\n` +
          `🙏 شكراً لأنك تعمل معنا!\n` +
          `💪 استمر في العمل وستحصل على المزيد\n\n` +
          `🤖 ${escMd(botUsername)}`;
        bot.sendMessage(withdrawalGroup, groupMsg, { parse_mode: 'Markdown' }).catch(() => {});
      }

      // تحديث قائمة الطلبات المعلقة
      await editWdPendingList(bot, chatId, query.message.message_id, page);
      return;
    }

    // قبول فردي (من صفحة التفاصيل القديمة)
    if (data.startsWith('wda_approve:')) {
      await bot.answerCallbackQuery(query.id);
      const parts  = data.split(':');
      const wdId   = parts[1];
      const page   = parseInt(parts[2]) || 0;
      const wd     = db.updateWithdrawalStatus(wdId, 'approved');
      if (!wd) return bot.sendMessage(chatId, '⚠️ الطلب غير موجود.');
      bot.sendMessage(chatId, `✅ تم قبول الطلب \`${wdId.substring(0, 8)}\`.`, { parse_mode: 'Markdown' });
      const userLang = getLang(wd.userId);
      const userCur  = getCurrency(wd.userId);
      const { display, symbol } = await formatAmount(wd.amount, userCur);
      await notifyUser(bot, wd.userId,
        t('notify_wd_approved', userLang, methodLabel(wd.method, userLang), display, symbol, wd.details)
      );

      // رسالة الجروب
      const withdrawalGroup = process.env.WITHDRAWAL_GROUP;
      const botUsername     = process.env.BOT_USERNAME || '';
      if (withdrawalGroup) {
        const userObj     = db.getUser(wd.userId);
        const userMention = userObj?.username ? `@${escMd(userObj.username)}` : escMd(userObj?.firstName || String(wd.userId));
        const { display: egpDisplay } = await formatAmount(wd.amount, 'egp');
        const now = new Date().toLocaleString('ar-EG', {
          timeZone: 'Africa/Cairo',
          year: 'numeric', month: 'numeric', day: 'numeric',
          hour: '2-digit', minute: '2-digit',
        });
        bot.sendMessage(withdrawalGroup,
          `🎉 *تم صرف مكافأة جديدة!*\n\n` +
          `👤 المستخدم: ${userMention}\n` +
          `💵 القيمة: *${egpDisplay}.00 جنيه*\n` +
          `🕐 الوقت: ${now}\n\n` +
          `🙏 شكراً لأنك تعمل معنا!\n` +
          `💪 استمر في العمل وستحصل على المزيد\n\n` +
          `🤖 ${escMd(botUsername)}`,
          { parse_mode: 'Markdown' }
        ).catch(() => {});
      }

      sendWdList(bot, chatId, 'pending', page);
      return;
    }

    // رفض فردي
    if (data.startsWith('wda_reject_ask:')) {
      await bot.answerCallbackQuery(query.id);
      const parts = data.split(':');
      const wdId  = parts[1];
      const page  = parseInt(parts[2]) || 0;
      setSession(userId, 'reject_reason', { wdId, page });
      bot.sendMessage(chatId, '📝 أدخل سبب الرفض (أو أرسل "تخطي"):');
      return;
    }

    // قبول جماعي
    if (data === 'wda_bulk_approve') {
      await bot.answerCallbackQuery(query.id);
      const pending = db.getWithdrawals('pending');
      if (!pending.length) return bot.sendMessage(chatId, '📭 لا توجد طلبات معلقة.');
      bot.sendMessage(chatId, `هل تريد قبول *${pending.length}* طلب سحب معلق؟`,
        { parse_mode: 'Markdown', reply_markup: confirmBulkKeyboard('approve') });
      return;
    }

    // رفض جماعي
    if (data === 'wda_bulk_reject') {
      await bot.answerCallbackQuery(query.id);
      const pending = db.getWithdrawals('pending');
      if (!pending.length) return bot.sendMessage(chatId, '📭 لا توجد طلبات معلقة.');
      bot.sendMessage(chatId,
        `هل تريد رفض *${pending.length}* طلب سحب معلق؟\n_(سيتم إعادة الأرصدة)_`,
        { parse_mode: 'Markdown', reply_markup: confirmBulkKeyboard('reject') });
      return;
    }

    // تنفيذ جماعي
    if (data.startsWith('wda_bulk_ok:')) {
      await bot.answerCallbackQuery(query.id);
      const action  = data.split(':')[1];
      const pending = db.getWithdrawals('pending');
      let done = 0;
      for (const wd of pending) {
        const updated = db.updateWithdrawalStatus(wd.id, action === 'approve' ? 'approved' : 'rejected');
        if (updated) {
          done++;
          const uLang = getLang(wd.userId);
          const uCur  = getCurrency(wd.userId);
          const { display, symbol } = await formatAmount(wd.amount, uCur);
          if (action === 'approve') {
            await notifyUser(bot, wd.userId,
              t('notify_wd_approved', uLang, methodLabel(wd.method, uLang), display, symbol, wd.details));
          } else {
            await notifyUser(bot, wd.userId,
              t('notify_wd_rejected', uLang, methodLabel(wd.method, uLang), display, symbol, null));
          }
        }
      }
      bot.sendMessage(chatId, `${action === 'approve' ? '✅' : '❌'} تمت معالجة *${done}* طلب.`,
        { parse_mode: 'Markdown' });
      return;
    }
  });
}

// ─────────────────────────────────────────────
//  Admin display helpers
// ─────────────────────────────────────────────
async function sendWdAdminMenu(bot, chatId) {
  // فتح قائمة الطلبات المعلقة مباشرة
  sendWdList(bot, chatId, 'pending', 0);
}

// ─────────────────────────────────────────────
//  قائمة الطلبات — المعلقة بالتصميم الجديد
// ─────────────────────────────────────────────
async function sendWdList(bot, chatId, status, page = 0) {
  const list  = db.getWithdrawals(status);
  const total = list.length;

  if (!total) {
    return bot.sendMessage(chatId, '📭 لا توجد طلبات.', {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '🔙 رجوع', callback_data: 'wda_menu' }]] },
    });
  }

  // للطلبات المعلقة: طلب + زرار "تم الدفع" في نفس الصف
  if (status === 'pending') {
    const { rows, safePage, totalPages } = buildWdPendingKeyboard(list, page);
    return bot.sendMessage(chatId,
      `⏳ *الطلبات المعلقة (${total})* — صفحة ${safePage + 1}/${totalPages}:`,
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows } }
    );
  }

  // للمقبولة والمرفوضة: التصميم العادي
  const PAGE       = 10;
  const totalPages = Math.ceil(total / PAGE) || 1;
  const safePage   = Math.max(0, Math.min(page, totalPages - 1));
  const slice      = list.slice(safePage * PAGE, (safePage + 1) * PAGE);

  const rows = slice.map(w => [{
    text: `${w.username}  |  💰${w.amount} EGP  |  ${methodLabel(w.method, 'ar')}`,
    callback_data: `wda_detail:${w.id}:${status}:${safePage}`,
  }]);

  const nav = [];
  if (safePage > 0)              nav.push({ text: '◀️ السابق', callback_data: `wda_list:${status}:${safePage - 1}` });
  if (safePage < totalPages - 1) nav.push({ text: '▶️ التالي', callback_data: `wda_list:${status}:${safePage + 1}` });
  if (nav.length) rows.push(nav);
  rows.push([{ text: '🔙 رجوع', callback_data: 'wda_menu' }]);

  bot.sendMessage(chatId,
    `📋 *الطلبات (${total})* — صفحة ${safePage + 1}/${totalPages}:`,
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows } }
  );
}

// ─────────────────────────────────────────────
//  تحديث قائمة الطلبات المعلقة في نفس الرسالة
//  (يُستدعى بعد الضغط على "تم الدفع")
// ─────────────────────────────────────────────
async function editWdPendingList(bot, chatId, messageId, page = 0) {
  const list  = db.getWithdrawals('pending');
  const total = list.length;

  if (!total) {
    // مفيش طلبات متبقية
    return bot.editMessageText(
      '✅ *تم معالجة جميع طلبات السحب!*\n\n📭 لا توجد طلبات معلقة.',
      {
        chat_id: chatId, message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '🔙 رجوع', callback_data: 'wda_menu' }]] },
      }
    ).catch(() => {});
    return;
  }

  const { rows, safePage, totalPages } = buildWdPendingKeyboard(list, page);

  bot.editMessageText(
    `⏳ *الطلبات المعلقة (${total})* — صفحة ${safePage + 1}/${totalPages}:`,
    {
      chat_id: chatId, message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: rows },
    }
  ).catch(() => {});
}

async function sendWdDetail(bot, chatId, wdId, backStatus = 'pending', backPage = 0) {
  const wd = db.getWithdrawals().find(w => w.id === wdId);
  if (!wd) return bot.sendMessage(chatId, '⚠️ الطلب غير موجود.');
  const rate = await getUsdtEgpRate();
  bot.sendMessage(chatId, formatWdAdmin(wd, rate), {
    parse_mode: 'Markdown',
    reply_markup: wdDetailKeyboard(wdId, wd.status, backStatus, backPage),
  });
}

module.exports = { register };
