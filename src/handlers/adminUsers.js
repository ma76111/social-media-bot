'use strict';

/**
 * adminUsers.js — إدارة المستخدمين
 *
 * الميزات:
 *  - بحث بالـ Telegram ID أو @username أو الـ uid الداخلي
 *  - عرض بيانات كاملة (رصيد، إجمالي أرباح، حالة حظر، لغة، عملة، تسليمات)
 *  - إضافة رصيد (هدية) أو خصم (عقوبة)
 *  - تعيين رصيد مباشر
 *  - حظر / إلغاء حظر مع سبب
 *  - override سعر مهمة معينة لمستخدم بعينه
 *  - حذف override
 *  - عرض قائمة جميع المستخدمين (pagination 10)
 */

const db = require('../db');
const { t, currencySymbol } = require('../i18n');
const { notifyUser, getLang } = require('../utils/notify');
const { escMd } = require('../utils/escMd');

// ─────────────────────────────────────────────
//  Sessions
// ─────────────────────────────────────────────
const sessions = {};
function setSession(id, flow, step, data = {}) { sessions[id] = { flow, step, data }; }
function getSession(id) { return sessions[id] || null; }
function clearSession(id) { delete sessions[id]; }

const USERS_PAGE = 10;

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────

function findUser(query) {
  const q = String(query).trim();
  // رقم كبير → Telegram ID
  if (/^\d{5,}$/.test(q))    return db.getUser(parseInt(q));
  // رقم صغير → uid داخلي
  if (/^\d+$/.test(q))       return db.findUserByUid(parseInt(q));
  // @ أو اسم → username
  return db.findUserByUsername(q);
}

function langLabel(l)  { return l === 'en' ? 'English 🇬🇧' : l === 'ar' ? 'العربية 🇦🇪' : '—'; }
function curLabel(c)   { return c === 'usdt' ? 'USDT 🟡' : c === 'egp' ? 'جنيه مصري 🇪🇬' : '—'; }

function userCard(user) {
  const tasks   = db.listTasks();
  // نحسب التسليمات مع migrate للبيانات القديمة
  const allSubs = tasks.flatMap(t =>
    (t.submissions || [])
      .filter(s => s.userId === user.id)
      .map(s => ({
        ...s,
        status: s.status === 'exported' ? 'approved' : s.status,
        exported: s.status === 'exported' ? 1 : (s.exported ?? 0),
      }))
  );
  const stats = { total: allSubs.length, pending: 0, approved: 0, rejected: 0, exported: 0 };
  for (const s of allSubs) {
    if (s.status === 'pending')  stats.pending++;
    if (s.status === 'approved') stats.approved++;
    if (s.status === 'rejected') stats.rejected++;
    if (s.exported === 1)        stats.exported++;
  }

  const overrides = Object.entries(user.rewardOverrides || {});
  let overridesText = '';
  if (overrides.length) {
    overridesText = '\n\n🎯 *Override المكافآت:*\n';
    for (const [tid, reward] of overrides) {
      const task = db.getTask(tid);
      const name = task ? db.getTaskText(task, 'name', 'ar') : tid;
      overridesText += `• ${escMd(name)}: \`${reward}\`\n`;
    }
  }

  return (
    `👤 *بيانات المستخدم*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `🆔 Telegram ID: \`${user.id}\`\n` +
    `🔢 UID الداخلي: \`#${user.uid || '—'}\`\n` +
    `👤 اسم المستخدم: ${user.username ? `@${escMd(user.username.replace(/^@/,''))}` : '—'}\n` +
    `📛 الاسم: ${escMd(user.firstName) || '—'}\n` +
    `📅 تاريخ الانضمام: ${user.joinedAt || '—'}\n` +
    `🌐 اللغة: ${langLabel(user.lang)}\n` +
    `💱 العملة: ${curLabel(user.currency)}\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `💰 الرصيد الحالي: \`${user.balance} EGP\`\n` +
    `📊 إجمالي الأرباح: \`${user.totalEarned} EGP\`\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `📦 إجمالي التسليمات: *${stats.total}*\n` +
    `  ⏳ معلق: ${stats.pending}  ✅ مقبول: ${stats.approved}\n` +
    `  ❌ مرفوض: ${stats.rejected}  📤 مصدَّر: ${stats.exported}\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `🚫 الحظر: ${user.isBanned ? `*محظور* منذ ${user.bannedAt}${user.banReason ? `\n📝 السبب: ${escMd(user.banReason)}` : ''}` : 'غير محظور'}` +
    overridesText
  );
}

