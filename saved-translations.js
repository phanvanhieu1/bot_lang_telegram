'use strict';
const mongoose=require('mongoose');
const {getHistoryDetail}=require('./history');

// A saved translation is an independent copy of its history entry. Clearing
// history or the 200-item history retention must not delete bookmarks.
const schema=new mongoose.Schema({
  owner:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true,index:true},
  historyId:{type:mongoose.Schema.Types.ObjectId,required:true},
  time:{type:Date,required:true}, // Original translation time
  savedAt:{type:Date,default:Date.now},
  text:{type:String,required:true},
  targetLang:{type:String,required:true},
  learningLang:{type:String,enum:['zh','en'],default:'zh'},
  result:{type:String,required:true},
  details:{type:mongoose.Schema.Types.Mixed,default:null},
  // When history was pruned, keep a short undo window for unsaving. Never
  // expose such entries in Saved, and automatically purge after expiry.
  deletedAt:{type:Date,default:null},
  expiresAt:{type:Date,default:null}
},{versionKey:false});
schema.index({owner:1,historyId:1},{unique:true});
schema.index({owner:1,savedAt:-1,_id:-1});
schema.index({expiresAt:1},{expireAfterSeconds:0});
const ORPHAN_UNDO_MS=30*60*1000;
const SavedTranslation=mongoose.models.SavedTranslation||
  mongoose.model('SavedTranslation',schema,'saved_translations');

function summary(item){
  return {id:String(item._id),historyId:String(item.historyId),
    time:item.time.toISOString(),savedAt:item.savedAt.toISOString(),
    text:item.text,targetLang:item.targetLang,
    learningLang:item.learningLang||'zh',
    engine:item.details?.engine||null,context:item.details?.context||null,
    result:item.result};
}

async function saveHistoryTranslation(owner,historyId){
  if(!owner||!mongoose.isValidObjectId(historyId))return null;
  const source=await getHistoryDetail(owner,historyId);
  if(source){
    try{
      // Repeated clicks/requests do not duplicate bookmarks.
      await SavedTranslation.updateOne({owner,historyId},{
        $setOnInsert:{owner,historyId,time:new Date(source.time),
          text:source.text,targetLang:source.targetLang,
          learningLang:source.learningLang||'zh',result:source.result,
          details:source.details||null,savedAt:new Date()},
        $set:{deletedAt:null,expiresAt:null}
      },{upsert:true});
    }catch(error){if(error?.code!==11000)throw error;}
  }else{
    // If original history was deleted, a recently unsaved bookmark can be
    // restored from the account's own 30-minute undo copy, without AI calls.
    const revived=await SavedTranslation.updateOne({
      owner,historyId,deletedAt:{$ne:null},expiresAt:{$gt:new Date()}
    },{$set:{deletedAt:null,expiresAt:null,savedAt:new Date()}});
    if(!revived.matchedCount)return null;
  }
  const saved=await SavedTranslation.findOne({owner,historyId,deletedAt:null})
    .select('historyId time savedAt text targetLang learningLang result details.engine details.context').lean();
  return saved?summary(saved):null;
}
async function listSavedTranslations(owner){
  const rows=await SavedTranslation.find({owner,deletedAt:null})
    .sort({savedAt:-1,_id:-1})
    .select('historyId time savedAt text targetLang learningLang result details.engine details.context')
    .lean();
  return rows.map(summary);
}
async function getSavedTranslation(owner,id){
  if(!owner||!mongoose.isValidObjectId(id))return null;
  const row=await SavedTranslation.findOne({_id:id,owner,deletedAt:null})
    .select('historyId time savedAt text targetLang learningLang result details').lean();
  if(!row)return null;
  return {...summary(row),details:row.details||null};
}
async function getSavedStatus(owner,historyId){
  if(!owner||!mongoose.isValidObjectId(historyId))return null;
  const row=await SavedTranslation.findOne({owner,historyId,deletedAt:null})
    .select('_id').lean();
  return row?String(row._id):null;
}
async function removeSavedTranslation(owner,id){
  if(!owner||!mongoose.isValidObjectId(id))return false;
  const saved=await SavedTranslation.findOne({_id:id,owner,deletedAt:null})
    .select('_id historyId').lean();
  if(!saved)return false;
  const original=await getHistoryDetail(owner,saved.historyId);
  if(original){
    const removed=await SavedTranslation.deleteOne({_id:id,owner,deletedAt:null});
    return removed.deletedCount===1;
  }
  // The history is gone; retain only a short, unlisted undo copy and remove
  // it automatically. Restoring within the window never calls AI again.
  const updated=await SavedTranslation.updateOne({_id:id,owner,deletedAt:null},
    {$set:{deletedAt:new Date(),
      expiresAt:new Date(Date.now()+ORPHAN_UNDO_MS)}});
  return updated.modifiedCount===1;
}
module.exports={SavedTranslation,saveHistoryTranslation,listSavedTranslations,
  getSavedTranslation,getSavedStatus,removeSavedTranslation};
