'use strict';

const db       = require('../db');
const exporter = require('../exporter');
const { notifyUser, notifyApproved, notifyRejected } = require('./user');
const sessions = {};
function setSession(a, f, s, d = {}) { sessions[a] = { flow: f, step: s, data: d }; }
function getSession(a) { return sessions[a] || null; }
function clearSession(a) { delete sessions[a]; }

function sh(uuid) { return uuid ? uuid.substring(0, 8) : ''; }
function expandTaskId(short) {
  return db.listTasks().find(t => t.id.startsWith(short))?.id || short;
}
function expandSubId(task, short) {
  return task.submissions.find(s => s.id.startsWith(short))?.id || short;
}

// ─────────────────────────────────────────────
//  Keyboards
// ─────────────────────────────────────────────

function subsMenuKeyboard(taskId) {
  const s = sh(taskId);
  return {
    inline_keyboard: [
      [
        { text: '📤 تصدير كل التسليمات',   callback_data: `exp_all:${s}`      },
        { text: '📤 تصدير عدد محدد',        callback_data: `exp_n:${s}`        },
      ],
      [
        { text: '✅ إرسال المقبولة وقبولها', callback_data: `exp_approved:${s}` },
        { text: '❌ إرسال المرفوضة ورفضها', callback_data: `exp_rejected:${s}` },
      ],
      [
        { text: '⏳ التسليمات غير الموافق عليها', callback_data: `view_pending:${s}` },
        { text: '📦 غير المصدَّرة',               callback_data: `view_unexported:${s}` },
      ],
      [
        { text: '↩️ إرجاع من التصدير',     callback_data: `undo_exp_menu:${s}` },
        { text: '👁 عرض التسليمات',          callback_data: `subs_list:${s}:all` },
      ],
      [
        { text: '⚡ عمليات جماعية',          callback_data: `subs_bulk_menu:${s}` },
        { text: '🔙 رجوع',                   callback_data: `adm_task:${s}`       },
      ],
    ],
  };
}

function bulkMenuKeyboard(taskId) {
  const s = sh(taskId);
  return {
    inline_keyboard: [
      [
        { text: '✅ قبول جماعي', callback_data: `bulk_approve:${s}` },
        { text: '❌ رفض جماعي',  callback_data: `bulk_reject:${s}`  },
      ],
      [
        { text: '🎯 انتقائي بـ IDs',    callback_data: `selective_ids:${s}`   },
        { text: '🎯 انتقائي بالأسماء', callback_data: `selective_names:${s}` },
      ],
      [{ text: '🔙 رجوع', callback_data: `adm_subs:${s}` }],
    ],
  };
}

function undoExpMenuKeyboard(taskId) {
  const s = sh(taskId);
  return {
    inline_keyboard: [
      [
        { text: '↩️ إرجاع الكل',       callback_data: `undo_all:${s}`   },
        { text: '↩️ إرجاع بـ IDs',     callback_data: `undo_ids:${s}`   },
      ],
      [{ text: '🔙 رجوع', callback_data: `adm_subs:${s}` }],
    ],
  };
}

function confirmKeyboard(yesCb, noCb) {
  return { inline_keyboard: [[
    { text: '✅ نعم', callback_data: yesCb },
    { text: '❌ لا',  callback_data: noCb  },
  ]]};
}

function subDetailKeyboard(taskId, subId, status, exported) {
  const t = sh(taskId), s = sh(subId);
  const rows = [];
  if (status === 'pending') {
    rows.push([
      { text: '✅ قبول', callback_data: `sub_approve:${t}:${s}` },
      { text: '❌ رفض',  callback_data: `sub_reject_ask:${t}:${s}` },
    ]);
  }
  if (status === 'approved' || status === 'rejected') {
    if (exported === 0) {
      rows.push([{ text: '📤 تصدير هذا التسليم', callback_data: `sub_export1:${t}:${s}` }]);
    } else {
      rows.push([{ text: '↩️ إرجاع من التصدير', callback_data: `sub_undo1:${t}:${s}` }]);
    }
  }
  rows.push([{ text: '🔙 رجوع', callback_data: `subs_list:${t}:all` }]);
  return { inline_keyboard: rows };
}

function selectiveActionKeyboard(taskId) {
  const s = sh(taskId);
  return {
    inline_keyboard: [[
      { text: '✅ قبول', callback_data: `sel_do:${s}:approve` },
      { text: '❌ رفض',  callback_data: `sel_do:${s}:reject`  },
    ]],
  };
}

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────

const STATUS_LABELS = {
  pending:  '⏳ في الانتظار',
  approved: '✅ موافق عليه',
  rejected: '❌ مرفوض',
};