// ─────────────────────────────────────────────
//  Keyboards
// ─────────────────────────────────────────────

function userActionsKeyboard(userId, isBanned) {
  return {
    inline_keyboard: [
      [
        { text: '💰 إضافة رصيد',    callback_data: `usr_add:${userId}`    },
        { text: '💸 خصم رصيد',      callback_data: `usr_deduct:${userId}` },
        { text: '✏️ تعيين رصيد',    callback_data: `usr_set:${userId}`    },
      ],
      [
        isBanned
          ? { text: '✅ إلغاء الحظر', callback_data: `usr_unban:${userId}` }
          : { text: '🚫 حظر',         callback_data: `usr_ban_ask:${userId}` },
        { text: '🎯 Override مكافأة', callback_data: `usr_override:${userId}` },
      ],
      [
        { text: '📋 تسليماته',  callback_data: `usr_subs:${userId}` },
        { text: '🔙 رجوع',     callback_data: 'usrs_list:0'         },
      ],
    ],
  };
}

// أزرار مختصرة تظهر تحت كل مستخدم في قائمة العشرة
function userQuickKeyboard(userId, isBanned) {
  return {
    inline_keyboard: [[
      { text: '👁 عرض',            callback_data: `usr_view:${userId}`    },
      { text: '💰 رصيد',           callback_data: `usr_add:${userId}`     },
      { text: '💸 خصم',            callback_data: `usr_deduct:${userId}`  },
      isBanned
        ? { text: '✅ رفع حظر',    callback_data: `usr_unban:${userId}`   }
        : { text: '🚫 حظر',        callback_data: `usr_ban_ask:${userId}` },
    ]],
  };
}

function overrideTasksKeyboard(userId) {
  const tasks = db.listTasks();
  const user  = db.getUser(userId);
  const rows  = tasks.map(t => {
    const ov    = user.rewardOverrides?.[t.id];
    const name  = db.getTaskText(t, 'name', 'ar');
    const label = ov !== undefined
      ? `✏️ ${name} (${ov} ← ${t.reward})`
      : `🎯 ${name} (${t.reward})`;
    return [{ text: label, callback_data: `usr_ov_task:${userId}:${t.id}` }];
  });
  rows.push([{ text: '🔙 رجوع', callback_data: `usr_view:${userId}` }]);
  return { inline_keyboard: rows };
}

function cancelKeyboard(backCb) {
  return { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: backCb }]] };
}

// ─────────────────────────────────────────────
//  Display helpers
// ─────────────────────────────────────────────

/**
 * يرسل 10 مستخدمين كل واحد في رسالة مستقلة
 * ثم رسالة navigation في الآخر
 */
