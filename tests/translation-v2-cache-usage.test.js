'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const express=require('express');
const User=require('../modules/users/user.model');
const {createV2Router}=require('../ai/v2/routes');
const {glossarySignature,keyForRequest,signatureForOwner,
  getCached,storeCached}=require('../ai/v2/cache');
const {freeRequestUsage,proRequestUsage}=require('../translation-request-usage');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const OWNER1='684000000000000000000001';
const OWNER2='684000000000000000000002';

test('V2 fingerprint changes for edits, direction, status and model while order does not matter',()=>{
  const a={_id:'aa',source:'刷子',translation:'đường dây bào khuyến mãi',
    sourceLang:'zh',targetLang:'vi',domain:'work',status:'approved',
    bidirectional:true,priority:100,version:1};
  const b={_id:'bb',source:'支付',translation:'thanh toán',
    sourceLang:'zh',targetLang:'vi',domain:'work',status:'approved',version:1};
  const fp=glossarySignature([a,b]);
  assert.equal(fp,glossarySignature([b,a]));
  assert.notEqual(fp,glossarySignature([{...a,translation:'bàn chải'},b]));
  assert.notEqual(fp,glossarySignature([{...a,bidirectional:false},b]));
  assert.notEqual(fp,glossarySignature([a]));
  const args={owner:OWNER1,text:'这是刷子吗',context:'colleague',
    signature:fp,env:{}};
  const key=keyForRequest(args);
  assert.equal(key,keyForRequest(args));
  assert.notEqual(key,keyForRequest({...args,owner:OWNER2}));
  assert.notEqual(key,keyForRequest({...args,context:'friend'}));
  assert.notEqual(key,keyForRequest({...args,signature:'changed'}));
  assert.notEqual(key,keyForRequest({...args,text:'Đây là đường dây bào khuyến mãi'}));
  assert.notEqual(key,keyForRequest({...args,env:{V2_OPENAI_MODEL:'another-model'}}));
});

test('Fingerprint lookup is owner-scoped and approved-only',async()=>{
  const calls=[];
  const db={find(filter){
    calls.push(filter);
    return {select:fields=>({
      lean:async()=>[{_id:'one',source:'刷子',translation:'dây',
        sourceLang:'zh',targetLang:'vi',domain:'work',status:'approved',version:1}]
    })};
  }};
  const result=await signatureForOwner(OWNER1,db);
  assert.equal(typeof result,'string');
  assert.equal(result.length,64);
  assert.deepEqual(calls,[{owner:OWNER1,status:'approved'}]);
});

test('Cache only persists PASS and reads require owner and unexpired TTL',async()=>{
  const writes=[],reads=[];
  const mock={
    updateOne:async(...args)=>{writes.push(args);},
    findOne:(filter)=>{reads.push(filter);return {select:()=>({
      lean:async()=>({value:{status:'PASS',translation:'Đã xác nhận'}})
    })};}
  };
  assert.equal(await storeCached({owner:OWNER1,key:'k',value:{
    status:'REVIEW',translation:'Chưa chắc chắn'}},mock),false);
  assert.equal(writes.length,0);
  assert.equal(await storeCached({owner:OWNER1,key:'k',value:{
    status:'PASS',translation:'Đã xác nhận'}},mock),true);
  assert.equal(writes.length,1);
  const hit=await getCached({owner:OWNER1,key:'k'},mock);
  assert.equal(hit.value.translation,'Đã xác nhận');
  assert.equal(reads[0].owner,OWNER1);
  assert.equal(reads[0].key,'k');
  assert.ok(reads[0].expiresAt.$gt instanceof Date);
});

