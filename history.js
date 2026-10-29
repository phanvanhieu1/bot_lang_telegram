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

async function addHistory({ userId, text, targetLang, learningLang = 'zh', result, details = null }) {
  if (!userId) throw new Error('Missing history owner');

  // Bound stored metadata: a snapshot can include sensitive AI prompts only
  // when the user enabled the inspector on that translation. Owner scoped.
  let safeDetails=null;
  if(details && typeof details==='object' && !Array.isArray(details)){
    const serialized=JSON.stringify(details);
    if(Buffer.byteLength(serialized,'utf8')<=200000){
      safeDetails=JSON.parse(serialized);
    }else{
      // Keep translation and accounting if extremely long raw AI traffic.
      const {inspection,...summary}=details;
      if(Buffer.byteLength(JSON.stringify(summary),'utf8')<=200000){
        safeDetails={...summary,inspection:null,
          inspectionUnavailable:'Luồng AI quá dài nên không được lưu vào lịch sử.'};
      }
    }
  }
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

module.exports = { addHistory, getHistory, getHistoryDetail, clearHistory };
