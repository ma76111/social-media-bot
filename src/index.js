'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const TelegramBot = require('node-telegram-bot-api');

const db              = require('./db');
const userHandler     = require('./handlers/user');
const adminTasksH     = require('./handlers/adminTasks');
const adminSubsH      = require('./handlers/adminSubmissions');
const withdrawHandler = require('./handlers/withdraw');
const onboarding      = require('./handlers/onboarding');
const adminUsersH     = require('./handlers/adminUsers');
const featuresHandler = require('./handlers/features');
const adminAdminsH    = require('./handlers/adminAdmins');
const adminSettingsH  = require('./handlers/adminSettings');
const rateLimiter     = require('./utils/rateLimiter');
const { startAutoRefresh, getUsdtEgpRate, getCachedRate } = require('./utils/price');
const { escMd } = require('./utils/escMd');

// ─────────────────────────────────────────────
//  Validation
// ─────────────────────────────────────────────
const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN || TOKEN === 'YOUR_BOT_TOKEN_HERE') {
  console.error('❌ ضع توكن البوت في .env  (BOT_TOKEN=...)');
  process.exit(1);
}

// الأدمن الرئيسيون من .env (ثابتون)
const MAIN_ADMIN_IDS = (process.env.ADMIN_IDS || '')
  .split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));

if (!MAIN_ADMIN_IDS.length) console.warn('⚠️ لم يتم تحديد ADMIN_IDS في .env');

// القائمة الحية = الرئيسيون + الإضافيون المحفوظون في DB
let ADMIN_IDS = [...MAIN_ADMIN_IDS, ...db.getExtraAdmins().map(a => a.id)];

// ─────────────────────────────────────────────
//  Bot
// ─────────────────────────────────────────────
const bot = new TelegramBot(TOKEN, { polling: true });

// ── جلب سعر USDT/EGP تلقائياً كل 5 دقائق ─────────────────
startAutoRefresh();

// ── callbacks لتحديث قائمة الأدمنز الحية ──────────────────
bot._onAdminAdded   = (id) => { if (!ADMIN_IDS.includes(id)) ADMIN_IDS.push(id); };
bot._onAdminRemoved = (id) => { ADMIN_IDS = ADMIN_IDS.filter(a => a !== id); };

function isAdmin(userId)       { return ADMIN_IDS.includes(userId); }
function isSuperAdmin(userId)  { return MAIN_ADMIN_IDS.includes(userId); }

// ─────────────────────────────────────────────
//  Callback Idempotency Gate
//
//  المشكلة: لما المستخدم يضغط الزرار ويعلق
//  (بطء نت / retry) يضغط تاني مرة → طلبان
//  معاً → رصيد يتخصم مرتين أو سحب مكرر.
//
//  الحل: نحفظ (userId:callbackData) كـ lock
//  لمدة CB_GATE_TTL ms — أي query جديد بنفس
//  البيانات يُرد عليه فوراً ويُعلَّم blocked.
//  كل handler يفحص query._blocked في أول سطر.
//
//  يُسجَّل أولاً قبل كل handlers.
// ─────────────────────────────────────────────
const _cbGate    = new Map();   // `${userId}:${data}` → timestamp
const CB_GATE_TTL = 8000;       // 8 ثواني

// النوافل اللي مش محتاجة lock (navigation بحتة)
const CB_NAV_PREFIXES = [
  'pending_page:', 'subs_show:',  'usrs_list:',  'usrs_page:',
  'adm_tasks_list','wda_menu',    'wda_list:',   'wda_detail:',
  'adm_task:',     'adm_fields:', 'feat_list:',  'feat_detail:',
  'subs_list:',    'usr_view:',   'adm_refresh_rate',
  'task_cancel_detail',
  'adm_alt:',
  'cfg_menu',      'cfg_back',    'cfg_edit:',
  'cfg_join_menu', 'cfg_join_toggle', 'cfg_join_id', 'cfg_join_label', 'cfg_join_url',
  'cfg_support_text',
  'adm_preview:',  'adm_preview_lang:',
  // Admin management navigation — لا تحتاج lock
  'admins_list',   'admins_back', 'admins_view:',
  // اشتراك إجباري — navigation بحتة
  'join_check',
];