function getFields(task) {
  return [...task.fields].sort((a, b) => a.order - b.order);
}

function formatSubText(sub, fields) {
  const expLabel = sub.exported === 1 ? '📤 مصدَّر' : '📦 غير مصدَّر';
  let text = `🆔 \`${sub.id.substring(0,8)}\`\n`;
  text += `👤 ${sub.username}  |  \`${sub.userId}\`\n`;
  text += `📅 ${sub.submittedAt}\n`;
  text += `📌 الحالة: ${STATUS_LABELS[sub.status] || sub.status}  ${expLabel}\n`;
  if (sub.rejectReason) text += `📝 سبب الرفض: ${sub.rejectReason}\n`;
  text += '\n';
  for (const field of fields) {
    const val = sub.data[field.id];
    if (val) {
      const display = (field.type === 'image' || field.type === 'file') ? '✅ مرفوع' : val;
      text += `• *${field.label}:* ${display}\n`;
    }
  }
  return text;
}

async function sendFileToAdmin(bot, chatId, result, label) {
  if (!result.filePath || result.count === 0) {
    return bot.sendMessage(chatId, `📭 لا توجد تسليمات للـ ${label}.`);
  }
  await bot.sendDocument(chatId, result.filePath, {
    caption: `${label}: *${result.count}* تسليم`,
    parse_mode: 'Markdown',
  });
}

// ─────────────────────────────────────────────
//  List & Detail
// ─────────────────────────────────────────────

function sendSubsList(bot, chatId, taskId, statusFilter) {
  const task   = db.getTask(taskId);
  if (!task) return bot.sendMessage(chatId, '⚠️ المهمة غير موجودة.');
  const filter = statusFilter === 'all' ? null : statusFilter;
  const subs   = db.getSubmissions(taskId, filter);
  const ts     = sh(taskId);
  const label  = filter ? (STATUS_LABELS[filter] || filter) : '🔵 الكل';

  if (subs.length === 0) {
    return bot.sendMessage(chatId, `📭 لا توجد تسليمات${filter ? ` بحالة "${label}"` : ''}.`,
      { reply_markup: subsMenuKeyboard(taskId) });
  }

  bot.sendMessage(chatId,
    `📊 *${label}*\n📦 العدد: *${subs.length}* تسليم`,
    {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [
        [{ text: `📋 عرض (${Math.min(10, subs.length)})`, callback_data: `subs_show:${ts}:${statusFilter}:0` }],
        [{ text: '🔙 رجوع', callback_data: `adm_subs:${ts}` }],
      ]},
    }
  );
}

function sendSubsPage(bot, chatId, taskId, statusFilter, page) {
  const task   = db.getTask(taskId);
  if (!task) return bot.sendMessage(chatId, '⚠️ المهمة غير موجودة.');
  const filter = statusFilter === 'all' ? null : statusFilter;
  const subs   = db.getSubmissions(taskId, filter);
  const ts     = sh(taskId);
  const PAGE   = 10;
  const total  = Math.ceil(subs.length / PAGE);
  const slice  = subs.slice(page * PAGE, (page + 1) * PAGE);

  let text = `📋 *التسليمات (${subs.length})* — ${filter ? STATUS_LABELS[filter] : '🔵 الكل'}\n`;
  text += `صفحة ${page + 1} / ${total}\n\n`;

  const rows = slice.map(s => [{
    text: `${STATUS_LABELS[s.status] || s.status} ${s.exported ? '📤' : '📦'} ${s.username} | ${s.submittedAt.substring(0,10)}`,
    callback_data: `sub_detail:${ts}:${sh(s.id)}`,
  }]);
  const nav = [];
  if (page > 0)          nav.push({ text: '◀️', callback_data: `subs_show:${ts}:${statusFilter}:${page-1}` });
  if (page < total - 1)  nav.push({ text: '▶️', callback_data: `subs_show:${ts}:${statusFilter}:${page+1}` });
  if (nav.length) rows.push(nav);
  rows.push([{ text: '🔙 رجوع', callback_data: `adm_subs:${ts}` }]);

  bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows } });
}

function sendSubDetail(bot, chatId, taskId, subId) {
  const task = db.getTask(taskId);
  if (!task) return bot.sendMessage(chatId, '⚠️ المهمة غير موجودة.');
  const sub  = db.getSubmission(taskId, subId);
  if (!sub)  return bot.sendMessage(chatId, '⚠️ التسليم غير موجود.');
  const fields = getFields(task);
  bot.sendMessage(chatId, formatSubText(sub, fields), {
    parse_mode: 'Markdown',
    reply_markup: subDetailKeyboard(taskId, subId, sub.status, sub.exported ?? 0),
  });
}

