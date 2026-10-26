'use strict';
const mongoose = require('mongoose');
const { getWebCachedText, setWebCachedText } = require('../web-cache');
const { translateFull } = require('../ai/services/pro.service');
const { parseTelegramTranslation } = require('../telegram-translation');

// Same MongoDB PRO cache collection and key as /api/translate on the website.
// Only stateless text translations are shared, never personal chat histories/images.
const ready = () => mongoose.connection.readyState === 1;
function parsePartial(raw) {
  const source = String(raw || '');
  const known = Array.from(source.matchAll(/^\s*(BACK_TRANSLATION|VOCABULARY|TRANSLATION|PRONUNCIATION)\s*:\s*/gim));
  const fields = {};
  for (let i=0; i<known.length; i++) {
    fields[known[i][1].toLowerCase()] = source.slice(
      known[i].index + known[i][0].length,
      i+1 < known.length ? known[i+1].index : source.length
    ).trim();
  }
  return {
    translation: fields.translation,
    backTranslation: fields.back_translation,
    vocabulary: fields.vocabulary
  };
}

async function translateViaSharedCache(text, language, showVocabulary) {
  if (!ready()) throw new Error('MongoDB chưa kết nối — không thể dùng cache chung');
  const context = 'auto', fast = false;
  const cache = await getWebCachedText(text, language, fast, context);
  const missingTranslation = !cache?.translation;
  // Website intentionally skips reverse translations for Chinese input.
  // Telegram supplements this in the same shared cache without replacing
  // its existing canonical translation.
  const missingBack = !cache?.backTranslation;
  const missingVocab = Boolean(showVocabulary) &&
    (!Object.hasOwn(cache || {}, 'vocabulary') || cache.vocabularyVersion !== 2);

  if (!missingTranslation && !missingBack && !missingVocab) {
    return { translation: cache.translation,
      backTranslation: cache.backTranslation || '',
      vocabulary: showVocabulary ? cache.vocabulary || '' : '',
      cached: true };
  }

  const isSupplement = !missingTranslation;
  const result = await translateFull(text, language, fast, null, [], false, {
    backTranslation: missingBack,
    vocabulary: missingVocab,
    existingTranslation: isSupplement ? cache.translation : null,
    context, telegramMode: true
  });

  const parsed = isSupplement ? parsePartial(result) : parseTelegramTranslation(result);
  if (!isSupplement && !parsed.translation) throw new Error('AI chưa trả về bản dịch');
  const update = {};
  if (missingTranslation) update.translation = parsed.translation;
  if (missingBack) update.backTranslation = parsed.backTranslation || '';
  if (missingVocab) {
    update.vocabulary = parsed.vocabulary || '';
    update.vocabularyVersion = 2;
  }
  await setWebCachedText(text, language, fast, context, update);
  const merged = { ...cache, ...update };
  return {
    translation: merged.translation,
    backTranslation: merged.backTranslation || '',
    vocabulary: showVocabulary ? merged.vocabulary || '' : '',
    cached: false
  };
}

module.exports = { translateViaSharedCache, parsePartial, ready };
