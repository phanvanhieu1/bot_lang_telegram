'use strict';
// Telegram sendMessage allows 4096 characters after entities parsing.
// Plain text removes parsing failures caused by untrusted AI translations.
const MAX_MESSAGE_CHARS = 3500;
const MAX_COPY_CHARS = 256;

function splitLongText(value, limit = MAX_MESSAGE_CHARS) {
  if (!Number.isSafeInteger(limit) || limit < 32 || limit > 4096) {
    throw new RangeError('Invalid Telegram chunk size');
  }
  let remaining = String(value ?? '');
  const chunks = [];
  while (remaining) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }
    let end = limit;
    const char = remaining.charCodeAt(end - 1);
    if (end < remaining.length && char >= 0xD800 && char <= 0xDBFF) end--;
    const search = remaining.slice(Math.floor(end * 0.6), end);
    const spaceAt = Math.max(search.lastIndexOf(' '), search.lastIndexOf(String.fromCharCode(10)));
    if (spaceAt >= 0) end = Math.floor(end * 0.6) + spaceAt + 1;
    const piece = remaining.slice(0, end);
    chunks.push(piece);
    remaining = remaining.slice(end);
  }
  return chunks;
}

function copyButtonText(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  return text.length <= MAX_COPY_CHARS ? text : null;
}

// Telegraf 4.16.3 does not provide Markup.button.copyText(), but the
// Telegram Bot API accepts an InlineKeyboardButton.copy_text payload.
function copyInlineButton(text) {
  const safe = copyButtonText(text);
  if (!safe) return null;
  return { text: '📋', copy_text: { text: safe } };
}

module.exports = { splitLongText, copyButtonText, copyInlineButton };
