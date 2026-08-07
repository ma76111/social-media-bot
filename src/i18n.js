'use strict';

/**
 * i18n.js — ملف الترجمة
 * الأزرار مصممة لتكون ثابتة ومعرَّفة بـ key
 * كل لغة تحتوي على نفس الـ keys
 *
 * الاستخدام:
 *   const t = require('./i18n').t;
 *   t('balance', 'ar')   // → 'رصيدي 💰'
 *   t('balance', 'en')   // → 'My Balance 💰'
 */

const translations = {

  // ──────────────────────────────────────────
  //  KEYBOARD BUTTONS  (نصوص ثابتة تُستخدم
  //  لمطابقة onText وبناء الـ keyboard معاً)
  // ──────────────────────────────────────────

  btn_balance:        { ar: '💰 رصيدي',          en: '💰 My Balance'       },
  btn_pending:        { ar: '⏳ الأموال المعلقة', en: '⏳ Pending Earnings'  },
  btn_withdraw:       { ar: '💳 سحب',             en: '💳 Withdraw'         },
  btn_settings:       { ar: '⚙️ التفضيلات',       en: '⚙️ Preferences'      },
  btn_myid:           { ar: '🆔 معرفي',           en: '🆔 My ID'            },

  // ──────────────────────────────────────────
  //  MESSAGES
  // ──────────────────────────────────────────

  // onboarding
  welcome_lang:       {
    ar: '🎉 *أهلاً بيك في بوت بيع الأكونتات!* �\n\n📱 *فيسبوك • إنستجرام • تيك توك • يوتيوب*\n\n💰 أسرع وأأمن طريقة لبيع أكونتات السوشيال ميديا\n✨ نفّذ المهام واستلم فلوسك فوراً 💸\n🔥 آلاف المستخدمين بيكسبوا كل يوم!\n\n━━━━━━━━━━━━━━━━━━\n🌐 اختر لغتك / Choose your language:',
    en: '🎉 *Welcome to the Accounts Bot!* 🚀\n\n📱 *Facebook • Instagram • TikTok • YouTube*\n\n💰 The fastest & safest way to sell social media accounts\n✨ Complete tasks and get paid instantly 💸\n🔥 Thousands earning daily!\n\n━━━━━━━━━━━━━━━━━━\n🌐 اختر لغتك / Choose your language:',
  },
  welcome_currency:   {
    ar: '✅ *تمام!*\n\n💱 اختار العملة اللي عايز تستلم بيها أرباحك:',
    en: '✅ *Great choice!*\n\n💱 Choose your preferred currency for earnings:',
  },
  onboarding_done:    {
    ar: '🎊 *مرحباً بيك في الفريق!* 🔥\n\n✅ تم الإعداد بنجاح\n\n💡 *ازاي تبدأ؟*\n👇 اضغط على أي مهمة من القائمة\n📋 نفّذ الخطوات المطلوبة\n💰 استلم مكافأتك فوراً!\n\n⚙️ تقدر تغير إعداداتك من *التفضيلات* في أي وقت.',
    en: '🎊 *Welcome to the team!* 🔥\n\n✅ Setup complete!\n\n💡 *How to start?*\n👇 Tap any task from the menu\n📋 Follow the required steps\n💰 Receive your reward instantly!\n\n⚙️ Change your settings anytime from *Preferences*.',
  },

  // home
  home_greeting:      {
    ar: (name) => `👋 *أهلاً ${name}!* 🔥\n\n📋 *اختار مهمة وابدأ تكسب دلوقتي:*`,
    en: (name) => `👋 *Hello ${name}!* 🔥\n\n📋 *Choose a task and start earning now:*`,
  },
  home_no_tasks:      {
    ar: '⏳ مفيش مهام متاحة دلوقتي، هيتم إضافة مهام قريباً! 🔜',
    en: '⏳ No tasks available right now, new tasks coming soon! 🔜',
  },

  // balance
  balance_text:       {
    ar: (bal, earned, sym) => `💰 *رصيدك الحالي:* \`${bal} ${sym}\`\n📊 *إجمالي أرباحك:* \`${earned} ${sym}\`\n\n💪 استمر في تنفيذ المهام وزود رصيدك! 🔥`,
    en: (bal, earned, sym) => `💰 *Current Balance:* \`${bal} ${sym}\`\n📊 *Total Earned:* \`${earned} ${sym}\`\n\n💪 Keep completing tasks and grow your balance! 🔥`,
  },

  // pending
  pending_title:      { ar: '⏳ *الأموال المعلقة*',       en: '⏳ *Pending Earnings*'    },
  pending_total_tasks:{ ar: (n) => `📦 إجمالي المهام المعلقة: *${n}*`,
                        en: (n) => `📦 Total pending tasks: *${n}*`                      },
  pending_total_amt:  { ar: (a, s) => `💰 إجمالي المكافآت المعلقة: *${a} ${s}*`,
                        en: (a, s) => `💰 Total pending amount: *${a} ${s}*`             },
  pending_empty:      { ar: '📭 لا توجد مهام معلقة حالياً.',
                        en: '📭 No pending tasks right now.'                             },
  pending_page:       { ar: (c, t) => `📄 صفحة ${c} / ${t}`, en: (c, t) => `📄 Page ${c} / ${t}` },
  btn_prev:           { ar: '◀️ السابق',  en: '◀️ Prev'   },
  btn_next:           { ar: 'التالي ▶️', en: 'Next ▶️'   },

  // task detail
  task_reward:        { ar: (r, s) => `💰 *المكافأة:* \`${r} ${s}\``,
                        en: (r, s) => `💰 *Reward:* \`${r} ${s}\``                      },
  task_desc_label:    { ar: '📖 *الشرح:*', en: '📖 *Description:*'                     },
  btn_start_task:     { ar: '✅ بدء التنفيذ', en: '✅ Start Task'                       },
  task_unavailable:   { ar: '⚠️ هذه المهمة غير متاحة حالياً.',
                        en: '⚠️ This task is not available right now.'                  },
  task_no_fields:     { ar: '⚠️ هذه المهمة لا تحتوي على حقول بعد. تواصل مع الإدارة.',
                        en: '⚠️ This task has no fields yet. Contact admin.'            },
  task_max_reached:   { ar: (n) => `⛔ لقد وصلت للحد الأقصى للتسليم في هذه المهمة (${n} مرة).`,
                        en: (n) => `⛔ You have reached the max submissions for this task (${n}).` },

  // field hints
  hint_email:         { ar: '📧 أرسل بريدك الإلكتروني',    en: '📧 Send your email address'    },
  hint_url:           { ar: '🔗 أرسل الرابط كاملاً',       en: '🔗 Send the full URL'          },
  hint_phone:         { ar: '📱 أرسل رقم الهاتف',          en: '📱 Send your phone number'     },
  hint_image:         { ar: '🖼 أرسل الصورة',               en: '🖼 Send an image'              },
  hint_file:          { ar: '📎 أرسل الملف',                en: '📎 Send a file'                },
  hint_password:      { ar: '🔑 أرسل كلمة المرور',         en: '🔑 Send your password'         },
  hint_number:        { ar: '🔢 أرسل رقماً',                en: '🔢 Send a number'              },
  hint_text:          { ar: '✏️ أرسل النص',                 en: '✏️ Send the text'              },
  field_invalid:      { ar: '❌ البيانات غير صحيحة.',       en: '❌ Invalid data.'               },
  btn_skip:           { ar: '⏭ تخطي (اختياري)',            en: '⏭ Skip (optional)'            },
  field_required:     { ar: '⚠️ هذا الحقل إجباري ولا يمكن تخطيه.',
                        en: '⚠️ This field is required and cannot be skipped.'          },

  // summary & confirm
  review_title:       { ar: '📝 *مراجعة بياناتك*',         en: '📝 *Review your data*'         },
  review_task:        { ar: (n) => `*المهمة:* ${n}`,        en: (n) => `*Task:* ${n}`          },
  review_empty:       { ar: '_(فارغ)_',                     en: '_(empty)_'                    },
  review_uploaded:    { ar: '✅ تم الرفع',                   en: '✅ Uploaded'                   },
  review_question:    { ar: 'هل تريد تأكيد التسليم؟',       en: 'Confirm your submission?'     },
  btn_confirm_sub:    { ar: '✅ تأكيد التسليم',              en: '✅ Confirm'                    },
  btn_cancel:         { ar: '❌ إلغاء',                      en: '❌ Cancel'                     },
  sub_success:        {
    ar: (id) => `🎉 *تم إرسال تسليمك بنجاح!*\n\n🆔 معرف التسليم: \`${id}\`\n⏳ الحالة: *قيد المراجعة*\n\n💪 شكراً! فريقنا هيراجع تسليمك في أقرب وقت.\n🔔 هتوصلك إشعار فور الموافقة 💰`,
    en: (id) => `🎉 *Submission sent successfully!*\n\n🆔 ID: \`${id}\`\n⏳ Status: *Under review*\n\n💪 Thank you! Our team will review your submission shortly.\n🔔 You'll be notified once approved 💰`,
  },
  sub_session_expired:{ ar: '⚠️ انتهت الجلسة، ابدأ من جديد.',
                        en: '⚠️ Session expired, please start again.'                  },
  cancel_msg:         { ar: '❌ تم إلغاء التسليم.',          en: '❌ Submission cancelled.'       },

  // withdraw
  wd_title:           { ar: '💳 *طلب سحب*',                 en: '💳 *Withdrawal Request*'       },
  wd_balance_avail:   { ar: (b, s) => `💰 رصيدك المتاح: \`${b} ${s}\``,
                        en: (b, s) => `💰 Available balance: \`${b} ${s}\``            },
  wd_choose_method:   { ar: 'اختر طريقة الاستلام:',          en: 'Choose withdrawal method:'    },
  wd_zero_balance:    { ar: (b, s) => `⚠️ رصيدك صفر، لا يمكن طلب سحب.\n💰 رصيدك الحالي: \`${b} ${s}\``,
                        en: (b, s) => `⚠️ Your balance is zero.\n💰 Current balance: \`${b} ${s}\`` },
  wd_enter_phone:     { ar: '📱 أدخل رقم الهاتف (Vodafone Cash / Orange Cash):',
                        en: '📱 Enter your phone number (Vodafone Cash / Orange Cash):'},
  wd_enter_binance:   { ar: '🆔 أدخل Binance ID الخاص بك:',
                        en: '🆔 Enter your Binance ID:'                               },
  wd_enter_amount:    { ar: (b, s) => `💰 *رصيدك المتاح:* \`${b} ${s}\`\n\nأدخل *المبلغ* المراد سحبه (${s}):`,
                        en: (b, s) => `💰 *Available:* \`${b} ${s}\`\n\nEnter *amount* to withdraw (${s}):` },
  wd_invalid_amount:  { ar: '⚠️ أدخل مبلغاً صحيحاً أكبر من 0.',
                        en: '⚠️ Enter a valid amount greater than 0.'                 },
  wd_insufficient:    { ar: (b, s) => `⚠️ رصيدك غير كافٍ.\n💰 الرصيد المتاح: \`${b} ${s}\``,
                        en: (b, s) => `⚠️ Insufficient balance.\n💰 Available: \`${b} ${s}\`` },
  wd_review:          { ar: '📋 *مراجعة طلب السحب*',        en: '📋 *Review Withdrawal*'        },
  wd_method_lbl:      { ar: (m) => `💳 الطريقة: ${m}`,      en: (m) => `💳 Method: ${m}`       },
  wd_details_lbl:     { ar: (d) => `📋 التفاصيل: \`${d}\``, en: (d) => `📋 Details: \`${d}\``  },
  wd_amount_lbl:      { ar: (a, s) => `💰 المبلغ: *${a} ${s}*`, en: (a, s) => `💰 Amount: *${a} ${s}*` },
  wd_confirm_q:       { ar: 'هل تريد تأكيد الطلب؟',          en: 'Confirm the request?'         },
  btn_confirm_wd:     { ar: '✅ تأكيد الطلب',                en: '✅ Confirm Request'            },
  wd_success:         {
    ar: (id, m, a, s) => `✅ *تم إرسال طلب السحب بنجاح!*\n\n🆔 رقم الطلب: \`${id}\`\n💳 الطريقة: ${m}\n💰 المبلغ: *${a} ${s}*\n⏳ الحالة: *قيد المراجعة*\n\nسيتم إشعارك فور معالجة الطلب.`,
    en: (id, m, a, s) => `✅ *Withdrawal request sent!*\n\n🆔 ID: \`${id}\`\n💳 Method: ${m}\n💰 Amount: *${a} ${s}*\n⏳ Status: *Pending*\n\nYou will be notified once processed.`,
  },
  wd_cancelled:       { ar: '❌ تم إلغاء طلب السحب.',        en: '❌ Withdrawal cancelled.'      },
  wd_balance_changed: { ar: '⚠️ رصيدك تغيّر، يرجى إعادة المحاولة.',
                        en: '⚠️ Your balance changed, please try again.'              },
  // إشعارات السحب للمستخدم
  notify_wd_approved: {
    ar: (m, a, s, d) => `🎉 *تم قبول طلب سحبك!* 💸\n\n💳 الطريقة: ${m}\n💰 المبلغ: *${a} ${s}*\n📋 التفاصيل: \`${d}\`\n\n⚡ جاري التحويل، شكراً لثقتك بينا! 🙏`,
    en: (m, a, s, d) => `🎉 *Your withdrawal was approved!* 💸\n\n💳 Method: ${m}\n💰 Amount: *${a} ${s}*\n📋 Details: \`${d}\`\n\n⚡ Transfer in progress, thank you for your trust! 🙏`,
  },
  notify_wd_rejected: {
    ar: (m, a, s, r) => `❌ *تم رفض طلب سحبك*\n\n💳 الطريقة: ${m}\n💰 المبلغ: \`${a} ${s}\`\n${r ? `📝 السبب: ${r}\n` : ''}\n↩️ تم إعادة المبلغ لرصيدك.\n💡 تواصل مع الدعم لو عندك أي استفسار.`,
    en: (m, a, s, r) => `❌ *Your withdrawal was rejected*\n\n💳 Method: ${m}\n💰 Amount: \`${a} ${s}\`\n${r ? `📝 Reason: ${r}\n` : ''}\n↩️ Amount returned to your balance.\n💡 Contact support if you have any questions.`,
  },

  // settings
  settings_title:     { ar: '⚙️ *التفضيلات*',               en: '⚙️ *Preferences*'            },
  settings_current:   { ar: (l, c) => `🌐 اللغة: *${l}*\n💱 العملة: *${c}*`,
                        en: (l, c) => `🌐 Language: *${l}*\n💱 Currency: *${c}*`     },
  btn_change_lang:    { ar: '🌐 تغيير اللغة',               en: '🌐 Change Language'            },
  btn_change_currency:{ ar: '💱 تغيير العملة',              en: '💱 Change Currency'            },
  settings_lang_q:    { ar: 'اختر اللغة:',                  en: 'Choose language:'             },
  settings_currency_q:{ ar: 'اختر العملة المفضلة:',         en: 'Choose preferred currency:'   },
  settings_saved:     { ar: '✅ تم حفظ التفضيلات.',          en: '✅ Preferences saved.'            },

  notify_banned: {
    ar: (reason) => `🚫 *تم حظر حسابك*\n${reason ? `📝 السبب: ${reason}\n` : ''}\nللاستفسار تواصل مع الإدارة.`,
    en: (reason) => `🚫 *Your account has been banned*\n${reason ? `📝 Reason: ${reason}\n` : ''}\nContact support for more info.`,
  },
  notify_unbanned: {
    ar: '✅ *تم رفع الحظر عن حسابك.*\nيمكنك الآن استخدام البوت مجدداً. 🎉',
    en: '✅ *Your account ban has been lifted.*\nYou can now use the bot again. 🎉',
  },
  notify_approaching_limit: {
    ar: (task, remaining) => `⚠️ *تنبيه!*\n\n📌 المهمة: *${task}*\nلديك *${remaining}* تسليم متبقي فقط في هذه المهمة.\nاستغل الفرصة قبل انتهاء الحد! 🔥`,
    en: (task, remaining) => `⚠️ *Heads up!*\n\n📌 Task: *${task}*\nYou have only *${remaining}* submission(s) left for this task.\nMake the most of it! 🔥`,
  },
  // notifications (submission)
  notify_approved: {
    ar: (task, id, r, s) => `🎊 *مبروك! تم قبول تسليمك!* 🔥\n\n📌 المهمة: *${task}*\n🆔 التسليم: \`${id}\`\n💰 المكافأة: \`${r} ${s}\` ✅ تمت إضافتها لرصيدك!\n\n💸 استمر وكسب أكتر! 🚀`,
    en: (task, id, r, s) => `🎊 *Congratulations! Submission approved!* 🔥\n\n📌 Task: *${task}*\n🆔 ID: \`${id}\`\n💰 Reward: \`${r} ${s}\` ✅ Added to your balance!\n\n💸 Keep going and earn more! 🚀`,
  },
  notify_rejected: {
    ar: (task, id, reason) => `❌ *تم رفض تسليمك*\n\n📌 المهمة: *${task}*\n🆔 التسليم: \`${id}\`\n${reason ? `📝 السبب: ${reason}\n` : ''}\n💡 راجع الشروط وحاول تاني، أنت قادر! 💪`,
    en: (task, id, reason) => `❌ *Submission rejected*\n\n📌 Task: *${task}*\n🆔 ID: \`${id}\`\n${reason ? `📝 Reason: ${reason}\n` : ''}\n💡 Review the requirements and try again, you got this! 💪`,
  },
};

// ─────────────────────────────────────────────
//  Helper function
// ─────────────────────────────────────────────

/**
 * @param {string} key
 * @param {string} lang  'ar' | 'en'
 * @param {...any} args  args للـ keys التي هي functions
 */
function t(key, lang = 'ar', ...args) {
  const entry = translations[key];
  if (!entry) return key;
  const val = entry[lang] ?? entry['ar'] ?? key;
  return typeof val === 'function' ? val(...args) : val;
}

/**
 * اسم العملة القصير للعرض
 */
function currencySymbol(currency) {
  return { egp: 'EGP', usdt: 'USDT' }[currency] || 'EGP';
}

/**
 * أسماء اللغات للعرض
 */
const LANG_NAMES = { ar: 'العربية 🇦🇪', en: 'English 🇬🇧' };
const CURRENCY_NAMES = { egp: 'جنيه مصري 🇪🇬', usdt: 'USDT 🟡' };

module.exports = { t, currencySymbol, LANG_NAMES, CURRENCY_NAMES, translations };
