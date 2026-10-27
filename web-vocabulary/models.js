// PRO-only per-account vocabulary, with durable processing and deduplication.
const mongoose = require('mongoose');
const id = { type: mongoose.Schema.Types.ObjectId, ref:'User', required:true, index:true };
const options = { versionKey:false, timestamps:true };

const settingSchema = new mongoose.Schema({
  userId: { ...id, unique:true },
  enabled: { type:Boolean, default:false, required:true }
}, options);
const entrySchema = new mongoose.Schema({
  userId:id,
  language:{ type:String, enum:['zh','en'], required:true },
  type:{ type:String, enum:['word','phrase','pattern'], required:true },
  key:{ type:String, required:true, maxlength:90 },
  text:{ type:String, required:true, maxlength:90 },
  meaning:{ type:String, default:'', maxlength:450 },
  pinyin:{ type:String, default:'', maxlength:250 },
  category:{ type:String, enum:['work','daily_life','both','unclassified'], default:'unclassified' },
  classificationSource:{ type:String, enum:['rule','translation','ai','deepl','pending','manual'], default:'pending' },
  manualOverride:{ type:Boolean, default:false },
  analysisAttempts:{ type:Number, default:0 },
  nextAnalysisAt:{ type:Date, default:Date.now },
  encounterCount:{ type:Number, default:0, min:0 },
  occurrenceCount:{ type:Number, default:0, min:0 },
  workCount:{ type:Number, default:0, min:0 },
  dailyCount:{ type:Number, default:0, min:0 },
  firstSeenAt:{ type:Date, default:Date.now },
  lastSeenAt:{ type:Date, default:Date.now },
  mastery:{ type:String, enum:['new','learning','known'], default:'new' }
}, options);
entrySchema.index({ userId:1, language:1, type:1, key:1 }, { unique:true });
entrySchema.index({ userId:1, language:1, encounterCount:-1 });
entrySchema.index({ classificationSource:1, nextAnalysisAt:1 });

const candidateSchema = new mongoose.Schema({
  key:String, text:String, type:String, meaning:String,
  category:String, topicHint:String, source:String, occurrences:Number
}, { _id:false });
const jobSchema = new mongoose.Schema({
  userId:id,
  eventId:{ type:String, required:true, maxlength:64 },
  language:{ type:String, enum:['zh','en'], required:true },
  candidates:{ type:[candidateSchema], default:[] },
  status:{ type:String, enum:['pending','processing','completed','failed'], default:'pending' },
  runAt:{ type:Date, default:Date.now },
  lockedUntil:{ type:Date, default:null },
  attempts:{ type:Number, default:0 },
  error:{ type:String, default:'', maxlength:250 },
  expiresAt:{ type:Date, default:null }
}, options);
jobSchema.index({ userId:1, eventId:1 }, { unique:true });
jobSchema.index({ status:1, runAt:1, lockedUntil:1 });
jobSchema.index({ expiresAt:1 }, { expireAfterSeconds:0 });

const occurrenceSchema = new mongoose.Schema({
  userId:id,
  eventId:{ type:String, required:true },
  language:{ type:String, enum:['zh','en'], required:true },
  type:{ type:String, enum:['word','phrase','pattern'], required:true },
  key:{ type:String, required:true },
  category:{ type:String, enum:['work','daily_life','both','unclassified'], required:true },
  count:{ type:Number, required:true },
  seenAt:{ type:Date, default:Date.now },
  expiresAt:{ type:Date, required:true }
}, { versionKey:false });
occurrenceSchema.index({ userId:1, eventId:1, language:1, type:1, key:1 }, { unique:true });
occurrenceSchema.index({ expiresAt:1 }, { expireAfterSeconds:0 });

const mutedSchema = new mongoose.Schema({
  userId:id,
  language:{ type:String, enum:['zh','en'], required:true },
  type:{ type:String, enum:['word','phrase','pattern'], required:true },
  key:{ type:String, required:true, maxlength:90 }
}, { versionKey:false, timestamps:true });
mutedSchema.index({ userId:1, language:1, type:1, key:1 }, { unique:true });

// An account/language-specific, five-minute fingerprint of an already
// processed source. TTL is for cleanup; expiry checks are always performed
// explicitly because MongoDB TTL deletion can lag behind.
const recentSchema = new mongoose.Schema({
  userId:id,
  language:{ type:String, enum:['zh','en'], required:true },
  fingerprint:{ type:String, required:true, maxlength:64 },
  expiresAt:{ type:Date, required:true }
}, { versionKey:false });
recentSchema.index({ userId:1, language:1, fingerprint:1 }, { unique:true });
recentSchema.index({ expiresAt:1 }, { expireAfterSeconds:0 });

const model = (name,schema) => mongoose.models[name] || mongoose.model(name,schema);
module.exports = {
  VocabularySetting:model('VocabularySetting',settingSchema),
  VocabularyEntry:model('VocabularyEntry',entrySchema),
  VocabularyJob:model('VocabularyJob',jobSchema),
  VocabularyOccurrence:model('VocabularyOccurrence',occurrenceSchema),
  VocabularyMuted:model('VocabularyMuted',mutedSchema),
  VocabularyRecentInput:model('VocabularyRecentInput',recentSchema)
};
