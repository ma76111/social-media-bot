'use strict';

/**
 * adminTasks.js - لوحة الأدمن: إدارة المهام والحقول
 * إنشاء / تعديل / حذف المهام وحقولها من داخل البوت
 */

const db = require('../db');
// نستخدم listUsers وgetWithdrawals من db مباشرةً
const { escMd } = require('../utils/escMd');

// ─── helper: جلب اسم الحقل بشكل آمن (string أو i18n object) ───
function getFieldLabel(field, lang = 'ar') {
  if (!field || !field.label) return '';
  if (typeof field.label === 'string') return field.label;
  return field.label[lang] || field.label['ar'] || Object.values(field.label).find(v => v) || '';
}

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
        [{ text: '📋 إدارة المهام' }, { text: '➕ مهمة جديدة'  }],
        [{ text: '📊 إحصائيات'    }, { text: '📤 طلبات السحب' }],
        [{ text: '👥 المستخدمون'  }, { text: '💱 سعر الصرف'   }],
      ],
      resize_keyboard: true,
    },
  };
}

function taskListAdminKeyboard(tasks) {
  const rows = tasks.map(t => [{
    text: `${t.isOpen ? '🟢' : '🔴'} ${db.getTaskText(t, 'name', 'ar')}`,
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
        { text: '📥 التسليمات', callback_data: `adm_subs:${sh(task.id)}`    },
        { text: '👁 عرض المهمة', callback_data: `adm_preview:${sh(task.id)}` },
      ],
      [
        { text: '🔙 رجوع',      callback_data: 'adm_tasks_list'              },
      ],
    ],
  };
}

function editTaskKeyboard(taskId) {
  const rows = [];

  // الحقول النصية — لكل حقل زرار لكل لغة
  for (const field of I18N_FIELDS) {
    const fieldLabel = { name: 'الاسم', shortDesc: 'الوصف المختصر', fullDesc: 'الشرح الكامل' }[field];
    const langRow = SUPPORTED_LANGS.map(lang => ({
      text: `✏️ ${fieldLabel} (${LANG_LABELS[lang]})`,
      callback_data: `adm_edit_field_prop:${sh(taskId)}:${field}:${lang}`,
    }));
    rows.push(langRow);
  }

  // الحقول الأخرى
  const otherFields = [
    ['المكافأة','reward'], ['الحد الأقصى/مستخدم','maxPerUser'],
    ['الترتيب','order'], ['فيديو الشرح','videoFileId'],
  ];
  for (const [label, key] of otherFields) {
    rows.push([{ text: `✏️ ${label}`, callback_data: `adm_edit_field_prop:${sh(taskId)}:${key}` }]);
  }

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
    text: `${f.required ? '🔴' : '🟡'} ${typeof f.label === 'object' ? (f.label.ar || '—') : (f.label || '—')} (${f.type})`,
    callback_data: `adm_fd:${sh(task.id)}:${sh(f.id)}`,
  }]);
  rows.push([
    { text: '➕ إضافة حقل', callback_data: `adm_add_field:${sh(task.id)}` },
    { text: '🔙 رجوع',      callback_data: `adm_task:${sh(task.id)}`      },
  ]);
  return { inline_keyboard: rows };
}

