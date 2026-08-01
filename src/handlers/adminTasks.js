'use strict';

/**
 * adminTasks.js - لوحة الأدمن: إدارة المهام والحقول
 * إنشاء / تعديل / حذف المهام وحقولها من داخل البوت
 */

const db = require('../db');
// نستخدم listUsers وgetWithdrawals من db مباشرةً

// ─────────────────────────────────────────────
//  Session state per admin
// ─────────────────────────────────────────────
// adminSessions[adminId] = {
//   flow: 'create_task' | 'edit_task' | 'add_field' | 'edit_field' | ...
//   step: string,
//   data: {}   ← بيانات مؤقتة
// }
const adminSessions = {};

function setSession(adminId, flow, step, data = {}) {
  adminSessions[adminId] = { flow, step, data };
}
function getSession(adminId) { return adminSessions[adminId] || null; }
function clearSession(adminId) { delete adminSessions[adminId]; }


// ─────────────────────────────────────────────
//  Keyboards
// ─────────────────────────────────────────────

function adminMainKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '📋 إدارة المهام' }, { text: '➕ مهمة جديدة' }],
        [{ text: '📊 إحصائيات' }, { text: '🏠 القائمة الرئيسية' }],
      ],
      resize_keyboard: true,
    },
  };
}

function taskListAdminKeyboard(tasks) {
  const rows = tasks.map(t => [{
    text: `${t.isOpen ? '🟢' : '🔴'} ${t.name}`,
    callback_data: `adm_task:${t.id}`,
  }]);
  rows.push([{ text: '➕ مهمة جديدة', callback_data: 'adm_new_task' }]);
  return { inline_keyboard: rows };
}

function taskDetailKeyboard(task) {
  return {
    inline_keyboard: [
      [
        { text: '✏️ تعديل المهمة', callback_data: `adm_edit_task:${sh(task.id)}` },
        { text: task.isOpen ? '🔴 إغلاق' : '🟢 فتح', callback_data: `adm_toggle:${sh(task.id)}` },
      ],
      [
        { text: '📝 الحقول',    callback_data: `adm_fields:${sh(task.id)}`   },
        { text: '🎯 الميزات',   callback_data: `feat_list:${sh(task.id)}`    },
        { text: '🗑 حذف',       callback_data: `adm_del_task:${sh(task.id)}` },
      ],
      [
        { text: '📥 التسليمات', callback_data: `adm_subs:${sh(task.id)}` },
        { text: '🔙 رجوع',      callback_data: 'adm_tasks_list'              },
      ],
    ],
  };
}

function editTaskKeyboard(taskId) {
  const fields = [
    ['الاسم','name'], ['الوصف المختصر','shortDesc'], ['الشرح الكامل','fullDesc'],
    ['المكافأة','reward'], ['الحد الأقصى/مستخدم','maxPerUser'],
    ['الترتيب','order'], ['فيديو الشرح','videoFileId'],
  ];
  const rows = fields.map(([label, key]) => [{
    text: `✏️ ${label}`,
    callback_data: `adm_edit_field_prop:${sh(taskId)}:${key}`,
  }]);
  rows.push([{ text: '🔙 رجوع', callback_data: `adm_task:${sh(taskId)}` }]);
  return { inline_keyboard: rows };
}

// ─────────────────────────────────────────────
//  UUID shortener للـ callback_data
//  تيليجرام: حد أقصى 64 byte للـ callback_data
// ─────────────────────────────────────────────

function sh(uuid) { return uuid.substring(0, 8); }

function expandTaskId(short) {
  const tasks = db.listTasks();
  const found = tasks.find(t => t.id.startsWith(short));
  return found ? found.id : short;
}

function expandFieldId(task, short) {
  const f = task.fields.find(f => f.id.startsWith(short));
  return f ? f.id : short;
}

function fieldsListKeyboard(task) {
  const sorted = [...task.fields].sort((a, b) => a.order - b.order);
  const rows = sorted.map(f => [{
    text: `${f.required ? '🔴' : '🟡'} ${f.label} (${f.type})`,
    callback_data: `adm_fd:${sh(task.id)}:${sh(f.id)}`,   // adm_fd = field detail
  }]);
  rows.push([
    { text: '➕ إضافة حقل', callback_data: `adm_add_field:${sh(task.id)}` },
    { text: '🔙 رجوع',      callback_data: `adm_task:${sh(task.id)}`      },
  ]);
  return { inline_keyboard: rows };
}