test('V1 per-click billing does not invent FREE charges or reuse old cache usage',()=>{
  const v1=proRequestUsage({promptTokens:600,completionTokens:150});
  assert.equal(v1.totalTokens,750);
  assert.equal(v1.estimatedCostUsd,0.003);
  assert.equal(v1.stages[0].model,'gpt-4o');
  assert.equal(proRequestUsage({promptTokens:9999,completionTokens:5000},true)
    .estimatedCostUsd,0);
  assert.equal(proRequestUsage(null,false).estimatedCostUsd,null);
  const free=freeRequestUsage({provider:'groq',usage:{input:200,output:60}});
  assert.equal(free.totalTokens,260);
  assert.equal(free.estimatedCostUsd,null);
  assert.equal(free.pricingIncomplete,true);
  assert.equal(freeRequestUsage({provider:'deepl'}).inputTokens,null);
  assert.equal(freeRequestUsage({cached:true}).estimatedCostUsd,0);
  assert.match(read('public/translation-usage.js'),/renderRequestUsage/);
  assert.match(read('public/index.html'),/id="requestUsagePanel"/);
});

test('V2 endpoint cache HIT skips paid providers and history billing, isolates users/context/glossary',async()=>{
  const originalFind=User.findById;
  let version='initial';
  const stored=new Map();
  const costRows=[];
  let translations=0;
  const cache={
    signatureForOwner:async()=>version,
    keyForRequest,
    getCached:async({owner,key})=>stored.get(String(owner)+':'+key)||null,
    storeCached:async({owner,key,value})=>{
      stored.set(String(owner)+':'+key,{value});
    }
  };
  const translate=async({text})=>{
    translations++;
    return {
      translation:'Đây là đường dây bào khuyến mãi.',
      status:'PASS',needsReview:false,issues:[],analysis:{domain:'work'},
      translationNotes:[],appliedTerms:[],
      sourceLanguage:'zh',targetLanguage:'vi',
      usage:{stages:[
        {role:'analyzer',provider:'claude',model:'claude-sonnet-5-5',
          usage:{input:100,output:200}},
        {role:'translator',provider:'openai',model:'gpt-6.1-sol',
          usage:{input:300,output:100}}
      ],totalInputTokens:400,totalOutputTokens:300,providers:['claude','openai']}
    };
  };
  User.findById=async id=>({_id:String(id),isActive:true,role:'pro'});
  const app=express();
  app.use(express.json());
  app.use((req,res,next)=>{
    req.session={authenticated:true,userId:req.get('x-test-user')||OWNER1};
    next();
  });
  app.use('/api/translate/v2',createV2Router({
    translate,cache,recordUsage:async x=>{costRows.push(x);},
    env:{V2_ENABLED:'true',OPENAI_API_KEY:'mock-key',CLAUDE_API_KEY:'mock-key'}
  }));
  const listener=app.listen(0,'127.0.0.1');
  try{
    await new Promise((resolve,reject)=>{
      if(listener.listening)return resolve();
      listener.once('listening',resolve);listener.once('error',reject);
    });
    const url='http://127.0.0.1:'+listener.address().port+'/api/translate/v2';
    async function send(context='colleague',owner=OWNER1){
      const response=await fetch(url,{method:'POST',headers:{
        'content-type':'application/json','x-test-user':owner},
        body:JSON.stringify({text:'这是刷子吗？',targetLang:'zh',context})});
      assert.equal(response.status,200);
      return response.json();
    }
    let one=await send();
    assert.equal(one.cached,false);
    assert.equal(one.requestUsage.totalTokens,700);
    assert.ok(one.requestUsage.estimatedCostUsd>0);
    assert.equal(one.requestUsage.stages.length,2);
    assert.ok(one.requestUsage.stages[0].estimatedKnownPaidUsd>0);
    assert.ok(one.requestUsage.stages[1].estimatedKnownPaidUsd>0);
    let repeat=await send();
    assert.equal(repeat.cached,true);
    assert.equal(repeat.requestUsage.totalTokens,0);
    assert.equal(repeat.requestUsage.estimatedCostUsd,0);
    assert.deepEqual(repeat.requestUsage.originalUsage,one.requestUsage);
    assert.equal(repeat.requestUsage.originalUsage.stages.length,2);
    assert.equal(repeat.translation,one.translation);
    assert.equal(translations,1);
    assert.equal(costRows.length,1);
    await send('friend');
    await send('colleague',OWNER2);
    assert.equal(translations,3);
    version='after-edit';
    await send();
    assert.equal(translations,4);
    assert.equal(costRows.length,4);
  }finally{
    User.findById=originalFind;
    await new Promise(resolve=>listener.close(resolve));
  }
});
