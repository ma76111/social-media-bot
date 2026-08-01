'use strict';

const db      = require('../db');
const { t, currencySymbol, LANG_NAMES, CURRENCY_NAMES } = require('../i18n');
const { formatAmount } = require('../utils/price');
const { sendSettingsPage } = require('./onboarding');
const rateLimiter = require('../utils/rateLimiter');

const PENDING_PAGE_SIZE = 12;

// ─────────────────────────────────────────────
//  Session state
// ─────────────────────────────────────────────
const sessions = {};
function clearSession(userId) { delete sessions[userId]; }

// تتبع المستخدمين اللي فتحوا تفاصيل مهمة وينتظرون بدء التنفيذ
const _pendingStart = {};

// ─────────────────────────────────────────────
//  User prefs helpers
// ─────────────────────────────────────────────
function getLang(userId) {
  const u = db.getUser(userId);
  return u.lang || 'ar';
}
function getCurrency(userId) {
  const u = db.getUser(userId);
  return u.currency || 'egp';
}

// ثوابت زرارات الإلغاء والرجوع
const BTN_CANCEL_AR = '❌ إلغاء';
const BTN_CANCEL_EN = '❌ Cancel';
const BTN_BACK_AR   = '↩️ رجوع';
const BTN_BACK_EN   = '↩️ Back';

// ─────────────────────────────────────────────
//  Keyboards  (نصوص متعددة اللغات)
// ─────────────────────────────────────────────

function mainMenuKeyboard(tasks = [], lang = 'ar') {
  const sym   = currencySymbol(getCurrencyFromLang(lang)); // fallback
  const taskRows = tasks.map(task => [{
    text: `${task.isOpen ? '🟢' : '🔴'} ${task.name}  💰 ${task.reward}`,
  }]);
  return {
    reply_markup: {
      keyboard: [
        ...taskRows,
        [{ text: t('btn_balance', lang) }, { text: t('btn_pending', lang) }],
        [{ text: t('btn_withdraw', lang) }, { text: t('btn_settings', lang) }],
      ],
      resize_keyboard: true,
    },
  };
}

function mainMenuKeyboardForUser(tasks = [], userId) {
  const lang = getLang(userId);
  const taskRows = tasks.map(task => [{
    text: `🟢 ${task.name} 💰 ${task.reward}`,
  }]);
  return {
    reply_markup: {
      keyboard: [
        ...taskRows,
        [{ text: t('btn_balance', lang) }, { text: t('btn_pending', lang) }],
        [{ text: t('btn_withdraw', lang) }, { text: t('btn_settings', lang) }],
        [{ text: '🆔 معرفي' }],
      ],
      resize_keyboard: true,
    },
  };
}

function startTaskKeyboard(taskId, lang = 'ar') {
  return {
    inline_keyboard: [[
      { text: t('btn_start_task', lang), callback_data: `task_start:${taskId}` },
    ]],
  };
}

function confirmKeyboard(taskId, lang = 'ar') {
  return {
    inline_keyboard: [[
      { text: t('btn_confirm_sub', lang), callback_data: `task_confirm:${taskId}` },
      { text: t('btn_cancel', lang),      callback_data: `task_cancel:${taskId}`  },
    ]],
  };
}

function skipKeyboard(lang = 'ar') {
  return {
    inline_keyboard: [[
      { text: t('btn_skip', lang), callback_data: 'field_skip' },
    ]],
  };
}

function pendingNavKeyboard(page, totalPages, lang = 'ar') {
  const nav = [];
  if (page > 0)              nav.push({ text: t('btn_prev', lang), callback_data: `pending_page:${page - 1}` });
  if (page < totalPages - 1) nav.push({ text: t('btn_next', lang), callback_data: `pending_page:${page + 1}` });
  return { inline_keyboard: nav.length ? [nav] : [] };
}

// ─────────────────────────────────────────────
//  Field validation/extraction
// ─────────────────────────────────────────────

function typeHint(type, lang) {
  const map = {
    email:    'hint_email',   url:   'hint_url',
    phone:    'hint_phone',   image: 'hint_image',
    file:     'hint_file',    password:'hint_password',
    number:   'hint_number',  text:  'hint_text',
  };
  return t(map[type] || 'hint_text', lang);
}