function fieldDetailKeyboard(taskId, fieldId) {
  const t = sh(taskId), f = sh(fieldId);
  return {
    inline_keyboard: [
      [
        { text: '✏️ تعديل الاسم', callback_data: `adm_ef:${t}:${f}:label` },
        { text: '🔁 تغيير النوع', callback_data: `adm_ef:${t}:${f}:type`  },
      ],
      [
        { text: '⬆️ رفع الترتيب', callback_data: `adm_fu:${t}:${f}` },
        { text: '⬇️ خفض الترتيب', callback_data: `adm_fd2:${t}:${f}` },
      ],
      [
        { text: '🔄 تبديل الإلزامية', callback_data: `adm_fr:${t}:${f}` },
        { text: '🗑 حذف',             callback_data: `adm_delf:${t}:${f}` },
      ],
      [{ text: '🔙 رجوع', callback_data: `adm_fields:${sh(taskId)}` }],
    ],
  };
}

function fieldTypesKeyboard(taskId, fieldId) {
  const rows = db.FIELD_TYPES.map(tp => [{
    text: tp,
    callback_data: `adm_sft:${sh(taskId)}:${sh(fieldId)}:${tp}`,
  }]);
  rows.push([{ text: '🔙 إلغاء', callback_data: `adm_fd:${sh(taskId)}:${sh(fieldId)}` }]);
  return { inline_keyboard: rows };
}

function confirmDeleteKeyboard(taskId) {
  return {
    inline_keyboard: [[
      { text: '✅ نعم، احذف', callback_data: `adm_confirm_del:${sh(taskId)}` },
      { text: '❌ لا', callback_data: `adm_task:${sh(taskId)}` },
    ]],
  };
}

function cancelKeyboard(backCb) {
  return {
    inline_keyboard: [[{ text: '❌ إلغاء', callback_data: backCb }]],
  };
}

function yesNoKeyboard(yesCb, noCb) {
  return {
    inline_keyboard: [[
      { text: '✅ نعم', callback_data: yesCb },
      { text: '❌ لا', callback_data: noCb },
    ]],
  };
}


// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────

function taskSummaryText(task) {
  const status = task.isOpen ? '🟢 مفتوحة' : '🔴 مغلقة';
  return (
    `📌 *${task.name}*\n` +
    `📄 ${task.shortDesc}\n\n` +
    `💰 المكافأة: \`${task.reward}\`\n` +
    `👤 حد التسليم/مستخدم: ${task.maxPerUser ?? 'غير محدود'}\n` +
    `🔢 الترتيب: ${task.order}\n` +
    `📋 عدد الحقول: ${task.fields.length}\n` +
    `${status}\n` +
    `📅 تاريخ الإنشاء: ${task.createdAt}\n\n` +
    `📊 الإحصائيات:\n` +
    `  • إجمالي: ${task.stats.total}\n` +
    `  • قيد المراجعة: ${task.stats.pending}\n` +
    `  • مقبول: ${task.stats.approved}\n` +
    `  • مرفوض: ${task.stats.rejected}\n` +
    `  • مصدَّر: ${task.stats.exported}`
  );
}

const PROP_LABELS = {
  name: 'اسم المهمة',
  shortDesc: 'الوصف المختصر',
  fullDesc: 'الشرح الكامل',
  reward: 'قيمة المكافأة',
  maxPerUser: 'الحد الأقصى للتسليم لكل مستخدم (0 = غير محدود)',
  order: 'رقم الترتيب',
  videoFileId: 'أرسل الفيديو مباشرة (أو أرسل "حذف" لإزالته)',
};


// ─────────────────────────────────────────────
//  register
// ─────────────────────────────────────────────

