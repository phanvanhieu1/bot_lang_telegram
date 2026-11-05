const crypto = require('crypto');
const mongoose = require('mongoose');

// Website cache is shared between signed-in accounts to avoid repeating
// identical translations. Telegram now shares this MongoDB translation cache.
const FREE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_KEY_VERSION = 1;

const webTranslationCacheSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  mode: { type: String, enum: ['free', 'pro'], required: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
  expiresAt: { type: Date, default: null }
}, {
  timestamps: true,
  versionKey: false
});

// MongoDB automatically removes FREE cache entries after their expiry.
// PRO entries keep expiresAt=null and do not expire automatically.
webTranslationCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const WebTranslationCache = mongoose.models.WebTranslationCache ||
  mongoose.model(
    'WebTranslationCache',
    webTranslationCacheSchema,
    'web_translation_cache'
  );

// Two users can miss the same key at the same time. If a concurrent upsert
// wins the unique-key race, update that existing entry instead of dropping
// the cache write.
async function upsertCache(filter, update) {
  try {
    await WebTranslationCache.updateOne(filter, update, { upsert: true });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    await WebTranslationCache.updateOne(filter, update, { upsert: false });
  }
}

function hashKey(parts) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify([CACHE_KEY_VERSION, ...parts]))
    .digest('hex');
}

function freeKey(text, lang = 'zh', context = 'auto') {
  const normalizedText = String(text).trim().replace(/\s+/g, ' ');
  // Versioned for explicit vs automatic context; no stale translations.
  // Invalidate obsolete zh translations that could alter/omit proper names.
  // English requests keep their previous cache namespace.
  return lang === 'zh'
    ? hashKey(['free-context-3-names', normalizedText, String(context)])
    : hashKey(['free-context-2', lang, normalizedText, String(context)]);
}

function proKey(text, lang, isFast, context = 'auto', translationModel = null) {
  // A manually chosen translator model has its own namespace. Requests from
  // older clients without a choice continue to use their legacy cache keys.
  return hashKey([
    translationModel?'pro-model-choice-2-vietnamese-backtranslation':lang==='zh'?'pro-context-3-names':'pro-context-2',
    String(text).trim(),
    String(lang),
    Boolean(isFast),
    String(context),
    ...(translationModel?[translationModel]:[])
  ]);
}

async function getFreeCachedText(text, lang = 'zh', context = 'auto') {
  const item = await WebTranslationCache.findOne({
    key: freeKey(text, lang, context),
    mode: 'free',
    expiresAt: { $gt: new Date() }
  }).select('value').lean();

  return item?.value || null;
}

async function setFreeCachedText(text, value, lang = 'zh', context = 'auto') {
  const now = Date.now();

  await upsertCache(
    { key: freeKey(text, lang, context), mode: 'free' },
    {
      $set: {
        value,
        expiresAt: new Date(now + FREE_CACHE_TTL_MS)
      }
    }
  );
}

async function getWebCachedText(text, lang, isFast, context = 'auto', translationModel = null) {
  const item = await WebTranslationCache.findOne({
    key: proKey(text, lang, isFast, context, translationModel),
    mode: 'pro'
  }).select('value').lean();

  return item?.value &&
    typeof item.value === 'object' &&
    !Array.isArray(item.value)
    ? item.value
    : null;
}

const PRO_FIELDS = new Set([
  'translation',
  'sourceLanguage',
  'backTranslation',
  'telegramBackTranslation',
  'pronunciation',
  'vocabulary',
  'vocabularyVersion',
  'verification'
]);

async function setWebCachedText(text, lang, isFast, context = 'auto', data, translationModel = null) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new TypeError('PRO cache data must be an object');
  }

  // Atomic field updates prevent optional translation components from
  // overwriting each other when simultaneous requests reach MongoDB.
  const fields = {};
  for (const [field, value] of Object.entries(data)) {
    if (!PRO_FIELDS.has(field)) {
      throw new Error(`Unsupported PRO cache field: ${field}`);
    }
    fields[`value.${field}`] = value;
  }

  if (!Object.keys(fields).length) return;

  await upsertCache(
    { key: proKey(text, lang, isFast, context, translationModel), mode: 'pro' },
    { $set: fields }
  );
}

module.exports = {
  proKey,
  getFreeCachedText,
  setFreeCachedText,
  getWebCachedText,
  setWebCachedText
};
