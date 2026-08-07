'use strict';

const db          = require('../db');
const { t, currencySymbol } = require('../i18n');
const { formatAmount }      = require('../utils/price');
const { sendSettingsPage }  = require('./onboarding');
const rateLimiter           = require('../utils/rateLimiter');
const { escMd }             = require('../utils/escMd');

const PENDING_PAGE_SIZE = 12;

// ─────────────────────────────────────────────
//  Sessions
// ─────────────────────────────────────────────
const sessions     = {};
const _pendingStart = {};
let   _adminIds     = [];  // يُعبَّأ عند register
function clearSession(uid) { delete sessions[uid]; }

// ─────────────────────────────────────────────
//  Prefs
// ─────────────────────────────────────────────
function getLang(uid)     { return db.getUser(uid).lang     || 'ar'; }
function getCurrency(uid) { return db.getUser(uid).currency || 'egp'; }

// ─────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────
const BTN_CANCEL_AR = '❌ إلغاء';
const BTN_CANCEL_EN = '❌ Cancel';
const BTN_BACK_AR   = '↩️ رجوع';
const BTN_BACK_EN   = '↩️ Back';

function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// ─────────────────────────────────────────────
//  sendMsg — helper مركزي يرسل رسالة مع entities
//  يُعالج %%نص%% → code entity (قابل للنسخ)
//  باقي النص plain text — لا Markdown → لا كسر
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
//  parseCodeSpans — تحويل %%نص%% إلى code entities
//
//  ⚠️ Telegram يحسب الـ offsets بـ UTF-16
//  الحروف العربية = 1 وحدة، الإيموجي = 2 وحدة
// ─────────────────────────────────────────────
function utf16len(str) {
  let n = 0;
  for (const cp of str) n += cp.codePointAt(0) > 0xFFFF ? 2 : 1;
  return n;
}

function parseCodeSpans(rawText) {
  const entities = [];
  let   clean    = '';
  let   u16off   = 0;
  const re       = /%%([^%\n]+?)%%/g;
  let   last     = 0;
  let   m;
  while ((m = re.exec(rawText)) !== null) {
    const plain = rawText.slice(last, m.index);
    clean  += plain;
    u16off += utf16len(plain);
    const code = m[1];
    entities.push({ type: 'code', offset: u16off, length: utf16len(code) });
    clean  += code;
    u16off += utf16len(code);
    last    = m.index + m[0].length;
  }
  clean += rawText.slice(last);
  return { text: clean, entities };
}

// ─────────────────────────────────────────────
//  Keyboards
// ─────────────────────────────────────────────
async function mainMenuKeyboardForUser(tasks = [], userId) {
  const lang     = getLang(userId);
  const currency = getCurrency(userId);
  const rows = await Promise.all(tasks.map(async tk => {
    const reward = db.getEffectiveReward(userId, tk);
    const { display, symbol } = await formatAmount(reward, currency);
    return [{
      text: `🟢 ${db.getTaskText(tk, 'name', lang)} — ${display} ${symbol}`,
    }];
  }));
  return {
    reply_markup: {
      keyboard: [
        ...rows,
        [{ text: t('btn_balance', lang) }, { text: t('btn_pending', lang) }],
        [{ text: t('btn_withdraw', lang) }, { text: t('btn_settings', lang) }],
        [{ text: t('btn_myid', lang) }],
      ],
      resize_keyboard: true,
    },
  };
}

async function mainMenuKeyboard(tasks = [], lang = 'ar', userId = null) {
  const currency = userId ? getCurrency(userId) : 'egp';
  const rows = await Promise.all(tasks.map(async tk => {
    const reward = userId ? db.getEffectiveReward(userId, tk) : tk.reward;
    const { display, symbol } = await formatAmount(reward, currency);
    return [{
      text: `${tk.isOpen ? '🟢' : '🔴'} ${db.getTaskText(tk, 'name', lang)} — ${display} ${symbol}`,
    }];
  }));
  return {
    reply_markup: {
      keyboard: [
        ...rows,
        [{ text: t('btn_balance', lang) }, { text: t('btn_pending', lang) }],
        [{ text: t('btn_withdraw', lang) }, { text: t('btn_settings', lang) }],
      ],
      resize_keyboard: true,
    },
  };
}

function confirmKeyboard(taskId, lang = 'ar') {
  return {
    inline_keyboard: [[
      { text: t('btn_confirm_sub', lang), callback_data: `task_confirm:${taskId}` },
      { text: t('btn_cancel',      lang), callback_data: `task_cancel:${taskId}`  },
    ]],
  };
}

function skipKeyboard(lang = 'ar') {
  return { inline_keyboard: [[{ text: t('btn_skip', lang), callback_data: 'field_skip' }]] };
}