function validateField(type, msg) {
  if (type === 'image')  return !!msg.photo;
  if (type === 'file')   return !!msg.document;
  if (type === 'url')    return msg.text && /^https?:\/\/.+/.test(msg.text.trim());
  if (type === 'email')  return msg.text && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(msg.text.trim());
  if (type === 'phone')  return msg.text && /^\+?[\d\s\-]{7,15}$/.test(msg.text.trim());
  if (type === 'number') return msg.text && !isNaN(msg.text.trim());
  return !!msg.text;
}

function extractValue(type, msg) {
  if (type === 'image') return msg.photo[msg.photo.length - 1].file_id;
  if (type === 'file')  return msg.document.file_id;
  return msg.text ? msg.text.trim() : '';
}

// ─────────────────────────────────────────────
//  Summary builder
// ─────────────────────────────────────────────

function buildSummary(task, answers, lang) {
  const fields = [...task.fields].sort((a, b) => a.order - b.order);
  let text = `${t('review_title', lang)}\n\n${t('review_task', lang, task.name)}\n\n`;
  for (const f of fields) {
    const val = answers[f.id];
    const display = val
      ? (f.type === 'image' || f.type === 'file' ? t('review_uploaded', lang) : val)
      : t('review_empty', lang);
    text += `• *${f.label}:* ${display}\n`;
  }
  text += `\n${t('review_question', lang)}`;
  return text;
}

// ─────────────────────────────────────────────
//  Pending page builder
// ─────────────────────────────────────────────

function getUserPendingItems(userId) {
  const items = [];
  for (const task of db.listTasks()) {
    for (const sub of db.getSubmissions(task.id, 'pending').filter(s => s.userId === userId)) {
      items.push({ task, sub });
    }
  }
  return items.sort((a, b) => b.sub.submittedAt.localeCompare(a.sub.submittedAt));
}

async function buildPendingText(items, page, userId) {
  const lang     = getLang(userId);
  const currency = getCurrency(userId);
  const total    = items.length;
  const pages    = Math.max(1, Math.ceil(total / PENDING_PAGE_SIZE));
  const slice    = items.slice(page * PENDING_PAGE_SIZE, (page + 1) * PENDING_PAGE_SIZE);

  // مجموع المكافآت بالعملة المختارة
  const totalEgp   = items.reduce((s, i) => s + i.task.reward, 0);
  const { display: totalAmt, symbol } = await formatAmount(totalEgp, currency);

  let text =
    `${t('pending_title', lang)}\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `${t('pending_total_tasks',  lang, total)}\n` +
    `${t('pending_total_amt',    lang, totalAmt, symbol)}\n` +
    `━━━━━━━━━━━━━━━━━━\n\n`;

  if (slice.length === 0) {
    return { text: text + t('pending_empty', lang), pages };
  }

  for (const { task, sub } of slice) {
    const { display: rewardDisplay, symbol: sym } = await formatAmount(task.reward, currency);
    const fields = [...task.fields].sort((a, b) => a.order - b.order);
    text += `📌 *${task.name}*\n`;
    text += `${t('task_reward', lang, rewardDisplay, sym)}\n`;
    text += `📅 ${sub.submittedAt}\n`;
    for (const f of fields) {
      const val = sub.data[f.id];
      if (val) {
        const display = (f.type === 'image' || f.type === 'file') ? '📎' : val;
        text += `• ${f.label}: \`${display}\`\n`;
      }
    }
    text += '\n';
  }

  if (pages > 1) text += t('pending_page', lang, page + 1, pages);
  return { text, pages };
}

// ─────────────────────────────────────────────
//  All menu btn texts (for filtering in message handler)
// ─────────────────────────────────────────────

