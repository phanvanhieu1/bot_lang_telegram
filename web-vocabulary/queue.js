// Durable, account-isolated vocabulary ingestion. This module is never imported by the Telegram bot.
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { pinyin } = require('pinyin-pro');
const User = require('../modules/users/user.model');
const { effectiveRole } = require('../web-maintenance');
const { extractCandidates } = require('./extractor');
const { analyzeBatch, MAX_ITEMS_PER_CALL } = require('./classifier');
const {
  VocabularySetting, VocabularyEntry, VocabularyJob,
  VocabularyOccurrence, VocabularyMuted, VocabularyRecentInput
} = require('./models');

const POLL_MS = 15000;
const BATCH_DELAY_MS = 35000;
const MAX_JOBS_PER_BATCH = 6;
const DUPLICATE_WINDOW_MS = 5 * 60 * 1000;
let busy = false;
let lastPendingScan = 0;
let timer = null;

function entryId(item) {
  return item.type + ':' + item.key;
}

function inputFingerprint(foreignText, language) {
  // Never save the original message for deduplication: store only SHA256.
  const normalized = String(foreignText).normalize('NFKC')
    .replace(/\s+/g,' ').trim();
  return crypto.createHash('sha256').update(
    language+':'+(language==='en'?normalized.toLowerCase():normalized)
  ).digest('hex');
}

async function captureTranslation({ userId, language, foreignText, context = 'auto', additionalVocabulary = '' }) {
  if (!userId || !['zh','en'].includes(language)) return false;
  if (typeof foreignText !== 'string' || !foreignText.trim()) return false;
  const setting = await VocabularySetting.findOne({ userId, enabled:true }).select('_id').lean();
  if (!setting) return false;

  const candidates = extractCandidates({ foreignText, language, context, additionalVocabulary });
  if (!candidates.length) return false;

  const fingerprint = inputFingerprint(foreignText,language);
  const expiresAt = new Date(Date.now()+DUPLICATE_WINDOW_MS);
  const filter = { userId,language,fingerprint };
  // Atomic claim also works if the old TTL document has not been cleaned up.
  let claimed = await VocabularyRecentInput.findOneAndUpdate(
    { ...filter, expiresAt:{ $lte:new Date() } },
    { $set:{ expiresAt } },{ new:true }
  ).lean();
  if (!claimed) {
    try {
      claimed = await VocabularyRecentInput.create({ ...filter, expiresAt });
    } catch (error) {
      if (error?.code===11000) return false; // Same input in the last 5 minutes.
      throw error;
    }
  }

  try {
    await VocabularyJob.create({
      userId, language, candidates, status:'pending',
      eventId:crypto.randomUUID(),
      runAt:new Date(Date.now()+BATCH_DELAY_MS)
    });
  } catch (error) {
    // Permit retry if a transient MongoDB failure stopped job creation.
    await VocabularyRecentInput.deleteOne({ ...filter, expiresAt }).catch(()=>{});
    throw error;
  }
  return true;
}

// Fire-and-forget only after the authenticated translation succeeds.
// All queued content is already reduced to lexical candidates, never full chats.
function scheduleCapture(args) {
  void captureTranslation(args).catch(error => {
    console.error('Vocabulary enqueue failed:', error.message);
  });
}

async function claimJob(userId = null, language = null) {
  const now = new Date();
  const filter = {
    attempts:{ $lt:4 },
    $or:[
      { status:'pending', runAt:{ $lte:now } },
      { status:'processing', lockedUntil:{ $lte:now } }
    ]
  };
  if (userId) filter.userId = userId;
  if (language) filter.language = language;
  return VocabularyJob.findOneAndUpdate(filter, {
    $set:{ status:'processing', lockedUntil:new Date(Date.now()+300000), error:'' },
    $inc:{ attempts:1 }
  }, { sort:{ createdAt:1 }, new:true }).lean();
}

async function settleJobs(jobs, status, error = '') {
  const ids = jobs.map(job => job._id);
  if (!ids.length) return;
  const updates = status === 'pending'
    ? { $set:{ status:'pending', lockedUntil:null,
        runAt:new Date(Date.now()+Math.min(3600000, 60000*2**(jobs[0].attempts||1))),
        error:String(error).slice(0,240) } }
    : { $set:{ status, lockedUntil:null, expiresAt:new Date(Date.now()+7*86400000),
        error:String(error).slice(0,240) }, $unset:{ candidates:1 } };
  await VocabularyJob.updateMany({ _id:{ $in:ids }, status:'processing' }, updates);
}

