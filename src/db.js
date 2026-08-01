'use strict';

/**
 * db.js - طبقة البيانات الكاملة
 * كل مهمة لها ملف JSON مستقل في data/tasks/<id>.json
 * بيانات المستخدمين (الرصيد) في data/users.json
 */

const fs   = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const TASKS_DIR  = path.join(__dirname, '..', 'data', 'tasks');
const USERS_FILE = path.join(__dirname, '..', 'data', 'users.json');

// تأكيد وجود المجلدات
fs.mkdirSync(TASKS_DIR, { recursive: true });
fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────

function now() {
  const d = new Date();
  // التوقيت المصري Africa/Cairo
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year:     'numeric',
    month:    '2-digit',
    day:      '2-digit',
    hour:     '2-digit',
    minute:   '2-digit',
    second:   '2-digit',
    hour12:   false,
  }).formatToParts(d);

  const get = (type) => parts.find(p => p.type === type)?.value || '00';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

function taskPath(taskId) {
  return path.join(TASKS_DIR, `${taskId}.json`);
}

function loadTask(taskId) {
  const p = taskPath(taskId);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function saveTask(task) {
  fs.writeFileSync(taskPath(task.id), JSON.stringify(task, null, 2), 'utf8');
}

function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) return {};
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
  // أفرغ الـ cache بعد الكتابة
  _usersCache = null;
}

// ── In-memory cache للمستخدمين ──────────────
let _usersCache = null;

function loadUsersCached() {
  if (_usersCache) return _usersCache;
  _usersCache = loadUsers();
  return _usersCache;
}

function invalidateUsersCache() { _usersCache = null; }

function listTaskIds() {
  if (!fs.existsSync(TASKS_DIR)) return [];
  return fs.readdirSync(TASKS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.slice(0, -5));
}

function recalcStats(task) {
  const stats = { total: 0, pending: 0, approved: 0, rejected: 0, exported: 0 };
  for (const s of task.submissions) {
    stats.total++;
    if (s.status === 'pending')  stats.pending++;
    if (s.status === 'approved') stats.approved++;
    if (s.status === 'rejected') stats.rejected++;
    if (s.exported === 1)        stats.exported++;
  }
  task.stats = stats;
}

// ─────────────────────────────────────────────
//  TASKS
// ─────────────────────────────────────────────

/**
 * إنشاء مهمة جديدة
 * @returns {object} المهمة الجديدة
 */
function createTask({ name, shortDesc, fullDesc, reward,
                       videoFileId = null,
                       maxPerUser = null,
                       isOpen = true }) {
  const task = {
    id: uuidv4(),
    name,
    shortDesc,
    fullDesc,
    videoFileId,
    reward: Number(reward),
    maxPerUser: maxPerUser ? Number(maxPerUser) : null,
    isOpen,
    order: 9999,
    createdAt: now(),
    fields: [],
    features: [],          // ← نظام الميزات
    submissions: [],
    stats: { total: 0, pending: 0, approved: 0, rejected: 0, exported: 0 },
  };
  saveTask(task);
  return task;
}

/**
 * جلب مهمة بالـ ID
 */
function getTask(taskId) {
  return loadTask(taskId);
}

/**
 * تعديل بيانات المهمة
 * يقبل أي مجموعة من: name, shortDesc, fullDesc, videoFileId,
 *   reward, maxPerUser, isOpen, order, fields
 */
function updateTask(taskId, updates) {
  const task = loadTask(taskId);
  if (!task) return null;
  const allowed = ['name','shortDesc','fullDesc','videoFileId',
                   'reward','maxPerUser','isOpen','order','fields'];
  for (const k of allowed) {
    if (k in updates) task[k] = updates[k];
  }
  saveTask(task);
  return task;
}

/**
 * حذف مهمة
 */
function deleteTask(taskId) {
  const p = taskPath(taskId);
  if (fs.existsSync(p)) { fs.unlinkSync(p); return true; }
  return false;
}

/**
 * قائمة كل المهام مرتبة
 * @param {boolean} openOnly - المهام المفتوحة فقط
 */
