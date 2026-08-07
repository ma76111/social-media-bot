'use strict';

/**
 * adminAdmins.js — إدارة الأدمنز
 * الأدمن الرئيسي فقط يقدر يضيف/يحذف
 * باقي الأدمنز يشوفوا القائمة بس
 */

const db = require('../db');
const { escMd } = require('../utils/escMd');

// ─────────────────────────────────────────────
//  Session
// ─────────────────────────────────────────────
const sessions = {};
function setSession(id, flow, step, data = {}) { sessions[id] = { flow, step, data }; }
function getSession(id) { return sessions[id] || null; }
function clearSession(id) { delete sessions[id]; }

// ─────────────────────────────────────────────
//  Keyboards
// ─────────────────────────────────────────────
function adminsMenuKeyboard(isSuperAdmin) {
  const rows = [
    [{ text: '👥 عرض الأدمنز', callback_data: 'admins_list' }],
  ];
  if (isSuperAdmin) {
    rows.push([
      { text: '➕ إضافة أدمن', callback_data: 'admins_add' },
    ]);
  }
  return { inline_keyboard: rows };
}

function adminListKeyboard(extras, isSuperAdmin) {
  const rows = extras.map(a => {
    const user = db.getUser(a.id);
    const label = user?.username
      ? `@${user.username}`
      : user?.firstName || `ID: ${a.id}`;
    const row = [{ text: `👤 ${label}`, callback_data: `admins_view:${a.id}` }];
    if (isSuperAdmin) {
      row.push({ text: '🗑 حذف', callback_data: `admins_remove:${a.id}` });
    }
    return row;
  });
  rows.push([{ text: '🔙 رجوع', callback_data: 'admins_back' }]);
  return { inline_keyboard: rows };
}

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────
function buildListText(mainAdminIds, extras) {
  let text = `👮 *إدارة الأدمنز*\n\n`;
  text += `🔑 *الأدمن الرئيسي (من .env):*\n`;
  for (const id of mainAdminIds) {
    const user = db.getUser(id);
    const name = user?.username ? `@${escMd(user.username)}` : escMd(user?.firstName || String(id));
    text += `  • ${name} (\`${id}\`)\n`;
  }

  text += `\n👥 *الأدمنز الإضافيون (${extras.length}):*\n`;
  if (!extras.length) {
    text += `  _لا يوجد أدمنز إضافيون_\n`;
  } else {
    for (const a of extras) {
      const user = db.getUser(a.id);
      const name = user?.username ? `@${escMd(user.username)}` : escMd(user?.firstName || String(a.id));
      text += `  • ${name} (\`${a.id}\`) — أُضيف: ${a.addedAt}\n`;
    }
  }
  return text;
}