// ─────────────────────────────────────────────
//  Individual Actions
// ─────────────────────────────────────────────

async function approveOne(bot, chatId, taskId, subId) {
  const task = db.getTask(taskId);
  const sub  = db.updateSubmissionStatus(taskId, subId, 'approved');
  if (!sub) return bot.sendMessage(chatId, '⚠️ التسليم غير موجود.');
  // استخدام المكافأة الفعلية (تأخذ rewardOverride بعين الاعتبار)
  const reward = db.getEffectiveReward(sub.userId, task);
  db.addBalance(sub.userId, reward);
  await notifyApproved(bot, sub, task);
  db.deleteSubmission(taskId, subId);   // ← حذف بعد القبول
  bot.sendMessage(chatId,
    `✅ تم قبول التسليم \`${subId.substring(0,8)}\` وإضافة \`${reward}\` للمستخدم.\n🗑 تم حذف التسليم من البيانات.`,
    { parse_mode: 'Markdown', reply_markup: subsMenuKeyboard(taskId) });
}

async function rejectOne(bot, chatId, adminId, taskId, subId, reason) {
  const task = db.getTask(taskId);
  const sub  = db.updateSubmissionStatus(taskId, subId, 'rejected', reason);
  if (!sub) return bot.sendMessage(chatId, '⚠️ التسليم غير موجود.');
  await notifyRejected(bot, sub, task, reason);
  db.deleteSubmission(taskId, subId);   // ← حذف بعد الرفض
  bot.sendMessage(chatId,
    `❌ تم رفض التسليم \`${subId.substring(0,8)}\`.\n🗑 تم حذف التسليم من البيانات.`,
    { parse_mode: 'Markdown', reply_markup: subsMenuKeyboard(taskId) });
}

// ─────────────────────────────────────────────
//  Bulk Actions
// ─────────────────────────────────────────────

async function executeBulkApprove(bot, chatId, taskId, limit) {
  const task    = db.getTask(taskId);
  const pending = db.getSubmissions(taskId, 'pending');
  const targets = limit ? pending.slice(0, limit) : pending;
  if (!targets.length) return bot.sendMessage(chatId, '📭 لا توجد تسليمات في الانتظار.');
  for (const sub of targets) {
    db.updateSubmissionStatus(taskId, sub.id, 'approved');
    const reward = db.getEffectiveReward(sub.userId, task);
    db.addBalance(sub.userId, reward);
    await notifyApproved(bot, sub, task);
  }
  db.bulkDeleteSubmissions(taskId, targets.map(s => s.id));
  bot.sendMessage(chatId,
    `✅ تم قبول وحذف *${targets.length}* تسليماً وإضافة المكافآت.`,
    { parse_mode: 'Markdown' });
}

async function executeBulkReject(bot, chatId, taskId, limit, reason) {
  const task    = db.getTask(taskId);
  const pending = db.getSubmissions(taskId, 'pending');
  const targets = limit ? pending.slice(0, limit) : pending;
  if (!targets.length) return bot.sendMessage(chatId, '📭 لا توجد تسليمات في الانتظار.');
  for (const sub of targets) {
    db.updateSubmissionStatus(taskId, sub.id, 'rejected', reason);
    await notifyRejected(bot, sub, task, reason);
  }
  db.bulkDeleteSubmissions(taskId, targets.map(s => s.id));
  bot.sendMessage(chatId,
    `❌ تم رفض وحذف *${targets.length}* تسليماً.`,
    { parse_mode: 'Markdown' });
}

async function executeSelectiveAction(bot, chatId, taskId, ids, action, reason) {
  const task = db.getTask(taskId);
  if (action === 'approve') {
    for (const id of ids) {
      const sub = db.getSubmission(taskId, id);
      if (!sub) continue;
      db.updateSubmissionStatus(taskId, id, 'approved');
      const reward = db.getEffectiveReward(sub.userId, task);
      db.addBalance(sub.userId, reward);
      await notifyApproved(bot, sub, task);
    }
    db.bulkDeleteSubmissions(taskId, ids);
    return bot.sendMessage(chatId, `✅ تم قبول وحذف *${ids.length}* تسليماً.`, { parse_mode: 'Markdown' });
  }
  if (action === 'reject') {
    for (const id of ids) {
      const sub = db.getSubmission(taskId, id);
      if (!sub) continue;
      db.updateSubmissionStatus(taskId, id, 'rejected', reason);
      await notifyRejected(bot, sub, task, reason);
    }
    db.bulkDeleteSubmissions(taskId, ids);
    return bot.sendMessage(chatId, `❌ تم رفض وحذف *${ids.length}* تسليماً.`, { parse_mode: 'Markdown' });
  }
}

