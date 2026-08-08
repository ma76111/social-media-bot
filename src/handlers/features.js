'use strict';

/**
 * features.js — نظام ميزات المهمة
 *
 * الميزات المدعومة حالياً:
 *   ● random_names  — الأدمن يدخل قائمة أسماء، المستخدم يضغط الزرار فيجيله اسم عشوائي
 *
 * الإضافة مستقبلاً: أي type جديد يُضاف هنا فقط بدون تغيير باقي الكود.
 */

const db = require('../db');
const { escMd } = require('../utils/escMd');

// ─────────────────────────────────────────────
//  Feature types registry
// ─────────────────────────────────────────────

const FEATURE_TYPES = {
  random_names: {
    label:    { ar: '🎲 احصل على اسم عشوائي', en: '🎲 Get a random name' },
    btnLabel: { ar: '🎲 اسم عشوائي',           en: '🎲 Random Name'       },
    describe: { ar: 'يعرض اسم عشوائي من القائمة عند الضغط',
                en: 'Shows a random name from the list on press' },
  },
};

// ─────────────────────────────────────────────
//  بناء أزرار الميزات للمستخدم (أثناء التسليم)
// ─────────────────────────────────────────────

/**
 * يرجع صفوف الـ inline keyboard للميزات
 * @param {object} task
 * @param {string} lang
 */
function buildFeatureButtons(task, lang) {
  const features = task.features || [];
  if (!features.length) return [];
  return features.map(feat => {
    const typeInfo = FEATURE_TYPES[feat.type];
    const text = feat.label || typeInfo?.btnLabel?.[lang] || feat.type;
    return [{ text, callback_data: `feat:${feat.id.substring(0, 8)}:${task.id.substring(0, 8)}` }];
  });
}

// ─────────────────────────────────────────────
//  تنفيذ الميزة عند ضغط المستخدم
// ─────────────────────────────────────────────

async function executeFeature(bot, query, feat, task, lang) {
  const chatId = query.message.chat.id;

  if (feat.type === 'random_names') {
    const names = feat.data?.names || [];
    if (!names.length) {
      return bot.answerCallbackQuery(query.id, {
        text: lang === 'ar' ? '⚠️ لا توجد أسماء مضافة.' : '⚠️ No names added.',
        show_alert: true,
      });
    }
    await bot.answerCallbackQuery(query.id);
    const name  = names[Math.floor(Math.random() * names.length)];
    const parts = name.trim().split(/\s+/);

    const labels = lang === 'ar'
      ? ['الاسم الأول', 'الاسم الثاني', 'الاسم الثالث', 'الاسم الرابع', 'الاسم الخامس']
      : ['First name', 'Second name', 'Third name', 'Fourth name', 'Fifth name'];

    let text = `✨ *${name}*\n\n`;
    parts.forEach((part, i) => {
      const label = labels[i] || (lang === 'ar' ? `الجزء ${i + 1}` : `Part ${i + 1}`);
      text += `${label}: \`${part}\`\n`;
    });

    return bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  }

  await bot.answerCallbackQuery(query.id, { text: '⚠️ ميزة غير معروفة.', show_alert: true });
}

// ─────────────────────────────────────────────
//  Admin sessions لإضافة الميزات
// ─────────────────────────────────────────────

const sessions = {};
function setSession(id, flow, step, data = {}) { sessions[id] = { flow, step, data }; }
function getSession(id) { return sessions[id] || null; }
function clearSession(id) { delete sessions[id]; }

// ─────────────────────────────────────────────
//  Admin keyboards
// ─────────────────────────────────────────────

function sh(uuid) { return uuid.substring(0, 8); }