function _isNavCb(data) {
  return CB_NAV_PREFIXES.some(p => data === p || data.startsWith(p));
}

// تنظيف دوري للـ locks المنتهية
setInterval(() => {
  const now = Date.now();
  for (const [k, ts] of _cbGate.entries())
    if (now - ts > CB_GATE_TTL) _cbGate.delete(k);
}, 60_000);

// Gate handler — يجب أن يكون أول شيء مسجَّل
bot.on('callback_query', (query) => {
  const data   = query.data || '';
  const userId = query.from.id;

  if (_isNavCb(data)) return;   // navigation — لا lock

  const key  = `${userId}:${data}`;
  const now  = Date.now();
  const last = _cbGate.get(key);

  if (last && now - last < CB_GATE_TTL) {
    // ضغطة مكررة: أجب بهدوء وعلِّم الـ query
    bot.answerCallbackQuery(query.id).catch(() => {});
    query._blocked = true;
    return;
  }

  _cbGate.set(key, now);
  // لا نحرر الـ lock هنا — يُحرَّر بعد CB_GATE_TTL تلقائياً
  // (عشان أي retry في خلال هذه المدة يُتجاهل)
});

// ─────────────────────────────────────────────
//  Admin keyboard
// ─────────────────────────────────────────────
function adminMenuKeyboard(userId) {
  const base = [
    [{ text: '📋 إدارة المهام' }, { text: '➕ مهمة جديدة'  }],
    [{ text: '📊 إحصائيات'    }, { text: '📤 طلبات السحب' }],
    [{ text: '👥 المستخدمون'  }, { text: '💱 سعر الصرف'   }],
    [{ text: '⚙️ الإعدادات'   }],
  ];
  if (isSuperAdmin(userId)) {
    base.push([{ text: '👮 إدارة الأدمنز' }]);
  }
  return { reply_markup: { keyboard: base, resize_keyboard: true } };
}

const ADMIN_ONLY_TEXTS = [
  '📋 إدارة المهام', '➕ مهمة جديدة',
  '📊 إحصائيات',     '📤 طلبات السحب',
  '👥 المستخدمون',   '💱 سعر الصرف',
  '⚙️ الإعدادات',
  '⚙️ إعدادات النظام', '📨 إرسال رسالة',
  '👮 إدارة الأدمنز',
];

// ─────────────────────────────────────────────
//  /start
// ─────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  if (isAdmin(msg.from.id)) {
    return bot.sendMessage(
      msg.chat.id,
      `👨‍💼 *أهلاً ${escMd(msg.from.first_name)}!*\n\nأنت مسجل كأدمن.`,
      { parse_mode: 'Markdown', ...adminMenuKeyboard(msg.from.id) }
    );
  }
  // المستخدم العادي — تعالَج بعد register
});

// ─────────────────────────────────────────────
//  Rate Limiter + حماية أزرار الأدمن
// ─────────────────────────────────────────────
bot.on('message', (msg) => {
  if (!msg.from) return;

  // حماية أزرار الأدمن (للجميع)
  if (msg.text && ADMIN_ONLY_TEXTS.includes(msg.text) && !isAdmin(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, '⛔ هذا القسم للأدمن فقط.');
  }

  // Rate limiter — الأدمن مستثنى
  if (!isAdmin(msg.from.id) && !rateLimiter.check(msg.from.id)) {
    if (rateLimiter.isFirstBlock(msg.from.id)) {
      bot.sendMessage(
        msg.chat.id,
        '⏳ أرسلت رسائل كثيرة بسرعة، انتظر لحظة ثم حاول مجدداً.'
      ).catch(() => {});
    }
  }
});

