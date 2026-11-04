'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const fs=require('node:fs');
const path=require('node:path');
const User=require('../modules/users/user.model');
const {createV2Router}=require('../ai/v2/routes');
const {keyForRequest}=require('../ai/v2/cache');
const {deepTranslate}=require('../ai/v2/engine');
const {formatV1Details,verificationUsage}=require('../ai/v2/details');

const srcFile=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

test('V2 JSON translation uses one GPT request for translation, backtranslation and Chinese vocabulary',async()=>{
  const captured=[];
  const providers={
    claude:async()=>({text:JSON.stringify({
      domain:'daily',intent:'muốn đi siêu thị',tone:'bình thường',
      facts:[],terms:[],patterns:[],ambiguities:[]
    }),model:'claude-haiku-5-5',usage:{input:250,output:120}}),
    openai:async(system,payload,opts)=>{
      captured.push({system,payload:JSON.parse(payload),schema:opts.jsonSchema});
      return {text:JSON.stringify({translation:'我去超市买菜。',
        backTranslation:'Tôi đi siêu thị mua rau.',
        vocabulary:'[WORD] 超市 : siêu thị\n[PHRASE] 买菜 : mua rau',
        semanticReviewRequired:false,uncertainties:[]}),
        model:'gpt-4o',usage:{input:500,output:150}};
    }
  };
  const r=await deepTranslate({text:'Tôi đi siêu thị mua rau.',context:'friend',
    backTranslation:true,vocabulary:true},providers);
  assert.equal(captured.length,1);
  assert.equal(captured[0].payload.includeBackTranslation,true);
  assert.equal(captured[0].payload.includeChineseVocabulary,true);
  assert.equal(r.backTranslation,'Tôi đi siêu thị mua rau.');
  assert.match(r.studyVocabulary,/\[WORD\] 超市/);
  assert.equal(r.sourceLanguage,'vi');
  assert.equal(r.usage.stages.length,2);
  assert.ok(captured[0].schema.required.includes('backTranslation'));
  assert.ok(captured[0].schema.required.includes('vocabulary'));
});