function pendingNavKeyboard(page, total, lang = 'ar') {
  const nav = [];
  if (page > 0)       nav.push({ text: t('btn_prev', lang), callback_data: `pending_page:${page - 1}` });
  if (page < total-1) nav.push({ text: t('btn_next', lang), callback_data: `pending_page:${page + 1}` });
  return { inline_keyboard: nav.length ? [nav] : [] };
}

// ─────────────────────────────────────────────
//  Field helpers
// ─────────────────────────────────────────────
function typeHint(type, lang) {
  const map = {
    email:'hint_email', url:'hint_url', phone:'hint_phone',
    image:'hint_image', file:'hint_file', password:'hint_password',
    number:'hint_number', text:'hint_text',
  };
  return t(map[type] || 'hint_text', lang);
}

// جلب اسم الحقل بلغة المستخدم مع fallback
function getFieldLabel(field, lang = 'ar') {
  if (!field.label) return '';
  if (typeof field.label === 'string') return field.label;
  return field.label[lang] || field.label['ar'] || Object.values(field.label).find(v => v) || '';
}

function validateField(type, msg, altType = null) {
  // دالة التحقق من نوع واحد
  function checkType(tp) {
    if (tp === 'image')  return !!msg.photo;
    if (tp === 'file')   return !!msg.document;
    if (tp === 'email')  return msg.text && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(msg.text.trim());
    if (tp === 'phone')  return msg.text && /^\+?[\d\s\-]{7,15}$/.test(msg.text.trim());
    if (tp === 'number') return msg.text && !isNaN(msg.text.trim());
    return !!msg.text;  // url, password, text — أي نص مقبول
  }
  // يقبل لو النوع الأساسي أو النوع البديل صح
  return checkType(type) || (altType ? checkType(altType) : false);
}

function extractValue(type, msg) {
  if (type === 'image') return msg.photo[msg.photo.length - 1].file_id;
  if (type === 'file')  return msg.document.file_id;
  return msg.text ? msg.text.trim() : '';
}

// ─────────────────────────────────────────────
//  Summary (ملخص التسليم)
// ─────────────────────────────────────────────
function buildSummary(task, answers, lang) {
  const fields = [...task.fields].sort((a, b) => a.order - b.order);
  let raw = '';

  for (const f of fields) {
    const val = answers[f.id];
    if (!val) continue;
    if (f.type === 'image' || f.type === 'file') {
      raw += `✅ ${lang === 'ar' ? 'تم رفع' : 'Uploaded'}: ${getFieldLabel(f, lang)}\n`;
    } else {
      raw += `%%${val}%%\n`;
    }
  }

  if (!raw) raw = t('review_empty', lang) + '\n';

  raw += `\n${t('review_question', lang)}`;
  return parseCodeSpans(raw);
}

