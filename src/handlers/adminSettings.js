'use strict';

const db        = require('../db');
const { escMd } = require('../utils/escMd');

// ─────────────────────────────────────────────
//  Session
// ─────────────────────────────────────────────
const sessions = {};
function setSession(id, data) { sessions[id] = data; }
function getSession(id)       { return sessions[id] || null; }
function clearSession(id)     { delete sessions[id]; }

// ─────────────────────────────────────────────
//  Labels
// ─────────────────────────────────────────────
const SETTING_LABELS = {
  minWithdrawal:   { label: 'حد أدنى السحب (EGP)',             type: 'number' },
  maxWithdrawal:   { label: 'حد أقصى السحب (EGP — 0=بلا حد)', type: 'number' },
  botEnabled:      { label: 'تفعيل البوت للمستخدمين',           type: 'bool'   },
  referralEnabled: { label: 'تفعيل الإحالة',                    type: 'bool'   },
  referralReward:  { label: 'مكافأة الإحالة (EGP)',              type: 'number' },
};

// ─────────────────────────────────────────────
//  Reply Keyboard الرئيسية للإعدادات
// ─────────────────────────────────────────────
function settingsReplyKeyboard() {
  return {
    keyboard: [
      [{ text: '⚙️ إعدادات النظام'  }, { text: '📨 إرسال رسالة'   }],
      [{ text: '🔙 رجوع'             }],
    ],
    resize_keyboard: true,
  };
}

// ─────────────────────────────────────────────
//  Inline Keyboard لقائمة الإعدادات
// ─────────────────────────────────────────────
function settingsInlineKeyboard() {
  const s = db.getSettings();
  const rows = Object.entries(SETTING_LABELS).map(([key, meta]) => {
    const val = s[key];
    let display;
    if (meta.type === 'bool')   display = val ? '✅' : '❌';
    else                        display = `${val}`;
    return [{ text: `${meta.label}: ${display}`, callback_data: `cfg_edit:${key}` }];
  });
  rows.push([{ text: '🔙 رجوع', callback_data: 'cfg_back' }]);
  return { inline_keyboard: rows };
}

// ─────────────────────────────────────────────
//  Display — قائمة الإعدادات
// ─────────────────────────────────────────────
function sendSettingsMenu(bot, chatId) {
  const s = db.getSettings();
  bot.sendMessage(chatId,
    `⚙️ *إعدادات النظام*\n━━━━━━━━━━━━━━━━━━\n` +
    `💳 حد أدنى السحب: \`${s.minWithdrawal} EGP\`\n` +
    `💳 حد أقصى السحب: \`${s.maxWithdrawal > 0 ? s.maxWithdrawal + ' EGP' : 'بلا حد'}\`\n` +
    `🤖 البوت: ${s.botEnabled ? '✅ مفعَّل' : '❌ معطَّل'}\n` +
    `👥 الإحالة: ${s.referralEnabled ? `✅ (${s.referralReward} EGP)` : '❌'}\n` +
    `━━━━━━━━━━━━━━━━━━\n_اضغط على أي إعداد لتعديله_`,
    { parse_mode: 'Markdown', reply_markup: settingsInlineKeyboard() }
  );
}

// ─────────────────────────────────────────────
//  Display — قائمة إرسال الرسائل
// ─────────────────────────────────────────────
function sendBroadcastMenu(bot, chatId) {
  bot.sendMessage(chatId,
    `📨 *إرسال رسالة*\n\nاختر المستلمين:`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📢 كل المستخدمين', callback_data: 'bcast_all'      }],
          [{ text: '🔍 مستخدم معين',   callback_data: 'bcast_one'      }],
          [{ text: '📋 مستخدمين معينين (IDs)', callback_data: 'bcast_list' }],
          [{ text: '🔙 رجوع',           callback_data: 'cfg_back'       }],
        ],
      },
    }
  );
}

