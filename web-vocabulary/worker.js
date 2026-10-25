// Background category enrichment for already-persisted AI1 items.
// Never changes text, meaning, pinyin or encounter counters.
const mongoose=require('mongoose');
const User=require('../modules/users/user.model');
const {effectiveRole}=require('../web-maintenance');
const {VocabularyEntry}=require('./models');
const {classifyCategories,MAX_CATEGORY_BATCH}=require('./category-classifier');

const POLL_MS=12000;
let busy=false,timer=null;

async function classifyOnce() {
  if(busy || mongoose.connection.readyState!==1)return;
  busy=true;
  try {
    const now=new Date();
    const first=await VocabularyEntry.findOne({
      category:'unclassified',classificationSource:'pending',
      manualOverride:false,nextAnalysisAt:{$lte:now}
    }).sort({nextAnalysisAt:1}).lean();
    if(!first)return;
    const entries=await VocabularyEntry.find({
      userId:first.userId,language:first.language,
      category:'unclassified',classificationSource:'pending',manualOverride:false,
      nextAnalysisAt:{$lte:now}
    }).sort({nextAnalysisAt:1}).limit(MAX_CATEGORY_BATCH).lean();
    if(!entries.length)return;
    const user=await User.findById(first.userId)
      .select('role proExpiresAt isActive').lean();
    if(!user?.isActive||!['pro','admin'].includes(effectiveRole(user))) {
      // A lapsed subscription preserves saved entries and makes no AI calls.
      for(const entry of entries) {
        await VocabularyEntry.updateOne({_id:entry._id},{
          $set:{nextAnalysisAt:new Date(Date.now()+6*60*60*1000)}
        });
      }
      return;
    }

    // Lease the items before network calls; asynchronous duplicate workers
    // cannot classify the same entries concurrently in ordinary operation.
    const ids=entries.map(entry=>entry._id);
    const leaseUntil=new Date(Date.now()+90*1000);
    await VocabularyEntry.updateMany({
      _id:{$in:ids},classificationSource:'pending',manualOverride:false
    },{$set:{nextAnalysisAt:leaseUntil}});

    let categories=new Map();
    try {
      categories=await classifyCategories(first.language,entries);
    } catch(error) {
      console.warn('Vocabulary category retry scheduled:',error.message);
    }
    for(const entry of entries) {
      const key=entry.type+':'+entry.key;
      const category=categories.get(key);
      const attempts=(entry.analysisAttempts||0)+1;
      const nextDelay=Math.min(6*60*60*1000,60*1000*Math.pow(2,Math.min(attempts,8)));
      const changes=category
        ? {$set:{category,classificationSource:'ai',
            nextAnalysisAt:new Date(Date.now()+nextDelay)},
           $inc:{analysisAttempts:1}}
        : {$set:{nextAnalysisAt:new Date(Date.now()+nextDelay)},
           $inc:{analysisAttempts:1}};
      await VocabularyEntry.updateOne({
        _id:entry._id,userId:entry.userId,
        classificationSource:'pending',manualOverride:false,
        category:'unclassified'
      },changes);
    }
  } catch(error) {
    console.error('Vocabulary category worker:',error.message);
  } finally {busy=false;}
}

function startVocabularyWorker() {
  if(timer)return;
  timer=setInterval(()=>void classifyOnce(),POLL_MS);
  timer.unref?.();
}

module.exports={classifyOnce,startVocabularyWorker};
