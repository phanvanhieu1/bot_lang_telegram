'use strict';
const mongoose = require('mongoose');
const { getUserConfig } = require('../session');

const fields = [
  'targetLang','voiceKey','speed',
  'showTranslation','showPronunciation','showBackTranslation','showVocabulary'
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
const ready = () => mongoose.connection.readyState === 1;
const namespace = () => process.env.TELEGRAM_TEST_MODE === '1' ? 'test' : 'production';
const pick = obj => Object.fromEntries(fields.filter(k => Object.hasOwn(obj,k)).map(k => [k,obj[k]]));

async function syncTelegramPreferences(ctx, next) {
  if (!ctx.from?.id || !ready()) return next();
  const key = namespace()+':'+String(ctx.from.id);
  const c = getUserConfig(ctx.from.id);
  if (!initialized.has(key)) {
    const saved = await TelegramPreferences.findOne({
      telegramId: String(ctx.from.id), namespace: namespace()
    }).select('preferences').lean();
    if (saved?.preferences) {
      Object.assign(c, pick(saved.preferences));
    }
    initialized.add(key);
  }
  try { return await next(); }
  finally {
    // Keep pending audio callback tokens and raw conversation history local;
    // persist the user's actual Telegram settings in MongoDB.
    try {
      await TelegramPreferences.updateOne(
        { telegramId:String(ctx.from.id), namespace:namespace() },
        { $set:{ preferences:pick(c) } },
        { upsert:true }
      );
    } catch(error) { console.warn('Telegram preferences MongoDB:',error.message); }
  }
}
module.exports = { syncTelegramPreferences, TelegramPreferences };