async function sendUsersList(bot, chatId, page = 0) {
  const all   = db.listUsers();
  const total = all.length;

  if (total === 0) {
    return bot.sendMessage(chatId, '📭 لا يوجد مستخدمون بعد.');
  }

  const slice      = all.slice(page * USERS_PAGE, (page + 1) * USERS_PAGE);
  const totalPages = Math.ceil(total / USERS_PAGE);

  // رسالة header
  await bot.sendMessage(
    chatId,
    `👥 *المستخدمون (${total})*  —  صفحة ${page + 1} / ${totalPages}`,
    { parse_mode: 'Markdown' }
  );

  // رسالة لكل مستخدم
  for (const user of slice) {
    const name    = user.username
      ? `@${user.username.replace(/^@/, '')}`
      : (user.firstName || String(user.id));
    const banned  = user.isBanned ? '  🚫 محظور' : '';
    const uid     = user.uid ? `#${user.uid}` : '#—';
    const text =
      `${uid}  |  ${name}${banned}\n` +
      `🆔 \`${user.id}\`\n` +
      `💰 الرصيد: \`${user.balance} EGP\`\n` +
      `📊 الأرباح: \`${user.totalEarned} EGP\``;

    await bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: userQuickKeyboard(user.id, user.isBanned),
    });
  }

  // رسالة navigation
  const nav = [];
  if (page > 0)             nav.push({ text: '◀️ السابق', callback_data: `usrs_page:${page - 1}` });
  if (page < totalPages - 1) nav.push({ text: 'التالي ▶️', callback_data: `usrs_page:${page + 1}` });

  const navRow = nav.length ? [nav] : [];
  bot.sendMessage(chatId, `🔍 *ابحث أو انتقل للصفحة التالية:*`, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        ...navRow,
        [{ text: '🔍 بحث بـ ID / @username', callback_data: 'usrs_search' }],
      ],
    },
  });
}

function sendUserCard(bot, chatId, userId) {
  const user = db.getUser(userId);
  bot.sendMessage(chatId, userCard(user), {
    parse_mode: 'Markdown',
    reply_markup: userActionsKeyboard(userId, user.isBanned),
  });
}

function sendUserSubs(bot, chatId, userId) {
  const tasks = db.listTasks();
  const user  = db.getUser(userId);
  const allSubs = tasks.flatMap(t =>
    t.submissions
      .filter(s => s.userId === userId)
      .map(s => ({
        task: t,
        sub: {
          ...s,
          // migrate الحالة القديمة
          status:   s.status === 'exported' ? 'approved' : s.status,
          exported: s.status === 'exported' ? 1 : (s.exported ?? 0),
        },
      }))
  ).sort((a, b) => b.sub.submittedAt.localeCompare(a.sub.submittedAt));

  if (!allSubs.length) {
    return bot.sendMessage(chatId, '📭 لا توجد تسليمات لهذا المستخدم.', {
      reply_markup: cancelKeyboard(`usr_view:${userId}`),
    });
  }

  const STATUS = { pending: '⏳', approved: '✅', rejected: '❌', exported: '📤' };
  let text = `📋 *تسليمات ${escMd(user.username || user.firstName || String(user.id))}*\n\n`;
  for (const { task, sub } of allSubs.slice(0, 20)) {
    const icon = STATUS[sub.status] || '•';
    const expIcon = sub.exported === 1 ? ' 📤' : '';
    text += `${icon}${expIcon} *${escMd(db.getTaskText(task, 'name', 'ar'))}* — \`${sub.id.substring(0, 8)}\` — ${sub.submittedAt}\n`;
  }
  if (allSubs.length > 20) text += `\n_... و ${allSubs.length - 20} تسليم آخر_`;

  bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: [[{ text: '🔙 رجوع', callback_data: `usr_view:${userId}` }]] },
  });
}

// ─────────────────────────────────────────────
//  Text flow handler
// ─────────────────────────────────────────────

