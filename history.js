const mongoose = require('mongoose');

// Website history is private to the signed-in Google account.
// Legacy history.json is deliberately not imported: its records have no owner.
const MAX_HISTORY = 200;

const historySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  time: { type: Date, default: Date.now },
  text: { type: String, required: true },
  targetLang: { type: String, required: true },
  result: { type: String, required: true }
}, { versionKey: false });

historySchema.index({ userId: 1, time: -1, _id: -1 });

const TranslationHistory = mongoose.models.TranslationHistory ||
  mongoose.model('TranslationHistory', historySchema);

async function addHistory({ userId, text, targetLang, result }) {
  if (!userId) throw new Error('Missing history owner');

  const item = await TranslationHistory.create({
    userId, text, targetLang, result
  });

  // Keep the same maximum as the old JSON history, now per user.
  const outdated = await TranslationHistory.find({ userId })
    .sort({ time: -1, _id: -1 })
    .skip(MAX_HISTORY)
    .select('_id')
    .lean();

  if (outdated.length) {
    await TranslationHistory.deleteMany({
      userId,
      _id: { $in: outdated.map(entry => entry._id) }
    });
  }

  return {
    id: String(item._id),
    time: item.time.toISOString(),
    text: item.text,
    targetLang: item.targetLang,
    result: item.result
  };
}

async function getHistory(userId) {
  if (!userId) throw new Error('Missing history owner');

  const items = await TranslationHistory.find({ userId })
    .sort({ time: -1, _id: -1 })
    .limit(MAX_HISTORY)
    .select('time text targetLang result')
    .lean();

  return items.map(item => ({
    id: String(item._id),
    time: item.time.toISOString(),
    text: item.text,
    targetLang: item.targetLang,
    result: item.result
  }));
}

async function clearHistory(userId) {
  if (!userId) throw new Error('Missing history owner');
  await TranslationHistory.deleteMany({ userId });
}

module.exports = { addHistory, getHistory, clearHistory };
