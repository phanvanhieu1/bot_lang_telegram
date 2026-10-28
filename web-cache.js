const crypto = require('crypto');
const mongoose = require('mongoose');

// Website cache is shared between signed-in accounts to avoid repeating
// identical translations. Telegram now shares this MongoDB translation cache.
const FREE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// Bump after prompt semantics change to avoid replaying stale V1 translations.
// No existing cached MongoDB documents are deleted.
const CACHE_KEY_VERSION = 2;

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

function freeKey(text, lang = 'zh') {
  const normalizedText = String(text).trim().replace(/\s+/g, ' ');
  return lang === 'zh'
    ? hashKey(['free', normalizedText]) // keep Chinese cache key shape within this revision
    : hashKey(['free', lang, normalizedText]);
}

function proKey(text, lang, isFast, context = 'auto') {
  return hashKey([
    'pro',
    String(text).trim(),
    String(lang),
    Boolean(isFast),
    String(context)
  ]);
}

async function getFreeCachedText(text, lang = 'zh') {
  const item = await WebTranslationCache.findOne({
    key: freeKey(text, lang),
    mode: 'free',
    expiresAt: { $gt: new Date() }
  }).select('value').lean();

  return item?.value || null;
}

async function setFreeCachedText(text, value, lang = 'zh') {
  const now = Date.now();

  await upsertCache(
    { key: freeKey(text, lang), mode: 'free' },
    {
      $set: {
        value,
        expiresAt: new Date(now + FREE_CACHE_TTL_MS)
      }
    }
  );
}

async function getWebCachedText(text, lang, isFast, context = 'auto') {
  const item = await WebTranslationCache.findOne({
    key: proKey(text, lang, isFast, context),
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

async function setWebCachedText(text, lang, isFast, context = 'auto', data) {
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
    { key: proKey(text, lang, isFast, context), mode: 'pro' },
    { $set: fields }
  );
}

module.exports = {
  getFreeCachedText,
  setFreeCachedText,
  getWebCachedText,
  setWebCachedText
};
