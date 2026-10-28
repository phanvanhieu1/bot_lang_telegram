'use strict';
// Per-user V2 cache; never shared with V1 or other accounts. TTL = 14 days.
// A fingerprint of the owner's entire approved glossary invalidates entries
// after add/edit/delete without changing the existing glossary schema.
const crypto=require('node:crypto');
const mongoose=require('mongoose');
const Glossary=require('../terminology/model');
const {ENGINE_VERSION,detectDirection}=require('./engine');
const {getV2ModelSettings}=require('./providers');

const TTL_MS=14*24*60*60*1000;
const schema=new mongoose.Schema({
  key:{type:String,required:true,unique:true},
  owner:{type:mongoose.Schema.Types.ObjectId,required:true,index:true,ref:'User'},
  value:{type:mongoose.Schema.Types.Mixed,required:true},
  expiresAt:{type:Date,required:true}
},{timestamps:true,versionKey:false,collection:'translation_v2_cache'});
schema.index({expiresAt:1},{expireAfterSeconds:0});
const Model=mongoose.models.TranslationV2Cache||
  mongoose.model('TranslationV2Cache',schema);

function digest(value){
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
const FIELDS='_id source translation sourceLang targetLang domain status bidirectional priority version';
function glossarySignature(rows){
  // Never store owner terminology in the cache key itself.
  return digest((rows||[]).map(x=>[
    String(x._id||''),String(x.source||''),String(x.translation||''),
    x.sourceLang,x.targetLang,x.domain,x.status,x.bidirectional===true,
    x.priority,x.version
  ]).sort((a,b)=>a[0].localeCompare(b[0])));
}
async function signatureForOwner(owner,GlossaryModel=Glossary){
  const rows=await GlossaryModel.find({owner,status:'approved'}).select(FIELDS).lean();
  return glossarySignature(rows);
}
function keyForRequest({owner,text,context,signature,env=process.env}){
  if(!owner||typeof text!=='string'||!signature)throw Error('V2_CACHE_INVALID_KEY');
  const direction=detectDirection(text);
  const {openaiModel,claudeModel,openaiEffort,claudeEffort}=getV2ModelSettings(env);
  return digest([
    'v2-cache-2',String(owner),text.trim(),context,
    direction.source,direction.target,ENGINE_VERSION,
    openaiModel,claudeModel,openaiEffort,claudeEffort,signature
  ]);
}
async function getCached({owner,key},CacheModel=Model){
  const item=await CacheModel.findOne({owner,key,expiresAt:{$gt:new Date()}})
    .select('value createdAt expiresAt').lean();
  return item && item.value?.status==='PASS' && typeof item.value.translation==='string'
    ? item:null;
}
async function storeCached({owner,key,value},CacheModel=Model){
  if(value?.status!=='PASS'||typeof value.translation!=='string'||!value.translation.trim())
    return false;
  const expiresAt=new Date(Date.now()+TTL_MS);
  // Unique key protects two processes from persisting duplicate rows.
  try{
    await CacheModel.updateOne({owner,key},{
      $set:{value,expiresAt},$setOnInsert:{owner,key}
    },{upsert:true,runValidators:true});
  }catch(error){
    if(error?.code!==11000)throw error;
    await CacheModel.updateOne({owner,key},{$set:{value,expiresAt}});
  }
  return true;
}
module.exports={Model,TTL_MS,glossarySignature,signatureForOwner,
  keyForRequest,getCached,storeCached};