function register(bot, isAdmin) {

  // ── قائمة المهام ─────────────────────────────
  bot.onText(/📋 إدارة المهام/, (msg) => {
    if (!isAdmin(msg.from.id)) return;
    sendTaskList(bot, msg.chat.id);
  });

  // ── مهمة جديدة (keyboard button) ─────────────
  bot.onText(/➕ مهمة جديدة/, (msg) => {
    if (!isAdmin(msg.from.id)) return;
    startCreateTask(bot, msg.chat.id, msg.from.id);
  });

  // ── إحصائيات ─────────────────────────────────
  bot.onText(/📊 إحصائيات/, (msg) => {
    if (!isAdmin(msg.from.id)) return;
    sendStats(bot, msg.chat.id);
  });

  // ── استقبال النصوص خلال flows ─────────────────
  bot.on('message', async (msg) => {
    const adminId = msg.from.id;
    if (!isAdmin(adminId)) return;
    const session = getSession(adminId);
    if (!session) return;
    if (msg.text && msg.text.startsWith('/')) return;
    if (msg.text && (msg.text.startsWith('🟢') || msg.text.startsWith('🔴'))) return;
    // تجاهل أزرار القائمة
    const menuTexts = ['📋 إدارة المهام','➕ مهمة جديدة','📊 إحصائيات','🔧 لوحة الأدمن','🏠 القائمة الرئيسية'];
    if (msg.text && menuTexts.includes(msg.text)) return;

    await handleAdminText(bot, msg, adminId, session);
  });

  // ── Callback queries ──────────────────────────
  bot.on('callback_query', async (query) => {
    if (query._blocked) return;   // Idempotency Gate
    const data    = query.data;
    const adminId = query.from.id;
    const chatId  = query.message.chat.id;
    const msgId   = query.message.message_id;

    if (data === 'adm_tasks_list') {
      await bot.answerCallbackQuery(query.id);
      sendTaskList(bot, chatId);
      return;
    }

    if (data === 'adm_new_task') {
      await bot.answerCallbackQuery(query.id);
      startCreateTask(bot, chatId, adminId);
      return;
    }

    if (data.startsWith('adm_task:')) {
      await bot.answerCallbackQuery(query.id);
      const taskId = data.split(':')[1];
      sendTaskDetail(bot, chatId, taskId);
      return;
    }

    if (data.startsWith('adm_toggle:')) {
      await bot.answerCallbackQuery(query.id);
      const taskId = expandTaskId(data.split(':')[1]);
      toggleTask(bot, chatId, taskId);
      return;
    }

    if (data.startsWith('adm_broadcast:')) {
      await bot.answerCallbackQuery(query.id);
      const taskId = expandTaskId(data.split(':')[1]);
      const task   = db.getTask(taskId);
      if (!task) return bot.sendMessage(chatId, '⚠️ المهمة غير موجودة.');
      bot.sendMessage(chatId, `📢 جاري إرسال الإشعارات...`);
      const { broadcastNewTask } = require('./user');
      broadcastNewTask(bot, task).then(count => {
        bot.sendMessage(
          chatId,
          count > 0
            ? `✅ تم إرسال الإشعار لـ *${count}* مستخدم.`
            : `⚠️ لا يوجد مستخدمون لإرسال الإشعار إليهم.`,
          { parse_mode: 'Markdown' }
        );
      }).catch(() => {});
      return;
    }

    if (data.startsWith('adm_edit_task:')) {
      await bot.answerCallbackQuery(query.id);
      const taskId = expandTaskId(data.split(':')[1]);
      const task   = db.getTask(taskId);
      bot.sendMessage(chatId, `✏️ *تعديل:* ${task.name}\n\nاختر ما تريد تعديله:`, {
        parse_mode: 'Markdown',
        reply_markup: editTaskKeyboard(taskId),
      });
      return;
    }

    if (data.startsWith('adm_edit_field_prop:')) {
      await bot.answerCallbackQuery(query.id);
      const parts  = data.split(':');
      const taskId = expandTaskId(parts[1]);
      const prop   = parts[2];
      startEditTaskProp(bot, chatId, adminId, taskId, prop);
      return;
    }

    if (data.startsWith('adm_del_task:')) {
      await bot.answerCallbackQuery(query.id);
      const taskId = expandTaskId(data.split(':')[1]);
      const task   = db.getTask(taskId);
      bot.sendMessage(chatId,
        `⚠️ هل تريد حذف مهمة "*${task.name}*" نهائياً؟\nسيتم حذف جميع التسليمات المرتبطة بها.`,
        { parse_mode: 'Markdown', reply_markup: confirmDeleteKeyboard(taskId) }
      );
      return;
    }

    if (data.startsWith('adm_confirm_del:')) {
      await bot.answerCallbackQuery(query.id);
      const taskId = expandTaskId(data.split(':')[1]);
      const task   = db.getTask(taskId);
      db.deleteTask(taskId);
      bot.sendMessage(chatId, `🗑 تم حذف المهمة "*${task?.name}*" بنجاح.`, {
        parse_mode: 'Markdown',
        ...adminMainKeyboard(),
      });
      return;
    }

    if (data.startsWith('adm_fields:')) {
      await bot.answerCallbackQuery(query.id);
      const short = data.split(':')[1];
      const taskId = expandTaskId(short);
      sendFieldsList(bot, chatId, taskId);
      return;
    }

    if (data.startsWith('adm_add_field:')) {
      await bot.answerCallbackQuery(query.id);
      const short  = data.split(':')[1];
      const taskId = expandTaskId(short);
      startAddField(bot, chatId, adminId, taskId);
      return;
    }

    // adm_fd = field detail (اسم مختصر عشان callback_data لا يتجاوز 64 byte)
    if (data.startsWith('adm_fd:') && !data.startsWith('adm_fd2:')) {
      await bot.answerCallbackQuery(query.id);
      const [, ts, fs] = data.split(':');
      const taskId  = expandTaskId(ts);
      const task    = db.getTask(taskId);
      const fieldId = task ? expandFieldId(task, fs) : fs;
      sendFieldDetail(bot, chatId, taskId, fieldId);
      return;
    }

    // adm_ef = edit field prop
    if (data.startsWith('adm_ef:')) {
      await bot.answerCallbackQuery(query.id);
      const parts  = data.split(':');
      const taskId  = expandTaskId(parts[1]);
      const task    = db.getTask(taskId);
      const fieldId = task ? expandFieldId(task, parts[2]) : parts[2];
      const prop    = parts[3];
      startEditFieldProp(bot, chatId, adminId, taskId, fieldId, prop);
      return;
    }

    // adm_sft = set field type
    if (data.startsWith('adm_sft:')) {
      await bot.answerCallbackQuery(query.id);
      const parts   = data.split(':');
      const taskId  = expandTaskId(parts[1]);
      const task    = db.getTask(taskId);
      const fieldId = task ? expandFieldId(task, parts[2]) : parts[2];
      const type    = parts[3];
      db.updateField(taskId, fieldId, { type });
      bot.sendMessage(chatId, `✅ تم تغيير نوع الحقل إلى *${type}*`, { parse_mode: 'Markdown' });
      sendFieldDetail(bot, chatId, taskId, fieldId);
      return;
    }

    // adm_fr = field required toggle
    if (data.startsWith('adm_fr:')) {
      await bot.answerCallbackQuery(query.id);
      const [, ts, fs] = data.split(':');
      const taskId  = expandTaskId(ts);
      const task    = db.getTask(taskId);
      const fieldId = task ? expandFieldId(task, fs) : fs;
      const field   = task?.fields.find(f => f.id === fieldId);
      db.updateField(taskId, fieldId, { required: !field.required });
      bot.sendMessage(chatId, `✅ الحقل أصبح ${!field.required ? '🔴 إجباري' : '🟡 اختياري'}`);
      sendFieldDetail(bot, chatId, taskId, fieldId);
      return;
    }

    // adm_fu = field up / adm_fd2 = field down
    if (data.startsWith('adm_fu:') || data.startsWith('adm_fd2:')) {
      await bot.answerCallbackQuery(query.id);
      const isUp   = data.startsWith('adm_fu:');
      const [, ts, fs] = data.split(':');
      const taskId  = expandTaskId(ts);
      const task    = db.getTask(taskId);
      const fieldId = task ? expandFieldId(task, fs) : fs;
      moveField(bot, chatId, taskId, fieldId, isUp ? -1 : 1);
      return;
    }

    // adm_delf = delete field
    if (data.startsWith('adm_delf:')) {
      await bot.answerCallbackQuery(query.id);
      const [, ts, fs] = data.split(':');
      const taskId  = expandTaskId(ts);
      const task    = db.getTask(taskId);
      const fieldId = task ? expandFieldId(task, fs) : fs;
      db.deleteField(taskId, fieldId);
      bot.sendMessage(chatId, '🗑 تم حذف الحقل.');
      sendFieldsList(bot, chatId, taskId);
      return;
    }

    // ── الـ callbacks القديمة (للتوافق مع رسائل قديمة) ──
    if (data.startsWith('adm_field_detail:')) {
      await bot.answerCallbackQuery(query.id);
      const [, , taskId, fieldId] = data.split(':');
      sendFieldDetail(bot, chatId, taskId, fieldId);
      return;
    }
    if (data.startsWith('adm_edit_f:')) {
      await bot.answerCallbackQuery(query.id);
      const [, , taskId, fieldId, prop] = data.split(':');
      startEditFieldProp(bot, chatId, adminId, taskId, fieldId, prop);
      return;
    }
    if (data.startsWith('adm_set_ftype:')) {
      await bot.answerCallbackQuery(query.id);
      const [, , taskId, fieldId, type] = data.split(':');
      db.updateField(taskId, fieldId, { type });
      bot.sendMessage(chatId, `✅ تم تغيير نوع الحقل إلى *${type}*`, { parse_mode: 'Markdown' });
      sendFieldDetail(bot, chatId, taskId, fieldId);
      return;
    }
    if (data.startsWith('adm_field_req:')) {
      await bot.answerCallbackQuery(query.id);
      const [, , taskId, fieldId] = data.split(':');
      const task  = db.getTask(taskId);
      const field = task?.fields.find(f => f.id === fieldId);
      db.updateField(taskId, fieldId, { required: !field.required });
      bot.sendMessage(chatId, `✅ الحقل أصبح ${!field.required ? '🔴 إجباري' : '🟡 اختياري'}`);
      sendFieldDetail(bot, chatId, taskId, fieldId);
      return;
    }
    if (data.startsWith('adm_field_up:') || data.startsWith('adm_field_dn:')) {
      await bot.answerCallbackQuery(query.id);
      const isUp  = data.startsWith('adm_field_up:');
      const parts = data.split(':');
      moveField(bot, chatId, parts[2], parts[3], isUp ? -1 : 1);
      return;
    }
    if (data.startsWith('adm_del_field:')) {
      await bot.answerCallbackQuery(query.id);
      const [, , taskId, fieldId] = data.split(':');
      db.deleteField(taskId, fieldId);
      bot.sendMessage(chatId, '🗑 تم حذف الحقل.');
      sendFieldsList(bot, chatId, taskId);
      return;
    }
  });
}


