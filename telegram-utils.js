'use strict';
// Telegram sendMessage allows 4096 characters after entities parsing.
// Plain text removes parsing failures caused by untrusted AI translations.
const MAX_MESSAGE_CHARS = 3500;
const MAX_COPY_CHARS = 256;

function splitLongText(value, limit = MAX_MESSAGE_CHARS) {
  if (!Number.isSafeInteger(limit) || limit < 32 || limit > 4096) {
    throw new RangeError('Invalid Telegram chunk size');
  }
  const chars = Array.from(String(value ?? ''));
  if (!chars.length) return [];
  const chunks = [];
  while (chars.length) {
    if (chars.length <= limit) {
      chunks.push(chars.join(''));
      break;
    }
    let end = limit;
    // Prefer splitting at whitespace, but never create very short fragments.
    for (let i = limit; i > Math.floor(limit * 0.6); i--) {
      if (/\s/.test(chars[i])) { end = i; break; }
    }
    const chunk = chars.splice(0, end).join('').trimEnd();
    if (chunk) chunks.push(chunk);
    while (chars[0] === ' ' || chars[0] === '\n') chars.shift();
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
