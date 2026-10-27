// One authoritative write/read path for the personal vocabulary displayed
// in "Chi tiết bản dịch" and the study library. Only AI1-selected items enter.
// No raw chat text or images are saved by this module.
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { pinyin } = require('pinyin-pro');
const { parseAi1Items } = require('./ai-items');
const { normalize } = require('./extractor');
const { entries, patterns } = require('./rules');
const {
  VocabularyEntry, VocabularyOccurrence, VocabularyMuted, VocabularyRecentInput
} = require('./models');

const DUPLICATE_WINDOW_MS=5*60*1000;
const OCCURRENCE_TTL_MS=60*24*60*60*1000;

function fingerprint(source,language) {
  const normalized=String(source || '').normalize('NFKC').trim().replace(/\s+/g,' ');
  return crypto.createHash('sha256').update(
    language+':'+(language==='en'?normalized.toLowerCase():normalized)
  ).digest('hex');
}

function ruleCategory(language,item) {
  const local=entries[language]?.[item.type]?.[item.key];
  if (local && ['work','daily_life','both'].includes(local[1])) return local[1];
  if(item.type==='pattern') {
    const grammar=(patterns[language] || []).find(row=>
      normalize(row.key,language,'pattern')===item.key);
    if (grammar && ['work','daily_life','both'].includes(grammar.category))
      return grammar.category;
  }
  return 'unclassified';
}

function entryFilter(userId,language,item) {
  return {userId,language,type:item.type,key:item.key};
}

function serializeEntry(entry,isNew=false) {
  return {
    _id:String(entry._id), key:entry.key, text:entry.text, type:entry.type,
    language:entry.language, meaning:entry.meaning || '',
    pinyin:entry.pinyin || '', category:entry.category || 'unclassified',
    encounterCount:entry.encounterCount || 0,
    occurrenceCount:entry.occurrenceCount || 0,
    classificationSource:entry.classificationSource || 'pending',
    isNew:Boolean(isNew)
  };
}

async function claimInput(userId,language,source) {
  const key={userId,language,fingerprint:fingerprint(source,language)};
  const now=new Date();
  const expiry=new Date(now.getTime()+DUPLICATE_WINDOW_MS);
  const updated=await VocabularyRecentInput.findOneAndUpdate(
    { ...key,expiresAt:{$lte:now} },
    { $set:{expiresAt:expiry} },{returnDocument: 'after'}
  ).lean();
  if(updated) return {claimed:true,key,expiry};
  try {
    await VocabularyRecentInput.create({...key,expiresAt:expiry});
    return {claimed:true,key,expiry};
  } catch(error) {
    if(error?.code===11000) return {claimed:false,key,expiry};
    throw error;
  }
}

async function resolveTranslationVocabulary({userId,language,foreignText,vocabulary}) {
  if(!userId || !['zh','en'].includes(language) || !foreignText) return [];
  const candidates=parseAi1Items(vocabulary,foreignText,language);
  if(!candidates.length) return [];
  const filters=candidates.map(item=>({type:item.type,key:item.key}));
  const scope={userId,language,$or:filters};
  const [before,muted]=await Promise.all([
    VocabularyEntry.find(scope).lean(),
    VocabularyMuted.find(scope).select('type key').lean()
  ]);
  const blocked=new Set(muted.map(item=>item.type+':'+item.key));
  const allowed=candidates.filter(item=>!blocked.has(item.type+':'+item.key));
  if(!allowed.length) return [];
  const existed=new Map(before.map(row=>[row.type+':'+row.key,row]));

  const claim=await claimInput(userId,language,foreignText);
  if(claim.claimed) {
    const now=new Date();
    const eventId=crypto.randomUUID();
    try {
      // Batch writes keep the translation response snappy: two MongoDB
      // roundtrips inside a transaction rather than two requests per item.
      const occurrences=[];
      const writes=[];
      for(const item of allowed) {
        const id=item.type+':'+item.key;
        const existing=existed.get(id);
        const filter=entryFilter(userId,language,item);
        // A user-edited or AI2-resolved category always overrides static rules.
        const category=existing?.category && existing.category!=='unclassified'
          ? existing.category : ruleCategory(language,item);
        occurrences.push({
          ...filter,eventId,category,
          count:item.occurrences,
          seenAt:now,expiresAt:new Date(now.getTime()+OCCURRENCE_TTL_MS)
        });
        const onInsert={
          text:item.text,meaning:item.meaning,category,
          pinyin:language==='zh' && item.type!=='pattern'
            ? pinyin(item.text,{toneType:'symbol',type:'string'}).slice(0,250):'',
          classificationSource:category==='unclassified' ? 'pending':'rule',
          manualOverride:false,mastery:'new',firstSeenAt:now,
          analysisAttempts:0,nextAnalysisAt:now
        };
        writes.push({updateOne:{
          filter,upsert:true,
          update:{
            $setOnInsert:onInsert,
            $set:{lastSeenAt:now},
            $inc:{encounterCount:1,occurrenceCount:item.occurrences,
              workCount:category==='work'?1:0,
              dailyCount:category==='daily_life'?1:0}
          }
        }});
        if(existing && !existing.meaning && !existing.manualOverride) {
          writes.push({updateOne:{
            filter:{...filter,manualOverride:false,$or:[{meaning:''},{meaning:null}]},
            update:{$set:{meaning:item.meaning}}
          }});
        }
      }
      await mongoose.connection.transaction(async(session)=>{
        await VocabularyOccurrence.insertMany(occurrences,{session,ordered:true});
        await VocabularyEntry.bulkWrite(writes,{session,ordered:true});
      });
    } catch(error) {
      // Failed writes must not consume the five-minute deduplication window.
      await VocabularyRecentInput.deleteOne({
        ...claim.key,expiresAt:claim.expiry
      }).catch(()=>{});
      throw error;
    }
  }

  // Always read fresh MongoDB values, including manually corrected meanings.
  const rows=await VocabularyEntry.find({
    userId,language,$or:allowed.map(item=>({type:item.type,key:item.key}))
  }).lean();
  const after=new Map(rows.map(row=>[row.type+':'+row.key,row]));
  return allowed.map(item=>{
    const id=item.type+':'+item.key,entry=after.get(id);
    return entry ? serializeEntry(entry,claim.claimed && !existed.has(id)) : null;
  }).filter(Boolean);
}

module.exports={
  resolveTranslationVocabulary,parseAi1Items,fingerprint,ruleCategory,serializeEntry
};
