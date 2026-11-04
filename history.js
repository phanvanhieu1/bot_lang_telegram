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
  learningLang: { type: String, enum: ['zh', 'en'], default: 'zh' },
  result: { type: String, required: true },
  // Historical display snapshot. Never included in history listing responses.
  details: { type: mongoose.Schema.Types.Mixed, default: null }
}, { versionKey: false });

historySchema.index({ userId: 1, time: -1, _id: -1 });

const TranslationHistory = mongoose.models.TranslationHistory ||
  mongoose.model('TranslationHistory', historySchema);

const MAX_DETAILS_BYTES=200000;
function boundedHistoryDetails(details){
  if(!details||typeof details!=='object'||Array.isArray(details))return null;
  // Snapshot fields are whitelisted by historySnapshot; do not mutate it.
  const clone=JSON.parse(JSON.stringify(details));
  const bytes=value=>Buffer.byteLength(JSON.stringify(value),'utf8');
  if(bytes(clone)<=MAX_DETAILS_BYTES)return clone;
  // Inspector lives under payload.inspection, not at the root.
  if(clone.payload?.inspection){
    delete clone.payload.inspection;
    clone.inspectionUnavailable='Luồng AI quá dài nên không được lưu vào lịch sử.';
    if(bytes(clone)<=MAX_DETAILS_BYTES)return clone;
  }
  // Keep original result in the parent document and retain small accounting
  // even if unusually large vocabulary/analysis metadata exceeds the cap.
  const usage=clone.payload?.requestUsage;
  const minimal={version:clone.version,engine:clone.engine,
    context:clone.context,options:clone.options,
    payload:usage?{requestUsage:usage}:{},
    inspectionUnavailable:'Chi tiết vượt giới hạn lưu trữ; đã giữ lại bản dịch gốc.'};
  if(bytes(minimal)<=MAX_DETAILS_BYTES)return minimal;
  return {version:clone.version,engine:clone.engine,context:clone.context,
    options:clone.options,payload:{},
    inspectionUnavailable:'Chi tiết quá dài để lưu.'};
}
async function addHistory({ userId, text, targetLang, learningLang = 'zh', result, details = null }) {
  if (!userId) throw new Error('Missing history owner');
  const safeDetails=boundedHistoryDetails(details);
  const item = await TranslationHistory.create({
    userId, text, targetLang, learningLang, result, details:safeDetails
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
    learningLang: item.learningLang || 'zh',
    result: item.result
  };
}

async function getHistory(userId) {
  if (!userId) throw new Error('Missing history owner');

  const items = await TranslationHistory.find({ userId })
    .sort({ time: -1, _id: -1 })
    .limit(MAX_HISTORY)
    .select('time text targetLang learningLang result details.engine details.context')
    .lean();

  return items.map(item => ({
    id: String(item._id),
    time: item.time.toISOString(),
    text: item.text,
    targetLang: item.targetLang,
    learningLang:item.learningLang||'zh',
    engine:item.details?.engine||null,
    context:item.details?.context||null,
    result: item.result
  }));
}

async function getHistoryDetail(userId,historyId) {
  if(!userId)throw new Error('Missing history owner');
  if(!mongoose.isValidObjectId(historyId))return null;
  const item=await TranslationHistory.findOne({_id:historyId,userId})
    .select('time text targetLang learningLang result details').lean();
  if(!item)return null;
  return {id:String(item._id),time:item.time.toISOString(),
    text:item.text,targetLang:item.targetLang,
    learningLang:item.learningLang||'zh',
    result:item.result,details:item.details||null};
}

async function clearHistory(userId, learningLang = null) {
  if (!userId) throw new Error('Missing history owner');
  if (learningLang && !['zh', 'en'].includes(learningLang)) throw new Error('Unsupported language');
  const filter = { userId };
  if (learningLang === 'en') filter.learningLang = 'en';
  if (learningLang === 'zh') filter.$or = [
    { learningLang: 'zh' },
    { learningLang: { $exists: false } }
  ];
  await TranslationHistory.deleteMany(filter);
}

module.exports = { addHistory, getHistory, getHistoryDetail, clearHistory, boundedHistoryDetails };
