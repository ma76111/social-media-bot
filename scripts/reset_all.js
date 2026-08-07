'use strict';

/**
 * reset_all.js — Full Reset
 * يمسح كل البيانات ويرجع البوت كأنه لسه معمول
 *
 * اللي بيتمسح:
 *   ✅ users.json        — المستخدمين وأرصدتهم
 *   ✅ counter.json      — العداد التسلسلي للـ UID
 *   ✅ withdrawals.json  — طلبات السحب
 *   ✅ data/tasks/*      — كل المهام والحقول والتسليمات
 *   ✅ exports/*         — ملفات التصدير
 *
 * اللي بيتحفظ:
 *   💾 نسخة احتياطية كاملة في data/backups/full_reset_<timestamp>/
 *
 * الاستخدام:
 *   node scripts/reset_all.js
 *   node scripts/reset_all.js --confirm
 */

const fs       = require('fs');
const path     = require('path');
const readline = require('readline');

const ROOT          = path.join(__dirname, '..');
const DATA_DIR      = path.join(ROOT, 'data');
const TASKS_DIR     = path.join(DATA_DIR, 'tasks');
const EXPORTS_DIR   = path.join(ROOT, 'exports');
const USERS_FILE    = path.join(DATA_DIR, 'users.json');
const COUNTER_FILE  = path.join(DATA_DIR, 'counter.json');
const WD_FILE       = path.join(DATA_DIR, 'withdrawals.json');

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────

function fileExists(p) { return fs.existsSync(p); }

function countFiles(dir) {
  if (!fileExists(dir)) return 0;
  return fs.readdirSync(dir).length;
}

function humanSize(filePath) {
  if (!fileExists(filePath)) return '(غير موجود)';
  const b = fs.statSync(filePath).size;
  return b < 1024 ? `${b} B` : `${(b / 1024).toFixed(1)} KB`;
}

function copyDir(src, dest) {
  if (!fileExists(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function ask(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, ans => { rl.close(); resolve(ans.trim()); });
  });
}

function nowTs() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

// ─────────────────────────────────────────────
//  Summary
// ─────────────────────────────────────────────

function printSummary() {
  const taskCount = countFiles(TASKS_DIR);
  let userCount = 0;
  let wdCount   = 0;
  try { userCount = Object.keys(JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'))).length; } catch {}
  try { wdCount   = JSON.parse(fs.readFileSync(WD_FILE, 'utf8')).length; } catch {}

  console.log('\n══════════════════════════════════════');
  console.log('   🗑  Full Reset — Task Bot');
  console.log('══════════════════════════════════════');
  console.log('\nالبيانات الحالية:');
  console.log(`  👥 مستخدمون:       ${userCount}`);
  console.log(`  📋 مهام:           ${taskCount}`);
  console.log(`  💸 طلبات سحب:     ${wdCount}`);
  console.log(`  📁 ملفات تصدير:   ${countFiles(EXPORTS_DIR)}`);
  console.log('\n⚠️  سيتم مسح كل شيء تماماً:');
  console.log('   users.json، counter.json، withdrawals.json');
  console.log('   data/tasks/*،  exports/*');
  console.log('\n💾 سيتم حفظ نسخة احتياطية كاملة قبل المسح\n');
}

// ─────────────────────────────────────────────
//  Main
// ─────────────────────────────────────────────

async function main() {
  const skipConfirm = process.argv.includes('--confirm') || !process.stdin.isTTY;

  printSummary();

  if (!skipConfirm) {
    const ans = await ask('اكتب "نعم" أو "yes" للتأكيد، أو أي شيء آخر للإلغاء: ');
    if (!['نعم', 'yes', 'y'].includes(ans.toLowerCase())) {
      console.log('\n❌ تم الإلغاء. لم يتم مسح أي شيء.\n');
      process.exit(0);
    }
  }

  // ── نسخة احتياطية ─────────────────────────
  const ts         = nowTs();
  const backupRoot = path.join(DATA_DIR, 'backups', `full_reset_${ts}`);
  fs.mkdirSync(backupRoot, { recursive: true });

  if (fileExists(USERS_FILE))   fs.copyFileSync(USERS_FILE,   path.join(backupRoot, 'users.json'));
  if (fileExists(COUNTER_FILE)) fs.copyFileSync(COUNTER_FILE, path.join(backupRoot, 'counter.json'));
  if (fileExists(WD_FILE))      fs.copyFileSync(WD_FILE,      path.join(backupRoot, 'withdrawals.json'));
  if (fileExists(TASKS_DIR))    copyDir(TASKS_DIR,   path.join(backupRoot, 'tasks'));
  if (fileExists(EXPORTS_DIR))  copyDir(EXPORTS_DIR, path.join(backupRoot, 'exports'));

  console.log(`\n💾 نسخة احتياطية: data/backups/full_reset_${ts}/`);

  // ── مسح ──────────────────────────────────
  // users.json
  fs.writeFileSync(USERS_FILE, JSON.stringify({}, null, 2), 'utf8');
  console.log('✅ تم مسح users.json');

  // counter.json
  fs.writeFileSync(COUNTER_FILE, JSON.stringify({ nextUid: 1 }, null, 2), 'utf8');
  console.log('✅ تم إعادة counter.json');

  // withdrawals.json
  fs.writeFileSync(WD_FILE, JSON.stringify([], null, 2), 'utf8');
  console.log('✅ تم مسح withdrawals.json');

  // tasks/*
  if (fileExists(TASKS_DIR)) {
    for (const f of fs.readdirSync(TASKS_DIR)) {
      fs.unlinkSync(path.join(TASKS_DIR, f));
    }
    console.log('✅ تم مسح data/tasks/');
  }

  // exports/*
  if (fileExists(EXPORTS_DIR)) {
    for (const f of fs.readdirSync(EXPORTS_DIR)) {
      const fp = path.join(EXPORTS_DIR, f);
      if (fs.statSync(fp).isFile()) fs.unlinkSync(fp);
    }
    console.log('✅ تم مسح exports/');
  }

  console.log('\n🎉 تم Full Reset بنجاح!');
  console.log('   أعد تشغيل البوت عشان يبدأ من الأول.\n');
}

main().catch(err => {
  console.error('\n❌ خطأ:', err.message);
  process.exit(1);
});