// ─────────────────────────────────────────────
//  Task list & detail
// ─────────────────────────────────────────────

function sendTaskList(bot, chatId) {
  const tasks = db.listTasks();
  if (tasks.length === 0) {
    return bot.sendMessage(chatId, '📭 لا توجد مهام. أنشئ مهمة جديدة:', {
      reply_markup: { inline_keyboard: [[{ text: '➕ مهمة جديدة', callback_data: 'adm_new_task' }]] },
    });
  }
  bot.sendMessage(chatId, `📋 *المهام (${tasks.length}):*`, {
    parse_mode: 'Markdown',
    reply_markup: taskListAdminKeyboard(tasks),
  });
}

function sendTaskDetail(bot, chatId, taskId) {
  const task = db.getTask(taskId);
  if (!task) return bot.sendMessage(chatId, '⚠️ المهمة غير موجودة.');
  bot.sendMessage(chatId, taskSummaryText(task), {
    parse_mode: 'Markdown',
    reply_markup: taskDetailKeyboard(task),
  });
}

function toggleTask(bot, chatId, taskId) {
  const task = db.getTask(taskId);

  // منع فتح مهمة بدون حقول
  if (!task.isOpen && (!task.fields || task.fields.length === 0)) {
    return bot.sendMessage(chatId,
      `⚠️ لا يمكن فتح المهمة قبل إضافة حقل واحد على الأقل.\n\nاذهب إلى 📝 الحقول وأضف حقلاً أولاً.`,
      { reply_markup: { inline_keyboard: [[{ text: '📝 إضافة حقول', callback_data: `adm_fields:${sh(taskId)}` }]] } }
    );
  }

  const wasOpen = task.isOpen;
  db.updateTask(taskId, { isOpen: !task.isOpen });

  const nowOpen = !wasOpen;
  bot.sendMessage(chatId, `✅ المهمة الآن ${nowOpen ? '🟢 مفتوحة' : '🔴 مغلقة'}`);

  // broadcast لما المهمة تتفتح
  if (nowOpen) {
    // نسأل الأدمن هل يريد إرسال إشعار
    bot.sendMessage(chatId, `📢 هل تريد إرسال إشعار للمستخدمين بهذه المهمة؟`, {
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ نعم، أرسل إشعار', callback_data: `adm_broadcast:${sh(taskId)}` },
          { text: '❌ لا',               callback_data: `adm_task:${sh(taskId)}`      },
        ]],
      },
    });
  }

  sendTaskDetail(bot, chatId, taskId);
}

