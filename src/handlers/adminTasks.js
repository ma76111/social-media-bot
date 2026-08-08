'use strict';

/**
 * adminTasks.js - لوحة الأدمن: إدارة المهام والحقول
 * كل الأزرار في Reply Keyboard (السفلي) لتجنب callback_data limit
 */

const db = require('../db');
const { escMd } = require('../utils/escMd');

// ─── helper: جلب اسم الحقل بشكل آمن ───
function getFieldLabel(field, lang = 'ar') {
  if (!field || !field.label) return '';
  if (typeof field.label === 'string') return field.label;
  return field.label[lang] || field.label['ar'] || Object.values(field.label).find(v => v) || '';
}

// ─────────────────────────────────────────────
//  Session
// ─────────────────────────────────────────────
const adminSessions = {};
function setSession(adminId, flow, step, data = {}) {
  adminSessions[adminId] = { flow, step, data };
}
function getSession(adminId) { return adminSessions[adminId] || null; }
function clearSession(adminId) { delete adminSessions[adminId]; }

// ─────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────
const SUPPORTED_LANGS = ['ar', 'en'];
const LANG_LABELS     = { ar: '🇦🇪 عربي', en: '🇬🇧 English' };
const I18N_FIELDS     = ['name', 'shortDesc', 'fullDesc'];
const PROP_LABELS     = {
  name:       'اسم المهمة',
  shortDesc:  'الوصف المختصر',
  fullDesc:   'الشرح الكامل',
  reward:     'قيمة المكافأة',
  maxPerUser: 'الحد الأقصى للتسليم/مستخدم (0=غير محدود)',
  order:      'رقم الترتيب',
  videoFileId:'أرسل الفيديو (أو "حذف" لإزالته)',
};

// أزرار إجراءات ثابتة للتعرف عليها في message handler
const BTN = {
  BACK:          '🔙 رجوع',
  CANCEL:        '❌ إلغاء',
  NEW_TASK:      '➕ مهمة جديدة',
  TASK_LIST:     '📋 المهام',
  STATS:         '📊 إحصائيات',
  // task detail actions
  EDIT_TASK:     '✏️ تعديل',
  TOGGLE_TASK:   '🔁 فتح/إغلاق',
  FIELDS:        '📝 الحقول',
  FEATURES:      '🎯 الميزات',
  DELETE_TASK:   '🗑 حذف المهمة',
  SUBMISSIONS:   '📥 التسليمات',
  PREVIEW:       '👁 معاينة',
  // field detail actions
  EDIT_LABEL_AR: '✏️ الاسم عربي',
  EDIT_LABEL_EN: '✏️ Name EN',
  EDIT_TYPE:     '🔁 النوع',
  TOGGLE_REQ:    '🔄 إلزامي/اختياري',
  MOVE_UP:       '⬆️ رفع',
  MOVE_DOWN:     '⬇️ خفض',
  ALT_TYPE:      '🔀 نوع بديل',
  DELETE_FIELD:  '🗑 حذف الحقل',
  ADD_FIELD:     '➕ إضافة حقل',
  // task edit props
  EDIT_NAME_AR:      '✏️ الاسم 🇦🇪',
  EDIT_NAME_EN:      '✏️ Name 🇬🇧',
  EDIT_DESC_AR:      '✏️ وصف مختصر 🇦🇪',
  EDIT_DESC_EN:      '✏️ Short desc 🇬🇧',
  EDIT_FULL_AR:      '✏️ شرح كامل 🇦🇪',
  EDIT_FULL_EN:      '✏️ Full desc 🇬🇧',
  EDIT_REWARD:       '💰 المكافأة',
  EDIT_MAX:          '👤 الحد الأقصى',
  EDIT_ORDER:        '🔢 الترتيب',
  EDIT_VIDEO:        '🎥 الفيديو',
  CONFIRM_DELETE:    '✅ نعم، احذف',
};

// كل الأزرار التي تُعالَج هنا (لحمايتها من handlers أخرى)
const ALL_BTN_TEXTS = new Set(Object.values(BTN));

// ─────────────────────────────────────────────
//  Reply Keyboards
// ─────────────────────────────────────────────

function mainAdminKeyboard() {
  return {
    keyboard: [
      [{ text: '📋 إدارة المهام' }, { text: '➕ مهمة جديدة' }],
      [{ text: '📊 إحصائيات' },    { text: '📤 طلبات السحب' }],
      [{ text: '👥 المستخدمون' },  { text: '💱 سعر الصرف' }],
      [{ text: '⚙️ الإعدادات' }],
    ],
    resize_keyboard: true,
  };
}

function taskListKeyboard(tasks) {
  const rows = tasks.map(t => [{
    text: `${t.isOpen ? '🟢' : '🔴'} ${db.getTaskText(t, 'name', 'ar')}`,
  }]);
  rows.push([{ text: BTN.NEW_TASK }, { text: BTN.BACK }]);
  return { keyboard: rows, resize_keyboard: true };
}

function taskDetailKeyboard(task) {
  return {
    keyboard: [
      [{ text: BTN.EDIT_TASK },   { text: BTN.TOGGLE_TASK }],
      [{ text: BTN.FIELDS },      { text: BTN.FEATURES }],
      [{ text: BTN.SUBMISSIONS }, { text: BTN.PREVIEW }],
      [{ text: BTN.DELETE_TASK }],
      [{ text: BTN.BACK }],
    ],
    resize_keyboard: true,
  };
}