// ─────────────────────────────────────────────
//  Pending items
// ─────────────────────────────────────────────
function getUserPendingItems(userId) {
  const items = [];
  // نقرأ كل المهام مرة واحدة — كل مهمة تحتوي على submissions داخلها
  for (const task of db.listTasks()) {
    const subs = (task.submissions || [])
      .filter(s => String(s.userId) === String(userId))
      .map(s => ({
        ...s,
        status:   s.status === 'exported' ? 'approved' : s.status,
        exported: s.status === 'exported' ? 1 : (s.exported ?? 0),
      }));
    for (const sub of subs) {
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

  // تصحيح page لو خرج عن النطاق
  const safePage = Math.min(page, pages - 1);
  const slice    = items.slice(safePage * PENDING_PAGE_SIZE, (safePage + 1) * PENDING_PAGE_SIZE);

  // إحصائيات حسب الحالة
  const pendingItems  = items.filter(i => i.sub.status === 'pending');
  const approvedItems = items.filter(i => i.sub.status === 'approved');
  const rejectedItems = items.filter(i => i.sub.status === 'rejected');

  // إجمالي الرصيد المعلق (pending فقط) — بـ getEffectiveReward
  const pendingEgp = pendingItems.reduce((s, i) => s + db.getEffectiveReward(userId, i.task), 0);
  const { display: totalAmt, symbol } = await formatAmount(pendingEgp, currency);

  const STATUS_ICON = { pending: '⏳', approved: '✅', rejected: '❌' };

  const ar = lang === 'ar';
  let headerText =
    `${t('pending_title', lang)}\n` +
    `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n` +
    `📊 ${ar ? 'الإجمالي' : 'Total'}  ·  *${total}* ${ar ? 'تسليم' : 'submission(s)'}\n` +
    `\n` +
    `⏳ ${ar ? 'معلقة' : 'Pending'}     *${pendingItems.length}*\n` +
    `✅ ${ar ? 'مقبولة' : 'Approved'}    *${approvedItems.length}*\n` +
    `❌ ${ar ? 'مرفوضة' : 'Rejected'}    *${rejectedItems.length}*\n` +
    `\n` +
    `💰 ${ar ? 'الرصيد المعلق' : 'Pending balance'}  →  *${totalAmt} ${symbol}*\n` +
    `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n\n`;

  if (slice.length === 0) {
    return { text: headerText + t('pending_empty', lang), entities: [], pages, safePage };
  }

  const STATUS_LABEL = {
    pending:  ar ? 'في الانتظار' : 'Pending',
    approved: ar ? 'مقبول'       : 'Approved',
    rejected: ar ? 'مرفوض'       : 'Rejected',
  };

  let rawItems = '';
  for (const { task, sub } of slice) {
    const effectiveReward = db.getEffectiveReward(userId, task);
    const { display: rd, symbol: rs } = await formatAmount(effectiveReward, currency);
    const taskName   = db.getTaskText(task, 'name', lang);
    const fields     = [...task.fields].sort((a, b) => a.order - b.order);
    const statusIcon = STATUS_ICON[sub.status] || '•';
    const statusLbl  = STATUS_LABEL[sub.status] || sub.status;

    rawItems += `${statusIcon} ${taskName}  ·  ${rd} ${rs}\n`;
    rawItems += `   ${ar ? 'الحالة:' : 'Status:'} ${statusLbl}  ·  📅 ${sub.submittedAt.substring(0, 16)}\n`;

    if (sub.status === 'rejected' && sub.rejectReason) {
      rawItems += `   📝 ${ar ? 'سبب الرفض:' : 'Reason:'} ${sub.rejectReason}\n`;
    }

    const textVals  = fields
      .filter(f => f.type !== 'image' && f.type !== 'file' && sub.data[f.id])
      .map(f => `%%${String(sub.data[f.id])}%%`);
    const mediaCount = fields.filter(f => (f.type === 'image' || f.type === 'file') && sub.data[f.id]).length;

    if (textVals.length)  rawItems += `   ${textVals.join(' · ')}\n`;
    if (mediaCount > 0)   rawItems += `   📎 ×${mediaCount}\n`;

    rawItems += '\n';
  }

  if (pages > 1) rawItems += t('pending_page', lang, safePage + 1, pages);

  const headerU16   = utf16len(headerText);
  const { text: cleanItems, entities: rawEntities } = parseCodeSpans(rawItems);
  const entities = rawEntities.map(e => ({ ...e, offset: e.offset + headerU16 }));

  return { text: headerText + cleanItems, entities, pages, safePage };
}

// ─────────────────────────────────────────────
//  Menu texts set (للفلترة في message handler)
// ─────────────────────────────────────────────
function allMenuTexts() {
  const s = new Set();
  ['btn_balance','btn_pending','btn_withdraw','btn_settings'].forEach(k => {
    s.add(t(k,'ar')); s.add(t(k,'en'));
  });
  s.add('🆔 معرفي'); s.add('🆔 My ID');
  s.add(t('btn_start_task','ar')); s.add(t('btn_start_task','en'));
  s.add(BTN_CANCEL_AR); s.add(BTN_CANCEL_EN);
  s.add(BTN_BACK_AR);   s.add(BTN_BACK_EN);
  return s;
}
const MENU_TEXTS = allMenuTexts();

// ─────────────────────────────────────────────
//  register
// ─────────────────────────────────────────────
function register(bot, adminIds = []) {
  // نخزن adminIds للإشعارات
  _adminIds = adminIds;

  bot.onText(/\/start/, (msg) => {
    clearSession(msg.from.id);
    db.getUser(msg.from.id);
  });

  bot._sendUserStart = (msg) => {
    clearSession(msg.from.id);
    db.getUser(msg.from.id);
    sendHome(bot, msg.chat.id, msg.from.id, msg.from.first_name);
  };

  // رصيدي
  bot.onText(new RegExp(`${escRe(t('btn_balance','ar'))}|${escRe(t('btn_balance','en'))}`), async (msg) => {
    const uid = msg.from.id;
    const lang = getLang(uid);
    const cur  = getCurrency(uid);
    const user = db.getUser(uid);
    const { display: bal, symbol: s1 } = await formatAmount(user.balance,     cur);
    const { display: ear, symbol: s2 } = await formatAmount(user.totalEarned, cur);
    bot.sendMessage(msg.chat.id, t('balance_text', lang, bal, ear, s1), { parse_mode: 'Markdown' });
  });

  // الأموال المعلقة
  bot.onText(new RegExp(`${escRe(t('btn_pending','ar'))}|${escRe(t('btn_pending','en'))}`), (msg) => {
    sendPendingPage(bot, msg.chat.id, msg.from.id, 0);
  });

  // التفضيلات
  bot.onText(new RegExp(`${escRe(t('btn_settings','ar'))}|${escRe(t('btn_settings','en'))}`), (msg) => {
    sendSettingsPage(bot, msg.chat.id, msg.from.id);
  });

  // معرفي
  bot.onText(/🆔 معرفي|🆔 My ID/i, (msg) => {
    const lang = getLang(msg.from.id);
    bot.sendMessage(msg.chat.id,
      `🆔 *${lang === 'ar' ? 'معرفك:' : 'Your Telegram ID:'}* \`${msg.from.id}\``,
      { parse_mode: 'Markdown' }
    );
  });

  // Callbacks
  bot.on('callback_query', async (query) => {
    if (query._blocked) return;
    const data   = query.data;
    const userId = query.from.id;
    const chatId = query.message.chat.id;
    const msgId  = query.message.message_id;
    const lang   = getLang(userId);

    // فحص الحظر
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
    if (data === 'task_cancel_detail') {
      await bot.answerCallbackQuery(query.id);
      clearSession(userId);
      delete _pendingStart[userId];
      bot.sendMessage(chatId, t('cancel_msg', lang));
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
      bot.sendMessage(chatId, t('cancel_msg', lang), await mainMenuKeyboardForUser(tasks, userId));
      return;
    }
    if (data.startsWith('pending_page:')) {
      await bot.answerCallbackQuery(query.id);
      await editPendingPage(bot, chatId, msgId, userId, parseInt(data.split(':')[1]) || 0);
      return;
    }
    bot.answerCallbackQuery(query.id);
  });

  // Messages
  bot.on('message', async (msg) => {
    const userId  = msg.from.id;
    const text    = msg.text;
    const session = sessions[userId];

    // rate limiter — لا يُطبَّق لو المستخدم داخل session نشط (تسليم)
    if (session && session.step === 'filling') {
      if (db.getUser(userId).isBanned) {
        clearSession(userId);
        return bot.sendMessage(msg.chat.id, '🚫 حسابك محظور.');
      }
    } else if (rateLimiter && !rateLimiter.check(userId)) {
      return;
    }

    // إلغاء
    if (text === BTN_CANCEL_AR || text === BTN_CANCEL_EN) {
      clearSession(userId);
      const lang  = getLang(userId);
      const tasks = db.listTasks(true);
      return bot.sendMessage(msg.chat.id,
        lang === 'ar' ? '❌ تم الإلغاء.' : '❌ Cancelled.',
        await mainMenuKeyboardForUser(tasks, userId)
      );
    }

    if (text === BTN_BACK_AR || text === BTN_BACK_EN) {
      if (session && session.step === 'filling' && session.fieldIndex > 0) {
        const task   = db.getTask(session.taskId);
        const fields = [...task.fields].sort((a, b) => a.order - b.order);

        // نرجع للحقل السابق وننظف إجابته
        session.fieldIndex--;
        let field = fields[session.fieldIndex];

        // لو الحقل الحالي هو حقل ثاني مدموج (يوجد حقل قبله يشير إليه)
        // نتخطاه للوراء خطوة تانية ونمسح إجابة الحقلين
        const isSecondaryMerged = fields.some(
          (f, i) => i < session.fieldIndex && f.mergedWith === field.id
        );
        if (isSecondaryMerged) {
          delete session.answers[field.id];  // امسح الثاني
          session.fieldIndex--;
          field = fields[session.fieldIndex]; // الحقل الأول المدموج
        }

        // امسح إجابة الحقل الأول + الحقل الثاني المدموج معه (لو موجود)
        delete session.answers[field.id];
        if (field.mergedWith) {
          delete session.answers[field.mergedWith];
        }

        return askField(bot, msg.chat.id, field, getLang(userId), session.fieldIndex === 0, task);
      }
      clearSession(userId);
      const lang  = getLang(userId);
      const tasks = db.listTasks(true);
      return bot.sendMessage(msg.chat.id,
        lang === 'ar' ? '❌ تم الإلغاء.' : '❌ Cancelled.',
        await mainMenuKeyboardForUser(tasks, userId)
      );
    }

    // بدء التنفيذ
    if (text === t('btn_start_task','ar') || text === t('btn_start_task','en')) {
      const taskId = _pendingStart[userId];
      delete _pendingStart[userId];
      if (!taskId) {
        const tasks = db.listTasks(true);
        return bot.sendMessage(msg.chat.id,
          getLang(userId) === 'ar' ? '⚠️ اختر مهمة أولاً.' : '⚠️ Choose a task first.',
          await mainMenuKeyboardForUser(tasks, userId)
        );
      }
      await startTask(bot, msg.chat.id, userId, taskId, getLang(userId));
      return;
    }

    // ضغط على اسم مهمة
    if (text) {
      const task = db.listTasks(true).find(tk => {
        const n = tk.name;
        if (typeof n === 'string') return text.includes(n);
        return Object.values(n).some(v => v && text.includes(v));
      });
      if (task) { await showTaskDetailByTask(bot, msg.chat.id, userId, task); return; }
    }

    if (!session || session.step !== 'filling') return;
    if (text && (text.startsWith('/') || MENU_TEXTS.has(text))) return;
    await handleFieldAnswer(bot, msg, userId, session);
  });
}

// ─────────────────────────────────────────────
//  sendHome
// ─────────────────────────────────────────────
async function sendHome(bot, chatId, userId, firstName) {
  const tasks = db.listTasks(true);
  const lang  = getLang(userId);
  const safe  = escMd(firstName || '');
  const text  = tasks.length === 0
    ? `👋 *${safe}*\n\n${t('home_no_tasks', lang)}`
    : t('home_greeting', lang, safe);
  bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    ...await mainMenuKeyboardForUser(tasks, userId),
  });
}