test('V1 labeled result fields and Pinyin are shared with V2',()=>{
  const r=formatV1Details({translation:'我去超市买菜',
    backTranslation:'Tôi đi siêu thị mua rau',pronunciation:'wǒ qù',
    vocabulary:'[WORD] 超市 : siêu thị',
    verification:{status:'PASS',confidence:98,issues:[],message:'Đúng nghĩa'}});
  assert.match(r,/^TRANSLATION: 我去超市买菜/);
  assert.match(r,/BACK_TRANSLATION: Tôi đi siêu thị mua rau/);
  assert.match(r,/PRONUNCIATION: wǒ qù/);
  assert.match(r,/VOCABULARY:\n\[WORD\] 超市/);
  assert.match(r,/VERIFICATION: \{"status":"PASS"/);
  const tokens=verificationUsage({usage:{prompt_tokens:500,completion_tokens:100}});
  assert.equal(tokens.totalTokens,600);
  assert.equal(tokens.estimatedCostUsd,0.00225);
  const app=srcFile('public/app.js');
  assert.match(app,/parseResult\(data.result\)/);
  assert.match(app,/backTranslation:backTranslationToggle.checked/);
  assert.match(app,/pronunciation:pronunciationToggle.checked/);
  assert.match(app,/vocabulary:vocabularyToggle.checked/);
  assert.match(app,/verification:verificationToggle.checked/);
  assert.doesNotMatch(app,/parseResult\('TRANSLATION: '\)/);
});

test('V2 supports V1-equivalent extras and optional verification on MISS and cache HIT',async()=>{
  const originalFind=User.findById;
  const saved=new Map(),billed=[],history=[],words=[];
  let nTranslate=0,nVerify=0;
  const cache={
    signatureForOwner:async()=> 'fingerprint',
    keyForRequest,
    getCached:async({owner,key})=>saved.get(String(owner)+':'+key)||null,
    storeCached:async({owner,key,value})=>{
      saved.set(String(owner)+':'+key,{value});
    }
  };
  const translate=async({text,backTranslation,vocabulary})=>{
    nTranslate++;
    return {
      translation:'我去超市买菜。',
      backTranslation:backTranslation?'Tôi đi siêu thị mua rau.':'',
      studyVocabulary:vocabulary?'[WORD] 超市 : siêu thị\n[PHRASE] 买菜 : mua rau':'',
      analysisTerms:[],analysisPatterns:[],appliedTerms:[],
      translationNotes:[],analysis:{domain:'daily',intent:'Đi siêu thị'},
      issues:[],status:'PASS',needsReview:false,
      sourceLanguage:'vi',targetLanguage:'zh',
      usage:{stages:[
        {role:'analyzer',provider:'claude',model:'claude-haiku-5-5',ms:80,
          usage:{input:100,output:60}},
        {role:'translator',provider:'openai',model:'gpt-4o',ms:100,
          usage:{input:350,output:90}}
      ],totalInputTokens:450,totalOutputTokens:150,providers:['claude','openai']}
    };
  };
  const verify=async()=>{nVerify++;return {verification:{
    status:'PASS',confidence:96,issues:[],message:'Bản dịch chính xác'},
    usage:{prompt_tokens:200,completion_tokens:80}};};
  User.findById=async id=>({_id:String(id),role:'pro',isActive:true});
  const app=express();app.use(express.json());
  app.use((req,res,next)=>{req.session={authenticated:true,
    userId:'684000000000000000000001'};next();});
  app.use('/api/translate/v2',createV2Router({
    cache,translate,verify,
    resolveVocabulary:async args=>{words.push(args);return [
      {type:'word',key:'超市',text:'超市',meaning:'nghĩa MongoDB',
        pinyin:'chāo shì',encounterCount:2,category:'daily_life',isNew:false}
    ];},
    recordHistory:async item=>{history.push(item);},
    recordUsage:async item=>{billed.push(item);},
    env:{V2_ENABLED:'true',OPENAI_API_KEY:'test',CLAUDE_API_KEY:'test'}
  }));
  const listener=app.listen(0,'127.0.0.1');
  try{
    await new Promise((resolve,reject)=>{
      if(listener.listening)resolve();
      else {listener.once('listening',resolve);listener.once('error',reject);}
    });
    const url='http://127.0.0.1:'+listener.address().port+'/api/translate/v2';
    const send=async options=>{
      const res=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({text:'Tôi đi siêu thị mua rau.',targetLang:'zh',
          context:'friend',...options})});
      assert.equal(res.status,200);
      return res.json();
    };
    const first=await send({verification:true});
    assert.equal(first.cached,false);
    assert.equal(nTranslate,1);assert.equal(nVerify,1);
    assert.equal(first.vocabularyItems[0].meaning,'nghĩa MongoDB');
    assert.match(first.result,/TRANSLATION:/);
    assert.match(first.result,/BACK_TRANSLATION:/);
    assert.match(first.result,/PRONUNCIATION:/);
    assert.match(first.result,/VOCABULARY:/);
    assert.match(first.result,/VERIFICATION:/);
    assert.equal(first.verification.confidence,96);
    assert.equal(first.requestUsage.totalTokens,880);
    assert.equal(first.requestUsage.stages.length,3);
    assert.equal(words[0].foreignText,'我去超市买菜。');
    const repeat=await send({verification:true});
    assert.equal(repeat.cached,true);
    assert.equal(repeat.requestUsage.totalTokens,0);
    assert.equal(repeat.verification.status,'PASS');
    assert.equal(nTranslate,1);assert.equal(nVerify,1);
    assert.equal(history.length,2);
    const off=await send({backTranslation:false,vocabulary:false,
      pronunciation:false,verification:false});
    assert.equal(off.cached,false); // optional Chinese-output fields change model prompt
    assert.equal(nTranslate,2);
    assert.doesNotMatch(off.result,/BACK_TRANSLATION:|PRONUNCIATION:|VOCABULARY:|VERIFICATION:/);
    assert.deepEqual(off.vocabularyItems,[]);
    assert.equal(words.length,2);
    assert.equal(billed.length,2);
  }finally{
    User.findById=originalFind;
    await new Promise(resolve=>listener.close(resolve));
  }
});