function presentation(candidate, analysis = null) {
  const fromTranslator = candidate.source === 'translation' && Boolean(candidate.meaning);
  const source = candidate.source === 'rule' ? 'rule'
    : fromTranslator ? 'translation' : analysis ? (analysis.source || 'ai') : 'pending';
  const category = candidate.source === 'rule'
    ? candidate.category : analysis?.category || candidate.category || 'unclassified';
  const meaning = candidate.source === 'rule'
    ? candidate.meaning : fromTranslator ? candidate.meaning : analysis?.meaning || '';
  return { source, category:category || 'unclassified', meaning };
}

async function applyBatch(jobs, allowed, existing, analysis, muted, attemptedIds = new Set()) {
  const now = new Date();
  const expiresAt = new Date(now.getTime()+60*86400000);
  await mongoose.connection.transaction(async session => {
    for (const job of jobs) {
      for (const candidate of job.candidates) {
        const id = entryId(candidate);
        if (!allowed.has(id) || muted.has(id)) continue;
        const ledgerFilter = {
          userId:job.userId, eventId:job.eventId, language:job.language,
          type:candidate.type, key:candidate.key
        };
        const previous = await VocabularyOccurrence.exists(ledgerFilter).session(session);
        if (previous) continue; // exact-once retry protection inside transaction

        const fromDb = existing.get(id);
        const classified = presentation(candidate, analysis.get(id));
        const category = candidate.topicHint ||
          (fromDb?.category !== 'both' ? fromDb?.category : null) ||
          (classified.category !== 'both' ? classified.category : 'unclassified');
        const eventCategory = ['work','daily_life'].includes(category)
          ? category : 'unclassified';
        await VocabularyOccurrence.create([{
          ...ledgerFilter, category:eventCategory, count:candidate.occurrences,
          seenAt:now, expiresAt
        }], { session });

        const safeMeaning = classified.meaning.slice(0,450);
        const initial = {
          text:candidate.text, meaning:safeMeaning,
          pinyin:job.language === 'zh' ? pinyin(candidate.text, { toneType:'symbol', type:'string' }).slice(0,250) : '',
          category:classified.category,
          classificationSource:classified.source, manualOverride:false,
          firstSeenAt:now, mastery:'new',
          analysisAttempts:classified.source==='pending' && attemptedIds.has(id) ? 3 : 0,
          nextAnalysisAt:new Date(now.getTime()+3600000)
        };
        await VocabularyEntry.updateOne({
          userId:job.userId, language:job.language, type:candidate.type, key:candidate.key
        }, {
          $setOnInsert:initial,
          $set:{ lastSeenAt:now },
          $inc:{
            encounterCount:1, occurrenceCount:candidate.occurrences,
            workCount:eventCategory==='work'?1:0,
            dailyCount:eventCategory==='daily_life'?1:0
          }
        }, { upsert:true, session, setDefaultsOnInsert:false });
      }
      await VocabularyJob.updateOne({ _id:job._id, status:'processing' }, {
        $set:{ status:'completed', lockedUntil:null, expiresAt:new Date(Date.now()+7*86400000) },
        $unset:{ candidates:1 }
      }, { session });
    }
  });
}

async function processBatch(jobs) {
  const first = jobs[0];
  const userId = first.userId;
  const [setting, user] = await Promise.all([
    VocabularySetting.findOne({ userId, enabled:true }).select('_id').lean(),
    User.findById(userId).select('role proExpiresAt isActive').lean()
  ]);
  // A cancelled subscription or disabled collection must never run AI.
  if (!setting || !user?.isActive) {
    await settleJobs(jobs, 'completed');
    return;
  }
  if (!['pro','admin'].includes(effectiveRole(user))) {
    await settleJobs(jobs, 'pending', 'PRO subscription required');
    return;
  }
  const all = new Map();
  for (const job of jobs) {
    for (const item of job.candidates || []) {
      if (!all.has(entryId(item))) all.set(entryId(item), item);
    }
  }
  const items = [...all.values()];
  if (!items.length) { await settleJobs(jobs,'completed'); return; }

  const keys = [...new Set(items.map(item=>item.key))];
  const [already, blocked] = await Promise.all([
    VocabularyEntry.find({ userId, language:first.language, key:{ $in:keys } })
      .select('key type category').lean(),
    VocabularyMuted.find({ userId, language:first.language, key:{ $in:keys } })
      .select('key type').lean()
  ]);
  const existing = new Map(already.map(item=>[entryId(item),item]));
  const muted = new Set(blocked.map(item=>entryId(item)));
  const missing = items.filter(item=>!existing.has(entryId(item)) &&
    !muted.has(entryId(item)) && item.source !== 'rule' &&
    !(item.source === 'translation' && item.category));
  const toAnalyze = missing.slice(0,MAX_ITEMS_PER_CALL);
  let analysis = new Map();
  let attemptedIds = new Set();
  if (toAnalyze.length) {
    try {
      analysis = await analyzeBatch(userId,first.language,toAnalyze);
      attemptedIds = new Set(toAnalyze.map(entryId));
    } catch (error) {
      // The FREE providers may be unavailable/rate-limited: still persist
      // every extracted candidate, and retry enrichment in a later worker pass.
      console.warn('Vocabulary FREE enrichment temporarily unavailable:', error.message);
    }
  }
  // Permission may have changed during AI call.
  const activeSetting = await VocabularySetting.findOne({ userId, enabled:true }).select('_id').lean();
  const activeUser = await User.findById(userId).select('role proExpiresAt isActive').lean();
  if (!activeSetting || !activeUser?.isActive ||
      !['pro','admin'].includes(effectiveRole(activeUser))) {
    await settleJobs(jobs, activeSetting ? 'pending':'completed', 'Permission changed');
    return;
  }
  await applyBatch(jobs, new Set(all.keys()), existing, analysis, muted, attemptedIds);
}