// ─────────────────────────────────────────────
//  Text handler
// ─────────────────────────────────────────────

async function handleAdminText(bot, msg, adminId) {
  const session = getSession(adminId);
  if (!session) return;
  const { flow, step, data } = session;
  const chatId = msg.chat.id;
  const text   = msg.text?.trim();

  if (flow === 'reject_one' && step === 'reason') {
    clearSession(adminId);
    return rejectOne(bot, chatId, adminId, data.taskId, data.subId, text || null);
  }

  if (flow === 'bulk_reject' && step === 'reason') {
    const reason = (text === 'تخطي' || text === 'skip') ? null : text;
    const count  = db.getSubmissions(data.taskId, 'pending').length;
    setSession(adminId, 'bulk_reject', 'confirm', { ...data, reason });
    return bot.sendMessage(chatId,
      `هل تريد رفض *${count}* تسليماً${reason ? ` بسبب: "${reason}"` : ''}؟`,
      { parse_mode: 'Markdown', reply_markup: confirmKeyboard(`bulk_rej_ok:${adminId}`, `adm_subs:${sh(data.taskId)}`) }
    );
  }

  if (flow === 'bulk_approve_n' && step === 'count') {
    const n = parseInt(text);
    if (isNaN(n) || n < 1) return bot.sendMessage(chatId, '⚠️ أدخل رقماً أكبر من 0.');
    setSession(adminId, 'bulk_approve', 'confirm', { taskId: data.taskId, limit: n });
    return bot.sendMessage(chatId, `هل تريد قبول *${n}* تسليماً؟`,
      { parse_mode: 'Markdown', reply_markup: confirmKeyboard(`bulk_app_ok:${adminId}`, `adm_subs:${sh(data.taskId)}`) });
  }

  if (flow === 'bulk_reject_n' && step === 'count') {
    const n = parseInt(text);
    if (isNaN(n) || n < 1) return bot.sendMessage(chatId, '⚠️ أدخل رقماً أكبر من 0.');
    setSession(adminId, 'bulk_reject', 'reason', { taskId: data.taskId, limit: n });
    return bot.sendMessage(chatId, '📝 أدخل سبب الرفض (أو أرسل "تخطي"):');
  }

  if (flow === 'exp_n' && step === 'count') {
    const n = parseInt(text);
    if (isNaN(n) || n < 1) return bot.sendMessage(chatId, '⚠️ أدخل رقماً أكبر من 0.');
    clearSession(adminId);
    const result = exporter.exportUnexported(data.taskId, n);
    return sendFileToAdmin(bot, chatId, result, `📤 تصدير ${n} تسليم`);
  }

  if (flow === 'undo_ids' && step === 'waiting') {
    // المستخدم يرسل سطر أو أكثر بصيغة email:password:phone
    const lines   = text.split('\n').map(l => l.trim()).filter(Boolean);
    const taskObj = db.getTask(data.taskId);
    const flds    = taskObj ? [...taskObj.fields].sort((a,b)=>a.order-b.order) : [];
    const allSubs = db.getSubmissions(data.taskId, null, 1);
    const matched = [];
    for (const line of lines) {
      const vals  = line.split(':');
      const found = allSubs.find(s =>
        !matched.find(m => m.id === s.id) &&
        flds.every((f, i) => {
          if (f.type === 'image' || f.type === 'file') return true;
          return (s.data[f.id] ?? '') === (vals[i] ?? '');
        })
      );
      if (found) matched.push(found);
    }
    if (!matched.length) return bot.sendMessage(chatId, '⚠️ لم يتم إيجاد تسليمات مصدَّرة بهذه البيانات.');
    exporter.undoExportedIds(data.taskId, matched.map(s => s.id));
    clearSession(adminId);
    return bot.sendMessage(chatId, `↩️ تم إرجاع *${matched.length}* تسليماً من التصدير.`, { parse_mode: 'Markdown' });
  }

  if (flow === 'selective_ids' && step === 'waiting') {
    const parts   = text.split(/[\s,\n]+/).filter(Boolean);
    const allSubs = db.getSubmissions(data.taskId);
    const matched = allSubs.filter(s => parts.some(p => s.id.startsWith(p)));
    if (!matched.length) return bot.sendMessage(chatId, '⚠️ لم يتم إيجاد تسليمات.');
    setSession(adminId, 'selective_act', 'action', { taskId: data.taskId, ids: matched.map(s => s.id) });
    return bot.sendMessage(chatId, `✅ تم تحديد *${matched.length}* تسليماً. اختر العملية:`,
      { parse_mode: 'Markdown', reply_markup: selectiveActionKeyboard(data.taskId) });
  }

  if (flow === 'selective_names' && step === 'waiting') {
    const names   = text.split(/[\s,\n]+/).filter(Boolean).map(n => n.replace(/^@/, '').toLowerCase());
    const allSubs = db.getSubmissions(data.taskId);
    const matched = allSubs.filter(s => names.some(n => s.username?.replace(/^@/, '').toLowerCase() === n));
    if (!matched.length) return bot.sendMessage(chatId, '⚠️ لم يتم إيجاد تسليمات لهؤلاء المستخدمين.');
    setSession(adminId, 'selective_act', 'action', { taskId: data.taskId, ids: matched.map(s => s.id) });
    return bot.sendMessage(chatId, `✅ تم تحديد *${matched.length}* تسليماً. اختر العملية:`,
      { parse_mode: 'Markdown', reply_markup: selectiveActionKeyboard(data.taskId) });
  }

  if (flow === 'selective_act_reject' && step === 'reason') {
    const reason = (text === 'تخطي' || text === 'skip') ? null : text;
    clearSession(adminId);
    return executeSelectiveAction(bot, chatId, data.taskId, data.ids, 'reject', reason);
  }
}