function listTasks(openOnly = false) {
  const tasks = [];
  for (const id of listTaskIds()) {
    const t = loadTask(id);
    if (!t) continue;
    if (openOnly && !t.isOpen) continue;
    tasks.push(t);
  }
  tasks.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.createdAt.localeCompare(b.createdAt);
  });
  return tasks;
}

// ─────────────────────────────────────────────
//  FIELDS
// ─────────────────────────────────────────────

/**
 * أنواع الحقول المدعومة
 */
const FIELD_TYPES = ['text','password','email','url','phone','image','file','number'];

/**
 * إضافة حقل للمهمة
 */
function addField(taskId, { label, type, required = true }) {
  const task = loadTask(taskId);
  if (!task) return null;
  const field = {
    id: uuidv4(),
    label,
    type: FIELD_TYPES.includes(type) ? type : 'text',
    required: Boolean(required),
    order: task.fields.length,
  };
  task.fields.push(field);
  saveTask(task);
  return field;
}

/**
 * تعديل حقل
 */
function updateField(taskId, fieldId, updates) {
  const task = loadTask(taskId);
  if (!task) return false;
  const field = task.fields.find(f => f.id === fieldId);
  if (!field) return false;
  for (const k of ['label','type','required','order']) {
    if (k in updates) field[k] = updates[k];
  }
  task.fields.sort((a, b) => a.order - b.order);
  saveTask(task);
  return true;
}

/**
 * حذف حقل
 */
function deleteField(taskId, fieldId) {
  const task = loadTask(taskId);
  if (!task) return false;
  const before = task.fields.length;
  task.fields = task.fields.filter(f => f.id !== fieldId);
  if (task.fields.length < before) { saveTask(task); return true; }
  return false;
}

/**
 * إعادة ترتيب الحقول
 * @param {string[]} orderedIds - معرفات الحقول بالترتيب الجديد
 */
function reorderFields(taskId, orderedIds) {
  const task = loadTask(taskId);
  if (!task) return false;
  const map = Object.fromEntries(task.fields.map(f => [f.id, f]));
  task.fields = orderedIds
    .filter(id => map[id])
    .map((id, i) => { map[id].order = i; return map[id]; });
  saveTask(task);
  return true;
}

// ─────────────────────────────────────────────
//  FEATURES  (ميزات المهمة)
// ─────────────────────────────────────────────
//
//  feature = {
//    id:     uuid,
//    type:   'random_names',   // النوع (قابل للتوسع)
//    label:  'احصل على اسم',   // نص الزرار
//    data:   { names: ['...', ...] }  // بيانات خاصة بالنوع
//  }

function addFeature(taskId, feature) {
  const task = loadTask(taskId);
  if (!task) return null;
  if (!task.features) task.features = [];
  const newFeat = { id: uuidv4(), ...feature };
  task.features.push(newFeat);
  saveTask(task);
  return newFeat;
}

function updateFeature(taskId, featureId, updates) {
  const task = loadTask(taskId);
  if (!task) return false;
  const feat = (task.features || []).find(f => f.id === featureId);
  if (!feat) return false;
  Object.assign(feat, updates);
  saveTask(task);
  return true;
}

function deleteFeature(taskId, featureId) {
  const task = loadTask(taskId);
  if (!task) return false;
  const before = (task.features || []).length;
  task.features = (task.features || []).filter(f => f.id !== featureId);
  if (task.features.length < before) { saveTask(task); return true; }
  return false;
}

function getFeatures(taskId) {
  const task = loadTask(taskId);
  return task?.features || [];
}

// ─────────────────────────────────────────────
//  SUBMISSIONS
// ─────────────────────────────────────────────

/**
 * إضافة تسليم جديد
 * @param {object} data - { fieldId: value, ... }
 */
function addSubmission(taskId, { userId, username, data }) {
  const task = loadTask(taskId);
  if (!task) return null;
  const submission = {
    id: uuidv4(),
    userId,
    username,
    submittedAt: now(),
    data,
    status: 'pending',    // pending | approved | rejected
    exported: 0,          // 0 = لم يُصدَّر | 1 = تم تصديره
    rejectReason: null,
    exportedAt: null,
  };
  task.submissions.push(submission);
  recalcStats(task);
  saveTask(task);
  return submission;
}

/**
 * جلب تسليم واحد
 */