function sendStats(bot, chatId) {
  const tasks = db.listTasks();
  const users = db.listUsers();

  // ── إحصائيات المستخدمين ──
  const totalUsers   = users.length;
  const bannedUsers  = users.filter(u => u.isBanned).length;
  const totalBalance = users.reduce((s, u) => s + (u.balance || 0), 0).toFixed(2);
  const totalEarned  = users.reduce((s, u) => s + (u.totalEarned || 0), 0).toFixed(2);

  // ── إحصائيات السحوبات ──
  const wds           = db.getWithdrawals();
  const pendingWds    = wds.filter(w => w.status === 'pending');
  const approvedWds   = wds.filter(w => w.status === 'approved');
  const pendingWdAmt  = pendingWds.reduce((s, w) => s + w.amount, 0).toFixed(2);
  const approvedWdAmt = approvedWds.reduce((s, w) => s + w.amount, 0).toFixed(2);

  // ── إحصائيات المهام ──
  let text = '📊 *إحصائيات عامة*\n\n';

  text += `👥 *المستخدمون*\n`;
  text += `  • الإجمالي: *${totalUsers}*\n`;
  text += `  • محظور: *${bannedUsers}*\n`;
  text += `  • إجمالي الأرصدة الحالية: *${totalBalance} EGP*\n`;
  text += `  • إجمالي ما كُسب: *${totalEarned} EGP*\n\n`;

  text += `💳 *السحوبات*\n`;
  text += `  • معلقة: *${pendingWds.length}* (${pendingWdAmt} EGP)\n`;
  text += `  • مقبولة: *${approvedWds.length}* (${approvedWdAmt} EGP)\n`;
  text += `  • مرفوضة: *${wds.filter(w => w.status === 'rejected').length}*\n\n`;

  if (tasks.length === 0) {
    text += '📋 *المهام:* لا توجد مهام.';
    return bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  }

  text += `📋 *المهام (${tasks.length})*\n`;
  let totals = { total: 0, pending: 0, approved: 0, rejected: 0, exported: 0 };
  for (const tk of tasks) {
    const icon = tk.isOpen ? '🟢' : '🔴';
    text += `${icon} *${tk.name}*: ${tk.stats.total} تسليم`;
    if (tk.stats.pending > 0) text += ` (⏳${tk.stats.pending})`;
    text += '\n';
    for (const k of Object.keys(totals)) totals[k] += tk.stats[k] || 0;
  }
  text += `\n*مجموع التسليمات:*\n`;
  text += `  ⏳ انتظار: ${totals.pending} | ✅ مقبول: ${totals.approved} | ❌ مرفوض: ${totals.rejected} | 📤 مصدَّر: ${totals.exported}`;

  bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
}