async function handleAdminText(bot, msg, adminId) {
  const session = getSession(adminId);
  if (!session) return;
  const { flow, step, data } = session;
  const chatId = msg.chat.id;
  const text   = msg.text?.trim();
  if (!text) return;

  // ── بحث ────────────────────────────────────
  if (flow === 'search') {
    clearSession(adminId);
    const user = findUser(text);
    if (!user) return bot.sendMessage(chatId, `⚠️ لم يتم إيجاد مستخدم بـ \`${text}\`\n\nجرب: Telegram ID أو @username أو الـ UID الداخلي (#1، #2، ...)`, { parse_mode: 'Markdown' });
    return sendUserCard(bot, chatId, user.id);
  }

  // ── إضافة رصيد ─────────────────────────────
  if (flow === 'add_balance') {
    const amount = parseFloat(text);
    if (isNaN(amount) || amount <= 0) return bot.sendMessage(chatId, '⚠️ أدخل رقماً موجباً.');
    const newBal = db.addBalance(data.userId, amount);
    clearSession(adminId);
    bot.sendMessage(chatId, `✅ تم إضافة \`${amount}\` للمستخدم \`${data.userId}\`\n💰 الرصيد الجديد: \`${newBal}\``, { parse_mode: 'Markdown' });
    await notifyUser(bot, data.userId, `🎁 تم إضافة مكافأة لرصيدك!\n💰 المبلغ: ${amount} EGP\n💳 رصيدك الحالي: ${newBal} EGP`);
    sendUserCard(bot, chatId, data.userId);
    return;
  }

  // ── خصم رصيد ───────────────────────────────
  if (flow === 'deduct_balance') {
    const amount = parseFloat(text);
    if (isNaN(amount) || amount <= 0) return bot.sendMessage(chatId, '⚠️ أدخل رقماً موجباً.');
    const newBal = db.addBalance(data.userId, -amount);
    clearSession(adminId);
    bot.sendMessage(chatId, `✅ تم خصم \`${amount}\` من المستخدم \`${data.userId}\`\n💰 الرصيد الجديد: \`${newBal}\``, { parse_mode: 'Markdown' });
    await notifyUser(bot, data.userId, `⚠️ تم خصم مبلغ من رصيدك\n💸 المبلغ المخصوم: ${amount} EGP\n💳 رصيدك الحالي: ${newBal} EGP`);
    sendUserCard(bot, chatId, data.userId);
    return;
  }

  // ── تعيين رصيد ─────────────────────────────
  if (flow === 'set_balance') {
    const amount = parseFloat(text);
    if (isNaN(amount)) return bot.sendMessage(chatId, '⚠️ أدخل رقماً صحيحاً.');
    const newBal = db.setBalance(data.userId, amount);
    clearSession(adminId);
    bot.sendMessage(chatId, `✅ تم تعيين رصيد المستخدم \`${data.userId}\` إلى \`${newBal}\``, { parse_mode: 'Markdown' });
    sendUserCard(bot, chatId, data.userId);
    return;
  }

  // ── سبب الحظر ──────────────────────────────
  if (flow === 'ban_reason') {
    const reason = (text === 'تخطي' || text === 'skip') ? null : text;
    db.banUser(data.userId, reason);
    clearSession(adminId);
    bot.sendMessage(chatId,
      `🚫 تم حظر المستخدم \`${data.userId}\`${reason ? `\nالسبب: ${escMd(reason)}` : ''}`,
      { parse_mode: 'Markdown' }
    );
    const userLang = getLang(data.userId);
    await notifyUser(bot, data.userId, t('notify_banned', userLang, reason));
    sendUserCard(bot, chatId, data.userId);
    return;
  }

  // ── override سعر مهمة ──────────────────────
  if (flow === 'set_override') {
    if (text === 'حذف' || text === 'delete') {
      db.setRewardOverride(data.userId, data.taskId, null);
      clearSession(adminId);
      bot.sendMessage(chatId, '✅ تم حذف الـ override.');
    } else {
      const reward = parseFloat(text);
      if (isNaN(reward) || reward < 0) return bot.sendMessage(chatId, '⚠️ أدخل رقماً صحيحاً أو "حذف" لإزالة الـ override.');
      db.setRewardOverride(data.userId, data.taskId, reward);
      clearSession(adminId);
      bot.sendMessage(chatId, `✅ تم تعيين المكافأة الخاصة لـ \`${data.userId}\` في مهمة \`${data.taskName}\` إلى \`${reward}\``, { parse_mode: 'Markdown' });
    }
    sendUserCard(bot, chatId, data.userId);
    return;
  }
}

// ─────────────────────────────────────────────
//  register
// ─────────────────────────────────────────────