function taskEditKeyboard() {
  return {
    keyboard: [
      [{ text: BTN.EDIT_NAME_AR }, { text: BTN.EDIT_NAME_EN }],
      [{ text: BTN.EDIT_DESC_AR }, { text: BTN.EDIT_DESC_EN }],
      [{ text: BTN.EDIT_FULL_AR }, { text: BTN.EDIT_FULL_EN }],
      [{ text: BTN.EDIT_REWARD },  { text: BTN.EDIT_MAX }],
      [{ text: BTN.EDIT_ORDER },   { text: BTN.EDIT_VIDEO }],
      [{ text: BTN.BACK }],
    ],
    resize_keyboard: true,
  };
}

function fieldsListKeyboard(task) {
  const sorted = [...task.fields].sort((a, b) => a.order - b.order);
  const rows = sorted.map(f => [{
    text: `${f.required ? '🔴' : '🟡'} ${getFieldLabel(f, 'ar')} (${f.type})`,
  }]);
  rows.push([{ text: BTN.ADD_FIELD }, { text: BTN.BACK }]);
  return { keyboard: rows, resize_keyboard: true };
}

function fieldDetailKeyboard(field) {
  const altBtn = field.altType
    ? `🔀 إزالة البديل (${field.altType})`
    : BTN.ALT_TYPE;
  return {
    keyboard: [
      [{ text: BTN.EDIT_LABEL_AR }, { text: BTN.EDIT_LABEL_EN }],
      [{ text: BTN.EDIT_TYPE },     { text: BTN.TOGGLE_REQ }],
      [{ text: BTN.MOVE_UP },       { text: BTN.MOVE_DOWN }],
      [{ text: altBtn },            { text: BTN.DELETE_FIELD }],
      [{ text: BTN.BACK }],
    ],
    resize_keyboard: true,
  };
}

function fieldTypesKeyboard() {
  const rows = [];
  for (let i = 0; i < db.FIELD_TYPES.length; i += 3) {
    rows.push(db.FIELD_TYPES.slice(i, i + 3).map(tp => ({ text: tp })));
  }
  rows.push([{ text: BTN.CANCEL }]);
  return { keyboard: rows, resize_keyboard: true };
}

