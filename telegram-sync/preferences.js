'use strict';
const mongoose = require('mongoose');
const { getUserConfig } = require('../session');

const fields = [
  'targetLang','voiceKey','speed',
  'showPronunciation','showBackTranslation','showVocabulary'
];
const schema = new mongoose.Schema({
  telegramId: { type: String, required: true },
  namespace: { type: String, required: true, enum: ['test','production'] },
  preferences: { type: mongoose.Schema.Types.Mixed, required: true }
}, { timestamps:true, versionKey:false });
schema.index({ telegramId:1, namespace:1 }, { unique:true });
const TelegramPreferences = mongoose.models.TelegramPreferences ||
  mongoose.model('TelegramPreferences', schema);
const initialized = new Set();
const locks = new Map();
const ready = () => mongoose.connection.readyState === 1;
const namespace = () => process.env.TELEGRAM_TEST_MODE === '1' ? 'test' : 'production';
const pick = obj => Object.fromEntries(fields.filter(k => Object.hasOwn(obj,k)).map(k => [k,obj[k]]));

async function updatePreferences(ctx, next) {
  if (!ready()) return next();
  const telegramId = String(ctx.from.id);
  const key = namespace()+':'+telegramId;
  const c = getUserConfig(ctx.from.id);
  let shouldInsert = false;

  if (!initialized.has(key)) {
    const saved = await TelegramPreferences.findOne({
      telegramId, namespace: namespace()
    }).select('preferences').lean();
    if (saved?.preferences) {
      Object.assign(c, pick(saved.preferences));
    } else {
      shouldInsert = true;
    }
    initialized.add(key);
  }
  const before = JSON.stringify(pick(c));
  try { return await next(); }
  finally {
    const current = pick(c);
    // Most Telegram messages don't modify settings: avoid a MongoDB write
    // on each translation, voice callback, /export and menu navigation.
    if (shouldInsert || before !== JSON.stringify(current)) {
      try {
        await TelegramPreferences.updateOne(
          { telegramId, namespace: namespace() },
          { $set:{ preferences:current } },
          { upsert:true }
        );
      } catch (error) {
        console.warn('Telegram preferences MongoDB:',error.message);
      }
    }
  }
}

// Serialize callbacks from the same Telegram user, so concurrent settings
// changes cannot overwrite a more recent choice in MongoDB.
async function syncTelegramPreferences(ctx, next) {
  if (!ctx.from?.id || !ready()) return next();
  const key = namespace()+':'+String(ctx.from.id);
  const previous = locks.get(key);
  let unlock;
  const lock = new Promise(resolve => { unlock = resolve; });
  locks.set(key, lock);
  if (previous) await previous;
  try { return await updatePreferences(ctx, next); }
  finally {
    if (locks.get(key) === lock) locks.delete(key);
    unlock();
  }
}

module.exports = { syncTelegramPreferences, TelegramPreferences };
