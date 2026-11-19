'use strict';
const mongoose = require('mongoose');
const {
  getWebCachedText,
  setWebCachedText,
  proTermScope
} = require('../web-cache');
const { translateFull } = require('../ai/services/pro.service');
const { parseTelegramTranslation } = require('../telegram-translation');

const { prepareRequest } = require('../ai/pipeline/prepare-request');
const { lookupUserTerms } = require('../ai/terminology/resolver');
const User = require('../modules/users/user.model');

// Same MongoDB PRO cache collection and key as /api/translate on the website.
// Only stateless text translations are shared, never personal chat histories/images.
const ready = () => mongoose.connection.readyState === 1;
function parsePartial(raw) {
  const source = String(raw || '');
  const known = Array.from(
    source.matchAll(
      /^\s*(BACK_TRANSLATION|VOCABULARY|TRANSLATION|PRONUNCIATION)\s*:\s*/gim
    )
  );
  const fields = {};
  for (let i = 0; i < known.length; i++) {
    fields[known[i][1].toLowerCase()] = source
      .slice(
        known[i].index + known[i][0].length,
        i + 1 < known.length ? known[i + 1].index : source.length
      )
      .trim();
  }
  return {
    translation: fields.translation,
    backTranslation: fields.back_translation,
    vocabulary: fields.vocabulary
  };
}

async function translateViaSharedCache(
  text,
  language,
  showVocabulary,
  { owner, sessionId } = {}
) {
  if (!ready())
    throw new Error('MongoDB chưa kết nối — không thể dùng cache chung');
  const context = 'auto',
    fast = false;
  let user;
  if (owner) {
    try {
      user = await User.findById(owner).select('hybridContextEnabled').lean();
    } catch {
      /* Translation can proceed without optional personalization. */
    }
  }
  const pipeline = await prepareRequest({
    text,
    targetLang: language,
    user,
    sessionId,
    channel: 'telegram'
  });
  const reverseField =
    pipeline.prepared.sourceLanguage === 'zh'
      ? 'telegramBackTranslation'
      : 'backTranslation';
  const inputIsChinese = reverseField === 'telegramBackTranslation';
  const terms =
    pipeline.cacheScope && language === 'zh'
      ? await lookupUserTerms(user._id, pipeline.prepared.evidenceText, {
          context,
          sourceLang: inputIsChinese ? 'zh' : 'vi',
          targetLang: inputIsChinese ? 'vi' : 'zh',
          v1AutoCandidates: true
        }).catch(() => [])
      : [];
  const cacheScope = pipeline.cacheScope
    ? pipeline.cacheScope + ':' + (proTermScope(user._id, terms) || '')
    : null;
  const cacheArgs = [text, language, fast, context];
  const cache = pipeline.bypassCache
    ? null
    : cacheScope
      ? await getWebCachedText(...cacheArgs, null, cacheScope)
      : await getWebCachedText(...cacheArgs);
  const missingTranslation = !cache?.translation;
  const missingBack = !Object.hasOwn(cache || {}, reverseField);
  const missingVocab =
    Boolean(showVocabulary) &&
    (!Object.hasOwn(cache || {}, 'vocabulary') ||
      cache.vocabularyVersion !== 2);

  if (!missingTranslation && !missingBack && !missingVocab) {
    return {
      translation: cache.translation,
      backTranslation: cache[reverseField] || '',
      vocabulary: showVocabulary ? cache.vocabulary || '' : '',
      cached: true
    };
  }

  const isSupplement = !missingTranslation;
  const result = await translateFull(text, language, fast, null, [], false, {
    backTranslation: missingBack,
    vocabulary: missingVocab,
    existingTranslation: isSupplement ? cache.translation : null,
    context,
    telegramMode: true,
    ...pipeline,
    ...(terms.length ? { terms } : {})
  });

  const parsed = isSupplement
    ? parsePartial(result)
    : parseTelegramTranslation(result);
  if (!isSupplement && !parsed.translation)
    throw new Error('AI chưa trả về bản dịch');
  const update = {};
  if (missingTranslation) update.translation = parsed.translation;
  if (missingBack) update[reverseField] = parsed.backTranslation || '';
  if (missingVocab) {
    update.vocabulary = parsed.vocabulary || '';
    update.vocabularyVersion = 2;
  }
  if (!pipeline.bypassCache) {
    if (cacheScope)
      await setWebCachedText(...cacheArgs, update, null, cacheScope);
    else await setWebCachedText(...cacheArgs, update);
  }
  const merged = { ...cache, ...update };
  return {
    translation: merged.translation,
    backTranslation: merged[reverseField] || '',
    vocabulary: showVocabulary ? merged.vocabulary || '' : '',
    cached: false
  };
}

module.exports = { translateViaSharedCache, parsePartial, ready };