function getSubmission(taskId, submissionId) {
  const task = loadTask(taskId);
  if (!task) return null;
  return task.submissions.find(s => s.id === submissionId) || null;
}

/**
 * جلب قائمة التسليمات مع فلتر اختياري
 * @param {string|null} status   - pending | approved | rejected | null (الكل)
 * @param {number|null} exported - 0 | 1 | null (الكل)
 */
function getSubmissions(taskId, status = null, exported = null) {
  const task = loadTask(taskId);
  if (!task) return [];
  let subs = task.submissions;
  // migrate: القديمة كانت status='exported' نحوّلها
  subs = subs.map(s => {
    if (s.status === 'exported') {
      return { ...s, status: 'approved', exported: 1 };
    }
    if (s.exported === undefined) s.exported = 0;
    return s;
  });
  if (status   !== null) subs = subs.filter(s => s.status === status);
  if (exported !== null) subs = subs.filter(s => s.exported === exported);
  return [...subs].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
}

/**
 * تحديث حالة تسليم واحد
 */
function updateSubmissionStatus(taskId, submissionId, newStatus, rejectReason = null) {
  const task = loadTask(taskId);
  if (!task) return null;
  const sub = task.submissions.find(s => s.id === submissionId);
  if (!sub) return null;
  // migrate قديم
  if (sub.status === 'exported') { sub.status = 'approved'; sub.exported = 1; }
  if (sub.exported === undefined) sub.exported = 0;

  sub.status = newStatus;
  if (rejectReason !== null) sub.rejectReason = rejectReason;
  recalcStats(task);
  saveTask(task);
  return sub;
}

function setExported(taskId, submissionIds, flag) {
  const task = loadTask(taskId);
  if (!task) return [];
  const idSet   = new Set(submissionIds);
  const updated = [];
  for (const sub of task.submissions) {
    if (idSet.has(sub.id)) {
      sub.exported = flag;
      if (flag === 1) sub.exportedAt = now();
      updated.push(sub);
    }
  }
  recalcStats(task);
  saveTask(task);
  return updated;
}

function bulkUpdateStatus(taskId, submissionIds, newStatus, rejectReason = null) {
  const task = loadTask(taskId);
  if (!task) return [];
  const idSet = new Set(submissionIds);
  const updated = [];
  for (const sub of task.submissions) {
    if (idSet.has(sub.id)) {
      // migrate قديم
      if (sub.status === 'exported') { sub.status = 'approved'; sub.exported = 1; }
      if (sub.exported === undefined) sub.exported = 0;
      sub.status = newStatus;
      if (rejectReason !== null) sub.rejectReason = rejectReason;
      updated.push(sub);
    }
  }
  recalcStats(task);
  saveTask(task);
  return updated;
}

/**
 * عدد تسليمات مستخدم لمهمة (غير المرفوضة)
 */
function countUserSubmissions(taskId, userId) {
  const task = loadTask(taskId);
  if (!task) return 0;
  return task.submissions.filter(
    s => s.userId === userId && s.status !== 'rejected'
  ).length;
}

function deleteSubmission(taskId, submissionId) {
  const task = loadTask(taskId);
  if (!task) return false;
  const before = task.submissions.length;
  task.submissions = task.submissions.filter(s => s.id !== submissionId);
  if (task.submissions.length < before) {
    recalcStats(task);
    saveTask(task);
    return true;
  }
  return false;
}

function bulkDeleteSubmissions(taskId, submissionIds) {
  const task = loadTask(taskId);
  if (!task) return 0;
  const idSet  = new Set(submissionIds);
  const before = task.submissions.length;
  task.submissions = task.submissions.filter(s => !idSet.has(s.id));
  const deleted = before - task.submissions.length;
  if (deleted > 0) { recalcStats(task); saveTask(task); }
  return deleted;
}

// ─────────────────────────────────────────────
//  USERS — uid تسلسلي + حظر + override سعر
// ─────────────────────────────────────────────

const COUNTER_FILE = path.join(__dirname, '..', 'data', 'counter.json');