// ─────────────────────────────────────────────
//  Keyboards
// ─────────────────────────────────────────────

function register(bot, isAdmin) {

  bot.on('message', async (msg) => {
    if (!msg.text || !isAdmin(msg.from.id)) return;
    if (msg.text.startsWith('/')) return;
    if (msg.text.startsWith('🟢') || msg.text.startsWith('🔴')) return;
    await handleAdminText(bot, msg, msg.from.id);
  });

  bot.on('callback_query', async (query) => {
    if (query._blocked) return;   // Idempotency Gate
    const data    = query.data;
    const adminId = query.from.id;
    const chatId  = query.message.chat.id;

    // ── فتح لوحة التسليمات ────────────────────
    if (data.startsWith('adm_subs:')) {
      await bot.answerCallbackQuery(query.id);
      const taskId = expandTaskId(data.split(':')[1]);
      const task   = db.getTask(taskId);
      const stats  = task?.stats || {};
      return bot.sendMessage(chatId,
        `📥 *إدارة التسليمات*\n\n` +
        `⏳ في الانتظار: *${stats.pending || 0}*\n` +
        `✅ موافق عليه: *${stats.approved || 0}*\n` +
        `❌ مرفوض: *${stats.rejected || 0}*\n` +
        `📤 مصدَّر: *${stats.exported || 0}*\n` +
        `📦 الإجمالي: *${stats.total || 0}*`,
        { parse_mode: 'Markdown', reply_markup: subsMenuKeyboard(taskId) }
      );
    }

    // ── 📤 تصدير كل التسليمات (pending + exported=0) ──────
    if (data.startsWith('exp_all:')) {
      await bot.answerCallbackQuery(query.id);
      const taskId = expandTaskId(data.split(':')[1]);
      const count  = db.getSubmissions(taskId, 'pending', 0).length;
      if (!count) return bot.sendMessage(chatId, '📭 لا توجد تسليمات معلقة غير مصدَّرة.');
      return bot.sendMessage(chatId,
        `هل تريد تصدير *${count}* تسليماً معلقاً (غير مصدَّر)؟`,
        { parse_mode: 'Markdown', reply_markup: confirmKeyboard(`exp_all_ok:${sh(taskId)}`, `adm_subs:${sh(taskId)}`) }
      );
    }
    if (data.startsWith('exp_all_ok:')) {
      await bot.answerCallbackQuery(query.id);
      const taskId = expandTaskId(data.split(':')[1]);
      const result = exporter.exportUnexported(taskId);
      return sendFileToAdmin(bot, chatId, result, '📤 تصدير كل التسليمات');
    }

    // ── 📤 تصدير عدد محدد ────────────────────────
    if (data.startsWith('exp_n:')) {
      await bot.answerCallbackQuery(query.id);
      const taskId = expandTaskId(data.split(':')[1]);
      setSession(adminId, 'exp_n', 'count', { taskId });
      return bot.sendMessage(chatId, '🔢 أدخل عدد التسليمات للتصدير:');
    }

    // ── ✅ إرسال المقبولة وقبولها ────────────────
    if (data.startsWith('exp_approved:')) {
      await bot.answerCallbackQuery(query.id);
      const taskId = expandTaskId(data.split(':')[1]);
      const count  = db.getSubmissions(taskId, 'approved').length;
      if (!count) return bot.sendMessage(chatId, '📭 لا توجد تسليمات موافق عليها.');
      return bot.sendMessage(chatId,
        `هل تريد إرسال *${count}* تسليماً موافقاً عليه وإشعار أصحابها؟`,
        { parse_mode: 'Markdown', reply_markup: confirmKeyboard(`exp_app_ok:${sh(taskId)}`, `adm_subs:${sh(taskId)}`) }
      );
    }
    if (data.startsWith('exp_app_ok:')) {
      await bot.answerCallbackQuery(query.id);
      const taskId = expandTaskId(data.split(':')[1]);
      bot.sendMessage(chatId, '⏳ جاري المعالجة...');
      const result = await exporter.sendApprovedAndNotify(bot, taskId, notifyApproved);
      return sendFileToAdmin(bot, chatId, result, '✅ المقبولة');
    }

    // ── ❌ إرسال المرفوضة ورفضها ──────────────────
    if (data.startsWith('exp_rejected:')) {
      await bot.answerCallbackQuery(query.id);
      const taskId = expandTaskId(data.split(':')[1]);
      const count  = db.getSubmissions(taskId, 'rejected').length;
      if (!count) return bot.sendMessage(chatId, '📭 لا توجد تسليمات مرفوضة.');
      return bot.sendMessage(chatId,
        `هل تريد إرسال *${count}* تسليماً مرفوضاً وإشعار أصحابها؟`,
        { parse_mode: 'Markdown', reply_markup: confirmKeyboard(`exp_rej_ok:${sh(taskId)}`, `adm_subs:${sh(taskId)}`) }
      );
    }
    if (data.startsWith('exp_rej_ok:')) {
      await bot.answerCallbackQuery(query.id);
      const taskId = expandTaskId(data.split(':')[1]);
      bot.sendMessage(chatId, '⏳ جاري المعالجة...');
      const result = await exporter.sendRejectedAndNotify(bot, taskId, notifyRejected);
      return sendFileToAdmin(bot, chatId, result, '❌ المرفوضة');
    }

    // ── ⏳ التسليمات في الانتظار (للمراجعة فقط) ──
    if (data.startsWith('view_pending:')) {
      await bot.answerCallbackQuery(query.id);
      const taskId = expandTaskId(data.split(':')[1]);
      const count  = db.getSubmissions(taskId, 'pending').length;
      if (!count) return bot.sendMessage(chatId, '📭 لا توجد تسليمات في الانتظار.');
      return bot.sendMessage(chatId,
        `⏳ *التسليمات في الانتظار:* *${count}*\n\nهل تريد تصدير ملف للمراجعة (بدون تغيير الحالة)؟`,
        { parse_mode: 'Markdown', reply_markup: confirmKeyboard(`view_pend_ok:${sh(taskId)}`, `adm_subs:${sh(taskId)}`) }
      );
    }
    if (data.startsWith('view_pend_ok:')) {
      await bot.answerCallbackQuery(query.id);
      const taskId = expandTaskId(data.split(':')[1]);
      const result = exporter.exportForReview(taskId, 'pending');
      return sendFileToAdmin(bot, chatId, result, '⏳ في الانتظار (للمراجعة)');
    }

    // ── 📦 غير المصدَّرة (pending + exported=0) ──────────
    if (data.startsWith('view_unexported:')) {
      await bot.answerCallbackQuery(query.id);
      const taskId = expandTaskId(data.split(':')[1]);
      const count  = db.getSubmissions(taskId, 'pending', 0).length;
      if (!count) return bot.sendMessage(chatId, '📭 كل التسليمات المعلقة مصدَّرة أو لا يوجد تسليمات.');
      return bot.sendMessage(chatId,
        `📦 *غير المصدَّرة (في الانتظار):* *${count}*\n\nهل تريد تصدير ملف للمراجعة (بدون تغيير علامة التصدير)؟`,
        { parse_mode: 'Markdown', reply_markup: confirmKeyboard(`view_unexp_ok:${sh(taskId)}`, `adm_subs:${sh(taskId)}`) }
      );
    }
    if (data.startsWith('view_unexp_ok:')) {
      await bot.answerCallbackQuery(query.id);
      const taskId = expandTaskId(data.split(':')[1]);
      const result = exporter.exportForReview(taskId, 'pending');
      return sendFileToAdmin(bot, chatId, result, '📦 غير المصدَّرة - في الانتظار');
    }

    // ── ↩️ قائمة الإرجاع ──────────────────────────
    if (data.startsWith('undo_exp_menu:')) {
      await bot.answerCallbackQuery(query.id);
      const taskId = expandTaskId(data.split(':')[1]);
      const count  = db.getSubmissions(taskId, null, 1).length;
      return bot.sendMessage(chatId,
        `↩️ *إرجاع من التصدير*\n📤 المصدَّر حالياً: *${count}*`,
        { parse_mode: 'Markdown', reply_markup: undoExpMenuKeyboard(taskId) }
      );
    }

    // ── ↩️ إرجاع الكل ─────────────────────────────
    if (data.startsWith('undo_all:')) {
      await bot.answerCallbackQuery(query.id);
      const taskId = expandTaskId(data.split(':')[1]);
      const count  = db.getSubmissions(taskId, null, 1).length;
      if (!count) return bot.sendMessage(chatId, '📭 لا توجد تسليمات مصدَّرة.');
      return bot.sendMessage(chatId,
        `هل تريد إرجاع *${count}* تسليماً من التصدير؟`,
        { parse_mode: 'Markdown', reply_markup: confirmKeyboard(`undo_all_ok:${sh(taskId)}`, `adm_subs:${sh(taskId)}`) }
      );
    }
    if (data.startsWith('undo_all_ok:')) {
      await bot.answerCallbackQuery(query.id);
      const taskId = expandTaskId(data.split(':')[1]);
      const count  = exporter.undoExportedAll(taskId);
      return bot.sendMessage(chatId, `↩️ تم إرجاع *${count}* تسليماً من التصدير.`, { parse_mode: 'Markdown' });
    }

    // ── ↩️ إرجاع بـ IDs ───────────────────────────
    if (data.startsWith('undo_ids:')) {
      await bot.answerCallbackQuery(query.id);
      const taskId = expandTaskId(data.split(':')[1]);
      setSession(adminId, 'undo_ids', 'waiting', { taskId });
      return bot.sendMessage(chatId, '🎯 أرسل معرفات التسليمات (أول 8 أحرف) مفصولة بمسافة:');
    }

    // ── قائمة التسليمات بفلتر ─────────────────────
    if (data.startsWith('subs_list:')) {
      await bot.answerCallbackQuery(query.id);
      const parts  = data.split(':');
      const taskId = expandTaskId(parts[1]);
      return sendSubsList(bot, chatId, taskId, parts[2]);
    }

    if (data.startsWith('subs_show:')) {
      await bot.answerCallbackQuery(query.id);
      const parts  = data.split(':');
      const taskId = expandTaskId(parts[1]);
      return sendSubsPage(bot, chatId, taskId, parts[2], parseInt(parts[3]) || 0);
    }

    // ── تفاصيل تسليم ─────────────────────────────
    if (data.startsWith('sub_detail:')) {
      await bot.answerCallbackQuery(query.id);
      const parts  = data.split(':');
      const taskId = expandTaskId(parts[1]);
      const task   = db.getTask(taskId);
      return sendSubDetail(bot, chatId, taskId, task ? expandSubId(task, parts[2]) : parts[2]);
    }

    // ── قبول فردي ────────────────────────────────
    if (data.startsWith('sub_approve:')) {
      await bot.answerCallbackQuery(query.id);
      const parts  = data.split(':');
      const taskId = expandTaskId(parts[1]);
      const task   = db.getTask(taskId);
      return approveOne(bot, chatId, taskId, task ? expandSubId(task, parts[2]) : parts[2]);
    }

    // ── رفض فردي ─────────────────────────────────
    if (data.startsWith('sub_reject_ask:')) {
      await bot.answerCallbackQuery(query.id);
      const parts  = data.split(':');
      const taskId = expandTaskId(parts[1]);
      const task   = db.getTask(taskId);
      const subId  = task ? expandSubId(task, parts[2]) : parts[2];
      setSession(adminId, 'reject_one', 'reason', { taskId, subId });
      return bot.sendMessage(chatId, '📝 أدخل سبب الرفض (أو أرسل "تخطي"):');
    }

    // ── تصدير فردي ───────────────────────────────
    if (data.startsWith('sub_export1:')) {
      await bot.answerCallbackQuery(query.id);
      const parts  = data.split(':');
      const taskId = expandTaskId(parts[1]);
      const task   = db.getTask(taskId);
      const subId  = task ? expandSubId(task, parts[2]) : parts[2];
      const result = exporter.exportSubmissions(taskId, [subId]);
      if (result.filePath) {
        await bot.sendDocument(chatId, result.filePath, { caption: `📤 تم تصدير \`${subId.substring(0,8)}\``, parse_mode: 'Markdown' });
      }
      return sendSubDetail(bot, chatId, taskId, subId);
    }

    // ── إرجاع تصدير فردي ─────────────────────────
    if (data.startsWith('sub_undo1:')) {
      await bot.answerCallbackQuery(query.id);
      const parts  = data.split(':');
      const taskId = expandTaskId(parts[1]);
      const task   = db.getTask(taskId);
      const subId  = task ? expandSubId(task, parts[2]) : parts[2];
      exporter.undoExportedIds(taskId, [subId]);
      bot.sendMessage(chatId, `↩️ تم إرجاع التسليم \`${subId.substring(0,8)}\` من التصدير.`, { parse_mode: 'Markdown' });
      return sendSubDetail(bot, chatId, taskId, subId);
    }

    // ── قائمة العمليات الجماعية ───────────────────
    if (data.startsWith('subs_bulk_menu:')) {
      await bot.answerCallbackQuery(query.id);
      const taskId = expandTaskId(data.split(':')[1]);
      return bot.sendMessage(chatId, '⚡ *العمليات الجماعية*',
        { parse_mode: 'Markdown', reply_markup: bulkMenuKeyboard(taskId) });
    }

    // ── قبول جماعي ───────────────────────────────
    if (data.startsWith('bulk_approve:')) {
      await bot.answerCallbackQuery(query.id);
      const taskId = expandTaskId(data.split(':')[1]);
      const count  = db.getSubmissions(taskId, 'pending').length;
      if (!count) return bot.sendMessage(chatId, '📭 لا توجد تسليمات في الانتظار.');
      setSession(adminId, 'bulk_approve', 'confirm', { taskId, limit: null });
      return bot.sendMessage(chatId, `هل تريد قبول *${count}* تسليماً؟`,
        { parse_mode: 'Markdown', reply_markup: confirmKeyboard(`bulk_app_ok:${adminId}`, `adm_subs:${sh(taskId)}`) });
    }
    if (data.startsWith('bulk_app_ok:')) {
      await bot.answerCallbackQuery(query.id);
      const session = getSession(adminId);
      if (!session) return;
      clearSession(adminId);
      return executeBulkApprove(bot, chatId, session.data.taskId, session.data.limit);
    }

    // ── رفض جماعي ────────────────────────────────
    if (data.startsWith('bulk_reject:') && !data.startsWith('bulk_reject_n')) {
      await bot.answerCallbackQuery(query.id);
      const taskId = expandTaskId(data.split(':')[1]);
      const count  = db.getSubmissions(taskId, 'pending').length;
      if (!count) return bot.sendMessage(chatId, '📭 لا توجد تسليمات في الانتظار.');
      setSession(adminId, 'bulk_reject', 'reason', { taskId, limit: null });
      return bot.sendMessage(chatId, `📝 أدخل سبب الرفض لـ *${count}* تسليم (أو "تخطي"):`, { parse_mode: 'Markdown' });
    }
    if (data.startsWith('bulk_rej_ok:')) {
      await bot.answerCallbackQuery(query.id);
      const session = getSession(adminId);
      if (!session) return;
      clearSession(adminId);
      return executeBulkReject(bot, chatId, session.data.taskId, session.data.limit, session.data.reason);
    }

    // ── انتقائي بـ IDs ────────────────────────────
    if (data.startsWith('selective_ids:')) {
      await bot.answerCallbackQuery(query.id);
      const taskId = expandTaskId(data.split(':')[1]);
      setSession(adminId, 'selective_ids', 'waiting', { taskId });
      return bot.sendMessage(chatId, '🎯 أرسل معرفات التسليمات (أول 8 أحرف) مفصولة بمسافة:');
    }

    // ── انتقائي بالأسماء ──────────────────────────
    if (data.startsWith('selective_names:')) {
      await bot.answerCallbackQuery(query.id);
      const taskId = expandTaskId(data.split(':')[1]);
      setSession(adminId, 'selective_names', 'waiting', { taskId });
      return bot.sendMessage(chatId, '🎯 أرسل أسماء المستخدمين مفصولة بمسافة:');
    }

    // ── تنفيذ الانتقائي ───────────────────────────
    if (data.startsWith('sel_do:')) {
      await bot.answerCallbackQuery(query.id);
      const parts  = data.split(':');
      const taskId = expandTaskId(parts[1]);
      const action = parts[2];
      const session = getSession(adminId);
      if (!session || session.flow !== 'selective_act') return;
      if (action === 'reject') {
        setSession(adminId, 'selective_act_reject', 'reason', { taskId, ids: session.data.ids });
        return bot.sendMessage(chatId, '📝 أدخل سبب الرفض (أو "تخطي"):');
      }
      clearSession(adminId);
      return executeSelectiveAction(bot, chatId, taskId, session.data.ids, action, null);
    }
  });
}

module.exports = { register, getSession, clearSession };