function featuresListKeyboard(task) {
  const rows = (task.features || []).map(f => [{
    text: `${FEATURE_TYPES[f.type]?.btnLabel?.ar || f.type} — ${f.label || ''}`,
    callback_data: `feat_detail:${sh(task.id)}:${sh(f.id)}`,
  }]);
  rows.push([
    { text: '➕ إضافة ميزة', callback_data: `feat_add:${sh(task.id)}` },
    { text: '🔙 رجوع',       callback_data: `feat_back:${sh(task.id)}` },
  ]);
  return { inline_keyboard: rows };
}

function featureDetailKeyboard(taskId, featId) {
  return {
    inline_keyboard: [
      [
        { text: '✏️ تعديل نص الزرار', callback_data: `feat_edit_label:${sh(taskId)}:${sh(featId)}` },
        { text: '✏️ تعديل الأسماء',   callback_data: `feat_edit_names:${sh(taskId)}:${sh(featId)}` },
      ],
      [
        { text: '🗑 حذف الميزة', callback_data: `feat_del:${sh(taskId)}:${sh(featId)}` },
        { text: '🔙 رجوع',       callback_data: `feat_list:${sh(taskId)}`               },
      ],
    ],
  };
}

function featureTypesKeyboard(taskId) {
  const rows = Object.entries(FEATURE_TYPES).map(([type, info]) => [{
    text: info.label.ar,
    callback_data: `feat_type:${sh(taskId)}:${type}`,
  }]);
  rows.push([{ text: '🔙 إلغاء', callback_data: `feat_list:${sh(taskId)}` }]);
  return { inline_keyboard: rows };
}

function cancelKeyboard(backCb) {
  return { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: backCb }]] };
}

// ─────────────────────────────────────────────
//  Expand IDs
// ─────────────────────────────────────────────

function expandTaskId(short) {
  return db.listTasks().find(t => t.id.startsWith(short))?.id || short;
}

function expandFeatId(task, short) {
  return (task.features || []).find(f => f.id.startsWith(short))?.id || short;
}

// ─────────────────────────────────────────────
//  Admin text handler
// ─────────────────────────────────────────────

async function handleAdminText(bot, msg, adminId) {
  const session = getSession(adminId);
  if (!session) return;
  const { flow, step, data } = session;
  const chatId = msg.chat.id;
  const text   = msg.text?.trim();
  if (!text) return;

  // إدخال اسم الزرار
  if (flow === 'feat_add' && step === 'label') {
    data.label = text;
    setSession(adminId, 'feat_add', 'names', data);
    return bot.sendMessage(chatId,
      `✅ نص الزرار: *${text}*\n\n📝 أدخل الأسماء (كل اسم في سطر جديد):`,
      { parse_mode: 'Markdown', reply_markup: cancelKeyboard(`feat_list:${sh(data.taskId)}`) }
    );
  }

  // إدخال الأسماء
  if (flow === 'feat_add' && step === 'names') {
    const names = text.split('\n').map(n => n.trim()).filter(Boolean);
    if (!names.length) return bot.sendMessage(chatId, '⚠️ أدخل اسماً واحداً على الأقل.');
    const feat = db.addFeature(data.taskId, {
      type:  'random_names',
      label: data.label,
      data:  { names },
    });
    clearSession(adminId);
    bot.sendMessage(chatId,
      `✅ تم إضافة الميزة "*${feat.label}*"\n📋 ${names.length} اسم.`,
      { parse_mode: 'Markdown' }
    );
    const task = db.getTask(data.taskId);
    return bot.sendMessage(chatId, `🎯 ميزات المهمة "${db.getTaskText(task, 'name', 'ar')}":`, {
      reply_markup: featuresListKeyboard(task),
    });
  }

  // تعديل نص الزرار
  if (flow === 'feat_edit_label') {
    db.updateFeature(data.taskId, data.featId, { label: text });
    clearSession(adminId);
    bot.sendMessage(chatId, `✅ تم تحديث نص الزرار إلى "*${text}*"`, { parse_mode: 'Markdown' });
    const task = db.getTask(data.taskId);
    return bot.sendMessage(chatId, `🎯 ميزات المهمة:`, { reply_markup: featuresListKeyboard(task) });
  }

  // تعديل الأسماء
  if (flow === 'feat_edit_names') {
    const names = text.split('\n').map(n => n.trim()).filter(Boolean);
    if (!names.length) return bot.sendMessage(chatId, '⚠️ أدخل اسماً واحداً على الأقل.');
    const task = db.getTask(data.taskId);
    const feat = (task.features || []).find(f => f.id === data.featId);
    db.updateFeature(data.taskId, data.featId, { data: { ...feat?.data, names } });
    clearSession(adminId);
    bot.sendMessage(chatId, `✅ تم تحديث الأسماء (${names.length} اسم).`);
    const updatedTask = db.getTask(data.taskId);
    return bot.sendMessage(chatId, `🎯 ميزات المهمة:`, { reply_markup: featuresListKeyboard(updatedTask) });
  }
}