function allMenuTexts() {
  const keys = ['btn_balance', 'btn_pending', 'btn_withdraw', 'btn_settings'];
  const texts = new Set();
  for (const k of keys) {
    texts.add(t(k, 'ar'));
    texts.add(t(k, 'en'));
  }
  texts.add('🆔 معرفي');
  texts.add(t('btn_start_task', 'ar'));
  texts.add(t('btn_start_task', 'en'));
  texts.add(BTN_CANCEL_AR);
  texts.add(BTN_CANCEL_EN);
  texts.add(BTN_BACK_AR);
  texts.add(BTN_BACK_EN);
  return texts;
}
const MENU_TEXTS = allMenuTexts();

// ─────────────────────────────────────────────
//  register
// ─────────────────────────────────────────────

function register(bot) {

  // ── /start placeholder (index.js يستدعي _sendUserStart) ──
  bot.onText(/\/start/, (msg) => {
    clearSession(msg.from.id);
    db.getUser(msg.from.id);
  });

  // _sendUserStart يُستدعى من index.js بعد التحقق من onboarding
  bot._sendUserStart = (msg) => {
    clearSession(msg.from.id);
    db.getUser(msg.from.id);
    sendHome(bot, msg.chat.id, msg.from.id, msg.from.first_name);
  };

  // ── رصيدي ─────────────────────────────────
  bot.onText(new RegExp(`${escRe(t('btn_balance','ar'))}|${escRe(t('btn_balance','en'))}`), async (msg) => {
    const userId   = msg.from.id;
    const lang     = getLang(userId);
    const currency = getCurrency(userId);
    const user     = db.getUser(userId);
    const { display: bal,    symbol: sym }  = await formatAmount(user.balance,     currency);
    const { display: earned, symbol: sym2 } = await formatAmount(user.totalEarned, currency);
    bot.sendMessage(msg.chat.id, t('balance_text', lang, bal, earned, sym), { parse_mode: 'Markdown' });
  });

  // ── الأموال المعلقة ────────────────────────
  bot.onText(new RegExp(`${escRe(t('btn_pending','ar'))}|${escRe(t('btn_pending','en'))}`), (msg) => {
    sendPendingPage(bot, msg.chat.id, msg.from.id, 0);
  });

  // ── الإعدادات ──────────────────────────────
  bot.onText(new RegExp(`${escRe(t('btn_settings','ar'))}|${escRe(t('btn_settings','en'))}`), (msg) => {
    sendSettingsPage(bot, msg.chat.id, msg.from.id);
  });

  // ── معرفي ──────────────────────────────────
  bot.onText(/🆔 معرفي/, (msg) => {
    bot.sendMessage(
      msg.chat.id,
      `🆔 *Telegram ID:* \`${msg.from.id}\``,
      { parse_mode: 'Markdown' }
    );
  });

  // ── Callbacks ─────────────────────────────
  bot.on('callback_query', async (query) => {
    if (query._blocked) return;   // Idempotency Gate
    const data   = query.data;
    const userId = query.from.id;
    const chatId = query.message.chat.id;
    const msgId  = query.message.message_id;
    const lang   = getLang(userId);

    // فحص الحظر قبل أي action للمستخدم
    if (data.startsWith('task_') || data === 'field_skip' || data.startsWith('pending_')) {
      const user = db.getUser(userId);
      if (user.isBanned) {
        await bot.answerCallbackQuery(query.id, { text: '🚫 حسابك محظور.', show_alert: true });
        return;
      }
    }

    if (data.startsWith('task_view:')) {
      await bot.answerCallbackQuery(query.id);
      const task = db.getTask(data.split(':')[1]);
      if (!task || !task.isOpen) return bot.sendMessage(chatId, t('task_unavailable', lang));
      await _sendTaskDetail(bot, chatId, task, userId);
      return;
    }

    if (data.startsWith('task_start:')) {
      await bot.answerCallbackQuery(query.id);
      await startTask(bot, chatId, userId, data.split(':')[1], lang);
      return;
    }

    if (data === 'field_skip') {
      await handleFieldSkip(bot, chatId, userId, query);
      return;
    }

    if (data.startsWith('task_confirm:')) {
      await bot.answerCallbackQuery(query.id);
      await confirmSubmission(bot, chatId, userId, data.split(':')[1], query);
      return;
    }

    if (data.startsWith('task_cancel:')) {
      clearSession(userId);
      await bot.answerCallbackQuery(query.id);
      const tasks = db.listTasks(true);
      bot.sendMessage(chatId, t('cancel_msg', lang), mainMenuKeyboardForUser(tasks, userId));
      return;
    }
    if (data.startsWith('pending_page:')) {
      await bot.answerCallbackQuery(query.id);
      const page = parseInt(data.split(':')[1]) || 0;
      await editPendingPage(bot, chatId, msgId, userId, page);
      return;
    }

    // ── ميزة: feat: callbacks تُعالَج في features.js فقط ─────
    // (تمت إزالة المعالجة المكررة هنا لتجنب الإجابة المزدوجة)

    bot.answerCallbackQuery(query.id);
  });

  // ── استقبال الرسائل ────────────────────────
  bot.on('message', async (msg) => {
    const userId = msg.from.id;
    const text   = msg.text;
    const session = sessions[userId];

    // فحص rate limit — لو محجوب نوقف المعالجة فوراً
    if (rateLimiter && !rateLimiter.check(userId)) return;

    // فحص الحظر
    if (session && session.step === 'filling') {
      const user = db.getUser(userId);
      if (user.isBanned) {
        clearSession(userId);
        return bot.sendMessage(msg.chat.id, '🚫 حسابك محظور، لا يمكنك إرسال تسليمات.');
      }
    }

    // ── زرار إلغاء ──────────────────────────────────────────
    if (text === BTN_CANCEL_AR || text === BTN_CANCEL_EN) {
      // يشتغل دايماً — حتى لو مفيش session
      clearSession(userId);
      const tasks = db.listTasks(true);
      const lang  = getLang(userId);
      return bot.sendMessage(msg.chat.id,
        lang === 'ar' ? '❌ تم إلغاء التسليم.' : '❌ Submission cancelled.',
        mainMenuKeyboardForUser(tasks, userId)
      );
    }

    // ── زرار رجوع للحقل السابق ───────────────────────────────
    if (text === BTN_BACK_AR || text === BTN_BACK_EN) {
      if (session && session.step === 'filling') {
        if (session.fieldIndex > 0) {
          session.fieldIndex--;
          const task   = db.getTask(session.taskId);
          const fields = [...task.fields].sort((a, b) => a.order - b.order);
          const field  = fields[session.fieldIndex];
          delete session.answers[field.id];
          const lang    = getLang(userId);
          const isFirst = session.fieldIndex === 0;
          return askField(bot, msg.chat.id, field, lang, isFirst);
        }
      }
      // مفيش session أو أول حقل — إلغاء وارجع للقائمة
      clearSession(userId);
      const tasks = db.listTasks(true);
      const lang  = getLang(userId);
      return bot.sendMessage(msg.chat.id,
        lang === 'ar' ? '❌ تم إلغاء التسليم.' : '❌ Submission cancelled.',
        mainMenuKeyboardForUser(tasks, userId)
      );
    }

    // ── زرار "بدء التنفيذ" ───────────────────────────────────
    if (text && (text === t('btn_start_task', 'ar') || text === t('btn_start_task', 'en'))) {
      const taskId = _pendingStart[userId];
      delete _pendingStart[userId];
      if (!taskId) {
        const tasks = db.listTasks(true);
        return bot.sendMessage(msg.chat.id,
          getLang(userId) === 'ar' ? '⚠️ اختر مهمة أولاً.' : '⚠️ Choose a task first.',
          mainMenuKeyboardForUser(tasks, userId)
        );
      }
      const lang = getLang(userId);
      // نبدأ مباشرة بدون رسالة وسيطة — askField هيبعت الـ cancel keyboard
      await startTask(bot, msg.chat.id, userId, taskId, lang);
      return;
    }

    // زرار مهمة من الـ keyboard — يشتغل للكل (مستخدم وأدمن)
    // الصيغة الثابتة: "🟢 {اسم المهمة} 💰 {المكافأة}"
    if (text) {
      // أولاً: ابحث عن اسم المهمة مباشرة في النص (الأسرع والأموثوق)
      const allOpenTasks = db.listTasks(true);
      const task = allOpenTasks.find(tk => text.includes(tk.name));
      if (task) {
        await showTaskDetailByTask(bot, msg.chat.id, userId, task);
        return;
      }
    }

    if (!session || session.step !== 'filling') return;
    if (text && text.startsWith('/')) return;
    if (text && MENU_TEXTS.has(text)) return;

    await handleFieldAnswer(bot, msg, userId, session);
  });
}