function fieldDetailKeyboard(taskId, fieldId, field = null) {
  const t = sh(taskId), f = sh(fieldId);
  // نستخدم الـ field المُمرَّر لو موجود، وإلا نقرأ من disk
  if (!field) {
    const task = db.getTask(taskId);
    field = task?.fields.find(fi => fi.id === fieldId);
  }
  const mergeBtn = field?.altType
    ? { text: `🔀 إلغاء النوع البديل (${field.altType})`, callback_data: `adm_alt_rm:${t}:${f}` }
    : { text: '🔀 إضافة نوع بديل', callback_data: `adm_alt:${t}:${f}` };

  return {
    inline_keyboard: [
      [
        { text: '✏️ الاسم 🇦🇪', callback_data: `adm_ef:${t}:${f}:label_ar` },
        { text: '✏️ Name 🇬🇧',   callback_data: `adm_ef:${t}:${f}:label_en` },
      ],
      [
        { text: '🔁 تغيير النوع', callback_data: `adm_ef:${t}:${f}:type`  },
        { text: '🔄 تبديل الإلزامية', callback_data: `adm_fr:${t}:${f}` },
      ],
      [
        { text: '⬆️ رفع الترتيب', callback_data: `adm_fu:${t}:${f}` },
        { text: '⬇️ خفض الترتيب', callback_data: `adm_fd2:${t}:${f}` },
      ],
      [
        mergeBtn,
        { text: '🗑 حذف', callback_data: `adm_delf:${t}:${f}` },
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

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────

function taskSummaryText(task) {
  const status = task.isOpen ? '🟢 مفتوحة' : '🔴 مغلقة';

  // عرض النصوص i18n بشكل واضح
  function showI18n(val) {
    if (!val) return '—';
    if (typeof val === 'string') return escMd(val);
    return SUPPORTED_LANGS
      .filter(l => val[l])
      .map(l => `${LANG_LABELS[l]}: ${escMd(val[l])}`)
      .join('\n    ') || '—';
  }

  return (
    `📌 *${escMd(db.getTaskText(task, 'name', 'ar'))}*\n` +
    `📄 الوصف:\n    ${showI18n(task.shortDesc)}\n\n` +
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

// اللغات المدعومة — أي لغة تُضاف هنا تظهر تلقائياً في الـ flow
const SUPPORTED_LANGS = ['ar', 'en'];
const LANG_LABELS = { ar: '🇦🇪 العربية', en: '🇬🇧 English' };

// الحقول النصية التي تدعم i18n
const I18N_FIELDS = ['name', 'shortDesc', 'fullDesc'];

const PROP_LABELS = {
  name:       'اسم المهمة',
  shortDesc:  'الوصف المختصر',
  fullDesc:   'الشرح الكامل',
  reward:     'قيمة المكافأة',
  maxPerUser: 'الحد الأقصى للتسليم لكل مستخدم (0 = غير محدود)',
  order:      'رقم الترتيب',
  videoFileId:'أرسل الفيديو مباشرة (أو أرسل "حذف" لإزالته)',
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

    // إلغاء صريح — يمسح session المهام ويوقف التنفيذ
    if (msg.text === '❌ إلغاء') {
      clearSession(adminId);
      return;
    }

    // تجاهل أزرار القائمة الرئيسية للأدمن
    const menuTexts = [
      '📋 إدارة المهام', '➕ مهمة جديدة', '📊 إحصائيات',
      '📤 طلبات السحب',  '👥 المستخدمون',  '💱 سعر الصرف',
      '🔧 لوحة الأدمن',  '🏠 القائمة الرئيسية', '⚙️ الإعدادات',
      '⚙️ إعدادات النظام', '📨 إرسال رسالة', '🔙 رجوع',
      '❌ إلغاء',  // زرار الإلغاء — تعالجه adminSettings
    ];
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
      const taskId = expandTaskId(data.split(':')[1]);
      sendTaskDetail(bot, chatId, taskId);
      return;
    }

    if (data.startsWith('adm_preview:')) {
      await bot.answerCallbackQuery(query.id);
      const taskId = expandTaskId(data.split(':')[1]);
      const task   = db.getTask(taskId);
      if (!task) return bot.sendMessage(chatId, '⚠️ المهمة غير موجودة.');
      // نسأل عن اللغة
      bot.sendMessage(chatId, '🌐 اختر لغة المعاينة:', {
        reply_markup: {
          inline_keyboard: [[
            { text: '🇦🇪 العربية', callback_data: `adm_preview_lang:${sh(taskId)}:ar` },
            { text: '🇬🇧 English', callback_data: `adm_preview_lang:${sh(taskId)}:en` },
          ]],
        },
      });
      return;
    }

    if (data.startsWith('adm_preview_lang:')) {
      await bot.answerCallbackQuery(query.id);
      const parts  = data.split(':');
      const taskId = expandTaskId(parts[1]);
      const lang   = parts[2];
      const task   = db.getTask(taskId);
      if (!task) return bot.sendMessage(chatId, '⚠️ المهمة غير موجودة.');
      const { _sendTaskDetailPreview } = require('./user');
      await _sendTaskDetailPreview(bot, chatId, task, adminId, lang);
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
      if (!task) return bot.sendMessage(chatId, '⚠️ المهمة غير موجودة.');
      bot.sendMessage(chatId, `✏️ *تعديل:* ${escMd(db.getTaskText(task, 'name', 'ar'))}\n\nاختر ما تريد تعديله:`, {
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
      const lang   = parts[3] || null;   // null = حقل غير i18n
      startEditTaskProp(bot, chatId, adminId, taskId, prop, lang);
      return;
    }

    if (data.startsWith('adm_del_task:')) {
      await bot.answerCallbackQuery(query.id);
      const taskId = expandTaskId(data.split(':')[1]);
      const task   = db.getTask(taskId);
      if (!task) return bot.sendMessage(chatId, '⚠️ المهمة غير موجودة.');
      bot.sendMessage(chatId,
        `⚠️ هل تريد حذف مهمة "*${escMd(db.getTaskText(task, 'name', 'ar'))}*" نهائياً؟\nسيتم حذف جميع التسليمات المرتبطة بها.`,
        { parse_mode: 'Markdown', reply_markup: confirmDeleteKeyboard(taskId) }
      );
      return;
    }

    if (data.startsWith('adm_confirm_del:')) {
      await bot.answerCallbackQuery(query.id);
      const taskId = expandTaskId(data.split(':')[1]);
      const task   = db.getTask(taskId);
      db.deleteTask(taskId);
      bot.sendMessage(chatId, `🗑 تم حذف المهمة "*${escMd(task ? db.getTaskText(task, 'name', 'ar') : '')}*" بنجاح.`, {
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
      if (!field) return bot.sendMessage(chatId, '⚠️ الحقل غير موجود.');
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

    // adm_alt = إضافة نوع بديل للحقل
    if (data.startsWith('adm_alt:')) {
      await bot.answerCallbackQuery(query.id);
      const [, ts, fs] = data.split(':');
      const taskId  = expandTaskId(ts);
      const task    = db.getTask(taskId);
      if (!task) return bot.sendMessage(chatId, '⚠️ المهمة غير موجودة.');
      const fieldId = expandFieldId(task, fs);
      const field   = task.fields.find(f => f.id === fieldId);
      if (!field) return bot.sendMessage(chatId, '⚠️ الحقل غير موجود.');

      // نعرض أنواع الحقول كخيارات (ما عدا النوع الحالي)
      const otherTypes = db.FIELD_TYPES.filter(tp => tp !== field.type);
      const rows = otherTypes.reduce((acc, tp, i) => {
        if (i % 3 === 0) acc.push([]);
        acc[acc.length - 1].push({
          text: tp,
          callback_data: `adm_alt_set:${sh(taskId)}:${sh(fieldId)}:${tp}`,
        });
        return acc;
      }, []);
      rows.push([{ text: '❌ إلغاء', callback_data: `adm_fd:${sh(taskId)}:${sh(fieldId)}` }]);

      bot.sendMessage(chatId,
        `🔀 *نوع بديل للحقل "${escMd(getFieldLabel(field))}"*\n\n` +
        `النوع الحالي: \`${field.type}\`\n\n` +
        `اختر النوع البديل المسموح به أيضاً:`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows } }
      );
      return;
    }

    // adm_alt_set = تعيين النوع البديل
    if (data.startsWith('adm_alt_set:')) {
      await bot.answerCallbackQuery(query.id);
      const parts   = data.split(':');
      const taskId  = expandTaskId(parts[1]);
      const task    = db.getTask(taskId);
      if (!task) return bot.sendMessage(chatId, '⚠️ المهمة غير موجودة.');
      const fieldId = expandFieldId(task, parts[2]);
      const altType = parts[3];
      const field   = task.fields.find(f => f.id === fieldId);
      if (!field) return bot.sendMessage(chatId, '⚠️ الحقل غير موجود.');

      db.updateField(taskId, fieldId, { altType });
      bot.sendMessage(chatId,
        `✅ *تم تعيين النوع البديل!*\n\n` +
        `الحقل "*${escMd(getFieldLabel(field))}*" يقبل الآن:\n` +
        `• \`${field.type}\`\n` +
        `• \`${altType}\``,
        { parse_mode: 'Markdown' }
      );
      sendFieldDetail(bot, chatId, taskId, fieldId);
      return;
    }

    // adm_alt_rm = حذف النوع البديل
    if (data.startsWith('adm_alt_rm:')) {
      await bot.answerCallbackQuery(query.id);
      const [, ts, fs] = data.split(':');
      const taskId  = expandTaskId(ts);
      const task    = db.getTask(taskId);
      if (!task) return bot.sendMessage(chatId, '⚠️ المهمة غير موجودة.');
      const fieldId = expandFieldId(task, fs);
      db.updateField(taskId, fieldId, { altType: null });
      bot.sendMessage(chatId, '✅ تم حذف النوع البديل.');
      sendFieldDetail(bot, chatId, taskId, fieldId);
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
  if (!task) return bot.sendMessage(chatId, '⚠️ المهمة غير موجودة.');

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
    text += `${icon} *${escMd(db.getTaskText(tk, 'name', 'ar'))}*: ${tk.stats.total} تسليم`;
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
    `📝 *حقول المهمة "${escMd(db.getTaskText(task, 'name', 'ar'))}"* (${count} حقل)\n\n🔴 إجباري | 🟡 اختياري`,
    { parse_mode: 'Markdown', reply_markup: fieldsListKeyboard(task) }
  );
}

function sendFieldDetail(bot, chatId, taskId, fieldId) {
  const task  = db.getTask(taskId);
  const field = task?.fields.find(f => f.id === fieldId);
  if (!field) return bot.sendMessage(chatId, '⚠️ الحقل غير موجود.');

  const altInfo = field.altType ? `🔀 نوع بديل: \`${field.altType}\`` : '—';
  const labelAr = typeof field.label === 'object' ? (field.label.ar || '—') : (field.label || '—');
  const labelEn = typeof field.label === 'object' ? (field.label.en || '—') : (field.label || '—');

  const text =
    `📝 *تفاصيل الحقل*\n\n` +
    `• الاسم 🇦🇪: *${escMd(labelAr)}*\n` +
    `• الاسم 🇬🇧: *${escMd(labelEn)}*\n` +
    `• النوع: \`${field.type}\`\n` +
    `• إجباري: ${field.required ? '✅ نعم' : '❌ لا'}\n` +
    `• الترتيب: ${field.order}\n` +
    `• النوع البديل: ${altInfo}`;

  bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: fieldDetailKeyboard(taskId, fieldId, field), // نمرر field لتجنب قراءة disk مرة ثانية
  });
}

function moveField(bot, chatId, taskId, fieldId, direction) {
  const task   = db.getTask(taskId);
  if (!task) return bot.sendMessage(chatId, '⚠️ المهمة غير موجودة.');

  // نرتب الحقول حسب order الحالي
  const fields = [...task.fields].sort((a, b) => a.order - b.order);
  const idx    = fields.findIndex(f => f.id === fieldId);

  if (idx === -1) return bot.sendMessage(chatId, '⚠️ الحقل غير موجود.');

  const newIdx = idx + direction;
  if (newIdx < 0 || newIdx >= fields.length) {
    return bot.sendMessage(chatId, '⚠️ لا يمكن تحريك الحقل أكثر من ذلك.');
  }

  // نبني الترتيب الجديد بتبادل الموضعين في المصفوفة مباشرةً
  const orderedIds = fields.map(f => f.id);
  [orderedIds[idx], orderedIds[newIdx]] = [orderedIds[newIdx], orderedIds[idx]];

  db.reorderFields(taskId, orderedIds);
  sendFieldsList(bot, chatId, taskId);
}


// ─────────────────────────────────────────────
//  Create Task Flow
// ─────────────────────────────────────────────
// steps: name → shortDesc → fullDesc → video → reward → maxPerUser → status → confirm

function startCreateTask(bot, chatId, adminId) {
  setSession(adminId, 'create_task', 'name_ar', {});
  bot.sendMessage(chatId, '➕ *إنشاء مهمة جديدة*\n\n' + CREATE_PROMPTS.name_ar, {
    parse_mode: 'Markdown',
    reply_markup: cancelKeyboard('adm_tasks_list'),
  });
}

const CREATE_PROMPTS = {
  name_ar:       '📝 أدخل *اسم المهمة* بالعربي:',
  name_en:       '📝 Enter *task name* in English:',
  shortDesc_ar:  '📄 أدخل *الوصف المختصر* بالعربي:',
  shortDesc_en:  '📄 Enter *short description* in English:',
  fullDesc_ar:   '📖 أدخل *الشرح الكامل* بالعربي:',
  fullDesc_en:   '📖 Enter *full description* in English:',
  video:         '🎥 أرسل *فيديو الشرح* (اختياري - أرسل "تخطي" لتجاوزه)',
  reward:        '💰 أدخل *قيمة المكافأة* (رقم):',
  maxPerUser:    '👤 أدخل *الحد الأقصى للتسليم لكل مستخدم* (0 = غير محدود):',
  status:        '🔘 هل المهمة *مفتوحة* الآن؟',
};

async function handleCreateTask(bot, msg, adminId, session) {
  const chatId = msg.chat.id;
  const step   = session.step;
  const data   = session.data;

  // الحقول النصية الثنائية (ar/en)
  const textSteps = {
    name_ar:      { field: 'name',      lang: 'ar', next: 'name_en'      },
    name_en:      { field: 'name',      lang: 'en', next: 'shortDesc_ar' },
    shortDesc_ar: { field: 'shortDesc', lang: 'ar', next: 'shortDesc_en' },
    shortDesc_en: { field: 'shortDesc', lang: 'en', next: 'fullDesc_ar'  },
    fullDesc_ar:  { field: 'fullDesc',  lang: 'ar', next: 'fullDesc_en'  },
    fullDesc_en:  { field: 'fullDesc',  lang: 'en', next: 'video'        },
  };

  if (textSteps[step]) {
    const { field, lang, next } = textSteps[step];
    const value = msg.text?.trim();
    if (!value) return bot.sendMessage(chatId, '⚠️ لا يمكن أن تكون فارغة.');
    // نبني i18n object تدريجياً
    if (!data[field] || typeof data[field] === 'string') data[field] = {};
    data[field][lang] = value;
    setSession(adminId, 'create_task', next, data);
    return bot.sendMessage(chatId, CREATE_PROMPTS[next], { parse_mode: 'Markdown' });
  }

  if (step === 'video') {
    if (msg.video) {
      data.videoFileId = msg.video.file_id;
    } else if (msg.text && /^(تخطي|skip)$/i.test(msg.text.trim())) {
      data.videoFileId = null;
    } else {
      return bot.sendMessage(chatId,
        '🎥 أرسل فيديو أو اكتب "تخطي" لتجاوز هذه الخطوة.',
        { reply_markup: cancelKeyboard('adm_tasks_list') }
      );
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
          { text: '🟢 مفتوحة', callback_data: `adm_ct_status:open` },
          { text: '🔴 مغلقة',  callback_data: `adm_ct_status:closed` },
        ]],
      },
    });
  }
}


// ─────────────────────────────────────────────
//  Edit Task Property Flow
// ─────────────────────────────────────────────

function startEditTaskProp(bot, chatId, adminId, taskId, prop, lang = null) {
  setSession(adminId, 'edit_task_prop', 'waiting', { taskId, prop, lang });
  const propLabel = PROP_LABELS[prop] || prop;
  const langLabel = lang ? ` (${LANG_LABELS[lang] || lang})` : '';
  const prompt = `✏️ *${propLabel}${langLabel}*`;
  const backCb = `adm_edit_task:${sh(taskId)}`;  // short ID للـ callback limit

  if (lang && I18N_FIELDS.includes(prop)) {
    const task    = db.getTask(taskId);
    const current = db.getTaskText(task, prop, lang);
    bot.sendMessage(chatId, prompt, {
      parse_mode: 'Markdown',
      reply_markup: cancelKeyboard(backCb),
    });
    if (current) {
      bot.sendMessage(chatId, `📌 الحالي:\n${current}`);
    }
  } else {
    bot.sendMessage(chatId, prompt, {
      parse_mode: 'Markdown',
      reply_markup: cancelKeyboard(backCb),
    });
  }
}

async function handleEditTaskProp(bot, msg, adminId, session) {
  const chatId = msg.chat.id;
  const { taskId, prop, lang } = session.data;

  let value;

  if (prop === 'videoFileId') {
    if (msg.video) {
      value = msg.video.file_id;
    } else if (msg.text?.trim().toLowerCase() === 'حذف') {
      value = null;
    } else {
      return bot.sendMessage(chatId, '⚠️ أرسل فيديو أو اكتب "حذف" لإزالة الفيديو الحالي.');
    }
    db.updateTask(taskId, { [prop]: value });
  } else if (prop === 'reward' || prop === 'order') {
    value = parseFloat(msg.text);
    if (isNaN(value)) return bot.sendMessage(chatId, '⚠️ أدخل رقماً صحيحاً.');
    db.updateTask(taskId, { [prop]: value });
  } else if (prop === 'maxPerUser') {
    const v = parseInt(msg.text);
    value = (!isNaN(v) && v > 0) ? v : null;
    db.updateTask(taskId, { [prop]: value });
  } else if (lang && I18N_FIELDS.includes(prop)) {
    // حقل i18n — نستخدم setTaskText
    value = msg.text?.trim();
    if (!value) return bot.sendMessage(chatId, '⚠️ القيمة لا يمكن أن تكون فارغة.');
    db.setTaskText(taskId, prop, lang, value);
  } else {
    value = msg.text?.trim();
    if (!value) return bot.sendMessage(chatId, '⚠️ القيمة لا يمكن أن تكون فارغة.');
    db.updateTask(taskId, { [prop]: value });
  }

  clearSession(adminId);
  const langLabel = lang ? ` (${LANG_LABELS[lang] || lang})` : '';
  bot.sendMessage(chatId,
    `✅ تم تحديث *${PROP_LABELS[prop] || prop}${langLabel}* بنجاح.`,
    { parse_mode: 'Markdown' }
  );
  sendTaskDetail(bot, chatId, taskId);
}

// ─────────────────────────────────────────────
//  Add Field Flow
// ─────────────────────────────────────────────
// steps: label → type → required

function startAddField(bot, chatId, adminId, taskId) {
  setSession(adminId, 'add_field', 'label_ar', { taskId });
  bot.sendMessage(chatId, '➕ *إضافة حقل جديد*\n\n✏️ أدخل *اسم الحقل بالعربي* (مثال: البريد الإلكتروني):', {
    parse_mode: 'Markdown',
    reply_markup: cancelKeyboard(`adm_fields:${sh(taskId)}`),
  });
}

async function handleAddField(bot, msg, adminId, session) {
  const chatId = msg.chat.id;
  const step   = session.step;
  const data   = session.data;

  if (step === 'label_ar') {
    if (!msg.text?.trim()) return bot.sendMessage(chatId, '⚠️ الاسم لا يمكن أن يكون فارغاً.');
    data.label = { ar: msg.text.trim(), en: '' };
    setSession(adminId, 'add_field', 'label_en', data);
    return bot.sendMessage(chatId, '✏️ Enter the *field name in English*:', {
      parse_mode: 'Markdown',
      reply_markup: cancelKeyboard(`adm_fields:${sh(data.taskId)}`),
    });
  }

  if (step === 'label_en') {
    if (!msg.text?.trim()) return bot.sendMessage(chatId, '⚠️ Cannot be empty.');
    data.label.en = msg.text.trim();
    setSession(adminId, 'add_field', 'type', data);
    return bot.sendMessage(chatId, '🔠 اختر *نوع الحقل:*', {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: db.FIELD_TYPES.reduce((rows, tp, i) => {
          if (i % 3 === 0) rows.push([]);
          rows[rows.length - 1].push({ text: tp, callback_data: `adm_af_type:${tp}` });
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
  const task  = db.getTask(taskId);
  const field = task?.fields.find(f => f.id === fieldId);
  const cur   = prop === 'label_ar'
    ? (typeof field?.label === 'object' ? field.label.ar : field?.label) || ''
    : prop === 'label_en'
    ? (typeof field?.label === 'object' ? field.label.en : field?.label) || ''
    : '';
  const hint  = prop === 'label_ar' ? '✏️ أدخل الاسم الجديد بالعربي:' : '✏️ Enter the new name in English:';
  bot.sendMessage(chatId, `${hint}\n\n📌 الحالي: \`${cur || '—'}\``, {
    parse_mode: 'Markdown',
    reply_markup: cancelKeyboard(`adm_fd:${sh(taskId)}:${sh(fieldId)}`),
  });
}

async function handleEditFieldProp(bot, msg, adminId, session) {
  const chatId = msg.chat.id;
  const { taskId, fieldId, prop } = session.data;
  const value = msg.text?.trim();
  if (!value) return bot.sendMessage(chatId, '⚠️ القيمة لا يمكن أن تكون فارغة.');

  if (prop === 'label_ar' || prop === 'label_en') {
    const task  = db.getTask(taskId);
    const field = task?.fields.find(f => f.id === fieldId);
    const lang  = prop === 'label_ar' ? 'ar' : 'en';
    const currentLabel = typeof field?.label === 'object'
      ? { ...field.label }
      : { ar: field?.label || '', en: field?.label || '' };
    currentLabel[lang] = value;
    db.updateField(taskId, fieldId, { label: currentLabel });
  } else {
    db.updateField(taskId, fieldId, { [prop]: value });
  }

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
    const status = data.split(':')[1];  // 'open' | 'closed'
    const session = getSession(adminId);
    if (!session || session.flow !== 'create_task') return false;
    session.data.isOpen = (status === 'open');
    // حفظ المهمة
    const task = db.createTask(session.data);
    clearSession(adminId);
    bot.sendMessage(
      chatId,
      `✅ *تم إنشاء المهمة بنجاح!*\n\n🆔 \`${task.id}\`\n📌 ${db.getTaskText(task, 'name', 'ar')}\n\nيمكنك الآن إضافة الحقول المطلوبة:`,
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
    const type = data.split(':')[1];
    const session = getSession(adminId);
    if (!session || session.flow !== 'add_field') return false;
    session.data.type = type;
    setSession(adminId, 'add_field', 'required', session.data);
    bot.sendMessage(chatId, `✅ النوع: *${type}*\n\nهل الحقل إجباري؟`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '🔴 إجباري',   callback_data: `adm_af_req:true`  },
          { text: '🟡 اختياري', callback_data: `adm_af_req:false` },
        ]],
      },
    });
    return true;
  }

  // اختيار إلزامية الحقل الجديد
  if (data.startsWith('adm_af_req:')) {
    bot.answerCallbackQuery(query.id);
    const req = data.split(':')[1];  // 'true' | 'false'
    const session = getSession(adminId);
    if (!session || session.flow !== 'add_field') return false;
    const { taskId, label, type } = session.data;
    const field = db.addField(taskId, { label, type, required: req === 'true' });
    clearSession(adminId);
    const fieldName = typeof field.label === 'object' ? (field.label.ar || field.label.en || '') : (field.label || '');
    bot.sendMessage(chatId, `✅ تم إضافة الحقل "*${escMd(fieldName)}*" بنجاح.`, { parse_mode: 'Markdown' });
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