function register(bot, isAdmin) {

  // زرار القائمة
  bot.onText(/👥 المستخدمون/, (msg) => {
    if (!isAdmin(msg.from.id)) return;
    sendUsersList(bot, msg.chat.id, 0);
  });

  // استقبال نصوص
  bot.on('message', async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const session = getSession(msg.from.id);
    if (!session) return;
    if (!msg.text || msg.text.startsWith('/')) return;
    if (msg.text.startsWith('🟢') || msg.text.startsWith('🔴')) return;
    // تجاهل أزرار القائمة الرئيسية للأدمن
    const menuTexts = [
      '📋 إدارة المهام', '➕ مهمة جديدة', '📊 إحصائيات',
      '📤 طلبات السحب',  '👥 المستخدمون',  '💱 سعر الصرف',
      '🔧 لوحة الأدمن',  '🏠 القائمة الرئيسية',
    ];
    if (menuTexts.includes(msg.text)) return;
    const menuTexts2 = ['⚙️ الإعدادات', '⚙️ إعدادات النظام', '📨 إرسال رسالة', '🔙 رجوع'];
    if (menuTexts2.includes(msg.text)) return;
    await handleAdminText(bot, msg, msg.from.id);
  });

  // Callbacks
  bot.on('callback_query', async (query) => {
    if (query._blocked) return;   // Idempotency Gate
    const data    = query.data;
    const adminId = query.from.id;
    const chatId  = query.message.chat.id;
    const msgId   = query.message.message_id;

    if (!isAdmin(adminId)) return;

    // ── قائمة المستخدمين (pagination) ──────────
    if (data.startsWith('usrs_list:') || data.startsWith('usrs_page:')) {
      await bot.answerCallbackQuery(query.id);
      const page = parseInt(data.split(':')[1]) || 0;
      await sendUsersList(bot, chatId, page);
      return;
    }

    // ── بحث ─────────────────────────────────
    if (data === 'usrs_search') {
      await bot.answerCallbackQuery(query.id);
      setSession(adminId, 'search', 'waiting', {});
      bot.sendMessage(chatId,
        '🔍 أدخل أحد التالي للبحث:\n\n• Telegram ID (مثال: `123456789`)\n• @username\n• UID الداخلي (مثال: `5`)',
        { parse_mode: 'Markdown', reply_markup: cancelKeyboard('usrs_list:0') }
      );
      return;
    }

    // ── عرض بيانات مستخدم ───────────────────
    if (data.startsWith('usr_view:')) {
      await bot.answerCallbackQuery(query.id);
      const userId = parseInt(data.split(':')[1]);
      sendUserCard(bot, chatId, userId);
      return;
    }

    // ── إضافة رصيد ──────────────────────────
    if (data.startsWith('usr_add:')) {
      await bot.answerCallbackQuery(query.id);
      const userId = parseInt(data.split(':')[1]);
      const user   = db.getUser(userId);
      setSession(adminId, 'add_balance', 'waiting', { userId });
      bot.sendMessage(chatId,
        `💰 *إضافة رصيد*\n\nالمستخدم: \`${userId}\`\nالرصيد الحالي: \`${user.balance}\`\n\nأدخل المبلغ المراد إضافته:`,
        { parse_mode: 'Markdown', reply_markup: cancelKeyboard(`usr_view:${userId}`) }
      );
      return;
    }

    // ── خصم رصيد ────────────────────────────
    if (data.startsWith('usr_deduct:')) {
      await bot.answerCallbackQuery(query.id);
      const userId = parseInt(data.split(':')[1]);
      const user   = db.getUser(userId);
      setSession(adminId, 'deduct_balance', 'waiting', { userId });
      bot.sendMessage(chatId,
        `💸 *خصم رصيد*\n\nالمستخدم: \`${userId}\`\nالرصيد الحالي: \`${user.balance}\`\n\nأدخل المبلغ المراد خصمه:`,
        { parse_mode: 'Markdown', reply_markup: cancelKeyboard(`usr_view:${userId}`) }
      );
      return;
    }

    // ── تعيين رصيد ──────────────────────────
    if (data.startsWith('usr_set:')) {
      await bot.answerCallbackQuery(query.id);
      const userId = parseInt(data.split(':')[1]);
      const user   = db.getUser(userId);
      setSession(adminId, 'set_balance', 'waiting', { userId });
      bot.sendMessage(chatId,
        `✏️ *تعيين رصيد*\n\nالمستخدم: \`${userId}\`\nالرصيد الحالي: \`${user.balance}\`\n\nأدخل الرصيد الجديد:`,
        { parse_mode: 'Markdown', reply_markup: cancelKeyboard(`usr_view:${userId}`) }
      );
      return;
    }

    // ── حظر (اطلب السبب) ────────────────────
    if (data.startsWith('usr_ban_ask:')) {
      await bot.answerCallbackQuery(query.id);
      const userId = parseInt(data.split(':')[1]);
      setSession(adminId, 'ban_reason', 'waiting', { userId });
      bot.sendMessage(chatId,
        `🚫 *حظر المستخدم* \`${userId}\`\n\nأدخل سبب الحظر (أو أرسل "تخطي"):`,
        { parse_mode: 'Markdown', reply_markup: cancelKeyboard(`usr_view:${userId}`) }
      );
      return;
    }

    // ── إلغاء حظر ───────────────────────────
    if (data.startsWith('usr_unban:')) {
      await bot.answerCallbackQuery(query.id);
      const userId = parseInt(data.split(':')[1]);
      db.unbanUser(userId);
      bot.sendMessage(chatId, `✅ تم إلغاء حظر المستخدم \`${userId}\`.`, { parse_mode: 'Markdown' });
      const userLang = getLang(userId);
      await notifyUser(bot, userId, t('notify_unbanned', userLang));
      sendUserCard(bot, chatId, userId);
      return;
    }

    // ── override قائمة المهام ────────────────
    if (data.startsWith('usr_override:')) {
      await bot.answerCallbackQuery(query.id);
      const userId = parseInt(data.split(':')[1]);
      const tasks  = db.listTasks();
      if (!tasks.length) return bot.sendMessage(chatId, '⚠️ لا توجد مهام بعد.');
      bot.sendMessage(chatId,
        `🎯 *Override مكافأة مهمة*\n\nاختر المهمة التي تريد تعيين مكافأة مخصصة لها للمستخدم \`${userId}\`:`,
        { parse_mode: 'Markdown', reply_markup: overrideTasksKeyboard(userId) }
      );
      return;
    }

    // ── اختيار مهمة للـ override ─────────────
    if (data.startsWith('usr_ov_task:')) {
      await bot.answerCallbackQuery(query.id);
      const [, , userId, taskId] = data.split(':');
      const task = db.getTask(taskId);
      const user = db.getUser(parseInt(userId));
      const cur  = user.rewardOverrides?.[taskId];
      setSession(adminId, 'set_override', 'waiting', {
        userId: parseInt(userId), taskId, taskName: db.getTaskText(task, 'name', 'ar'),
      });
      bot.sendMessage(chatId,
        `🎯 *Override مكافأة*\n\n` +
        `المهمة: *${escMd(db.getTaskText(task, 'name', 'ar'))}*\n` +
        `المكافأة الأصلية: \`${task?.reward}\`\n` +
        `Override الحالي: ${cur !== undefined ? `\`${cur}\`` : 'لا يوجد'}\n\n` +
        `أدخل المكافأة الجديدة أو أرسل "حذف" لإزالة الـ override:`,
        { parse_mode: 'Markdown', reply_markup: cancelKeyboard(`usr_override:${userId}`) }
      );
      return;
    }

    // ── تسليمات المستخدم ─────────────────────
    if (data.startsWith('usr_subs:')) {
      await bot.answerCallbackQuery(query.id);
      const userId = parseInt(data.split(':')[1]);
      sendUserSubs(bot, chatId, userId);
      return;
    }

    // ── إلغاء (أي session) ──────────────────
    if (data === 'usr_cancel') {
      await bot.answerCallbackQuery(query.id);
      clearSession(adminId);
      return;
    }
  });
}

module.exports = { register, clearSession };
