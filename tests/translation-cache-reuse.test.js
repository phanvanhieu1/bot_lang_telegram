'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const mongoose=require('mongoose');
const {proKey,proTermScope,getWebCachedText,setWebCachedText}=
  require('../web-cache');
const v2Cache=require('../ai/v2/cache');

const SOURCE='đơn hàng bên PP này đã treo 2 tiếng, có thể gửi không?';
const MODEL='gpt-4o-mini';
const TERMS=[{id:'glossary-pp-1',source:'PP',translation:'PP',
  domain:'work',priority:100,version:1,conditional:false}];

test('V1 personal glossary cache isolates users, models and glossary versions',()=>{
  const a=proTermScope('user-A',TERMS);
  const b=proTermScope('user-B',TERMS);
  const edited=proTermScope('user-A',[{...TERMS[0],translation:'platform-PP',version:2}]);
  assert.equal(proTermScope('user-A',TERMS),a);
  assert.equal(proTermScope('user-A',[]),null);
  assert.notEqual(a,b);
  assert.notEqual(a,edited);
  const key=scope=>proKey(SOURCE,'zh',false,'colleague',MODEL,scope);
  assert.notEqual(key(a),key(b));
  assert.notEqual(key(a),key(edited));
  assert.notEqual(key(a),key(null));
  assert.notEqual(key(a),proKey(SOURCE,'zh',false,'colleague','gpt-4o',a));
  assert.notEqual(key(a),proKey(SOURCE,'zh',false,'friend',MODEL,a));
});

test('V1 repeated identical glossary requests reuse Mongo cache, including cached reverse-translation warning',async()=>{
  const Model=mongoose.models.WebTranslationCache;
  assert.ok(Model,'web-cache must register WebTranslationCache');
  const oldFind=Model.findOne,oldUpdate=Model.updateOne;
  const docs=new Map();
  Model.findOne=filter=>({select:()=>({lean:async()=>docs.get(filter.key)||null})});
  Model.updateOne=async(filter,update)=>{
    const item=docs.get(filter.key)||{mode:filter.mode,value:{}};
    for(const [field,value] of Object.entries(update.$set||{})){
      if(field.startsWith('value.'))item.value[field.slice(6)]=value;
    }
    docs.set(filter.key,item);
  };
  const a=proTermScope('user-A',TERMS);
  const b=proTermScope('user-B',TERMS);
  let paidCalls=0;
  async function translate(scope){
    const cached=await getWebCachedText(SOURCE,'zh',false,'colleague',MODEL,scope);
    if(cached?.translation)return {cached:true,value:cached};
    paidCalls++;
    const value={
      translation:'这个PP的订单已经挂了两个小时，可以发吗？',
      backTranslation:'',
      backTranslationWarning:'EXPECTED_VIETNAMESE_BACK_TRANSLATION_GOT_ENGLISH',
      vocabulary:'',vocabularyVersion:2
    };
    await setWebCachedText(SOURCE,'zh',false,'colleague',value,MODEL,scope);
    return {cached:false,value};
  }
  try{
    const first=await translate(a);
    const second=await translate(a);
    assert.equal(first.cached,false);
    assert.equal(second.cached,true);
    assert.equal(paidCalls,1);
    assert.deepEqual(second.value,first.value);
    const otherUser=await translate(b);
    assert.equal(otherUser.cached,false);
    assert.equal(paidCalls,2);
    const otherModel=await getWebCachedText(SOURCE,'zh',false,'colleague','gpt-4o',a);
    assert.equal(otherModel,null);
    const edited=proTermScope('user-A',[{...TERMS[0],translation:'nền tảng PP',version:2}]);
    assert.equal(await getWebCachedText(SOURCE,'zh',false,'colleague',MODEL,edited),null);
    const missingScope=await getWebCachedText(SOURCE,'zh',false,'colleague',MODEL);
    assert.equal(missingScope,null);
  }finally{
    Model.findOne=oldFind;
    Model.updateOne=oldUpdate;
  }
});

test('V2 completed REVIEW remains REVIEW across cache hits; failures and empty reviews are excluded',async()=>{
  const docs=new Map();
  const fakeModel={
    findOne:filter=>({select:()=>({lean:async()=>docs.get(filter.key)||null})}),
    updateOne:async(filter,update)=>{
      docs.set(filter.key,{owner:filter.owner,key:filter.key,...update.$set});
    }
  };
  const owner='user-A',key='v2-personal-cache-example';
  const review={status:'REVIEW',needsReview:true,
    translation:'Bản dịch cần kiểm tra',issues:['Thiếu thuật ngữ đã xác nhận'],
    sourceLanguage:'zh',targetLanguage:'vi'};
  let translations=0;
  async function once(){
    const cached=await v2Cache.getCached({owner,key},fakeModel);
    if(cached)return {cached:true,result:cached.value};
    translations++;
    await v2Cache.storeCached({owner,key,value:review},fakeModel);
    return {cached:false,result:review};
  }
  const first=await once(),second=await once();
  assert.equal(first.cached,false);
  assert.equal(second.cached,true);
  assert.equal(translations,1);
  assert.equal(second.result.status,'REVIEW');
  assert.deepEqual(second.result.issues,review.issues);
  assert.equal(await v2Cache.storeCached({owner,key:'invalid',value:{
    ...review,issues:[]}},fakeModel),false);
  assert.equal(await v2Cache.storeCached({owner,key:'failure',value:{
    ...review,status:'FAIL'}},fakeModel),false);
  assert.equal(await v2Cache.getCached({owner,key:'failure'},fakeModel),null);
});
