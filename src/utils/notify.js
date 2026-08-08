'use strict';

/**
 * notify.js — دوال الإشعارات المشتركة
 *
 * مستقل عن user.js لكسر الـ circular dependency:
 *   user.js ← require('./withdraw') ← require('./user')
 *
 * كل handler يستورد منه مباشرة بدل ما يستورد من user.js
 */

const db             = require('../db');
const { t }          = require('../i18n');
const { formatAmount } = require('./price');

// ─────────────────────────────────────────────
//  getLang / getCurrency — helpers مستقلة
// ─────────────────────────────────────────────
function getLang(userId)     { return db.getUser(userId).lang     || 'ar'; }
function getCurrency(userId) { return db.getUser(userId).currency || 'egp'; }

// ─────────────────────────────────────────────
//  notifyUser — إرسال رسالة مع Markdown fallback
// ─────────────────────────────────────────────
async function notifyUser(bot, userId, text) {
  try {
    await bot.sendMessage(userId, text, { parse_mode: 'Markdown' });
    return true;
  } catch (e) {
    if (e.code === 'ETELEGRAM') {
      try {
        const plain = text
          .replace(/\*([^*]+)\*/g, '$1')
          .replace(/_([^_]+)_/g, '$1')
          .replace(/`([^`]+)`/g, '$1');
        await bot.sendMessage(userId, plain);
        return true;
      } catch { return false; }
    }
    return false;
  }
}

// ─────────────────────────────────────────────
//  notifyApproved / notifyRejected
// ─────────────────────────────────────────────
async function notifyApproved(bot, sub, task) {
  const lang     = getLang(sub.userId);
  const currency = getCurrency(sub.userId);
  const reward   = db.getEffectiveReward(sub.userId, task);
  const { display, symbol } = await formatAmount(reward, currency);
  const taskName = db.getTaskText(task, 'name', lang);
  return notifyUser(bot, sub.userId,
    t('notify_approved', lang, taskName, sub.id.substring(0, 8), display, symbol)
  );
}

async function notifyRejected(bot, sub, task, reason) {
  const lang     = getLang(sub.userId);
  const taskName = db.getTaskText(task, 'name', lang);
  return notifyUser(bot, sub.userId,
    t('notify_rejected', lang, taskName, sub.id.substring(0, 8), reason || '')
  );
}

module.exports = { notifyUser, notifyApproved, notifyRejected, getLang, getCurrency };