function loadCounter() {
  if (!fs.existsSync(COUNTER_FILE)) return { nextUid: 1 };
  return JSON.parse(fs.readFileSync(COUNTER_FILE, 'utf8'));
}
function saveCounter(c) {
  fs.writeFileSync(COUNTER_FILE, JSON.stringify(c, null, 2), 'utf8');
}
function nextUid() {
  const c = loadCounter();
  const uid = c.nextUid;
  c.nextUid++;
  saveCounter(c);
  return uid;
}

function getUser(userId) {
  const users = loadUsersCached();
  const uid = String(userId);
  if (!users[uid]) {
    users[uid] = {
      id:          userId,
      uid:         nextUid(),      // معرف تسلسلي داخلي  #1, #2, ...
      username:    null,
      firstName:   null,
      balance:     0,
      totalEarned: 0,
      lang:        null,
      currency:    null,
      isBanned:    false,
      bannedAt:    null,
      banReason:   null,
      joinedAt:    now(),
      rewardOverrides: {},         // { taskId: customReward }
    };
    saveUsers(users);
  }
  // migrate حقول المستخدمين القدامى
  let dirty = false;
  const defaults = {
    lang: null, currency: null, isBanned: false,
    bannedAt: null, banReason: null, joinedAt: null,
    rewardOverrides: {}, uid: null, username: null, firstName: null,
  };
  for (const [k, v] of Object.entries(defaults)) {
    if (!(k in users[uid])) { users[uid][k] = v; dirty = true; }
  }
  if (!users[uid].uid) { users[uid].uid = nextUid(); dirty = true; }
  if (dirty) saveUsers(users);
  return users[uid];
}

function updateUserMeta(userId, { username, firstName } = {}) {
  const users = loadUsersCached();
  const uid   = String(userId);
  if (!users[uid]) getUser(userId);
  if (username  !== undefined) users[uid].username  = username;
  if (firstName !== undefined) users[uid].firstName = firstName;
  saveUsers(users);
}

function updateUserSettings(userId, { lang, currency } = {}) {
  const users = loadUsersCached();
  const uid   = String(userId);
  if (!users[uid]) getUser(userId);
  if (lang     !== undefined) users[uid].lang     = lang;
  if (currency !== undefined) users[uid].currency = currency;
  saveUsers(users);
  return users[uid];
}

function addBalance(userId, amount) {
  const users = loadUsersCached();
  const uid = String(userId);
  if (!users[uid]) getUser(userId);
  users[uid].balance     = Math.round((users[uid].balance     + amount) * 10000) / 10000;
  users[uid].totalEarned = Math.round((users[uid].totalEarned + (amount > 0 ? amount : 0)) * 10000) / 10000;
  saveUsers(users);
  return users[uid].balance;
}

function setBalance(userId, amount) {
  const users = loadUsersCached();
  const uid   = String(userId);
  if (!users[uid]) getUser(userId);
  users[uid].balance = Math.round(Number(amount) * 10000) / 10000;
  saveUsers(users);
  return users[uid].balance;
}

function banUser(userId, reason = null) {
  const users = loadUsersCached();
  const uid   = String(userId);
  if (!users[uid]) getUser(userId);
  users[uid].isBanned  = true;
  users[uid].bannedAt  = now();
  users[uid].banReason = reason;
  saveUsers(users);
}

function unbanUser(userId) {
  const users = loadUsersCached();
  const uid   = String(userId);
  if (!users[uid]) return;
  users[uid].isBanned  = false;
  users[uid].bannedAt  = null;
  users[uid].banReason = null;
  saveUsers(users);
}

function setRewardOverride(userId, taskId, reward) {
  const users = loadUsersCached();
  const uid   = String(userId);
  if (!users[uid]) getUser(userId);
  if (!users[uid].rewardOverrides) users[uid].rewardOverrides = {};
  if (reward === null) {
    delete users[uid].rewardOverrides[taskId];
  } else {
    users[uid].rewardOverrides[taskId] = Number(reward);
  }
  saveUsers(users);
}

function getEffectiveReward(userId, task) {
  const users = loadUsersCached();
  const uid   = String(userId);
  const overrides = users[uid]?.rewardOverrides || {};
  return overrides[task.id] !== undefined ? overrides[task.id] : task.reward;
}