// ─────────────────────────────────────────────
//  sendHome
// ─────────────────────────────────────────────

async function sendHome(bot, chatId, userId, firstName) {
  const tasks = db.listTasks(true);
  const lang  = getLang(userId);
  const text  = tasks.length === 0
    ? `👋 *${firstName || ''}*\n\n${t('home_no_tasks', lang)}`
    : t('home_greeting', lang, firstName || '');

  bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    ...mainMenuKeyboardForUser(tasks, userId),
  });
}

// ─────────────────────────────────────────────
//  Pending page
// ─────────────────────────────────────────────

async function sendPendingPage(bot, chatId, userId, page) {
  const items          = getUserPendingItems(userId);
  const { text, pages } = await buildPendingText(items, page, userId);
  const lang           = getLang(userId);
  bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: pendingNavKeyboard(page, pages, lang),
  });
}

async function editPendingPage(bot, chatId, msgId, userId, page) {
  const items          = getUserPendingItems(userId);
  const { text, pages } = await buildPendingText(items, page, userId);
  const lang           = getLang(userId);
  try {
    await bot.editMessageText(text, {
      chat_id: chatId, message_id: msgId,
      parse_mode: 'Markdown',
      reply_markup: pendingNavKeyboard(page, pages, lang),
    });
  } catch { /* unchanged message */ }
}