// ─────────────────────────────────────────────
//  Fields management
// ─────────────────────────────────────────────

function sendFieldsList(bot, chatId, taskId) {
  const task = db.getTask(taskId);
  if (!task) return bot.sendMessage(chatId, '⚠️ المهمة غير موجودة.');
  const count = task.fields.length;
  bot.sendMessage(
    chatId,
    `📝 *حقول المهمة "${task.name}"* (${count} حقل)\n\n🔴 إجباري | 🟡 اختياري`,
    { parse_mode: 'Markdown', reply_markup: fieldsListKeyboard(task) }
  );
}

function sendFieldDetail(bot, chatId, taskId, fieldId) {
  const task  = db.getTask(taskId);
  const field = task?.fields.find(f => f.id === fieldId);
  if (!field) return bot.sendMessage(chatId, '⚠️ الحقل غير موجود.');
  const text =
    `📝 *تفاصيل الحقل*\n\n` +
    `• الاسم: *${field.label}*\n` +
    `• النوع: \`${field.type}\`\n` +
    `• إجباري: ${field.required ? '✅ نعم' : '❌ لا'}\n` +
    `• الترتيب: ${field.order}`;
  bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: fieldDetailKeyboard(taskId, fieldId),
  });
}

function moveField(bot, chatId, taskId, fieldId, direction) {
  const task   = db.getTask(taskId);
  const fields = [...task.fields].sort((a, b) => a.order - b.order);
  const idx    = fields.findIndex(f => f.id === fieldId);
  const newIdx = idx + direction;
  if (newIdx < 0 || newIdx >= fields.length) {
    return bot.sendMessage(chatId, '⚠️ لا يمكن تحريك الحقل أكثر من ذلك.');
  }
  [fields[idx].order, fields[newIdx].order] = [fields[newIdx].order, fields[idx].order];
  db.reorderFields(taskId, fields.map(f => f.id));
  sendFieldsList(bot, chatId, taskId);
}


// ─────────────────────────────────────────────
//  Create Task Flow
// ─────────────────────────────────────────────
// steps: name → shortDesc → fullDesc → video → reward → maxPerUser → status → confirm

function startCreateTask(bot, chatId, adminId) {
  setSession(adminId, 'create_task', 'name', {});
  bot.sendMessage(chatId, '➕ *إنشاء مهمة جديدة*\n\n📝 أدخل *اسم المهمة:*', {
    parse_mode: 'Markdown',
    reply_markup: cancelKeyboard('adm_tasks_list'),
  });
}

const CREATE_STEPS = ['name','shortDesc','fullDesc','video','reward','maxPerUser','status'];

const CREATE_PROMPTS = {
  name:       '📝 أدخل *اسم المهمة:*',
  shortDesc:  '📄 أدخل *وصفاً مختصراً:*',
  fullDesc:   '📖 أدخل *الشرح النصي الكامل:*',
  video:      '🎥 أرسل *فيديو الشرح* (اختياري - أرسل "تخطي" لتجاوزه)',
  reward:     '💰 أدخل *قيمة المكافأة* (رقم):',
  maxPerUser: '👤 أدخل *الحد الأقصى للتسليم لكل مستخدم* (0 = غير محدود):',
  status:     '🔘 هل المهمة *مفتوحة* الآن؟',
};