// ─────────────────────────────────────────────
//  حماية Callbacks (أدمن فقط + handleCallbackExtras)
// ─────────────────────────────────────────────
bot.on('callback_query', async (query) => {
  if (query._blocked) return;   // ← Gate حجبها

  const data    = query.data || '';
  const userId  = query.from.id;

  const isAdminCb = /^(adm_|bulk_|subs_|sub_|sel_|selective_|wda_|usr_|usrs_)/.test(data);
  if (isAdminCb && !isAdmin(userId)) {
    return bot.answerCallbackQuery(query.id, {
      text: '⛔ هذا الإجراء للأدمن فقط.',
      show_alert: true,
    });
  }

  if (isAdmin(userId)) {
    // زرار تحديث سعر الصرف
    if (data === 'adm_refresh_rate') {
      await bot.answerCallbackQuery(query.id, { text: '⏳ جاري الجلب...' });
      try {
        const rate = await getUsdtEgpRate();
        const now  = new Date().toLocaleTimeString('ar-EG', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit' });
        bot.editMessageText(
          `💱 *سعر الصرف الحالي*\n\n` +
          `1 USDT = *${rate} EGP*\n` +
          `🕐 _آخر تحديث: ${now} (Cairo)_`,
          {
            chat_id:    query.message.chat.id,
            message_id: query.message.message_id,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                { text: '🔄 تحديث الآن', callback_data: 'adm_refresh_rate' },
              ]],
            },
          }
        ).catch(() => {});
      } catch {
        bot.answerCallbackQuery(query.id, { text: '❌ فشل جلب السعر.', show_alert: true });
      }
      return;
    }

    const handled = adminTasksH.handleCallbackExtras(bot, query);
    if (handled) return;
  }
});

// ─────────────────────────────────────────────
//  💱 سعر الصرف — زرار الأدمن
// ─────────────────────────────────────────────
bot.onText(/💱 سعر الصرف/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;

  // رسالة مؤقتة أثناء الجلب
  const loadingMsg = await bot.sendMessage(msg.chat.id, '⏳ جاري جلب السعر...');

  try {
    const rate = await getUsdtEgpRate();
    const now  = new Date().toLocaleTimeString('ar-EG', {
      timeZone: 'Africa/Cairo',
      hour: '2-digit', minute: '2-digit',
    });

    bot.editMessageText(
      `💱 *سعر الصرف الحالي*\n\n` +
      `1 USDT = *${rate} EGP*\n` +
      `🕐 _آخر تحديث: ${now} (Cairo)_`,
      {
        chat_id:    msg.chat.id,
        message_id: loadingMsg.message_id,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '🔄 تحديث الآن', callback_data: 'adm_refresh_rate' },
          ]],
        },
      }
    ).catch(() => {});
  } catch {
    bot.editMessageText('❌ فشل جلب السعر، حاول مرة أخرى.', {
      chat_id:    msg.chat.id,
      message_id: loadingMsg.message_id,
    }).catch(() => {});
  }
});

// ─────────────────────────────────────────────
//  /cancel — إلغاء أي session جارية
// ─────────────────────────────────────────────
bot.onText(/\/cancel/, (msg) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;

  // نظّف sessions من كل الـ handlers
  userHandler.clearSession(userId);
  adminTasksH.clearSession(userId);
  adminSubsH.clearSession(userId);
  adminAdminsH.clearSession(userId);
  adminUsersH.clearSession(userId);

  bot.sendMessage(chatId,
    isAdmin(userId)
      ? '✅ تم إلغاء العملية الجارية.'
      : '✅ تم إلغاء التسليم.',
    { reply_markup: { remove_keyboard: true } }
  );
});

// ─────────────────────────────────────────────
//  Register handlers  (الترتيب مهم)
// ─────────────────────────────────────────────

// جلب username البوت مرة واحدة قبل أي شيء
bot.getMe().then(me => {
  userHandler.setBotUsername(me.username || '');
}).catch(() => {});

userHandler.register(bot, ADMIN_IDS);
adminTasksH.register(bot, isAdmin);
adminSubsH.register(bot, isAdmin);
withdrawHandler.register(bot, isAdmin, ADMIN_IDS);
adminUsersH.register(bot, isAdmin);
featuresHandler.register(bot, isAdmin);
adminAdminsH.register(bot, isAdmin, isSuperAdmin, MAIN_ADMIN_IDS);
adminSettingsH.register(bot, isAdmin, (uid) => adminMenuKeyboard(uid).reply_markup);

