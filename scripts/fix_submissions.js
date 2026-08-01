'use strict';
const fs = require('fs');
const file = './src/handlers/adminSubmissions.js';
const lines = fs.readFileSync(file, 'utf8').split('\n');

console.log('Total lines before:', lines.length);

// الهيكل المكرر:
// L24:  subsMenuKeyboard (1) ← صحيحة
// L319: handleAdminText  (1) ← صحيحة  
// L419: subsMenuKeyboard (2) ← مكررة → نحذف L419-515
// L516: handleAdminText  (2) ← مكررة → نحذف L516-615
// L616: register          ← صحيح

// نحتفظ بـ L1-418 + L616-end
const kept = [...lines.slice(0, 418), ...lines.slice(615)];

const newContent = kept.join('\n');
fs.writeFileSync(file, newContent, 'utf8');

// تحقق
const check = fs.readFileSync(file, 'utf8');
const c1 = (check.match(/function subsMenuKeyboard/g) || []).length;
const c2 = (check.match(/async function handleAdminText/g) || []).length;
console.log('subsMenuKeyboard occurrences:', c1);
console.log('handleAdminText occurrences:', c2);
console.log('Lines after:', check.split('\n').length);
if (c1 === 1 && c2 === 1) {
  console.log('✅ تم الإصلاح بنجاح');
} else {
  console.log('❌ لا زال مكرر');
}