async function handleCreateTask(bot, msg, adminId, session) {
  const chatId = msg.chat.id;
  const step   = session.step;
  const data   = session.data;

  if (step === 'name') {
    if (!msg.text?.trim()) return bot.sendMessage(chatId, '⚠️ الاسم لا يمكن أن يكون فارغاً.');
    data.name = msg.text.trim();
    setSession(adminId, 'create_task', 'shortDesc', data);
    return bot.sendMessage(chatId, CREATE_PROMPTS.shortDesc, { parse_mode: 'Markdown' });
  }

  if (step === 'shortDesc') {
    data.shortDesc = msg.text?.trim() || '';
    setSession(adminId, 'create_task', 'fullDesc', data);
    return bot.sendMessage(chatId, CREATE_PROMPTS.fullDesc, { parse_mode: 'Markdown' });
  }

  if (step === 'fullDesc') {
    data.fullDesc = msg.text?.trim() || '';
    setSession(adminId, 'create_task', 'video', data);
    return bot.sendMessage(chatId, CREATE_PROMPTS.video, { parse_mode: 'Markdown' });
  }

  if (step === 'video') {
    if (msg.video) {
      data.videoFileId = msg.video.file_id;
    } else {
      data.videoFileId = null;
    }
    setSession(adminId, 'create_task', 'reward', data);
    return bot.sendMessage(chatId, CREATE_PROMPTS.reward, { parse_mode: 'Markdown' });
  }

  if (step === 'reward') {
    const val = parseFloat(msg.text);
    if (isNaN(val) || val < 0) return bot.sendMessage(chatId, '⚠️ أدخل رقماً صحيحاً.');
    data.reward = val;
    setSession(adminId, 'create_task', 'maxPerUser', data);
    return bot.sendMessage(chatId, CREATE_PROMPTS.maxPerUser, { parse_mode: 'Markdown' });
  }

  if (step === 'maxPerUser') {
    const val = parseInt(msg.text);
    data.maxPerUser = (!isNaN(val) && val > 0) ? val : null;
    setSession(adminId, 'create_task', 'status', data);
    return bot.sendMessage(chatId, CREATE_PROMPTS.status, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '🟢 مفتوحة', callback_data: `adm_ct_status:open:${adminId}` },
          { text: '🔴 مغلقة',  callback_data: `adm_ct_status:closed:${adminId}` },
        ]],
      },
    });
  }
}


// ─────────────────────────────────────────────
//  Edit Task Property Flow
// ─────────────────────────────────────────────

function startEditTaskProp(bot, chatId, adminId, taskId, prop) {
  setSession(adminId, 'edit_task_prop', 'waiting', { taskId, prop });
  const prompt = PROP_LABELS[prop] || `أدخل قيمة جديدة لـ ${prop}:`;
  bot.sendMessage(chatId, `✏️ *${prompt}*`, {
    parse_mode: 'Markdown',
    reply_markup: cancelKeyboard(`adm_edit_task:${taskId}`),
  });
}

async function handleEditTaskProp(bot, msg, adminId, session) {
  const chatId = msg.chat.id;
  const { taskId, prop } = session.data;

  let value;

  if (prop === 'videoFileId') {
    if (msg.video) {
      value = msg.video.file_id;
    } else if (msg.text?.trim().toLowerCase() === 'حذف') {
      value = null;
    } else {
      return bot.sendMessage(chatId, '⚠️ أرسل فيديو أو اكتب "حذف" لإزالة الفيديو الحالي.');
    }
  } else if (prop === 'reward' || prop === 'order') {
    value = parseFloat(msg.text);
    if (isNaN(value)) return bot.sendMessage(chatId, '⚠️ أدخل رقماً صحيحاً.');
  } else if (prop === 'maxPerUser') {
    const v = parseInt(msg.text);
    value = (!isNaN(v) && v > 0) ? v : null;
  } else {
    value = msg.text?.trim();
    if (!value) return bot.sendMessage(chatId, '⚠️ القيمة لا يمكن أن تكون فارغة.');
  }

  db.updateTask(taskId, { [prop]: value });
  clearSession(adminId);
  bot.sendMessage(chatId, `✅ تم تحديث *${PROP_LABELS[prop] || prop}* بنجاح.`, { parse_mode: 'Markdown' });
  sendTaskDetail(bot, chatId, taskId);
}

// ─────────────────────────────────────────────
//  Add Field Flow
// ─────────────────────────────────────────────
// steps: label → type → required

function startAddField(bot, chatId, adminId, taskId) {
  setSession(adminId, 'add_field', 'label', { taskId });
  bot.sendMessage(chatId, '➕ *إضافة حقل جديد*\n\n✏️ أدخل *اسم الحقل* (مثال: البريد الإلكتروني):', {
    parse_mode: 'Markdown',
    reply_markup: cancelKeyboard(`adm_fields:${sh(taskId)}`),
  });
}

async function handleAddField(bot, msg, adminId, session) {
  const chatId = msg.chat.id;
  const step   = session.step;
  const data   = session.data;

  if (step === 'label') {
    if (!msg.text?.trim()) return bot.sendMessage(chatId, '⚠️ الاسم لا يمكن أن يكون فارغاً.');
    data.label = msg.text.trim();
    setSession(adminId, 'add_field', 'type', data);
    return bot.sendMessage(chatId, '🔠 اختر *نوع الحقل:*', {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: db.FIELD_TYPES.reduce((rows, t, i) => {
          if (i % 3 === 0) rows.push([]);
          rows[rows.length - 1].push({ text: t, callback_data: `adm_af_type:${t}:${adminId}` });
          return rows;
        }, []),
      },
    });
  }
}

// ─────────────────────────────────────────────
//  Edit Field Property Flow
// ─────────────────────────────────────────────