// ─────────────────────────────────────────────
//  register
// ─────────────────────────────────────────────
function register(bot, isAdmin, mainKeyboard) {

  // زرار ⚙️ الإعدادات من الكيبورد الرئيسي
  bot.onText(/⚙️ الإعدادات/, (msg) => {
    if (!isAdmin(msg.from.id)) return;
    bot.sendMessage(msg.chat.id, '⚙️ *لوحة الإعدادات*', {
      parse_mode: 'Markdown',
      reply_markup: settingsReplyKeyboard(),
    });
  });

  // أزرار داخل لوحة الإعدادات (reply keyboard)
  bot.onText(/⚙️ إعدادات النظام/, (msg) => {
    if (!isAdmin(msg.from.id)) return;
    sendSettingsMenu(bot, msg.chat.id);
  });

  bot.onText(/📨 إرسال رسالة/, (msg) => {
    if (!isAdmin(msg.from.id)) return;
    sendBroadcastMenu(bot, msg.chat.id);
  });

  // زرار رجوع من لوحة الإعدادات — يرجع للكيبورد الرئيسي
  bot.onText(/^🔙 رجوع$/, (msg) => {
    if (!isAdmin(msg.from.id)) return;
    clearSession(msg.from.id);
    bot.sendMessage(msg.chat.id, '🏠 القائمة الرئيسية', {
      reply_markup: typeof mainKeyboard === 'function'
        ? mainKeyboard(msg.from.id)
        : mainKeyboard,
    });
  });

  // ── Message handler ──────────────────────────
  bot.on('message', async (msg) => {
    const adminId = msg.from.id;
    if (!isAdmin(adminId)) return;
    const session = getSession(adminId);
    if (!session) return;
    if (!msg.text || msg.text.startsWith('/')) return;
    if (msg.text === '❌ إلغاء') {
      clearSession(adminId);
      return bot.sendMessage(msg.chat.id, '❌ تم الإلغاء.', { reply_markup: settingsReplyKeyboard() });
    }

    // ── إعداد: انتظار قيمة جديدة ──
    if (session.type === 'setting') {
      const { key } = session;
      const meta = SETTING_LABELS[key];
      if (!meta) { clearSession(adminId); return; }

      let value;
      if (meta.type === 'number') {
        value = parseFloat(msg.text);
        if (isNaN(value) || value < 0)
          return bot.sendMessage(msg.chat.id, '⚠️ أدخل رقماً صحيحاً (0 أو أكبر).');
      } else {
        return; // bool يُعالج بالـ callback مباشرة
      }

      db.setSetting(key, value);
      clearSession(adminId);
      bot.sendMessage(msg.chat.id,
        `✅ تم تحديث *${escMd(meta.label)}* → \`${value}\``,
        { parse_mode: 'Markdown' }
      );
      sendSettingsMenu(bot, msg.chat.id);
      return;
    }

    // ── Broadcast: انتظار الرسالة ──
    if (session.type === 'broadcast_msg') {
      const { target, targetId, targetIds } = session;
      clearSession(adminId);
      const msgText = msg.text;

      let recipients = [];
      if (target === 'all') {
        recipients = db.listUsers().map(u => u.id);
      } else if (target === 'one') {
        recipients = [targetId];
      } else if (target === 'list') {
        recipients = targetIds;
      }

      bot.sendMessage(msg.chat.id, `⏳ جاري الإرسال لـ ${recipients.length} مستخدم...`);

      let sent = 0, failed = 0;
      for (const uid of recipients) {
        try {
          await bot.sendMessage(uid, msgText);
          sent++;
        } catch {
          failed++;
        }
        // throttle 25/ثانية
        if (sent % 25 === 0) await new Promise(r => setTimeout(r, 1100));
      }

      bot.sendMessage(msg.chat.id,
        `✅ تم الإرسال!\n\n` +
        `• ✅ وصل: *${sent}*\n` +
        `• ❌ فشل: *${failed}*`,
        { parse_mode: 'Markdown', reply_markup: settingsReplyKeyboard() }
      );
      return;
    }

    // ── Broadcast: انتظار معرف مستخدم واحد ──
    if (session.type === 'broadcast_one_id') {
      clearSession(adminId);
      const raw = msg.text.trim().replace(/^@/, '');
      // ابحث بالـ username أو الـ ID
      let user = isNaN(raw)
        ? db.findUserByUsername(raw)
        : db.findUserByUid(parseInt(raw)) || db.getUser(parseInt(raw));

      if (!user || !user.id) {
        return bot.sendMessage(msg.chat.id, '⚠️ المستخدم غير موجود.');
      }

      setSession(adminId, { type: 'broadcast_msg', target: 'one', targetId: user.id });
      bot.sendMessage(msg.chat.id,
        `✅ تم اختيار: *${escMd(user.username || user.firstName || String(user.id))}*\n\nأرسل الرسالة الآن:`,
        {
          parse_mode: 'Markdown',
          reply_markup: { keyboard: [[{ text: '❌ إلغاء' }]], resize_keyboard: true, one_time_keyboard: true },
        }
      );
      return;
    }

    // ── Broadcast: انتظار قائمة IDs ──
    if (session.type === 'broadcast_list_ids') {
      clearSession(adminId);
      const lines = msg.text.split(/[\n,\s]+/).map(s => s.trim()).filter(Boolean);
      const ids   = [];
      for (const line of lines) {
        const raw  = line.replace(/^@/, '');
        const user = isNaN(raw)
          ? db.findUserByUsername(raw)
          : db.findUserByUid(parseInt(raw)) || (db.getUser(parseInt(raw)));
        if (user?.id) ids.push(user.id);
      }
      if (!ids.length) {
        return bot.sendMessage(msg.chat.id, '⚠️ لم يتم إيجاد أي مستخدم. أعد المحاولة.');
      }
      setSession(adminId, { type: 'broadcast_msg', target: 'list', targetIds: ids });
      bot.sendMessage(msg.chat.id,
        `✅ تم إيجاد *${ids.length}* مستخدم.\n\nأرسل الرسالة الآن:`,
        {
          parse_mode: 'Markdown',
          reply_markup: { keyboard: [[{ text: '❌ إلغاء' }]], resize_keyboard: true, one_time_keyboard: true },
        }
      );
      return;
    }
  });

  // ── Callback handler ─────────────────────────
  bot.on('callback_query', async (query) => {
    if (query._blocked) return;
    const data    = query.data;
    const adminId = query.from.id;
    const chatId  = query.message.chat.id;
    const msgId   = query.message.message_id;

    if (!isAdmin(adminId)) return;

    if (data === 'cfg_menu') {
      await bot.answerCallbackQuery(query.id);
      sendSettingsMenu(bot, chatId);
      return;
    }

    if (data === 'cfg_back') {
      await bot.answerCallbackQuery(query.id);
      clearSession(adminId);
      return;
    }

    // تعديل إعداد
    if (data.startsWith('cfg_edit:')) {
      await bot.answerCallbackQuery(query.id);
      const key  = data.split(':')[1];
      const meta = SETTING_LABELS[key];
      if (!meta) return;

      const cur = db.getSetting(key);

      if (meta.type === 'bool') {
        // toggle فوري
        db.setSetting(key, !cur);
        bot.sendMessage(chatId,
          `✅ *${escMd(meta.label)}* الآن: ${!cur ? '✅ مفعَّل' : '❌ معطَّل'}`,
          { parse_mode: 'Markdown' }
        );
        bot.editMessageReplyMarkup(settingsInlineKeyboard(), {
          chat_id: chatId, message_id: msgId,
        }).catch(() => {});
        return;
      }

      // رقم → نطلب قيمة جديدة
      setSession(adminId, { type: 'setting', key });
      bot.sendMessage(chatId,
        `✏️ *${escMd(meta.label)}*\n\nالحالي: \`${cur}\`\nأدخل القيمة الجديدة:`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            keyboard: [[{ text: '❌ إلغاء' }]],
            resize_keyboard: true, one_time_keyboard: true,
          },
        }
      );
      return;
    }

    // ── Broadcast callbacks ───────────────────
    if (data === 'bcast_all') {
      await bot.answerCallbackQuery(query.id);
      const count = db.listUsers().length;
      setSession(adminId, { type: 'broadcast_msg', target: 'all' });
      bot.sendMessage(chatId,
        `📢 إرسال لـ *${count}* مستخدم\n\nأرسل الرسالة الآن:`,
        {
          parse_mode: 'Markdown',
          reply_markup: { keyboard: [[{ text: '❌ إلغاء' }]], resize_keyboard: true, one_time_keyboard: true },
        }
      );
      return;
    }

    if (data === 'bcast_one') {
      await bot.answerCallbackQuery(query.id);
      setSession(adminId, { type: 'broadcast_one_id' });
      bot.sendMessage(chatId,
        `🔍 أرسل *يوزر* المستخدم أو *ID* الرقمي أو *UID* الداخلي:`,
        {
          parse_mode: 'Markdown',
          reply_markup: { keyboard: [[{ text: '❌ إلغاء' }]], resize_keyboard: true, one_time_keyboard: true },
        }
      );
      return;
    }

    if (data === 'bcast_list') {
      await bot.answerCallbackQuery(query.id);
      setSession(adminId, { type: 'broadcast_list_ids' });
      bot.sendMessage(chatId,
        `📋 أرسل قائمة IDs أو يوزرات (كل واحد في سطر أو بفاصلة):`,
        {
          parse_mode: 'Markdown',
          reply_markup: { keyboard: [[{ text: '❌ إلغاء' }]], resize_keyboard: true, one_time_keyboard: true },
        }
      );
      return;
    }
  });
}

module.exports = { register, sendSettingsMenu };
