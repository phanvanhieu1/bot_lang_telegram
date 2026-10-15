const mongoose = require('mongoose');

// Per-account website AI usage. Does not affect Telegram bot.
const usageSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  time: { type: Date, default: Date.now },
  tokens: { type: Number, default: 0, min: 0 },
  cost: { type: Number, default: 0, min: 0 }
}, { versionKey: false });

usageSchema.index({ userId: 1, time: -1 });

const TranslationUsage = mongoose.models.TranslationUsage ||
  mongoose.model('TranslationUsage', usageSchema);

async function addUsage({ userId, totalTokens, cost }) {
  if (!userId) throw new Error('Missing usage owner');

  await TranslationUsage.create({
    userId,
    tokens: Number(totalTokens) || 0,
    cost: Number(cost) || 0
  });
}

async function getUsageStats(userId) {
  if (!userId) throw new Error('Missing usage owner');

  const now = new Date();
  // Preserve the existing server-local definition of "today".
  const todayStart = new Date(
    now.getFullYear(), now.getMonth(), now.getDate()
  );

  const [stats] = await TranslationUsage.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(String(userId)) } },
    {
      $facet: {
        today: [
          { $match: { time: { $gte: todayStart } } },
          {
            $group: {
              _id: null,
              requests: { $sum: 1 },
              tokens: { $sum: '$tokens' },
              cost: { $sum: '$cost' }
            }
          }
        ],
        total: [
          {
            $group: {
              _id: null,
              requests: { $sum: 1 },
              tokens: { $sum: '$tokens' },
              cost: { $sum: '$cost' }
            }
          }
        ]
      }
    }
  ]);

  const empty = { requests: 0, tokens: 0, cost: 0 };
  const normalize = (record) => ({
    requests: record?.requests || 0,
    tokens: record?.tokens || 0,
    cost: record?.cost || 0
  });

  return {
    today: stats?.today?.length ? normalize(stats.today[0]) : empty,
    total: stats?.total?.length ? normalize(stats.total[0]) : { ...empty }
  };
}

module.exports = { addUsage, getUsageStats };
