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
  referralReward:  { label: 'مكافأة الإحالة عند التسجيل (EGP)', type: 'number' },
  referralPerSub:  { label: 'مكافأة الإحالة لكل تسليم مقبول (EGP)', type: 'number' },
  supportEnabled:  { label: 'تفعيل زرار الدعم',                 type: 'bool'   },
  joinEnabled:     { label: 'اشتراك إجباري في القناة',           type: 'bool'   },
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
  // زرار مخصص لإعدادات القناة وزرار تعديل نص الدعم
  rows.push([{ text: '💬 تعديل نص الدعم', callback_data: 'cfg_support_text' }]);
  rows.push([{ text: '📢 إعداد قناة الاشتراك الإجباري', callback_data: 'cfg_join_menu' }]);
  rows.push([{ text: '🔙 رجوع', callback_data: 'cfg_back' }]);
  return { inline_keyboard: rows };
}

// ─────────────────────────────────────────────
//  Display — قائمة إعداد القناة الإجبارية
// ─────────────────────────────────────────────
function sendJoinSettingsMenu(bot, chatId) {
  const s = db.getSettings();
  const status    = s.joinEnabled ? '✅ مفعَّل' : '❌ معطَّل';
  const channelId = s.joinChannelId   || '_(غير محدد)_';
  const label     = s.joinChannelLabel || '_(غير محدد)_';
  const url       = s.joinChannelUrl   || '_(غير محدد)_';

  bot.sendMessage(chatId,
    `🔒 *إعداد الاشتراك الإجباري*\n━━━━━━━━━━━━━━━━━━\n` +
    `الحالة: ${status}\n` +
    `معرف القناة: \`${escMd(channelId)}\`\n` +
    `اسم القناة: ${escMd(label)}\n` +
    `رابط القناة: ${escMd(url)}\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `⚠️ _تأكد أن البوت مضاف كأدمن في القناة/المجموعة_`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: s.joinEnabled ? '🔴 تعطيل الاشتراك الإجباري' : '🟢 تفعيل الاشتراك الإجباري',
             callback_data: 'cfg_join_toggle' }],
          [{ text: '📢 تغيير معرف القناة (@username أو -100xxxx)',  callback_data: 'cfg_join_id'    }],
          [{ text: '✏️ تغيير اسم القناة (للعرض)',                   callback_data: 'cfg_join_label' }],
          [{ text: '🔗 تغيير رابط القناة',                         callback_data: 'cfg_join_url'   }],
          [{ text: '🔙 رجوع للإعدادات', callback_data: 'cfg_menu' }],
        ],
      },
    }
  );
}

// ─────────────────────────────────────────────
//  Display — قائمة الإعدادات
// ─────────────────────────────────────────────
function sendSettingsMenu(bot, chatId) {
  const s = db.getSettings();
  const joinStatus = s.joinEnabled
    ? `✅ مفعَّل — ${s.joinChannelLabel || s.joinChannelId || '(غير محدد)'}`
    : '❌ معطَّل';
  const refStatus = s.referralEnabled
    ? `✅ (تسجيل: ${s.referralReward} EGP | تسليم: ${s.referralPerSub} EGP)`
    : '❌ معطَّل';
  bot.sendMessage(chatId,
    `⚙️ *إعدادات النظام*\n━━━━━━━━━━━━━━━━━━\n` +
    `💳 حد أدنى السحب: \`${s.minWithdrawal} EGP\`\n` +
    `💳 حد أقصى السحب: \`${s.maxWithdrawal > 0 ? s.maxWithdrawal + ' EGP' : 'بلا حد'}\`\n` +
    `🤖 البوت: ${s.botEnabled ? '✅ مفعَّل' : '❌ معطَّل'}\n` +
    `👥 الإحالة: ${refStatus}\n` +
    `💬 الدعم: ${s.supportEnabled ? '✅ مفعَّل' : '❌ معطَّل'}\n` +
    `🔒 اشتراك إجباري: ${joinStatus}\n` +
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
  // فقط لو الأدمن في session إعدادات أو مفيش session إعدادات
  bot.onText(/^🔙 رجوع$/, (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const session = getSession(msg.from.id);
    // لو في session لغير الإعدادات → اتركها للـ handler المسؤول (adminTasks)
    if (session && session.type !== 'setting' && session.type !== 'broadcast_msg'
        && session.type !== 'broadcast_one_id' && session.type !== 'broadcast_list_ids'
        && session.type !== 'join_setting' && session.type !== 'support_text') return;
    // لو adminTasks عنده session نشط بأي flow غير task_list → تجاهل (يعالجه adminTasks)
    const adminTasksSession = require('./adminTasks').getSession(msg.from.id);
    if (adminTasksSession && adminTasksSession.flow !== 'task_list') return;
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

    // ── نص الدعم: انتظار النص الجديد ──
    if (session.type === 'support_text') {
      clearSession(adminId);
      const value = msg.text.trim();
      db.setSetting('supportText', value);
      bot.sendMessage(msg.chat.id,
        `✅ تم تحديث نص الدعم.\n\n*معاينة:*\n${value}`,
        { parse_mode: 'Markdown' }
      );
      sendSettingsMenu(bot, msg.chat.id);
      return;
    }

    // ── إعداد القناة: انتظار قيمة جديدة ──
    if (session.type === 'join_setting') {
      const { key } = session;
      clearSession(adminId);
      const value = msg.text.trim();
      db.setSetting(key, value);
      const labels = {
        joinChannelId:    'معرف القناة',
        joinChannelLabel: 'اسم القناة',
        joinChannelUrl:   'رابط القناة',
      };
      bot.sendMessage(msg.chat.id,
        `✅ تم تحديث *${labels[key] || key}* → \`${escMd(value)}\``,
        { parse_mode: 'Markdown' }
      );
      sendJoinSettingsMenu(bot, msg.chat.id);
      return;
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
        if (sent > 0 && sent % 25 === 0) await new Promise(r => setTimeout(r, 1100));
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
      // رجوع للقائمة الرئيسية للأدمن
      bot.sendMessage(chatId, '🏠 القائمة الرئيسية', {
        reply_markup: mainKeyboard(adminId),
      });
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

    // ── تعديل نص الدعم ──────────────────────
    if (data === 'cfg_support_text') {
      await bot.answerCallbackQuery(query.id);
      const cur = db.getSetting('supportText') || '(فارغ)';
      setSession(adminId, { type: 'support_text' });
      bot.sendMessage(chatId,
        `💬 *نص الدعم*\n\nالحالي:\n${escMd(cur)}\n\nأرسل النص الجديد (يدعم Markdown):\n_مثال: للتواصل مع الدعم: @username_`,
        {
          parse_mode: 'Markdown',
          reply_markup: { keyboard: [[{ text: '❌ إلغاء' }]], resize_keyboard: true, one_time_keyboard: true },
        }
      );
      return;
    }

    // ── إعداد القناة الإجبارية ───────────────
    if (data === 'cfg_join_menu') {
      await bot.answerCallbackQuery(query.id);
      sendJoinSettingsMenu(bot, chatId);
      return;
    }

    if (data === 'cfg_join_toggle') {
      await bot.answerCallbackQuery(query.id);
      const cur = db.getSetting('joinEnabled');
      db.setSetting('joinEnabled', !cur);
      bot.sendMessage(chatId,
        `🔒 الاشتراك الإجباري الآن: ${!cur ? '✅ مفعَّل' : '❌ معطَّل'}`,
        { parse_mode: 'Markdown' }
      );
      sendJoinSettingsMenu(bot, chatId);
      return;
    }

    if (data === 'cfg_join_id') {
      await bot.answerCallbackQuery(query.id);
      const cur = db.getSetting('joinChannelId') || '(فارغ)';
      setSession(adminId, { type: 'join_setting', key: 'joinChannelId' });
      bot.sendMessage(chatId,
        `📢 *معرف القناة/المجموعة*\n\nالحالي: \`${escMd(cur)}\`\n\n` +
        `أرسل المعرف الجديد:\n` +
        `• مثال قناة عامة: \`@MediaBuyer_Group\`\n` +
        `• مثال مجموعة خاصة: \`-1001234567890\`\n\n` +
        `⚠️ _تأكد أن البوت مضاف كأدمن_`,
        {
          parse_mode: 'Markdown',
          reply_markup: { keyboard: [[{ text: '❌ إلغاء' }]], resize_keyboard: true, one_time_keyboard: true },
        }
      );
      return;
    }

    if (data === 'cfg_join_label') {
      await bot.answerCallbackQuery(query.id);
      const cur = db.getSetting('joinChannelLabel') || '(فارغ)';
      setSession(adminId, { type: 'join_setting', key: 'joinChannelLabel' });
      bot.sendMessage(chatId,
        `✏️ *اسم القناة للعرض*\n\nالحالي: \`${escMd(cur)}\`\n\nأرسل الاسم الجديد:`,
        {
          parse_mode: 'Markdown',
          reply_markup: { keyboard: [[{ text: '❌ إلغاء' }]], resize_keyboard: true, one_time_keyboard: true },
        }
      );
      return;
    }

    if (data === 'cfg_join_url') {
      await bot.answerCallbackQuery(query.id);
      const cur = db.getSetting('joinChannelUrl') || '(فارغ)';
      setSession(adminId, { type: 'join_setting', key: 'joinChannelUrl' });
      bot.sendMessage(chatId,
        `🔗 *رابط القناة/المجموعة*\n\nالحالي: \`${escMd(cur)}\`\n\n` +
        `أرسل الرابط الجديد:\n• مثال: \`https://t.me/MediaBuyer_Group\``,
        {
          parse_mode: 'Markdown',
          reply_markup: { keyboard: [[{ text: '❌ إلغاء' }]], resize_keyboard: true, one_time_keyboard: true },
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
