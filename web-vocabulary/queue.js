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
  VocabularyOccurrence, VocabularyMuted, VocabularyAiQuota
} = require('./models');

const POLL_MS = 15000;
const BATCH_DELAY_MS = 35000;
const MAX_JOBS_PER_BATCH = 6;
const MAX_AI_CALLS_PER_DAY = 12;
let busy = false;
let timer = null;

function entryId(item) {
  return item.type + ':' + item.key;
}

async function captureTranslation({ userId, language, foreignText, context = 'auto' }) {
  if (!userId || !['zh','en'].includes(language)) return false;
  if (typeof foreignText !== 'string' || !foreignText.trim()) return false;
  const setting = await VocabularySetting.findOne({ userId, enabled:true }).select('_id').lean();
  if (!setting) return false;

  const candidates = extractCandidates({ foreignText, language, context });
  if (!candidates.length) return false;
  await VocabularyJob.create({
    userId, language, candidates, status:'pending',
    eventId:crypto.randomUUID(),
    runAt:new Date(Date.now() + BATCH_DELAY_MS)
  });
  return true;
}

// Fire-and-forget only after the authenticated translation succeeds.
// All queued content is already reduced to lexical candidates, never full chats.
function scheduleCapture(args) {
  void captureTranslation(args).catch(error => {
    console.error('Vocabulary enqueue failed:', error.message);
  });
}

async function reserveAiQuota(userId) {
  const date = new Date();
  const day = date.toISOString().slice(0, 10);
  const expiresAt = new Date(date.getTime() + 3*24*60*60*1000);
  try {
    const row = await VocabularyAiQuota.findOneAndUpdate(
      { userId, day, calls:{ $lt:MAX_AI_CALLS_PER_DAY } },
      { $inc:{ calls:1 }, $setOnInsert:{ expiresAt } },
      { upsert:true, new:true }
    ).lean();
    return Boolean(row);
  } catch (error) {
    if (error.code === 11000) return false; // daily quota already reached
    throw error;
  }
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
  const source = candidate.source === 'rule' ? 'rule' : analysis ? 'ai' : 'pending';
  const category = candidate.source === 'rule'
    ? candidate.category : analysis?.category || 'unclassified';
  const meaning = candidate.source === 'rule'
    ? candidate.meaning : analysis?.meaning || '';
  return { source, category:category || 'unclassified', meaning };
}

async function applyBatch(jobs, allowed, existing, analysis, muted) {
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
          firstSeenAt:now, mastery:'new'
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
    !muted.has(entryId(item)) && item.source !== 'rule');
  const toAnalyze = missing.slice(0,MAX_ITEMS_PER_CALL);
  let analysis = new Map();
  if (toAnalyze.length && await reserveAiQuota(userId)) {
    analysis = await analyzeBatch(userId,first.language,toAnalyze,
      first.candidates?.[0]?.topicHint || 'auto');
  }
  // Permission may have changed during AI call.
  const activeSetting = await VocabularySetting.findOne({ userId, enabled:true }).select('_id').lean();
  const activeUser = await User.findById(userId).select('role proExpiresAt isActive').lean();
  if (!activeSetting || !activeUser?.isActive ||
      !['pro','admin'].includes(effectiveRole(activeUser))) {
    await settleJobs(jobs, activeSetting ? 'pending':'completed', 'Permission changed');
    return;
  }
  await applyBatch(jobs, new Set(all.keys()), existing, analysis, muted);
}

async function runWorkerOnce() {
  if (busy || mongoose.connection.readyState !== 1) return;
  busy = true;
  let jobs = [];
  try {
    const first = await claimJob();
    if (!first) return;
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
  presentation, reserveAiQuota
};
