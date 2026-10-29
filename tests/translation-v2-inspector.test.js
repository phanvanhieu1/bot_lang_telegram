'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const User=require('../modules/users/user.model');
const {deepTranslate}=require('../ai/v2/engine');
const {createV2Router}=require('../ai/v2/routes');
const {keyForRequest}=require('../ai/v2/cache');

const ACCOUNT='684000000000000000000001';
test('V2 inspection shows actual Claude and GPT arguments and original raw JSON; no extra calls',async()=>{
  let claude=0,gpt=0;
  const captured=[];
  const providers={
    claude:async(system,input)=>{
      claude++;
      assert.match(system,/KHÔNG dịch/);
      assert.equal(JSON.parse(input).original,'我去超市');
      return {text:JSON.stringify({domain:'daily',intent:'đi mua đồ',tone:'bình thường',
        facts:[],terms:[{source:'超市',meaning:'siêu thị'}],
        patterns:[],ambiguities:[]}),
        model:'claude-haiku-5-5',usage:{input:120,output:60}};
    },
    openai:async(system,input)=>{
      gpt++;
      assert.match(system,/biên dịch viên/);
      const payload=JSON.parse(input);
      assert.equal(payload.original,'我去超市');
      assert.equal(payload.analysis.domain,'daily');
      assert.equal(payload.analysis.terms[0].source,'超市');
      return {text:JSON.stringify({translation:'Tôi đi siêu thị.',
        backTranslation:'',vocabulary:'',
        semanticReviewRequired:false,uncertainties:[]}),
        model:'gpt-4o',usage:{input:150,output:40}};
    }
  };
  const translation=await deepTranslate({text:'我去超市',
    inspectStage:stage=>captured.push(stage)},providers);
  assert.equal(translation.translation,'Tôi đi siêu thị.');
  assert.equal(captured.length,2);
  assert.equal(claude,1);
  assert.equal(gpt,1);
  assert.equal(captured[0].role,'analyzer');
  assert.equal(captured[0].provider,'claude');
  assert.equal(JSON.parse(captured[0].input).original,'我去超市');
  assert.equal(JSON.parse(captured[0].rawOutput).terms[0].source,'超市');
  assert.equal(captured[1].role,'translator');
  assert.equal(JSON.parse(captured[1].input).analysis.terms[0].source,'超市');
  assert.equal(JSON.parse(captured[1].rawOutput).translation,'Tôi đi siêu thị.');
  assert.equal(captured[1].usage.output,40);
  assert.ok(!JSON.stringify(captured).includes('apiKey'));
});
test('without opt-in, V2 never calls inspection callback',async()=>{
  let calls=0;
  const providers={
    claude:async()=>{calls++;return {text:JSON.stringify({
      domain:'daily',intent:'greeting',tone:'normal',facts:[],
      terms:[],patterns:[],ambiguities:[]}),model:'claude-haiku-5-5',
      usage:{input:100,output:40}};},
    openai:async()=>{calls++;return {text:JSON.stringify({
      translation:'Xin chào',backTranslation:'',vocabulary:'',
      semanticReviewRequired:false,uncertainties:[]}),model:'gpt-4o',
      usage:{input:150,output:35}};}
  };
  const translation=await deepTranslate({text:'你好'},providers);
  assert.equal(translation.translation,'Xin chào');
  assert.equal(calls,2);
  assert.equal(Object.hasOwn(translation,'inspection'),false);
});

