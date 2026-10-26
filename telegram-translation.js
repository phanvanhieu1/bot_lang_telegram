'use strict';

// Parse named fields before presenting a translation. Do not let text from
// BACK_TRANSLATION, VOCABULARY or PRONUNCIATION leak into Copy or TTS.
const FIELDS = new Set(['TRANSLATION', 'BACK_TRANSLATION', 'PRONUNCIATION', 'VOCABULARY', 'VERIFICATION']);

function parseTelegramTranslation(raw) {
  const source = typeof raw === 'string' ? raw.replace(/\r\n/g, '\n').trim() : '';
  if (!source) throw new Error('AI không trả về bản dịch');

  const headings = /^\s*(TRANSLATION|BACK_TRANSLATION|PRONUNCIATION|VOCABULARY|VERIFICATION)\s*:\s*/gim;
  const positions = Array.from(source.matchAll(headings));
  if (!positions.length) {
    return { translation: source, backTranslation: '', pronunciation: '', vocabulary: '' };
  }

  const parsed = Object.create(null);
  for (let i = 0; i < positions.length; i++) {
    const match = positions[i];
    const name = match[1].toUpperCase();
    if (!FIELDS.has(name)) continue;
    const nextStart = i + 1 < positions.length ? positions[i + 1].index : source.length;
    const value = source.slice(match.index + match[0].length, nextStart).trim();
    if (!(name in parsed)) parsed[name] = value;
  }

  // Never copy or read the full raw response when the TRANSLATION field is
  // missing. A hidden extra section is not a valid translated sentence.
  if (!parsed.TRANSLATION) throw new Error('Kết quả AI thiếu trường TRANSLATION');

  return {
    translation: parsed.TRANSLATION,
    backTranslation: parsed.BACK_TRANSLATION || '',
    pronunciation: parsed.PRONUNCIATION || '',
    vocabulary: parsed.VOCABULARY || ''
  };
}

function buildTranslationButtons({ translation, speechId, vocabId, copyInlineButton, callbackButton }) {
  if (!translation || !speechId || typeof copyInlineButton !== 'function' || typeof callbackButton !== 'function') {
    throw new TypeError('Invalid translation actions');
  }
  const row = [];
  const copy = copyInlineButton(translation);
  if (copy) row.push(copy);
  if (vocabId) row.push(callbackButton('💾', 'save_vocab_' + vocabId));
  row.push(callbackButton('🔊', 'speak_translation_' + speechId));
  return { inline_keyboard: [row] };
}

// The three learner-facing fields are rendered together in ONE Telegram message.
// Vocabulary is available via the Save action, never appended as a separate bubble.
function buildCompactTranslation({ translation, pinyin, backTranslation }) {
  if (typeof translation !== 'string' || !translation.trim()) {
    throw new TypeError('Missing primary translation');
  }
  const lines = ['📖 ' + translation.trim()];
  if (typeof pinyin === 'string' && pinyin.trim()) lines.push('🔤 ' + pinyin.trim());
  if (typeof backTranslation === 'string' && backTranslation.trim()) lines.push('🔁 ' + backTranslation.trim());
  return lines.join('\n');
}

const hasHan = text => /[\u3400-\u9FFF]/u.test(String(text || ''));

function getChineseSentence(source, translation, backTranslation = '') {
  if (hasHan(translation)) return translation;
  if (hasHan(source)) return source;
  // Photo messages have no recognized source text until AI responds.
  if (hasHan(backTranslation)) return backTranslation;
  return '';
}

// In the Mandarin workflow, a non-Chinese TRANSLATION is Vietnamese.
// The language is stored with its translation so later language changes
// don't affect an existing Telegram speaker button.
function getSpeechLanguage(source, translation, targetLang) {
  if (hasHan(translation)) return 'zh';
  if (targetLang === 'zh') return 'vi';
  if (/[À-ỹ]/u.test(translation)) return 'vi';
  return 'other';
}

module.exports = { parseTelegramTranslation, buildTranslationButtons, buildCompactTranslation, getChineseSentence, getSpeechLanguage };
