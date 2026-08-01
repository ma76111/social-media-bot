'use strict';
/**
 * sessionStore.js — حفظ sessions على ملف JSON
 * لما البوت بيوقف بيحفظ، لما بيشتغل بيرجع
 */

const fs   = require('fs');
const path = require('path');

const SESSION_FILE = path.join(__dirname, '..', '..', 'data', 'sessions.json');

function loadAll() {
  if (!fs.existsSync(SESSION_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')); } catch { return {}; }
}

function saveAll(data) {
  try { fs.writeFileSync(SESSION_FILE, JSON.stringify(data), 'utf8'); } catch {}
}

/**
 * مصنع sessions — كل module يستدعيه بـ namespace مختلف
 * عشان sessions الـ user لا تتعارض مع sessions الأدمن
 */
function createStore(namespace) {
  const _mem = {};   // in-memory أسرع للقراءة

  // load من الملف عند البداية
  const persisted = loadAll()[namespace] || {};
  Object.assign(_mem, persisted);

  function set(id, value) {
    _mem[String(id)] = value;
    _flush();
  }
  function get(id) { return _mem[String(id)] || null; }
  function del(id) { delete _mem[String(id)]; _flush(); }
  function all()   { return _mem; }

  let _timer = null;
  function _flush() {
    // debounce الكتابة — نكتب بعد 500ms من آخر تغيير
    if (_timer) clearTimeout(_timer);
    _timer = setTimeout(() => {
      const current = loadAll();
      current[namespace] = _mem;
      saveAll(current);
    }, 500);
  }

  return { set, get, del, all };
}

// حفظ عند إيقاف البوت
function setupShutdownSave(stores) {
  const save = () => {
    const current = loadAll();
    for (const [ns, store] of Object.entries(stores)) {
      current[ns] = store.all();
    }
    saveAll(current);
  };
  process.on('SIGINT',  () => { save(); process.exit(0); });
  process.on('SIGTERM', () => { save(); process.exit(0); });
}

module.exports = { createStore, setupShutdownSave };