// ─────────────────────────────────────────────
//  Pending pages
// ─────────────────────────────────────────────
async function sendPendingPage(bot, chatId, userId, page) {
  const items = getUserPendingItems(userId);
  const { text, entities, pages, safePage } = await buildPendingText(items, page, userId);
  const lang = getLang(userId);
  bot.sendMessage(chatId, text, {
    ...(entities.length ? { entities } : {}),
    reply_markup: pendingNavKeyboard(safePage, pages, lang),
  });
}

async function editPendingPage(bot, chatId, msgId, userId, page) {
  const items = getUserPendingItems(userId);
  const { text, entities, pages, safePage } = await buildPendingText(items, page, userId);
  const lang = getLang(userId);
  try {
    await bot.editMessageText(text, {
      chat_id: chatId, message_id: msgId,
      ...(entities.length ? { entities } : {}),
      reply_markup: pendingNavKeyboard(safePage, pages, lang),
    });
  } catch { /* unchanged */ }
}

// ─────────────────────────────────────────────
//  Task detail
// ─────────────────────────────────────────────
async function showTaskDetailByTask(bot, chatId, userId, task) {
  const lang = getLang(userId);
  if (!task?.isOpen) return bot.sendMessage(chatId, t('task_unavailable', lang));
  if (!task.fields || task.fields.length === 0)
    return bot.sendMessage(chatId, t('task_no_fields', lang));
  await _sendTaskDetail(bot, chatId, task, userId);
}