function listUsers() {
  const users = loadUsersCached();
  return Object.values(users).sort((a, b) => (a.uid || 0) - (b.uid || 0));
}

function findUserByUid(uid) {
  const users = loadUsersCached();
  return Object.values(users).find(u => u.uid === Number(uid)) || null;
}

function findUserByUsername(username) {
  const clean = username.replace(/^@/, '').toLowerCase();
  const users = loadUsersCached();
  return Object.values(users).find(u =>
    u.username && u.username.replace(/^@/, '').toLowerCase() === clean
  ) || null;
}

// ─────────────────────────────────────────────
//  WITHDRAWALS  (طلبات السحب)
// ─────────────────────────────────────────────
//
//  كل طلب:
//  {
//    id, userId, username,
//    method: 'cash_eg' | 'binance',
//    details: string,   ← رقم الهاتف (كاش) أو Binance ID
//    amount: number,
//    status: 'pending' | 'approved' | 'rejected',
//    rejectReason: null | string,
//    createdAt, updatedAt
//  }

const WITHDRAWALS_FILE = path.join(__dirname, '..', 'data', 'withdrawals.json');

function loadWithdrawals() {
  if (!fs.existsSync(WITHDRAWALS_FILE)) return [];
  return JSON.parse(fs.readFileSync(WITHDRAWALS_FILE, 'utf8'));
}

function saveWithdrawals(list) {
  fs.writeFileSync(WITHDRAWALS_FILE, JSON.stringify(list, null, 2), 'utf8');
}

function createWithdrawal({ userId, username, method, details, amount }) {
  const list = loadWithdrawals();
  const req = {
    id: uuidv4(),
    userId,
    username,
    method,      // 'cash_eg' | 'binance'
    details,     // رقم الهاتف أو Binance ID
    amount: Number(amount),
    status: 'pending',
    rejectReason: null,
    createdAt: now(),
    updatedAt: now(),
  };
  list.push(req);
  saveWithdrawals(list);

  // خصم الرصيد فوراً (يُجمَّد) — نستخدم الـ cache
  const users = loadUsersCached();
  const uid = String(userId);
  if (users[uid]) {
    users[uid].balance = Math.round((users[uid].balance - amount) * 10000) / 10000;
    saveUsers(users);
  }
  return req;
}

function getWithdrawals(status = null) {
  let list = loadWithdrawals();
  if (status) list = list.filter(w => w.status === status);
  return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function getUserWithdrawals(userId, status = null) {
  return getWithdrawals(status).filter(w => w.userId === userId);
}

function updateWithdrawalStatus(id, newStatus, rejectReason = null) {
  const list = loadWithdrawals();
  const req  = list.find(w => w.id === id);
  if (!req) return null;

  const old = req.status;
  req.status    = newStatus;
  req.updatedAt = now();
  if (rejectReason !== null) req.rejectReason = rejectReason;

  // لو رُفض → أعد الرصيد للمستخدم — نستخدم الـ cache
  if (newStatus === 'rejected' && old === 'pending') {
    const users = loadUsersCached();
    const uid = String(req.userId);
    if (users[uid]) {
      users[uid].balance = Math.round((users[uid].balance + req.amount) * 10000) / 10000;
      saveUsers(users);
    }
  }

  saveWithdrawals(list);
  return req;
}

// ─────────────────────────────────────────────
//  Exports
// ─────────────────────────────────────────────

module.exports = {
  // Tasks
  createTask, getTask, updateTask, deleteTask, listTasks,
  // Fields
  FIELD_TYPES, addField, updateField, deleteField, reorderFields,
  // Submissions
  addSubmission, getSubmission, getSubmissions,
  updateSubmissionStatus, bulkUpdateStatus, setExported,
  deleteSubmission, bulkDeleteSubmissions,
  countUserSubmissions,
  // Users
  getUser, updateUserMeta, updateUserSettings,
  addBalance, setBalance,
  banUser, unbanUser,
  setRewardOverride, getEffectiveReward,
  listUsers, findUserByUid, findUserByUsername,
  // Features
  addFeature, updateFeature, deleteFeature, getFeatures,
  // Withdrawals
  createWithdrawal, getWithdrawals, getUserWithdrawals, updateWithdrawalStatus,
};