// ─────────────────────────────────────────────
//  register
// ─────────────────────────────────────────────

function register(bot, isAdmin) {

  // ── استقبال نصوص الأدمن ───────────────────
  bot.on('message', async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    if (!msg.text || msg.text.startsWith('/')) return;
    if (msg.text.startsWith('🟢') || msg.text.startsWith('🔴')) return;
    await handleAdminText(bot, msg, msg.from.id);
  });

  // ── Callbacks ─────────────────────────────
  bot.on('callback_query', async (query) => {
    if (query._blocked) return;   // Idempotency Gate
    const data    = query.data;
    const userId  = query.from.id;
    const chatId  = query.message.chat.id;

    // ── ميزة: تنفيذ للمستخدم ─────────────────
    if (data.startsWith('feat:')) {
      await bot.answerCallbackQuery(query.id);
      const [, featShort, taskShort] = data.split(':');
      const taskId = expandTaskId(taskShort);
      const task   = db.getTask(taskId);
      if (!task) return;
      const feat = (task.features || []).find(f => f.id.startsWith(featShort));
      if (!feat) return;
      const lang = db.getUser(userId)?.lang || 'ar';
      await executeFeature(bot, query, feat, task, lang);
      return;
    }

    if (!isAdmin(userId)) return;

    // ── قائمة الميزات ─────────────────────────
    if (data.startsWith('feat_list:')) {
      await bot.answerCallbackQuery(query.id);
      const taskId = expandTaskId(data.split(':')[1]);
      const task   = db.getTask(taskId);
      if (!task) return bot.sendMessage(chatId, '⚠️ المهمة غير موجودة.');
      bot.sendMessage(chatId, `🎯 *ميزات المهمة "${db.getTaskText(task, 'name', 'ar')}"* (${(task.features||[]).length}):`, {
        parse_mode: 'Markdown',
        reply_markup: featuresListKeyboard(task),
      });
      return;
    }

    // ── رجوع من الميزات إلى تفاصيل المهمة ──────
    if (data.startsWith('feat_back:')) {
      await bot.answerCallbackQuery(query.id);
      const taskId = expandTaskId(data.split(':')[1]);
      const task   = db.getTask(taskId);
      if (!task) return bot.sendMessage(chatId, '⚠️ المهمة غير موجودة.');
      // إرسال رسالة تطلب الضغط على اسم المهمة من القائمة
      bot.sendMessage(chatId,
        `✅ اضغط على اسم المهمة "*${escMd(db.getTaskText(task, 'name', 'ar'))}*" من القائمة السفلية للرجوع إليها.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // ── إضافة ميزة: اختيار النوع ─────────────
    if (data.startsWith('feat_add:')) {
      await bot.answerCallbackQuery(query.id);
      const taskId = expandTaskId(data.split(':')[1]);
      bot.sendMessage(chatId, '🎯 اختر نوع الميزة:', {
        reply_markup: featureTypesKeyboard(taskId),
      });
      return;
    }

    // ── اختيار نوع الميزة ────────────────────
    if (data.startsWith('feat_type:')) {
      await bot.answerCallbackQuery(query.id);
      const [, ts, type] = data.split(':');
      const taskId = expandTaskId(ts);
      setSession(userId, 'feat_add', 'label', { taskId, type });
      const typeInfo = FEATURE_TYPES[type];
      bot.sendMessage(chatId,
        `➕ *إضافة ميزة: ${typeInfo?.label?.ar}*\n\n✏️ أدخل *نص الزرار* الذي سيظهر للمستخدم:\n_(مثال: 🎲 احصل على اسم)_`,
        { parse_mode: 'Markdown', reply_markup: cancelKeyboard(`feat_list:${ts}`) }
      );
      return;
    }

    // ── تفاصيل ميزة ──────────────────────────
    if (data.startsWith('feat_detail:')) {
      await bot.answerCallbackQuery(query.id);
      const [, ts, fs] = data.split(':');
      const taskId = expandTaskId(ts);
      const task   = db.getTask(taskId);
      const featId = expandFeatId(task, fs);
      const feat   = (task?.features || []).find(f => f.id === featId);
      if (!feat) return bot.sendMessage(chatId, '⚠️ الميزة غير موجودة.');
      const names  = feat.data?.names || [];
      bot.sendMessage(chatId,
        `🎯 *تفاصيل الميزة*\n\n` +
        `• النوع: \`${feat.type}\`\n` +
        `• نص الزرار: *${feat.label}*\n` +
        `• عدد الأسماء: *${names.length}*\n\n` +
        `📋 الأسماء:\n${names.map((n, i) => `${i + 1}. ${n}`).join('\n')}`,
        { parse_mode: 'Markdown', reply_markup: featureDetailKeyboard(taskId, featId) }
      );
      return;
    }

    // ── تعديل نص الزرار ──────────────────────
    if (data.startsWith('feat_edit_label:')) {
      await bot.answerCallbackQuery(query.id);
      const [, ts, fs] = data.split(':');
      const taskId = expandTaskId(ts);
      const task   = db.getTask(taskId);
      const featId = expandFeatId(task, fs);
      setSession(userId, 'feat_edit_label', 'waiting', { taskId, featId });
      bot.sendMessage(chatId, '✏️ أدخل نص الزرار الجديد:', {
        reply_markup: cancelKeyboard(`feat_detail:${ts}:${fs}`),
      });
      return;
    }

    // ── تعديل الأسماء ────────────────────────
    if (data.startsWith('feat_edit_names:')) {
      await bot.answerCallbackQuery(query.id);
      const [, ts, fs] = data.split(':');
      const taskId = expandTaskId(ts);
      const task   = db.getTask(taskId);
      const featId = expandFeatId(task, fs);
      setSession(userId, 'feat_edit_names', 'waiting', { taskId, featId });
      bot.sendMessage(chatId,
        '📝 أدخل الأسماء الجديدة (كل اسم في سطر جديد):',
        { reply_markup: cancelKeyboard(`feat_detail:${ts}:${fs}`) }
      );
      return;
    }

    // ── حذف ميزة ─────────────────────────────
    if (data.startsWith('feat_del:')) {
      await bot.answerCallbackQuery(query.id);
      const [, ts, fs] = data.split(':');
      const taskId = expandTaskId(ts);
      const task   = db.getTask(taskId);
      const featId = expandFeatId(task, fs);
      db.deleteFeature(taskId, featId);
      bot.sendMessage(chatId, '🗑 تم حذف الميزة.');
      const updated = db.getTask(taskId);
      bot.sendMessage(chatId, `🎯 ميزات المهمة:`, { reply_markup: featuresListKeyboard(updated) });
      return;
    }
  });
}

module.exports = { register, buildFeatureButtons, FEATURE_TYPES };