function startEditFieldProp(bot, chatId, adminId, taskId, fieldId, prop) {
  if (prop === 'type') {
    return bot.sendMessage(chatId, '🔠 اختر النوع الجديد:', {
      reply_markup: fieldTypesKeyboard(taskId, fieldId),
    });
  }
  setSession(adminId, 'edit_field_prop', 'waiting', { taskId, fieldId, prop });
  bot.sendMessage(chatId, `✏️ أدخل القيمة الجديدة لـ *${prop === 'label' ? 'اسم الحقل' : prop}*:`, {
    parse_mode: 'Markdown',
    reply_markup: cancelKeyboard(`adm_fd:${sh(taskId)}:${sh(fieldId)}`),
  });
}

async function handleEditFieldProp(bot, msg, adminId, session) {
  const chatId = msg.chat.id;
  const { taskId, fieldId, prop } = session.data;
  const value = msg.text?.trim();
  if (!value) return bot.sendMessage(chatId, '⚠️ القيمة لا يمكن أن تكون فارغة.');
  db.updateField(taskId, fieldId, { [prop]: value });
  clearSession(adminId);
  bot.sendMessage(chatId, '✅ تم التحديث بنجاح.');
  sendFieldDetail(bot, chatId, taskId, fieldId);
}


// ─────────────────────────────────────────────
//  handleAdminText - dispatcher
// ─────────────────────────────────────────────

async function handleAdminText(bot, msg, adminId, session) {
  const { flow } = session;

  if (flow === 'create_task')    return handleCreateTask(bot, msg, adminId, session);
  if (flow === 'edit_task_prop') return handleEditTaskProp(bot, msg, adminId, session);
  if (flow === 'add_field')      return handleAddField(bot, msg, adminId, session);
  if (flow === 'edit_field_prop') return handleEditFieldProp(bot, msg, adminId, session);
}

// ─────────────────────────────────────────────
//  Callback dispatcher for status & type picks
//  (مشترك مع index.js)
// ─────────────────────────────────────────────

function handleCallbackExtras(bot, query) {
  if (query._blocked) return false;   // Idempotency Gate
  const data    = query.data;
  const adminId = query.from.id;
  const chatId  = query.message.chat.id;

  // اختيار حالة المهمة الجديدة
  if (data.startsWith('adm_ct_status:')) {
    bot.answerCallbackQuery(query.id);
    const [, , status] = data.split(':');
    const session = getSession(adminId);
    if (!session || session.flow !== 'create_task') return;
    session.data.isOpen = (status === 'open');
    // حفظ المهمة
    const task = db.createTask(session.data);
    clearSession(adminId);
    bot.sendMessage(
      chatId,
      `✅ *تم إنشاء المهمة بنجاح!*\n\n🆔 \`${task.id}\`\n📌 ${task.name}\n\nيمكنك الآن إضافة الحقول المطلوبة:`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[
          { text: '➕ إضافة حقول', callback_data: `adm_fields:${task.id}` },
          { text: '📋 عرض المهمة', callback_data: `adm_task:${task.id}` },
        ]]},
      }
    );

    // broadcast للمستخدمين لو المهمة مفتوحة وعندها حقول
    if (task.isOpen && task.fields && task.fields.length > 0) {
      const { broadcastNewTask } = require('./user');
      broadcastNewTask(bot, task).then(count => {
        if (count > 0) {
          bot.sendMessage(chatId, `📢 تم إرسال إشعار المهمة الجديدة لـ *${count}* مستخدم.`, { parse_mode: 'Markdown' });
        }
      }).catch(() => {});
    }

    return true;
  }

  // اختيار نوع الحقل الجديد
  if (data.startsWith('adm_af_type:')) {
    bot.answerCallbackQuery(query.id);
    const [, type] = data.split(':');
    const session = getSession(adminId);
    if (!session || session.flow !== 'add_field') return;
    session.data.type = type;
    setSession(adminId, 'add_field', 'required', session.data);
    bot.sendMessage(chatId, `✅ النوع: *${type}*\n\nهل الحقل إجباري؟`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '🔴 إجباري',   callback_data: `adm_af_req:true:${adminId}` },
          { text: '🟡 اختياري', callback_data: `adm_af_req:false:${adminId}` },
        ]],
      },
    });
    return true;
  }

  // اختيار إلزامية الحقل الجديد
  if (data.startsWith('adm_af_req:')) {
    bot.answerCallbackQuery(query.id);
    const [, req] = data.split(':');
    const session = getSession(adminId);
    if (!session || session.flow !== 'add_field') return;
    const { taskId, label, type } = session.data;
    const field = db.addField(taskId, { label, type, required: req === 'true' });
    clearSession(adminId);
    bot.sendMessage(chatId, `✅ تم إضافة الحقل "*${field.label}*" بنجاح.`, { parse_mode: 'Markdown' });
    sendFieldsList(bot, chatId, taskId);
    return true;
  }

  return false;
}

module.exports = {
  register,
  handleCallbackExtras,
  adminMainKeyboard,
  getSession,
  clearSession,
};