// ─────────────────────────────────────────────
//  Task detail
// ─────────────────────────────────────────────

async function showTaskDetailByTask(bot, chatId, userId, task) {
  if (!task?.isOpen) return bot.sendMessage(chatId, t('task_unavailable', getLang(userId)));
  if (!task.fields || task.fields.length === 0) {
    return bot.sendMessage(chatId, t('task_no_fields', getLang(userId)));
  }
  await _sendTaskDetail(bot, chatId, task, userId);
}

async function _sendTaskDetail(bot, chatId, task, userId) {
  const lang     = getLang(userId);
  const currency = getCurrency(userId);
  const { display, symbol } = await formatAmount(task.reward, currency);

  let text = `📌 *${task.name}*\n\n`;
  text += `${t('task_reward', lang, display, symbol)}\n\n`;
  text += `${t('task_desc_label', lang)}\n${task.fullDesc}`;

  if (task.videoFileId) await bot.sendVideo(chatId, task.videoFileId, { caption: '🎥' });
  await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });

  // أزرار الميزات inline (لو في ميزات)
  const { buildFeatureButtons } = require('./features');
  const featRows = buildFeatureButtons(task, lang);
  if (featRows.length > 0) {
    await bot.sendMessage(chatId,
      lang === 'ar' ? '🎯 *أدوات المهمة:*' : '🎯 *Task Tools:*',
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: featRows } }
    );
  }

  // زرار "بدء التنفيذ" في الـ keyboard السفلي
  const startBtnText = t('btn_start_task', lang);
  bot.sendMessage(
    chatId,
    lang === 'ar' ? '👇 اضغط لبدء التنفيذ:' : '👇 Press to start:',
    {
      reply_markup: {
        keyboard: [[{ text: startBtnText }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    }
  );

  _pendingStart[userId] = task.id;
}

// ─────────────────────────────────────────────
//  Submission flow
// ─────────────────────────────────────────────

async function startTask(bot, chatId, userId, taskId, lang) {
  const user = db.getUser(userId);
  if (user.isBanned) return bot.sendMessage(chatId, '🚫 حسابك محظور، لا يمكنك تنفيذ مهام.');
  const task = db.getTask(taskId);
  if (!task?.isOpen) return bot.sendMessage(chatId, t('task_unavailable', lang));
  if (task.fields.length === 0) return bot.sendMessage(chatId, t('task_no_fields', lang));
  if (task.maxPerUser !== null) {
    if (db.countUserSubmissions(taskId, userId) >= task.maxPerUser)
      return bot.sendMessage(chatId, t('task_max_reached', lang, task.maxPerUser));
  }
  const fields = [...task.fields].sort((a, b) => a.order - b.order);
  sessions[userId] = { step: 'filling', taskId, fieldIndex: 0, answers: {} };
  await askField(bot, chatId, fields[0], lang, true);  // isFirst = true
}

async function askField(bot, chatId, field, lang, isFirst = false) {
  const emojiMap = {
    email: '📧', url: '🔗', phone: '📱',
    image: '🖼', file: '📎', password: '🔑',
    number: '🔢', text: '✏️',
  };
  const emoji = emojiMap[field.type] || '✏️';
  const label = field.required
    ? `*${field.label}*`
    : `*${field.label}* _(${t('btn_skip', lang)})_`;

  const cancelText = lang === 'ar' ? BTN_CANCEL_AR : BTN_CANCEL_EN;
  const backText   = lang === 'ar' ? BTN_BACK_AR   : BTN_BACK_EN;

  // صف الإلغاء/رجوع في الـ reply keyboard
  const cancelRow = isFirst
    ? [{ text: cancelText }]
    : [{ text: backText }, { text: cancelText }];

  // الـ inline keyboard (للحقول الاختيارية فقط)
  const inlineRows = field.required ? [] : skipKeyboard(lang).inline_keyboard;

  // رسالة واحدة تجمع الحقل + الـ reply keyboard
  const opts = {
    parse_mode: 'Markdown',
    reply_markup: {
      keyboard: [cancelRow],
      resize_keyboard: true,
      one_time_keyboard: false,
    },
  };

  await bot.sendMessage(chatId, `${emoji} ${label}`, opts);

  // لو الحقل اختياري — نبعت inline skip في رسالة منفصلة خفيفة
  if (!field.required) {
    await bot.sendMessage(chatId,
      lang === 'ar' ? '_أو تخطى هذا الحقل:_' : '_Or skip this field:_',
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: inlineRows } }
    );
  }
}