// onboarding — يمرر sendHome كـ callback بعد اكتمال الإعداد
onboarding.register(bot, (bot_, chatId, userId, firstName) => {
  userHandler.sendHome(bot_, chatId, userId, firstName);
});

// /start للمستخدم العادي
bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
  if (isAdmin(msg.from.id)) return;

  // فحص الصيانة
  const botEnabled = db.getSetting('botEnabled');
  if (!botEnabled) {
    const mainMsg = db.getSetting('maintenanceMsg');
    return bot.sendMessage(msg.chat.id,
      mainMsg || '🔧 البوت في وضع الصيانة حالياً، يرجى المحاولة لاحقاً.'
    );
  }

  const isNewUser = !db.getUser(msg.from.id).lang;

  // حفظ بيانات المستخدم
  db.updateUserMeta(msg.from.id, {
    username:  msg.from.username  || null,
    firstName: msg.from.first_name || null,
  });

  // ── تتبع الإحالة — يعمل فقط للمستخدمين الجدد ──
  const param = (match && match[1]) ? match[1].trim() : '';
  if (param.startsWith('ref_') && isNewUser) {
    const referrerId = parseInt(param.slice(4));
    if (!isNaN(referrerId) && referrerId !== msg.from.id) {
      const wasNew = db.setReferredBy(msg.from.id, referrerId);
      // مكافأة التسجيل الفورية (لو مفعَّلة)
      if (wasNew) {
        const s = db.getSettings();
        if (s.referralEnabled && s.referralReward > 0) {
          db.addBalance(referrerId, s.referralReward);
          // إشعار المُحيل
          bot.sendMessage(referrerId,
            `🎉 *مبروك!* أحد أصدقائك انضم عبر رابط إحالتك!\n💰 حصلت على مكافأة \`${s.referralReward} EGP\``,
            { parse_mode: 'Markdown' }
          ).catch(() => {});
        }
      }
    }
  }

  const user = db.getUser(msg.from.id);

  // فحص الحظر
  if (user.isBanned) {
    return bot.sendMessage(
      msg.chat.id,
      `🚫 *تم حظر حسابك*\n${user.banReason ? `📝 السبب: ${escMd(user.banReason)}` : ''}\n\nللاستفسار تواصل مع الإدارة.`,
      { parse_mode: 'Markdown' }
    );
  }

  if (onboarding.needsOnboarding(msg.from.id)) {
    return onboarding.sendLangChoice(bot, msg.chat.id);
  }

  bot._sendUserStart(msg);
});

// ─────────────────────────────────────────────
//  Error handling
// ─────────────────────────────────────────────
bot.on('polling_error', (err) => {
  if (err.code === 'EFATAL' || err.code === 'ECONNRESET' || err.message?.includes('ECONNRESET')) {
    console.warn(`[Polling] انقطاع مؤقت: ${err.message} — سيعاد الاتصال تلقائياً`);
    return;
  }
  console.error('Polling error:', err.code, err.message);
});
bot.on('error', (err) => console.error('Bot error:', err.message));
process.on('unhandledRejection', (r) => console.error('Unhandled:', r));

// ─────────────────────────────────────────────
//  Graceful Shutdown
//  لما البوت يتوقف (SIGINT / SIGTERM / SIGHUP)
//  ينظف الـ sessions ويوقف الـ polling بشكل نظيف
// ─────────────────────────────────────────────
let _isShuttingDown = false;

async function gracefulShutdown(signal) {
  if (_isShuttingDown) return;
  _isShuttingDown = true;

  console.log(`\n⚠️  [${signal}] جاري إيقاف البوت بشكل نظيف...`);

  try {
    // أوقف الـ polling
    await bot.stopPolling({ cancel: true });
    console.log('✅ Polling stopped');
  } catch (e) {
    console.warn('⚠️ Error stopping polling:', e.message);
  }

  console.log('👋 البوت توقف بنجاح.');
  process.exit(0);
}

process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGHUP',  () => gracefulShutdown('SIGHUP'));

console.log(`✅ البوت يعمل | الأدمن الرئيسي: [${MAIN_ADMIN_IDS.join(', ')}] | الإضافيون: [${db.getExtraAdmins().map(a=>a.id).join(', ') || 'لا يوجد'}]`);