// Retry only entries that were never successfully reviewed by AI.
// Rejected/low-confidence AI answers stay available for manual correction.
async function revisitPendingOnce() {
  const now = new Date();
  const entries = await VocabularyEntry.find({
    classificationSource:'pending', manualOverride:false,
    analysisAttempts:{ $lt:3 }, nextAnalysisAt:{ $lte:now }
  }).sort({ nextAnalysisAt:1 }).limit(MAX_ITEMS_PER_CALL).lean();
  if (!entries.length) return;

  const first = entries[0];
  const batch = entries.filter(item =>
    String(item.userId)===String(first.userId) && item.language===first.language);
  const [setting,user] = await Promise.all([
    VocabularySetting.findOne({userId:first.userId,enabled:true}).select('_id').lean(),
    User.findById(first.userId).select('role proExpiresAt isActive').lean()
  ]);
  if (!setting || !user?.isActive || !['pro','admin'].includes(effectiveRole(user))) return;
  // No artificial daily quota; providers keep their own service limits.
  let results = new Map();
  let success = false;
  try {
    results = await analyzeBatch(first.userId,first.language,
      batch.map(item=>({key:item.key,type:item.type})));
    success = true;
  } catch (error) {
    console.error('Vocabulary pending retry:',error.message);
  }
  const nextAnalysisAt = new Date(Date.now()+(success?86400000:3600000));
  for (const item of batch) {
    const classified = results.get(entryId(item));
    const changes = classified
      ? { $set:{ meaning:classified.meaning,category:classified.category,
          classificationSource:'ai',nextAnalysisAt }, $inc:{analysisAttempts:1} }
      : { $set:{ nextAnalysisAt }, $inc:{analysisAttempts:success?3:1} };
    await VocabularyEntry.updateOne({
      _id:item._id,userId:item.userId,
      classificationSource:'pending',manualOverride:false
    },changes);
  }
}

async function runWorkerOnce() {
  if (busy || mongoose.connection.readyState !== 1) return;
  busy = true;
  let jobs = [];
  try {
    const first = await claimJob();
    if (!first) {
      if (Date.now()-lastPendingScan>120000) {
        lastPendingScan=Date.now();
        await revisitPendingOnce();
      }
      return;
    }
    jobs = [first];
    for (let i=1;i<MAX_JOBS_PER_BATCH;i++) {
      const next = await claimJob(first.userId, first.language);
      if (!next) break;
      jobs.push(next);
    }
    await processBatch(jobs);
  } catch (error) {
    console.error('Vocabulary worker error:', error.message);
    if (jobs.length) {
      try {
        const retry = jobs[0].attempts < 4;
        await settleJobs(jobs, retry?'pending':'failed',error.message);
      } catch (storeError) {
        console.error('Vocabulary job retry failed:',storeError.message);
      }
    }
  } finally {
    busy = false;
  }
}

function startVocabularyWorker() {
  if (timer) return;
  timer = setInterval(() => void runWorkerOnce(), POLL_MS);
  timer.unref?.();
}

module.exports = {
  captureTranslation, scheduleCapture, runWorkerOnce, startVocabularyWorker,
  presentation, inputFingerprint, revisitPendingOnce
};