function yesNoKeyboard() {
  return {
    keyboard: [[{ text: '✅ نعم، احذف' }, { text: BTN.CANCEL }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

function cancelKeyboard() {
  return {
    keyboard: [[{ text: BTN.CANCEL }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

function skipCancelKeyboard() {
  return {
    keyboard: [[{ text: 'تخطي' }, { text: BTN.CANCEL }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

// ─────────────────────────────────────────────
//  Display helpers
// ─────────────────────────────────────────────

function taskSummaryText(task) {
  const status = task.isOpen ? '🟢 مفتوحة' : '🔴 مغلقة';
  function showI18n(val) {
    if (!val) return '—';
    if (typeof val === 'string') return escMd(val);
    return SUPPORTED_LANGS.filter(l => val[l]).map(l => `${LANG_LABELS[l]}: ${escMd(val[l])}`).join('\n    ') || '—';
  }
  return (
    `📌 *${escMd(db.getTaskText(task, 'name', 'ar'))}*\n` +
    `📄 الوصف:\n    ${showI18n(task.shortDesc)}\n\n` +
    `💰 المكافأة: \`${task.reward}\`\n` +
    `👤 حد التسليم/مستخدم: ${task.maxPerUser ?? 'غير محدود'}\n` +
    `🔢 الترتيب: ${task.order}\n` +
    `📋 عدد الحقول: ${task.fields.length}\n` +
    `${status}\n` +
    `📅 ${task.createdAt}\n\n` +
    `📊 إجمالي: ${task.stats.total} | ⏳${task.stats.pending} | ✅${task.stats.approved} | ❌${task.stats.rejected}`
  );
}

function sendTaskList(bot, chatId, adminId = null) {
  const tasks = db.listTasks();
  // نحفظ state لما الأدمن يختار مهمة
  if (adminId) setSession(adminId, 'task_list', 'main', {});
  if (tasks.length === 0) {
    return bot.sendMessage(chatId, '📭 لا توجد مهام.', {
      reply_markup: {
        keyboard: [[{ text: BTN.NEW_TASK }, { text: BTN.BACK }]],
        resize_keyboard: true,
      },
    });
  }
  bot.sendMessage(chatId, `📋 *المهام (${tasks.length}):*\n\nاختر مهمة:`, {
    parse_mode: 'Markdown',
    reply_markup: taskListKeyboard(tasks),
  });
}

function sendTaskDetail(bot, chatId, task) {
  bot.sendMessage(chatId, taskSummaryText(task), {
    parse_mode: 'Markdown',
    reply_markup: taskDetailKeyboard(task),
  });
}

function sendFieldsList(bot, chatId, task) {
  const count = task.fields.length;
  bot.sendMessage(
    chatId,
    `📝 *حقول "${escMd(db.getTaskText(task, 'name', 'ar'))}"* (${count})\n\n🔴 إجباري | 🟡 اختياري\n\nاختر حقلاً للتعديل:`,
    { parse_mode: 'Markdown', reply_markup: fieldsListKeyboard(task) }
  );
}

function sendFieldDetail(bot, chatId, field, task) {
  const labelAr = getFieldLabel(field, 'ar');
  const labelEn = getFieldLabel(field, 'en');
  const altInfo = field.altType ? `\`${field.altType}\`` : '—';
  const text =
    `📝 *تفاصيل الحقل*\n\n` +
    `• الاسم 🇦🇪: *${escMd(labelAr)}*\n` +
    `• Name 🇬🇧: *${escMd(labelEn)}*\n` +
    `• النوع: \`${field.type}\`\n` +
    `• إجباري: ${field.required ? '✅' : '❌'}\n` +
    `• الترتيب: ${field.order}\n` +
    `• نوع بديل: ${altInfo}`;
  bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: fieldDetailKeyboard(field),
  });
}

function sendStats(bot, chatId) {
  const tasks = db.listTasks();
  const users = db.listUsers();
  const totalBalance = users.reduce((s, u) => s + (u.balance || 0), 0).toFixed(2);
  const totalEarned  = users.reduce((s, u) => s + (u.totalEarned || 0), 0).toFixed(2);
  const wds          = db.getWithdrawals();
  const pendingWds   = wds.filter(w => w.status === 'pending');
  const approvedWds  = wds.filter(w => w.status === 'approved');

  let text = '📊 *إحصائيات عامة*\n\n';
  text += `👥 المستخدمون: *${users.length}* (محظور: ${users.filter(u => u.isBanned).length})\n`;
  text += `💰 الأرصدة الحالية: *${totalBalance} EGP* | مكتسب: *${totalEarned} EGP*\n\n`;
  text += `💳 السحوبات: معلقة *${pendingWds.length}* | مقبولة *${approvedWds.length}*\n\n`;

  if (tasks.length > 0) {
    text += `📋 *المهام (${tasks.length})*\n`;
    let totals = { total: 0, pending: 0, approved: 0, rejected: 0 };
    for (const tk of tasks) {
      text += `${tk.isOpen ? '🟢' : '🔴'} *${escMd(db.getTaskText(tk, 'name', 'ar'))}*: ${tk.stats.total} تسليم`;
      if (tk.stats.pending > 0) text += ` (⏳${tk.stats.pending})`;
      text += '\n';
      for (const k of Object.keys(totals)) totals[k] += tk.stats[k] || 0;
    }
    text += `\n*مجموع:* ⏳${totals.pending} | ✅${totals.approved} | ❌${totals.rejected}`;
  }

  bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: { keyboard: [[{ text: BTN.BACK }]], resize_keyboard: true },
  });
}

// ─────────────────────────────────────────────
//  register — message handler مركزي
// ─────────────────────────────────────────────

function register(bot, isAdmin) {

  bot.on('message', async (msg) => {
    const adminId = msg.from.id;
    if (!isAdmin(adminId)) return;

    const text    = msg.text || '';
    const session = getSession(adminId);

    // ── القائمة الرئيسية / navigation ──────────
    if (text === '📋 إدارة المهام') {
      clearSession(adminId);
      return sendTaskList(bot, msg.chat.id, adminId);
    }
    if (text === '➕ مهمة جديدة') {
      return startCreateTask(bot, msg.chat.id, adminId);
    }
    if (text === '📊 إحصائيات') {
      clearSession(adminId);
      return sendStats(bot, msg.chat.id);
    }

    // ── إلغاء / رجوع ───────────────────────────
    if (text === BTN.CANCEL) {
      clearSession(adminId);
      return bot.sendMessage(msg.chat.id, '✅ تم الإلغاء.', {
        reply_markup: mainAdminKeyboard(),
      });
    }

    // ── رجوع — يعتمد على آخر state ──────────────
    if (text === BTN.BACK) {
      if (!session) {
        clearSession(adminId);
        return bot.sendMessage(msg.chat.id, '🏠 القائمة الرئيسية', {
          reply_markup: mainAdminKeyboard(),
        });
      }
      const { flow, data } = session;

      if (flow === 'task_list') {
        clearSession(adminId);
        return bot.sendMessage(msg.chat.id, '🏠 القائمة الرئيسية', {
          reply_markup: mainAdminKeyboard(),
        });
      }
      if (flow === 'task_detail') {
        clearSession(adminId);
        return sendTaskList(bot, msg.chat.id, adminId);
      }
      if (flow === 'task_edit') {
        const task = db.getTask(data.taskId);
        if (task) { setSession(adminId, 'task_detail', 'main', { taskId: task.id }); return sendTaskDetail(bot, msg.chat.id, task); }
        return sendTaskList(bot, msg.chat.id, adminId);
      }
      if (flow === 'fields_list') {
        const task = db.getTask(data.taskId);
        if (task) { setSession(adminId, 'task_detail', 'main', { taskId: task.id }); return sendTaskDetail(bot, msg.chat.id, task); }
        return sendTaskList(bot, msg.chat.id, adminId);
      }
      if (flow === 'field_detail') {
        const task = db.getTask(data.taskId);
        if (task) { setSession(adminId, 'fields_list', 'main', { taskId: task.id }); return sendFieldsList(bot, msg.chat.id, task); }
        return sendTaskList(bot, msg.chat.id, adminId);
      }
      // default
      clearSession(adminId);
      return bot.sendMessage(msg.chat.id, '🏠 القائمة الرئيسية', { reply_markup: mainAdminKeyboard() });
    }

    // ── لو مفيش session و الـ text مش زرار معروف → ignore ──
    if (!session && !ALL_BTN_TEXTS.has(text)) return;

    // ── معالجة state ─────────────────────────────
    if (session) {
      const { flow, step, data } = session;

      // ─ Task List: المستخدم اختار مهمة ─
      if (flow === 'task_list') {
        const tasks = db.listTasks();
        const task  = tasks.find(t => text.includes(db.getTaskText(t, 'name', 'ar')));
        if (task) {
          setSession(adminId, 'task_detail', 'main', { taskId: task.id });
          return sendTaskDetail(bot, msg.chat.id, task);
        }
        return;
      }

      // ─ Task Detail: أزرار الإجراءات ─
      if (flow === 'task_detail') {
        const task = db.getTask(data.taskId);
        if (!task) { clearSession(adminId); return sendTaskList(bot, msg.chat.id, adminId); }

        if (text === BTN.EDIT_TASK) {
          setSession(adminId, 'task_edit', 'main', { taskId: task.id });
          return bot.sendMessage(msg.chat.id, `✏️ *تعديل: ${escMd(db.getTaskText(task, 'name', 'ar'))}*\n\nاختر ما تريد تعديله:`, {
            parse_mode: 'Markdown', reply_markup: taskEditKeyboard(),
          });
        }
        if (text === BTN.TOGGLE_TASK) return handleToggleTask(bot, msg.chat.id, adminId, task);
        if (text === BTN.FIELDS) {
          setSession(adminId, 'fields_list', 'main', { taskId: task.id });
          return sendFieldsList(bot, msg.chat.id, task);
        }
        if (text === BTN.FEATURES) {
          // تفويض لـ features handler عبر callback
          return bot.sendMessage(msg.chat.id, `🎯 لإدارة الميزات استخدم:\n/features_${task.id.substring(0,8)}`);
        }
        if (text === BTN.SUBMISSIONS) {
          return bot.sendMessage(msg.chat.id, '📥 اذهب لقسم التسليمات من القائمة الرئيسية واختر المهمة.');
        }
        if (text === BTN.PREVIEW) {
          const { _sendTaskDetailPreview } = require('./user');
          await _sendTaskDetailPreview(bot, msg.chat.id, task, adminId, 'ar');
          return;
        }
        if (text === BTN.DELETE_TASK) {
          setSession(adminId, 'task_detail', 'confirm_delete', { taskId: task.id });
          return bot.sendMessage(msg.chat.id,
            `⚠️ هل تريد حذف "*${escMd(db.getTaskText(task, 'name', 'ar'))}*" نهائياً؟\nسيتم حذف جميع التسليمات.`,
            { parse_mode: 'Markdown', reply_markup: yesNoKeyboard() }
          );
        }
        if (step === 'confirm_delete') {
          if (text === BTN.CONFIRM_DELETE) {
            const name = db.getTaskText(task, 'name', 'ar');
            db.deleteTask(data.taskId);
            clearSession(adminId);
            return bot.sendMessage(msg.chat.id, `🗑 تم حذف "${escMd(name)}".`, {
              parse_mode: 'Markdown', reply_markup: mainAdminKeyboard(),
            });
          }
          // إلغاء الحذف
          setSession(adminId, 'task_detail', 'main', { taskId: task.id });
          return sendTaskDetail(bot, msg.chat.id, task);
        }
        return;
      }

      // ─ Task Edit: اختيار خاصية للتعديل ─
      if (flow === 'task_edit' && step === 'main') {
        const task = db.getTask(data.taskId);
        if (!task) { clearSession(adminId); return sendTaskList(bot, msg.chat.id, adminId); }

        const propMap = {
          [BTN.EDIT_NAME_AR]:  { prop: 'name',      lang: 'ar' },
          [BTN.EDIT_NAME_EN]:  { prop: 'name',      lang: 'en' },
          [BTN.EDIT_DESC_AR]:  { prop: 'shortDesc', lang: 'ar' },
          [BTN.EDIT_DESC_EN]:  { prop: 'shortDesc', lang: 'en' },
          [BTN.EDIT_FULL_AR]:  { prop: 'fullDesc',  lang: 'ar' },
          [BTN.EDIT_FULL_EN]:  { prop: 'fullDesc',  lang: 'en' },
          [BTN.EDIT_REWARD]:   { prop: 'reward',    lang: null },
          [BTN.EDIT_MAX]:      { prop: 'maxPerUser', lang: null },
          [BTN.EDIT_ORDER]:    { prop: 'order',     lang: null },
          [BTN.EDIT_VIDEO]:    { prop: 'videoFileId', lang: null },
        };
        const chosen = propMap[text];
        if (chosen) {
          setSession(adminId, 'task_edit', 'waiting_value', { ...data, ...chosen });
          const cur = chosen.lang ? db.getTaskText(task, chosen.prop, chosen.lang) : task[chosen.prop];
          const isVideo = chosen.prop === 'videoFileId';
          return bot.sendMessage(msg.chat.id,
            `✏️ *${PROP_LABELS[chosen.prop]}*\n\n📌 الحالي: \`${cur ?? '—'}\`\n\nأرسل القيمة الجديدة:`,
            { parse_mode: 'Markdown', reply_markup: isVideo ? skipCancelKeyboard() : cancelKeyboard() }
          );
        }
        return;
      }

      // ─ Task Edit: انتظار القيمة الجديدة ─
      if (flow === 'task_edit' && step === 'waiting_value') {
        return handleEditTaskPropMsg(bot, msg, adminId, session);
      }

      // ─ Create Task flow ─
      if (flow === 'create_task') {
        return handleCreateTask(bot, msg, adminId, session);
      }

      // ─ Fields List: اختيار حقل ─
      if (flow === 'fields_list') {
        const task = db.getTask(data.taskId);
        if (!task) { clearSession(adminId); return sendTaskList(bot, msg.chat.id, adminId); }

        if (text === BTN.ADD_FIELD) {
          setSession(adminId, 'add_field', 'label_ar', { taskId: task.id });
          return bot.sendMessage(msg.chat.id, '➕ *إضافة حقل*\n\n✏️ أدخل اسم الحقل بالعربي:', {
            parse_mode: 'Markdown', reply_markup: cancelKeyboard(),
          });
        }

        const sorted = [...task.fields].sort((a, b) => a.order - b.order);
        const field  = sorted.find(f => {
          const label = getFieldLabel(f, 'ar');
          return text.includes(label) && text.includes(f.type);
        });
        if (field) {
          setSession(adminId, 'field_detail', 'main', { taskId: task.id, fieldId: field.id });
          return sendFieldDetail(bot, msg.chat.id, field, task);
        }
        return;
      }

      // ─ Field Detail: أزرار الإجراءات ─
      if (flow === 'field_detail') {
        return handleFieldDetailAction(bot, msg, adminId, session);
      }

      // ─ Add Field flow ─
      if (flow === 'add_field') {
        return handleAddField(bot, msg, adminId, session);
      }

      // ─ Edit Field Prop flow ─
      if (flow === 'edit_field_prop') {
        return handleEditFieldPropMsg(bot, msg, adminId, session);
      }

      // ─ Field Type selection ─
      if (flow === 'select_field_type') {
        if (db.FIELD_TYPES.includes(text)) {
          const { taskId, fieldId, context } = data;
          if (context === 'add_field') {
            setSession(adminId, 'add_field', 'required', { ...data, type: text });
            return bot.sendMessage(msg.chat.id, `✅ النوع: *${text}*\n\nهل الحقل إجباري؟`, {
              parse_mode: 'Markdown',
              reply_markup: { keyboard: [[{ text: '🔴 إجباري' }, { text: '🟡 اختياري' }]], resize_keyboard: true },
            });
          }
          if (context === 'edit_type') {
            db.updateField(taskId, fieldId, { type: text });
            const task  = db.getTask(taskId);
            const field = task?.fields.find(f => f.id === fieldId);
            setSession(adminId, 'field_detail', 'main', { taskId, fieldId });
            return bot.sendMessage(msg.chat.id, `✅ تم تغيير النوع إلى *${text}*`, {
              parse_mode: 'Markdown',
              reply_markup: fieldDetailKeyboard(field),
            });
          }
        }
        return;
      }
    }

    // ── إذا لم يكن هناك session ولم يُعالَج الزرار → ignore ──
  });

  // لا يوجد callback_query handler هنا — كل شيء Reply Keyboard
}

// ─────────────────────────────────────────────
//  Action handlers
// ─────────────────────────────────────────────

async function handleToggleTask(bot, chatId, adminId, task) {
  if (!task.isOpen && (!task.fields || task.fields.length === 0)) {
    return bot.sendMessage(chatId,
      '⚠️ لا يمكن فتح المهمة قبل إضافة حقل واحد على الأقل.\nاذهب إلى 📝 الحقول أولاً.'
    );
  }
  const wasOpen = task.isOpen;
  db.updateTask(task.id, { isOpen: !task.isOpen });
  const nowOpen = !wasOpen;
  bot.sendMessage(chatId, `✅ المهمة الآن ${nowOpen ? '🟢 مفتوحة' : '🔴 مغلقة'}`);

  if (nowOpen) {
    bot.sendMessage(chatId, '📢 هل تريد إرسال إشعار للمستخدمين؟', {
      reply_markup: {
        keyboard: [[{ text: '✅ نعم، أرسل' }, { text: '❌ لا' }]],
        resize_keyboard: true, one_time_keyboard: true,
      },
    });
    setSession(adminId, 'task_detail', 'broadcast_confirm', { taskId: task.id });
    return;
  }
  const updatedTask = db.getTask(task.id);
  setSession(adminId, 'task_detail', 'main', { taskId: task.id });
  sendTaskDetail(bot, chatId, updatedTask);
}

async function handleFieldDetailAction(bot, msg, adminId, session) {
  const { data, step } = session;
  const chatId  = msg.chat.id;
  const text    = msg.text || '';
  const task    = db.getTask(data.taskId);
  if (!task) { clearSession(adminId); return sendTaskList(bot, chatId, adminId); }
  const field   = task.fields.find(f => f.id === data.fieldId);
  if (!field) {
    setSession(adminId, 'fields_list', 'main', { taskId: data.taskId });
    return sendFieldsList(bot, chatId, task);
  }

  // انتظار قيمة نوع بديل
  if (step === 'waiting_alt_type') {
    if (db.FIELD_TYPES.includes(text) && text !== field.type) {
      db.updateField(data.taskId, data.fieldId, { altType: text });
      bot.sendMessage(chatId, `✅ النوع البديل: \`${text}\``, { parse_mode: 'Markdown' });
    } else {
      bot.sendMessage(chatId, '⚠️ نوع غير صالح أو مطابق للنوع الحالي.');
    }
    const updField = db.getTask(data.taskId)?.fields.find(f => f.id === data.fieldId);
    setSession(adminId, 'field_detail', 'main', data);
    return sendFieldDetail(bot, chatId, updField, task);
  }

  if (text === BTN.EDIT_LABEL_AR) {
    setSession(adminId, 'edit_field_prop', 'waiting', { ...data, prop: 'label_ar' });
    return bot.sendMessage(chatId, `✏️ اسم الحقل (عربي)\n📌 الحالي: \`${getFieldLabel(field, 'ar')}\`\n\nأرسل الاسم الجديد:`, {
      parse_mode: 'Markdown', reply_markup: cancelKeyboard(),
    });
  }
  if (text === BTN.EDIT_LABEL_EN) {
    setSession(adminId, 'edit_field_prop', 'waiting', { ...data, prop: 'label_en' });
    return bot.sendMessage(chatId, `✏️ Field Name (English)\n📌 Current: \`${getFieldLabel(field, 'en')}\`\n\nSend new name:`, {
      parse_mode: 'Markdown', reply_markup: cancelKeyboard(),
    });
  }
  if (text === BTN.EDIT_TYPE) {
    setSession(adminId, 'select_field_type', 'waiting', { ...data, context: 'edit_type' });
    return bot.sendMessage(chatId, `🔠 النوع الحالي: \`${field.type}\`\n\nاختر النوع الجديد:`, {
      parse_mode: 'Markdown', reply_markup: fieldTypesKeyboard(),
    });
  }
  if (text === BTN.TOGGLE_REQ) {
    db.updateField(data.taskId, data.fieldId, { required: !field.required });
    bot.sendMessage(chatId, `✅ الحقل أصبح ${!field.required ? '🔴 إجباري' : '🟡 اختياري'}`);
    const updField = db.getTask(data.taskId)?.fields.find(f => f.id === data.fieldId);
    setSession(adminId, 'field_detail', 'main', data);
    return sendFieldDetail(bot, chatId, updField, task);
  }
  if (text === BTN.MOVE_UP || text === BTN.MOVE_DOWN) {
    moveField(bot, chatId, adminId, data.taskId, data.fieldId, text === BTN.MOVE_UP ? -1 : 1);
    return;
  }
  if (text === BTN.ALT_TYPE || text.startsWith('🔀 إزالة البديل')) {
    if (text.startsWith('🔀 إزالة البديل')) {
      db.updateField(data.taskId, data.fieldId, { altType: null });
      bot.sendMessage(chatId, '✅ تم حذف النوع البديل.');
      const updField = db.getTask(data.taskId)?.fields.find(f => f.id === data.fieldId);
      setSession(adminId, 'field_detail', 'main', data);
      return sendFieldDetail(bot, chatId, updField, task);
    }
    setSession(adminId, 'field_detail', 'waiting_alt_type', data);
    return bot.sendMessage(chatId, `🔀 أرسل النوع البديل المقبول:\n(غير ${field.type})`, {
      reply_markup: fieldTypesKeyboard(),
    });
  }
  if (text === BTN.DELETE_FIELD) {
    setSession(adminId, 'field_detail', 'confirm_delete', data);
    return bot.sendMessage(chatId, `⚠️ هل تريد حذف الحقل "*${escMd(getFieldLabel(field, 'ar'))}*"؟`, {
      parse_mode: 'Markdown', reply_markup: yesNoKeyboard(),
    });
  }
  if (step === 'confirm_delete') {
    if (text === BTN.CONFIRM_DELETE) {
      db.deleteField(data.taskId, data.fieldId);
      const updTask = db.getTask(data.taskId);
      setSession(adminId, 'fields_list', 'main', { taskId: data.taskId });
      bot.sendMessage(chatId, '🗑 تم حذف الحقل.');
      if (updTask) return sendFieldsList(bot, chatId, updTask);
    }
    setSession(adminId, 'field_detail', 'main', data);
    return sendFieldDetail(bot, chatId, field, task);
  }
}

function moveField(bot, chatId, adminId, taskId, fieldId, direction) {
  const task   = db.getTask(taskId);
  if (!task) return;
  const fields = [...task.fields].sort((a, b) => a.order - b.order);
  const idx    = fields.findIndex(f => f.id === fieldId);
  if (idx === -1) return;
  const newIdx = idx + direction;
  if (newIdx < 0 || newIdx >= fields.length) {
    return bot.sendMessage(chatId, '⚠️ لا يمكن تحريك الحقل أكثر.');
  }
  const orderedIds = fields.map(f => f.id);
  [orderedIds[idx], orderedIds[newIdx]] = [orderedIds[newIdx], orderedIds[idx]];
  db.reorderFields(taskId, orderedIds);
  const updTask  = db.getTask(taskId);
  const updField = updTask?.fields.find(f => f.id === fieldId);
  setSession(adminId, 'field_detail', 'main', { taskId, fieldId });
  return sendFieldDetail(bot, chatId, updField, updTask);
}

// ─────────────────────────────────────────────
//  Create Task Flow
// ─────────────────────────────────────────────
const CREATE_PROMPTS = {
  name_ar:      '📝 أدخل *اسم المهمة* بالعربي:',
  name_en:      '📝 Enter *task name* in English:',
  shortDesc_ar: '📄 أدخل *الوصف المختصر* بالعربي:',
  shortDesc_en: '📄 Enter *short description* in English:',
  fullDesc_ar:  '📖 أدخل *الشرح الكامل* بالعربي:',
  fullDesc_en:  '📖 Enter *full description* in English:',
  video:        '🎥 أرسل *فيديو الشرح* (أو اضغط "تخطي"):',
  reward:       '💰 أدخل *قيمة المكافأة* (رقم):',
  maxPerUser:   '👤 أدخل *الحد الأقصى/مستخدم* (0 = غير محدود):',
};

function startCreateTask(bot, chatId, adminId) {
  setSession(adminId, 'create_task', 'name_ar', {});
  bot.sendMessage(chatId, '➕ *إنشاء مهمة جديدة*\n\n' + CREATE_PROMPTS.name_ar, {
    parse_mode: 'Markdown', reply_markup: cancelKeyboard(),
  });
}

async function handleCreateTask(bot, msg, adminId, session) {
  const chatId = msg.chat.id;
  const step   = session.step;
  const data   = session.data;
  const TEXT_STEPS = {
    name_ar:      { field: 'name',      lang: 'ar', next: 'name_en'      },
    name_en:      { field: 'name',      lang: 'en', next: 'shortDesc_ar' },
    shortDesc_ar: { field: 'shortDesc', lang: 'ar', next: 'shortDesc_en' },
    shortDesc_en: { field: 'shortDesc', lang: 'en', next: 'fullDesc_ar'  },
    fullDesc_ar:  { field: 'fullDesc',  lang: 'ar', next: 'fullDesc_en'  },
    fullDesc_en:  { field: 'fullDesc',  lang: 'en', next: 'video'        },
  };
  if (TEXT_STEPS[step]) {
    const { field, lang, next } = TEXT_STEPS[step];
    const value = msg.text?.trim();
    if (!value) return bot.sendMessage(chatId, '⚠️ لا يمكن أن يكون فارغاً.');
    if (!data[field]) data[field] = {};
    data[field][lang] = value;
    setSession(adminId, 'create_task', next, data);
    const isVideo = next === 'video';
    return bot.sendMessage(chatId, CREATE_PROMPTS[next], {
      parse_mode: 'Markdown',
      reply_markup: isVideo ? skipCancelKeyboard() : cancelKeyboard(),
    });
  }
  if (step === 'video') {
    if (msg.video) { data.videoFileId = msg.video.file_id; }
    else if (msg.text && /^(تخطي|skip)$/i.test(msg.text.trim())) { data.videoFileId = null; }
    else return bot.sendMessage(chatId, '⚠️ أرسل فيديو أو اضغط "تخطي".', { reply_markup: skipCancelKeyboard() });
    setSession(adminId, 'create_task', 'reward', data);
    return bot.sendMessage(chatId, CREATE_PROMPTS.reward, { parse_mode: 'Markdown', reply_markup: cancelKeyboard() });
  }
  if (step === 'reward') {
    const val = parseFloat(msg.text);
    if (isNaN(val) || val < 0) return bot.sendMessage(chatId, '⚠️ أدخل رقماً صحيحاً.');
    data.reward = val;
    setSession(adminId, 'create_task', 'maxPerUser', data);
    return bot.sendMessage(chatId, CREATE_PROMPTS.maxPerUser, { parse_mode: 'Markdown', reply_markup: cancelKeyboard() });
  }
  if (step === 'maxPerUser') {
    const val = parseInt(msg.text);
    data.maxPerUser = (!isNaN(val) && val > 0) ? val : null;
    setSession(adminId, 'create_task', 'status', data);
    return bot.sendMessage(chatId, '🔘 هل المهمة مفتوحة الآن؟', {
      reply_markup: {
        keyboard: [[{ text: '🟢 مفتوحة' }, { text: '🔴 مغلقة' }]],
        resize_keyboard: true, one_time_keyboard: true,
      },
    });
  }
  if (step === 'status') {
    const isOpen = msg.text === '🟢 مفتوحة';
    if (msg.text !== '🟢 مفتوحة' && msg.text !== '🔴 مغلقة') return;
    data.isOpen = isOpen;
    const task = db.createTask(data);
    clearSession(adminId);
    bot.sendMessage(chatId,
      `✅ *تم إنشاء المهمة!*\n\n📌 ${escMd(db.getTaskText(task, 'name', 'ar'))}\n\nأضف الحقول الآن:`,
      { parse_mode: 'Markdown', reply_markup: mainAdminKeyboard() }
    );
    setSession(adminId, 'fields_list', 'main', { taskId: task.id });
    return sendFieldsList(bot, chatId, task);
  }
}

// ─────────────────────────────────────────────
//  Edit Task Property
// ─────────────────────────────────────────────
async function handleEditTaskPropMsg(bot, msg, adminId, session) {
  const chatId = msg.chat.id;
  const { taskId, prop, lang } = session.data;

  if (prop === 'videoFileId') {
    if (msg.video) { db.updateTask(taskId, { videoFileId: msg.video.file_id }); }
    else if (msg.text?.trim().toLowerCase() === 'حذف') { db.updateTask(taskId, { videoFileId: null }); }
    else return bot.sendMessage(chatId, '⚠️ أرسل فيديو أو اكتب "حذف".', { reply_markup: skipCancelKeyboard() });
  } else if (prop === 'reward' || prop === 'order') {
    const val = parseFloat(msg.text);
    if (isNaN(val)) return bot.sendMessage(chatId, '⚠️ أدخل رقماً.');
    db.updateTask(taskId, { [prop]: val });
  } else if (prop === 'maxPerUser') {
    const v = parseInt(msg.text);
    db.updateTask(taskId, { maxPerUser: (!isNaN(v) && v > 0) ? v : null });
  } else if (lang && I18N_FIELDS.includes(prop)) {
    const value = msg.text?.trim();
    if (!value) return bot.sendMessage(chatId, '⚠️ لا يمكن أن يكون فارغاً.');
    db.setTaskText(taskId, prop, lang, value);
  }

  bot.sendMessage(chatId, `✅ تم التحديث.`);
  const task = db.getTask(taskId);
  setSession(adminId, 'task_edit', 'main', { taskId });
  bot.sendMessage(chatId, `✏️ *تعديل: ${escMd(db.getTaskText(task, 'name', 'ar'))}*\n\nاختر ما تريد تعديله:`, {
    parse_mode: 'Markdown', reply_markup: taskEditKeyboard(),
  });
}

// ─────────────────────────────────────────────
//  Add Field Flow
// ─────────────────────────────────────────────
async function handleAddField(bot, msg, adminId, session) {
  const chatId = msg.chat.id;
  const { step, data } = session;

  if (step === 'label_ar') {
    if (!msg.text?.trim()) return bot.sendMessage(chatId, '⚠️ الاسم لا يمكن أن يكون فارغاً.');
    data.label = { ar: msg.text.trim(), en: '' };
    setSession(adminId, 'add_field', 'label_en', data);
    return bot.sendMessage(chatId, '✏️ Enter the *field name in English*:', {
      parse_mode: 'Markdown', reply_markup: cancelKeyboard(),
    });
  }
  if (step === 'label_en') {
    if (!msg.text?.trim()) return bot.sendMessage(chatId, '⚠️ Cannot be empty.');
    data.label.en = msg.text.trim();
    setSession(adminId, 'select_field_type', 'waiting', { ...data, context: 'add_field' });
    return bot.sendMessage(chatId, '🔠 اختر *نوع الحقل:*', {
      parse_mode: 'Markdown', reply_markup: fieldTypesKeyboard(),
    });
  }
  if (step === 'required') {
    const required = msg.text === '🔴 إجباري';
    if (msg.text !== '🔴 إجباري' && msg.text !== '🟡 اختياري') return;
    const field = db.addField(data.taskId, { label: data.label, type: data.type, required });
    clearSession(adminId);
    const fieldName = getFieldLabel(field, 'ar');
    bot.sendMessage(chatId, `✅ تم إضافة الحقل "*${escMd(fieldName)}*".`, { parse_mode: 'Markdown' });
    const task = db.getTask(data.taskId);
    setSession(adminId, 'fields_list', 'main', { taskId: data.taskId });
    if (task) return sendFieldsList(bot, chatId, task);
  }
}

// ─────────────────────────────────────────────
//  Edit Field Property
// ─────────────────────────────────────────────
async function handleEditFieldPropMsg(bot, msg, adminId, session) {
  const chatId = msg.chat.id;
  const { taskId, fieldId, prop } = session.data;
  const value = msg.text?.trim();
  if (!value) return bot.sendMessage(chatId, '⚠️ لا يمكن أن يكون فارغاً.');

  if (prop === 'label_ar' || prop === 'label_en') {
    const task  = db.getTask(taskId);
    const field = task?.fields.find(f => f.id === fieldId);
    const lang  = prop === 'label_ar' ? 'ar' : 'en';
    const cur   = typeof field?.label === 'object' ? { ...field.label } : { ar: field?.label || '', en: field?.label || '' };
    cur[lang]   = value;
    db.updateField(taskId, fieldId, { label: cur });
  } else {
    db.updateField(taskId, fieldId, { [prop]: value });
  }

  bot.sendMessage(chatId, '✅ تم التحديث.');
  const task    = db.getTask(taskId);
  const updField = task?.fields.find(f => f.id === fieldId);
  setSession(adminId, 'field_detail', 'main', { taskId, fieldId });
  if (updField && task) return sendFieldDetail(bot, chatId, updField, task);
}

// ─────────────────────────────────────────────
//  handleCallbackExtras — متوافق مع index.js
// ─────────────────────────────────────────────
function handleCallbackExtras(bot, query) {
  return false; // كل شيء الآن Reply Keyboard
}

module.exports = {
  register,
  handleCallbackExtras,
  adminMainKeyboard: () => ({ reply_markup: mainAdminKeyboard() }),
  getSession,
  clearSession,
  ALL_BTN_TEXTS,
};