async function handleFieldSkip(bot, chatId, userId, query) {
  await bot.answerCallbackQuery(query.id);
  const session = sessions[userId];
  if (!session || session.step !== 'filling') return;
  const lang   = getLang(userId);
  const task   = db.getTask(session.taskId);
  const fields = [...task.fields].sort((a, b) => a.order - b.order);
  const field  = fields[session.fieldIndex];
  if (!field || field.required) return bot.sendMessage(chatId, t('field_required', lang));
  session.answers[field.id] = '';
  session.fieldIndex++;
  await advanceOrConfirm(bot, chatId, userId, session, task, fields);
}

async function handleFieldAnswer(bot, msg, userId, session) {
  const chatId = msg.chat.id;
  const lang   = getLang(userId);
  const task   = db.getTask(session.taskId);
  if (!task) { clearSession(userId); return; }
  const fields = [...task.fields].sort((a, b) => a.order - b.order);
  const field  = fields[session.fieldIndex];
  if (!field) return;
  if (!validateField(field.type, msg))
    return bot.sendMessage(chatId, `❌ *${field.label}* — ${t('field_invalid', lang)}\n\n${typeHint(field.type, lang)}`, { parse_mode: 'Markdown' });
  session.answers[field.id] = extractValue(field.type, msg);
  session.fieldIndex++;
  await advanceOrConfirm(bot, chatId, userId, session, task, fields);
}

async function advanceOrConfirm(bot, chatId, userId, session, task, fields) {
  const lang = getLang(userId);
  if (session.fieldIndex < fields.length) {
    const isFirst = session.fieldIndex === 0;
    await askField(bot, chatId, fields[session.fieldIndex], lang, isFirst);
  } else {
    session.step = 'confirming';
    // أرجع الـ keyboard الرئيسي عند الملخص
    const tasks = db.listTasks(true);
    bot.sendMessage(chatId, buildSummary(task, session.answers, lang), {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: confirmKeyboard(session.taskId, lang).inline_keyboard },
    });
  }
}

