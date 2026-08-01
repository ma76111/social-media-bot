'use strict';

/**
 * seed_task.js
 * ينشئ مهمة "إنشاء حسابات فيسبوك" بـ 3 حقول
 * ويضيف 100 تسليم وهمي لاختبار النظام
 *
 * الاستخدام:
 *   node scripts/seed_task.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const db   = require('../src/db');
const { v4: uuidv4 } = require('uuid');
const fs   = require('fs');
const path = require('path');

// ─────────────────────────────────────────────
//  بيانات وهمية
// ─────────────────────────────────────────────

const FAKE_EMAILS    = ['gmail.com','yahoo.com','hotmail.com','outlook.com','yopmail.com'];
const FAKE_NAMES_AR  = ['أحمد','محمد','علي','خالد','عمر','يوسف','حسن','إبراهيم','سامر','طارق',
                        'فاطمة','مريم','نور','سارة','ريم','لينا','هنا','دينا','رنا','ميار'];
const FAKE_NAMES_EN  = ['ahmed','mohamed','ali','khalid','omar','youssef','hassan','ibrahim',
                        'samer','tarek','fatma','mariam','nour','sara','reem','lina','hana','dina'];

function rand(arr)         { return arr[Math.floor(Math.random() * arr.length)]; }
function randNum(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function fakeEmail() {
  const name = rand(FAKE_NAMES_EN);
  const num  = randNum(10, 9999);
  return `${name}${num}@${rand(FAKE_EMAILS)}`;
}

function fakePassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#!';
  return Array.from({ length: randNum(8, 12) }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function fakePhone() {
  const prefixes = ['010','011','012','015'];
  return rand(prefixes) + String(randNum(10000000, 99999999));
}

function fakeUsername() {
  return rand(FAKE_NAMES_EN) + randNum(100, 9999);
}

function fakeFullName() {
  return rand(FAKE_NAMES_AR) + ' ' + rand(FAKE_NAMES_AR);
}

function now(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  return d.toISOString().replace('T', ' ').substring(0, 19);
}

// ─────────────────────────────────────────────
//  Main
// ─────────────────────────────────────────────

console.log('\n══════════════════════════════════════');
console.log('   🌱  Seed Task Script');
console.log('══════════════════════════════════════\n');

// 1. إنشاء المهمة
const task = db.createTask({
  name:       'إنشاء حسابات فيسبوك',
  shortDesc:  'أنشئ حساب فيسبوك جديد وسلّم بياناته',
  fullDesc:   'قم بإنشاء حساب فيسبوك جديد تماماً باستخدام بريد إلكتروني جديد.\n\n📋 المطلوب:\n• بريد إلكتروني جديد\n• كلمة مرور قوية\n• رقم هاتف للتحقق\n• اسم الحساب على فيسبوك',
  reward:     2,
  isOpen:     true,
  maxPerUser: null,
  videoFileId: null,
});

console.log(`✅ تم إنشاء المهمة: "${task.name}" (ID: ${task.id.substring(0,8)})`);

// 2. إضافة الحقول
const emailField = db.addField(task.id, { label: 'البريد الإلكتروني', type: 'email',    required: true });
const passField  = db.addField(task.id, { label: 'كلمة المرور',       type: 'password', required: true });
const phoneField = db.addField(task.id, { label: 'رقم الهاتف',        type: 'phone',    required: true });
const userField  = db.addField(task.id, { label: 'اسم الحساب',        type: 'text',     required: true });

console.log(`✅ تم إضافة 4 حقول: ${[emailField, passField, phoneField, userField].map(f => f.label).join(', ')}`);

// 3. إنشاء 100 تسليم وهمي
const SUBMISSIONS_COUNT = 100;
let added = 0;

for (let i = 0; i < SUBMISSIONS_COUNT; i++) {
  const userId   = randNum(100000000, 999999999);
  const username = `@${fakeUsername()}`;

  // تأكيد وجود المستخدم في users.json
  db.getUser(userId);

  const sub = db.addSubmission(task.id, {
    userId,
    username,
    data: {
      [emailField.id]: fakeEmail(),
      [passField.id]:  fakePassword(),
      [phoneField.id]: fakePhone(),
      [userField.id]:  fakeFullName(),
    },
  });

  // 70% pending, 20% approved, 10% rejected
  const r = Math.random();
  if (r > 0.70 && r <= 0.90) {
    db.updateSubmissionStatus(task.id, sub.id, 'approved');
  } else if (r > 0.90) {
    db.updateSubmissionStatus(task.id, sub.id, 'rejected', 'حساب مكرر');
  }

  added++;
}

// إحصائيات
const final = db.getTask(task.id);
const stats = final.stats;

console.log(`\n✅ تم إضافة ${added} تسليم وهمي`);
console.log('\n📊 الإحصائيات:');
console.log(`  ⏳ في الانتظار : ${stats.pending}`);
console.log(`  ✅ موافق عليه : ${stats.approved}`);
console.log(`  ❌ مرفوض      : ${stats.rejected}`);
console.log(`  📦 الإجمالي   : ${stats.total}`);
console.log('\n🎉 تم بنجاح! شغّل البوت وجرّب.\n');