// ─────────────────────────────────────────────
//  register
// ─────────────────────────────────────────────
function register(bot, isAdmin, isSuperAdmin, mainAdminIds) {

  // ── زرار القائمة الرئيسية ─────────────────
  bot.onText(/👮 إدارة الأدمنز/, (msg) => {
    if (!isAdmin(msg.from.id)) return;
    sendAdminsMenu(bot, msg.chat.id, msg.from.id, mainAdminIds);
  });

  // ── استقبال النصوص (إضافة أدمن) ──────────
  bot.on('message', async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const session = getSession(msg.from.id);
    if (!session) return;
    if (!msg.text || msg.text.startsWith('/')) return;

    if (session.flow === 'add_admin' && session.step === 'waiting_id') {
      const input = msg.text.trim();
      const userId = parseInt(input);

      if (isNaN(userId)) {
        return bot.sendMessage(msg.chat.id, '⚠️ أرسل معرف تيليجرام رقمي صحيح.');
      }
      if (mainAdminIds.includes(userId)) {
        clearSession(msg.from.id);
        return bot.sendMessage(msg.chat.id, '⚠️ هذا المستخدم أدمن رئيسي بالفعل.');
      }

      const added = db.addExtraAdmin(userId);
      clearSession(msg.from.id);

      if (!added) {
        return bot.sendMessage(msg.chat.id, '⚠️ هذا المستخدم مضاف كأدمن مسبقاً.');
      }

      // أضفه للقائمة الحية في index.js
      bot._onAdminAdded?.(userId);

      const user = db.getUser(userId);
      const name = user?.username ? `@${user.username}` : (user?.firstName || String(userId));
      bot.sendMessage(msg.chat.id,
        `✅ تم إضافة *${escMd(name)}* (\`${userId}\`) كأدمن.`,
        { parse_mode: 'Markdown' }
      );
      sendAdminsMenu(bot, msg.chat.id, msg.from.id, mainAdminIds);
    }
  });

  // ── Callbacks ─────────────────────────────
  bot.on('callback_query', async (query) => {
    if (query._blocked) return;
    const data   = query.data;
    const userId = query.from.id;
    const chatId = query.message.chat.id;

    if (!isAdmin(userId)) return;

    if (data === 'admins_list' || data === 'admins_back') {
      await bot.answerCallbackQuery(query.id);
      sendAdminsMenu(bot, chatId, userId, mainAdminIds);
      return;
    }

    if (data === 'admins_add') {
      if (!isSuperAdmin(userId)) {
        return bot.answerCallbackQuery(query.id, { text: '⛔ للأدمن الرئيسي فقط.', show_alert: true });
      }
      await bot.answerCallbackQuery(query.id);
      setSession(userId, 'add_admin', 'waiting_id', {});
      bot.sendMessage(chatId,
        `➕ *إضافة أدمن جديد*\n\nأرسل *معرف تيليجرام* (ID) للمستخدم الذي تريد تعيينه أدمناً:\n\n💡 المستخدم يقدر يعرف معرفه بإرسال /start للبوت أو من @userinfobot`,
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'admins_back' }]] },
        }
      );
      return;
    }

    if (data.startsWith('admins_remove:')) {
      if (!isSuperAdmin(userId)) {
        return bot.answerCallbackQuery(query.id, { text: '⛔ للأدمن الرئيسي فقط.', show_alert: true });
      }
      await bot.answerCallbackQuery(query.id);
      const targetId = parseInt(data.split(':')[1]);

      // تأكيد الحذف
      const user = db.getUser(targetId);
      const name = user?.username ? `@${escMd(user.username)}` : escMd(user?.firstName || String(targetId));
      bot.sendMessage(chatId,
        `⚠️ هل تريد حذف *${name}* (\`${targetId}\`) من الأدمنز؟`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ نعم، احذف', callback_data: `admins_confirm_remove:${targetId}` },
              { text: '❌ لا',        callback_data: 'admins_back' },
            ]],
          },
        }
      );
      return;
    }

    if (data.startsWith('admins_confirm_remove:')) {
      if (!isSuperAdmin(userId)) {
        return bot.answerCallbackQuery(query.id, { text: '⛔ للأدمن الرئيسي فقط.', show_alert: true });
      }
      await bot.answerCallbackQuery(query.id);
      const targetId = parseInt(data.split(':')[1]);
      const removed  = db.removeExtraAdmin(targetId);

      // أزله من القائمة الحية
      bot._onAdminRemoved?.(targetId);

      if (removed) {
        bot.sendMessage(chatId, `✅ تم حذف الأدمن \`${targetId}\` بنجاح.`, { parse_mode: 'Markdown' });
      } else {
        bot.sendMessage(chatId, `⚠️ لم يتم إيجاد الأدمن.`);
      }
      sendAdminsMenu(bot, chatId, userId, mainAdminIds);
      return;
    }

    if (data.startsWith('admins_view:')) {
      await bot.answerCallbackQuery(query.id);
      const targetId = parseInt(data.split(':')[1]);
      const user     = db.getUser(targetId);
      const name     = user?.username ? `@${escMd(user.username)}` : escMd(user?.firstName || String(targetId));
      const extra    = db.getExtraAdmins().find(a => a.id === targetId);
      bot.sendMessage(chatId,
        `👤 *تفاصيل الأدمن*\n\n` +
        `• الاسم: ${name}\n` +
        `• الـ ID: \`${targetId}\`\n` +
        `• أُضيف: ${extra?.addedAt || '—'}`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              isSuperAdmin(userId)
                ? [{ text: '🗑 حذف من الأدمنز', callback_data: `admins_remove:${targetId}` }]
                : [],
              [{ text: '🔙 رجوع', callback_data: 'admins_list' }],
            ].filter(r => r.length),
          },
        }
      );
      return;
    }
  });
}

// ─────────────────────────────────────────────
//  sendAdminsMenu
// ─────────────────────────────────────────────
function sendAdminsMenu(bot, chatId, userId, mainAdminIds) {
  const isSuperAdmin = mainAdminIds.includes(userId);
  const extras = db.getExtraAdmins();
  const text   = buildListText(mainAdminIds, extras);

  bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: extras.length
      ? adminListKeyboard(extras, isSuperAdmin)
      : adminsMenuKeyboard(isSuperAdmin),
  });
}

module.exports = { register, clearSession };
