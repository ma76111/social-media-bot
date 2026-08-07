'use strict';

/**
 * escMd — يعمل escape للنصوص القادمة من المستخدمين
 * قبل إدراجها في رسائل Markdown
 *
 * يحمي من: * _ ` [ ] ( ) ~ > # + - = | { } . !
 * (كل الرموز الخاصة بـ MarkdownV1 وMarkdownV2)
 *
 * نستخدم MarkdownV1 (parse_mode: 'Markdown') فنحتاج فقط:
 *   * _ ` [
 */
function escMd(text) {
  if (!text && text !== 0) return '';
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/\*/g, '\\*')
    .replace(/_/g,  '\\_')
    .replace(/`/g,  '\\`')
    .replace(/\[/g, '\\[');
}

module.exports = { escMd };
