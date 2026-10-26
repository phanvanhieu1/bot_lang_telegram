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
    const piece = remaining.slice(0, end).trimEnd();
    if (piece) chunks.push(piece);
    remaining = remaining.slice(end).trimStart();
  }
  return chunks;
}

// Headings and AI content are sent as plain text so special characters do
// not cause Telegram's "can't parse entities" response.
function buildStudyMessages(sections) {
  const messages = [];
  for (const section of sections) {
    if (!section || typeof section.title !== 'string' || !section.body) continue;
    const prefix = section.title + '\n';
    for (const piece of splitLongText(String(section.body), MAX_MESSAGE_CHARS - Array.from(prefix).length - 4)) {
      const candidate = prefix + piece;
      if (candidate.length > 4096) throw new Error('Telegram message too long');
      messages.push(candidate);
    }
  }
  return messages;
}

function copyButtonText(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  return text.length <= MAX_COPY_CHARS ? text : null;
}

module.exports = { splitLongText, buildStudyMessages, copyButtonText };