test('V2 cache hits do not fabricate model exchanges; explicit forced refresh is billable',async()=>{
  const originalFind=User.findById;
  let runs=0;
  const saved=new Map(), billed=[];
  const cache={
    signatureForOwner:async()=> 'glossary-version',
    keyForRequest,
    getCached:async({owner,key})=>saved.get(String(owner)+':'+key)||null,
    storeCached:async({owner,key,value})=>{
      saved.set(String(owner)+':'+key,{value});
    }
  };
  const translate=async({inspectStage})=>{
    runs++;
    if(inspectStage){
      inspectStage({role:'analyzer',provider:'claude',model:'claude-haiku-5-5',
        system:'claude instructions',input:'{"original":"你好"}',
        rawOutput:'{"domain":"daily"}',usage:{input:100,output:40},ms:10});
      inspectStage({role:'translator',provider:'openai',model:'gpt-4o',
        system:'GPT instructions',input:'{"analysis":{"domain":"daily"}}',
        rawOutput:'{"translation":"Xin chào"}',
        usage:{input:150,output:30},ms:12});
    }
    return {translation:'Xin chào',status:'PASS',needsReview:false,
      issues:[],analysis:{domain:'daily'},analysisTerms:[],analysisPatterns:[],
      translationNotes:[],appliedTerms:[],sourceLanguage:'zh',targetLanguage:'vi',
      usage:{stages:[
        {role:'analyzer',provider:'claude',model:'claude-haiku-5-5',
          usage:{input:100,output:40}},
        {role:'translator',provider:'openai',model:'gpt-4o',
          usage:{input:150,output:30}}
      ],totalInputTokens:250,totalOutputTokens:70,providers:['claude','openai']}
    };
  };
  User.findById=async()=>({_id:ACCOUNT,role:'pro',isActive:true});
  const app=express();app.use(express.json());
  app.use((req,res,next)=>{req.session={authenticated:true,userId:ACCOUNT};next();});
  app.use('/api/translate/v2',createV2Router({
    cache,translate,
    resolveVocabulary:async()=>[],recordHistory:async()=>{},
    recordUsage:async usage=>{billed.push(usage);},
    env:{V2_ENABLED:'true',OPENAI_API_KEY:'fake',CLAUDE_API_KEY:'fake'}
  }));
  const server=app.listen(0,'127.0.0.1');
  try{
    await new Promise((resolve,reject)=>{
      if(server.listening)resolve();
      else {server.once('listening',resolve);server.once('error',reject);}
    });
    const endpoint='http://127.0.0.1:'+server.address().port+'/api/translate/v2';
    async function send(opts={}){
      const response=await fetch(endpoint,{method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({text:'你好',targetLang:'zh',context:'friend',
          pronunciation:false,vocabulary:false,verification:false,...opts})});
      return {status:response.status,body:await response.json()};
    }
    const first=await send();
    assert.equal(first.status,200);
    assert.equal(first.body.inspection,undefined);
    assert.equal(first.body.cached,false);
    assert.equal(runs,1);
    const cached=await send({inspectAI:true});
    assert.equal(cached.status,200);
    assert.equal(cached.body.cached,true);
    assert.equal(cached.body.inspection.cacheHit,true);
    assert.deepEqual(cached.body.inspection.stages,[]);
    assert.equal(cached.body.requestUsage.estimatedCostUsd,0);
    assert.equal(runs,1);
    const invalid=await send({forceRefresh:true,inspectAI:false});
    assert.equal(invalid.status,400);
    assert.equal(runs,1);
    const refreshed=await send({inspectAI:true,forceRefresh:true});
    assert.equal(refreshed.status,200);
    assert.equal(refreshed.body.cached,false);
    assert.equal(refreshed.body.inspection.cacheHit,false);
    assert.equal(refreshed.body.inspection.stages.length,2);
    assert.equal(refreshed.body.inspection.stages[0].system,'claude instructions');
    assert.equal(refreshed.body.inspection.stages[1].rawOutput,
      '{"translation":"Xin chào"}');
    assert.equal(runs,2);
    assert.equal(billed.length,2);
    const hidden=await send();
    assert.equal(hidden.body.inspection,undefined);
    assert.equal(hidden.body.cached,true);
    assert.equal(runs,2);
    assert.equal(JSON.stringify(saved).includes('claude instructions'),false);
  }finally{
    User.findById=originalFind;
    await new Promise(resolve=>server.close(resolve));
  }
});