async function _sendTaskDetail(bot, chatId, task, userId) {
  const lang     = getLang(userId);
  const currency = getCurrency(userId);
  const { display, symbol } = await formatAmount(task.reward, currency);
  const name     = db.getTaskText(task, 'name',     lang);
  const fullDesc = db.getTaskText(task, 'fullDesc', lang);

  // نسجل قبل أي await
  _pendingStart[userId] = task.id;

  // 1) فيديو
  if (task.videoFileId) await bot.sendVideo(chatId, task.videoFileId, { caption: '🎥' });

  // 2) اسم + مكافأة — Markdown مضمون (escMd على name)
  await bot.sendMessage(chatId,
    `📌 *${escMd(name)}*\n\n${t('task_reward', lang, display, symbol)}`,
    { parse_mode: 'Markdown' }
  );

  // 3) الوصف — plain text مع %%..%% → code entity
  if (fullDesc) {
    const label       = t('task_desc_label', lang);
    const prefix      = label + '\n';
    const prefixU16   = utf16len(prefix);
    const { text: cleanDesc, entities: descEntities } = parseCodeSpans(fullDesc);
    const shiftedEnt  = descEntities.map(e => ({ ...e, offset: e.offset + prefixU16 }));
    await bot.sendMessage(chatId, prefix + cleanDesc,
      shiftedEnt.length ? { entities: shiftedEnt } : {}
    );
  }

  // 4) ميزات inline
  const { buildFeatureButtons } = require('./features');
  const featRows = buildFeatureButtons(task, lang);
  if (featRows.length > 0) {
    await bot.sendMessage(chatId,
      lang === 'ar' ? '🎯 *أدوات هتحتاجها:*' : '🎯 *Tools You\'ll Need:*',
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: featRows } }
    );
  }

  // 5) بدء التنفيذ + إلغاء
  const startBtn  = t('btn_start_task', lang);
  const cancelBtn = lang === 'ar' ? BTN_CANCEL_AR : BTN_CANCEL_EN;
  await bot.sendMessage(chatId,
    lang === 'ar' ? '👇 اضغط لبدء التنفيذ:' : '👇 Press to start:',
    {
      reply_markup: {
        keyboard: [[{ text: startBtn }, { text: cancelBtn }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    }
  );
}

// ─────────────────────────────────────────────
//  Submission flow
// ─────────────────────────────────────────────
async function startTask(bot, chatId, userId, taskId, lang) {
  const user = db.getUser(userId);
  if (user.isBanned) return bot.sendMessage(chatId, '🚫 حسابك محظور.');
  const task = db.getTask(taskId);
  if (!task?.isOpen) return bot.sendMessage(chatId, t('task_unavailable', lang));
  if (!task.fields.length) return bot.sendMessage(chatId, t('task_no_fields', lang));
  if (task.maxPerUser !== null) {
    if (db.countUserSubmissions(taskId, userId) >= task.maxPerUser)
      return bot.sendMessage(chatId, t('task_max_reached', lang, task.maxPerUser));
  }
  const fields = [...task.fields].sort((a, b) => a.order - b.order);
  sessions[userId] = { step: 'filling', taskId, fieldIndex: 0, answers: {} };
  await askField(bot, chatId, fields[0], lang, true, task);
}

async function askField(bot, chatId, field, lang, isFirst = false, task = null) {
  const emojiMap = {
    email:'📧', url:'🔗', phone:'📱', image:'🖼',
    file:'📎',  password:'🔑', number:'🔢', text:'✏️',
  };
  const emoji = emojiMap[field.type] || '✏️';

  // لو الحقل مدموج — نعرض اسم الحقلين معاً كخيار واحد
  let displayLabel;
  if (field.mergedWith && task) {
    const linked = task.fields.find(f => f.id === field.mergedWith);
    if (linked) {
      const sep = field.mergeSeparator || '/';
      const l1  = getFieldLabel(field, lang);
      const l2  = getFieldLabel(linked, lang);
      displayLabel = field.required
        ? `*${l1} ${sep} ${l2}*`
        : `*${l1} ${sep} ${l2}* _(${t('btn_skip', lang)})_`;
    }
  }
  if (!displayLabel) {
    displayLabel = field.required
      ? `*${getFieldLabel(field, lang)}*`
      : `*${getFieldLabel(field, lang)}* _(${t('btn_skip', lang)})_`;
  }

  const cancelRow = isFirst
    ? [{ text: lang === 'ar' ? BTN_CANCEL_AR : BTN_CANCEL_EN }]
    : [{ text: lang === 'ar' ? BTN_BACK_AR : BTN_BACK_EN }, { text: lang === 'ar' ? BTN_CANCEL_AR : BTN_CANCEL_EN }];

  await bot.sendMessage(chatId, `${emoji} ${displayLabel}`, {
    parse_mode: 'Markdown',
    reply_markup: { keyboard: [cancelRow], resize_keyboard: true, one_time_keyboard: false },
  });
  if (!field.required) {
    await bot.sendMessage(chatId,
      lang === 'ar' ? '_أو تخطى هذا الحقل:_' : '_Or skip this field:_',
      { parse_mode: 'Markdown', reply_markup: skipKeyboard(lang) }
    );
  }
}

async function handleFieldSkip(bot, chatId, userId, query) {
  await bot.answerCallbackQuery(query.id);
  const session = sessions[userId];
  if (!session || session.step !== 'filling') return;
  const lang   = getLang(userId);
  const task   = db.getTask(session.taskId);
  if (!task) {
    clearSession(userId);
    return bot.sendMessage(chatId, t('task_unavailable', lang));
  }
  const fields = [...task.fields].sort((a, b) => a.order - b.order);
  const field  = fields[session.fieldIndex];
  if (!field || field.required) return bot.sendMessage(chatId, t('field_required', lang));
  session.answers[field.id] = '';
  // لو مدموج، تخطى الثاني كمان
  if (field.mergedWith) {
    const linked = fields.find(f => f.id === field.mergedWith);
    if (linked) session.answers[linked.id] = '';
  }
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

  if (!validateField(field.type, msg, field.altType))
    return bot.sendMessage(chatId,
      `❌ ${getFieldLabel(field, lang)} — ${t('field_invalid', lang)}\n\n` +
      `${typeHint(field.type, lang)}`
    );

  const rawValue = extractValue(field.type, msg);

  // احفظ القيمة في الحقل الحالي
  session.answers[field.id] = rawValue;

  // لو الحقل مدموج — احفظ نفس القيمة في الحقل الثاني وتخطاه
  if (field.mergedWith) {
    const linked = fields.find(f => f.id === field.mergedWith);
    if (linked) {
      session.answers[linked.id] = rawValue;
    }
  }

  session.fieldIndex++;
  await advanceOrConfirm(bot, chatId, userId, session, task, fields);
}

async function advanceOrConfirm(bot, chatId, userId, session, task, fields) {
  const lang = getLang(userId);

  // تقدم للأمام مع تخطي الحقول المدموجة التي حُفظت بالفعل
  while (session.fieldIndex < fields.length) {
    const field = fields[session.fieldIndex];
    // الحقل اتحفظ بالفعل (مدموج ومُعبَّأ من الحقل السابق، أو مُتخطَّى)
    if (session.answers.hasOwnProperty(field.id)) {
      session.fieldIndex++;
      continue;
    }
    // سؤال عن هذا الحقل
    await askField(bot, chatId, field, lang, session.fieldIndex === 0, task);
    return;
  }

  // كل الحقول اتملت → عرض ملخص التأكيد
  session.step = 'confirming';
  const { text, entities } = buildSummary(task, session.answers, lang);
  bot.sendMessage(chatId, text, {
    ...(entities.length ? { entities } : {}),
    reply_markup: { inline_keyboard: confirmKeyboard(session.taskId, lang).inline_keyboard },
  });
}

async function confirmSubmission(bot, chatId, userId, taskId, query) {
  const session = sessions[userId];
  const lang    = getLang(userId);
  if (!session || session.step !== 'confirming' || session.taskId !== taskId)
    return bot.sendMessage(chatId, t('sub_session_expired', lang));

  // ── فحص تكرار البيانات عبر كل المستخدمين ──
  const duplicate = db.hasSubmittedData(taskId, session.answers, userId);
  if (duplicate) {
    clearSession(userId);
    const tasks = db.listTasks(true);
    return bot.sendMessage(chatId,
      lang === 'ar'
        ? '⛔ *هذه البيانات مسجلة مسبقاً.*\n\nلا يمكن تسليم نفس البيانات أكثر من مرة.'
        : '⛔ *This data has already been submitted.*\n\nDuplicate submissions are not allowed.',
      { parse_mode: 'Markdown', ...await mainMenuKeyboardForUser(tasks, userId) }
    );
  }

  const username = query.from.username ? `@${query.from.username}` : query.from.first_name;
  const sub = db.addSubmission(taskId, { userId, username, data: session.answers });
  clearSession(userId);

  const task = db.getTask(taskId);
  if (!task) {
    // المهمة حُذفت بعد التسليم — التسليم محفوظ لكن لا يمكن الإشعار
    const tasks = db.listTasks(true);
    return bot.sendMessage(chatId, t('sub_success', lang, sub.id.substring(0, 8)), {
      parse_mode: 'Markdown',
      ...await mainMenuKeyboardForUser(tasks, userId),
    });
  }
  const taskName = db.getTaskText(task, 'name', 'ar');

  // إشعار كل الأدمنز بالتسليم الجديد
  for (const adminId of _adminIds) {
    bot.sendMessage(adminId,
      `📥 *تسليم جديد!*\n\n` +
      `📌 المهمة: *${escMd(taskName)}*\n` +
      `👤 المستخدم: ${escMd(username)}\n` +
      `🆔 \`${sub.id.substring(0, 8)}\``,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  }

  // إشعار اقتراب الحد الأقصى (لو تبقى تسليم واحد فقط)
  if (task?.maxPerUser) {
    const done      = db.countUserSubmissions(taskId, userId);
    const remaining = task.maxPerUser - done;
    if (remaining === 1) {
      notifyUser(bot, userId, t('notify_approaching_limit', lang, db.getTaskText(task, 'name', lang), remaining)).catch(() => {});
    }
  }

  const tasks = db.listTasks(true);
  bot.sendMessage(chatId, t('sub_success', lang, sub.id.substring(0, 8)), {
    parse_mode: 'Markdown',
    ...await mainMenuKeyboardForUser(tasks, userId),
  });
}

// ─────────────────────────────────────────────
//  Preview للأدمن — يعرض المهمة كما يراها المستخدم
// ─────────────────────────────────────────────
async function _sendTaskDetailPreview(bot, chatId, task, adminId, lang = 'ar') {
  const currency = 'egp';
  const { display, symbol } = await require('../utils/price').formatAmount(task.reward, currency);
  const { t } = require('../i18n');
  const name     = db.getTaskText(task, 'name',     lang);
  const fullDesc = db.getTaskText(task, 'fullDesc', lang);

  if (task.videoFileId) await bot.sendVideo(chatId, task.videoFileId, { caption: '🎥' });

  await bot.sendMessage(chatId,
    `📌 *${escMd(name)}*\n\n${require('../i18n').t('task_reward', lang, display, symbol)}`,
    { parse_mode: 'Markdown' }
  );

  if (fullDesc) {
    const label       = require('../i18n').t('task_desc_label', lang);
    const prefix      = label + '\n';
    const prefixU16   = utf16len(prefix);
    const { text: cleanDesc, entities: descEntities } = parseCodeSpans(fullDesc);
    const shiftedEnt  = descEntities.map(e => ({ ...e, offset: e.offset + prefixU16 }));
    await bot.sendMessage(chatId, prefix + cleanDesc,
      shiftedEnt.length ? { entities: shiftedEnt } : {}
    );
  }

  // حقول المهمة
  if (task.fields && task.fields.length > 0) {
    const fields = [...task.fields].sort((a, b) => a.order - b.order);
    let fieldsText = `📋 *الحقول (${fields.length}):*\n`;
    for (const f of fields) {
      const altInfo = f.altType ? ` / ${f.altType}` : '';
      fieldsText += `${f.required ? '🔴' : '🟡'} ${escMd(f.label)} \`(${f.type}${altInfo})\`\n`;
    }
    await bot.sendMessage(chatId, fieldsText, { parse_mode: 'Markdown' });
  }

  await bot.sendMessage(chatId,
    `👁 *معاينة المهمة*\n_هذا هو شكل المهمة كما يراها المستخدم_`,
    { parse_mode: 'Markdown' }
  );
}
async function notifyUser(bot, userId, text) {
  // نحاول Markdown أولاً — لو فشل نبعت plain text
  try {
    await bot.sendMessage(userId, text, { parse_mode: 'Markdown' });
    return true;
  } catch (e) {
    if (e.code === 'ETELEGRAM') {
      try {
        // plain text fallback — نشيل رموز Markdown
        const plain = text
          .replace(/\*([^*]+)\*/g, '$1')
          .replace(/_([^_]+)_/g, '$1')
          .replace(/`([^`]+)`/g, '$1');
        await bot.sendMessage(userId, plain);
        return true;
      } catch { return false; }
    }
    return false;
  }
}

async function notifyApproved(bot, sub, task) {
  const lang     = getLang(sub.userId);
  const currency = getCurrency(sub.userId);
  const reward   = db.getEffectiveReward(sub.userId, task);
  const { display, symbol } = await formatAmount(reward, currency);
  const taskName = db.getTaskText(task, 'name', lang);
  return notifyUser(bot, sub.userId,
    t('notify_approved', lang, taskName, sub.id.substring(0, 8), display, symbol)
  );
}

async function notifyRejected(bot, sub, task, reason) {
  const lang     = getLang(sub.userId);
  const taskName = db.getTaskText(task, 'name', lang);
  return notifyUser(bot, sub.userId,
    t('notify_rejected', lang, taskName, sub.id.substring(0, 8), reason || '')
  );
}

// ─────────────────────────────────────────────
//  Broadcast
// ─────────────────────────────────────────────
async function broadcastNewTask(bot, task) {
  const users  = db.listUsers();
  const tasks  = db.listTasks(true);
  let sent = 0, batch = 0;
  const BATCH_SIZE = 25, BATCH_DELAY = 1100;

  for (const user of users) {
    if (!user.lang) continue;
    try {
      const lang     = user.lang || 'ar';
      const currency = user.currency || 'egp';
      const { display, symbol } = await formatAmount(task.reward, currency);
      const taskName  = db.getTaskText(task, 'name',      lang);
      const shortDesc = db.getTaskText(task, 'shortDesc', lang);
      const taskRows  = await Promise.all(tasks.map(async tk => {
        const reward = db.getEffectiveReward(user.id, tk);
        const { display: rd, symbol: rs } = await formatAmount(reward, currency);
        return [{ text: `🟢 ${db.getTaskText(tk,'name',lang)} — ${rd} ${rs}` }];
      }));
      await bot.sendMessage(user.id,
        `🆕 *${lang === 'ar' ? 'مهمة جديدة!' : 'New Task!'}*\n\n` +
        `📌 *${escMd(taskName)}*\n` +
        `${t('task_reward', lang, display, symbol)}\n\n` +
        `${escMd(shortDesc || '')}`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            keyboard: [
              ...taskRows,
              [{ text: t('btn_balance',lang) }, { text: t('btn_pending',lang) }],
              [{ text: t('btn_withdraw',lang) }, { text: t('btn_settings',lang) }],
              [{ text: t('btn_myid',lang) }],
            ],
            resize_keyboard: true,
          },
        }
      );
      sent++; batch++;
      if (batch >= BATCH_SIZE) {
        batch = 0;
        await new Promise(r => setTimeout(r, BATCH_DELAY));
      }
    } catch { /* bot blocked */ }
  }
  return sent;
}

// ─────────────────────────────────────────────
//  Exports
// ─────────────────────────────────────────────
module.exports = {
  register, notifyUser, notifyApproved, notifyRejected,
  clearSession, sendHome, broadcastNewTask,
  getLang, getCurrency, mainMenuKeyboardForUser,
  _sendTaskDetailPreview,
};
