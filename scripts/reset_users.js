'use strict';

/**
 * reset_users.js
 * يمسح بيانات المستخدمين (الأرصدة، اللغات، الإعدادات، الحظر)
 * ويعيد العداد التسلسلي (uid) من 1
 *
 * لا يمس: المهام، الحقول، التسليمات، طلبات السحب
 *
 * الاستخدام:
 *   node scripts/reset_users.js
 *   node scripts/reset_users.js --confirm   ← تخطي سؤال التأكيد
 */

const fs      = require('fs');
const path    = require('path');
const readline = require('readline');

const DATA_DIR       = path.join(__dirname, '..', 'data');
const USERS_FILE     = path.join(DATA_DIR, 'users.json');
const COUNTER_FILE   = path.join(DATA_DIR, 'counter.json');

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────

function fileSize(filePath) {
  if (!fs.existsSync(filePath)) return '(غير موجود)';
  const bytes = fs.statSync(filePath).size;
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

function countUsers() {
  if (!fs.existsSync(USERS_FILE)) return 0;
  try {
    return Object.keys(JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'))).length;
  } catch { return 0; }
}

function ask(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, answer => { rl.close(); resolve(answer.trim()); });
  });
}

// ─────────────────────────────────────────────
//  Main
// ─────────────────────────────────────────────

async function main() {
  const skipConfirm = process.argv.includes('--confirm') || !process.stdin.isTTY;

  console.log('\n══════════════════════════════════');
  console.log('   🗑  Reset Users Script');
  console.log('══════════════════════════════════');
  console.log(`\nالملفات المستهدفة:`);
  console.log(`  users.json   → ${fileSize(USERS_FILE)}  (${countUsers()} مستخدم)`);
  console.log(`  counter.json → ${fileSize(COUNTER_FILE)}`);
  console.log('\n⚠️  سيتم مسح جميع بيانات المستخدمين:');
  console.log('   الأرصدة، إجمالي الأرباح، اللغة، العملة، الحظر، الـ UID');
  console.log('✅  لن يتم مسح: المهام، الحقول، التسليمات، طلبات السحب\n');

  if (!skipConfirm) {
    const answer = await ask('هل أنت متأكد؟ اكتب "نعم" أو "yes" للتأكيد: ');
    if (!['نعم', 'yes', 'y'].includes(answer.toLowerCase())) {
      console.log('\n❌ تم الإلغاء. لم يتم مسح أي شيء.\n');
      process.exit(0);
    }
  }

  // نسخ احتياطي قبل المسح
  const backupDir = path.join(DATA_DIR, 'backups');
  fs.mkdirSync(backupDir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);

  if (fs.existsSync(USERS_FILE)) {
    const backup = path.join(backupDir, `users_${ts}.json`);
    fs.copyFileSync(USERS_FILE, backup);
    console.log(`\n💾 نسخة احتياطية: backups/users_${ts}.json`);
  }

  // مسح
  fs.writeFileSync(USERS_FILE,   JSON.stringify({}, null, 2), 'utf8');
  fs.writeFileSync(COUNTER_FILE, JSON.stringify({ nextUid: 1 }, null, 2), 'utf8');

  console.log('✅ تم مسح users.json');
  console.log('✅ تم إعادة counter.json → nextUid: 1');
  console.log('\n🎉 تم بنجاح! أعد تشغيل البوت.\n');
}

main().catch(err => {
  console.error('خطأ:', err.message);
  process.exit(1);
});