async function confirmSubmission(bot, chatId, userId, taskId, query) {
  const session = sessions[userId];
  const lang    = getLang(userId);
  if (!session || session.step !== 'confirming' || session.taskId !== taskId)
    return bot.sendMessage(chatId, t('sub_session_expired', lang));

  const username = query.from.username ? `@${query.from.username}` : query.from.first_name;
  const sub = db.addSubmission(taskId, { userId, username, data: session.answers });
  clearSession(userId);

  const tasks = db.listTasks(true);
  bot.sendMessage(
    chatId,
    t('sub_success', lang, sub.id.substring(0, 8)),
    { parse_mode: 'Markdown', ...mainMenuKeyboardForUser(tasks, userId) }
  );
}

// ─────────────────────────────────────────────
//  Notification helpers (يستخدمها الأدمن)
// ─────────────────────────────────────────────

async function notifyUser(bot, userId, text) {
  try { await bot.sendMessage(userId, text, { parse_mode: 'Markdown' }); return true; }
  catch { return false; }
}

/**
 * broadcast مهمة جديدة لكل المستخدمين
 * رسالة واحدة تجمع الإشعار + keyboard المحدَّث
 * Throttle: 25 رسالة/ثانية لتجنب حظر Telegram API
 */
async function broadcastNewTask(bot, task) {
  const users = db.listUsers();
  const tasks = db.listTasks(true);
  let sent = 0;
  let batchCount = 0;
  const BATCH_SIZE = 25;       // 25 رسالة
  const BATCH_DELAY_MS = 1100; // ثم انتظر 1.1 ثانية (هامش أمان فوق 1 ثانية)

  for (const user of users) {
    if (!user.lang) continue;
    try {
      const lang     = user.lang     || 'ar';
      const currency = user.currency || 'egp';
      const { display, symbol } = await require('../utils/price').formatAmount(task.reward, currency);

      const taskRows = tasks.map(tk => [{
        text: `🟢 ${tk.name} 💰 ${tk.reward}`,
      }]);

      await bot.sendMessage(user.id,
        `🆕 *${lang === 'ar' ? 'مهمة جديدة!' : 'New Task!'}*\n\n` +
        `📌 *${task.name}*\n` +
        `${t('task_reward', lang, display, symbol)}\n\n` +
        `${task.shortDesc || ''}`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            keyboard: [
              ...taskRows,
              [{ text: t('btn_balance', lang) }, { text: t('btn_pending', lang) }],
              [{ text: t('btn_withdraw', lang) }, { text: t('btn_settings', lang) }],
              [{ text: '🆔 معرفي' }],
            ],
            resize_keyboard: true,
          },
        }
      );

      sent++;
      batchCount++;

      // كل 25 رسالة انتظر 1.1 ثانية
      if (batchCount >= BATCH_SIZE) {
        batchCount = 0;
        await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
      }
    } catch { /* المستخدم حظر البوت — نتجاهله */ }
  }
  return sent;
}

/**
 * إشعار قبول تسليم — يعرض المكافأة بعملة المستخدم
 */
async function notifyApproved(bot, sub, task) {
  const lang     = getLang(sub.userId);
  const currency = getCurrency(sub.userId);
  const { display, symbol } = await formatAmount(task.reward, currency);
  return notifyUser(bot, sub.userId,
    t('notify_approved', lang, task.name, sub.id.substring(0, 8), display, symbol)
  );
}

async function notifyRejected(bot, sub, task, reason) {
  const lang = getLang(sub.userId);
  return notifyUser(bot, sub.userId,
    t('notify_rejected', lang, task.name, sub.id.substring(0, 8), reason || '')
  );
}

// ─────────────────────────────────────────────
//  Util
// ─────────────────────────────────────────────
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function getCurrencyFromLang(lang) { return lang === 'en' ? 'usdt' : 'egp'; }

module.exports = {
  register, notifyUser, notifyApproved, notifyRejected,
  clearSession, sendHome, broadcastNewTask,
  getLang, getCurrency, mainMenuKeyboardForUser,
};
