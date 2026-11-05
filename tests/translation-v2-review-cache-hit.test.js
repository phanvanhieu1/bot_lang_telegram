'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const User=require('../modules/users/user.model');
const {createV2Router}=require('../ai/v2/routes');
const realCache=require('../ai/v2/cache');

const ACCOUNT='684000000000000000000001';

test('V2 REVIEW: second identical request reuses result and preserves warnings without paying Claude/GPT again',async()=>{
  const originalFind=User.findById;
  const stored=new Map(),usageCalls=[];
  const model={
    findOne:query=>({select:()=>({lean:async()=>stored.get(query.key)||null})}),
    updateOne:async(query,change)=>{
      stored.set(query.key,{owner:query.owner,key:query.key,
        ...change.$set});
    }
  };
  const cache={
    signatureForOwner:async()=> 'approved-glossary-unchanged',
    keyForRequest:realCache.keyForRequest,
    getCached:args=>realCache.getCached(args,model),
    storeCached:args=>realCache.storeCached(args,model)
  };
  let translationCalls=0;
  const translate=async()=>{
    translationCalls++;
    return {translation:'Xin chào',status:'REVIEW',needsReview:true,
      issues:['Cần kiểm tra thuật ngữ PP trước khi sử dụng'],
      analysis:{domain:'work'},analysisTerms:[],analysisPatterns:[],
      translationNotes:[],appliedTerms:[],
      sourceLanguage:'zh',targetLanguage:'vi',backTranslation:'',
      studyVocabulary:'',
      usage:{stages:[
        {role:'analyzer',provider:'claude',model:'claude-haiku-5-5',
          usage:{input:100,output:25}},
        {role:'translator',provider:'openai',model:'gpt-4o-mini',
          usage:{input:140,output:35}}
      ],totalInputTokens:240,totalOutputTokens:60,
        providers:['claude','openai']}};
  };
  User.findById=async()=>({_id:ACCOUNT,role:'pro',isActive:true});
  const app=express();
  app.use(express.json());
  app.use((req,res,next)=>{
    req.session={authenticated:true,userId:ACCOUNT};next();
  });
  app.use('/api/translate/v2',createV2Router({
    cache,translate,resolveVocabulary:async()=>[],
    recordHistory:async()=>null,
    recordUsage:async row=>{usageCalls.push(row);},
    env:{V2_ENABLED:'true',OPENAI_API_KEY:'dummy',CLAUDE_API_KEY:'dummy'}
  }));
  const server=app.listen(0,'127.0.0.1');
  try{
    await new Promise((resolve,reject)=>{
      if(server.listening)resolve();
      else{server.once('listening',resolve);server.once('error',reject);}
    });
    const url='http://127.0.0.1:'+server.address().port+'/api/translate/v2';
    async function send(extra={}){
      const response=await fetch(url,{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({
          text:'你好',targetLang:'zh',context:'colleague',
          vocabulary:false,backTranslation:false,pronunciation:false,
          verification:false,translationModel:'gpt-4o-mini',...extra
        })
      });
      return {status:response.status,body:await response.json()};
    }
    const first=await send();
    assert.equal(first.status,200);
    assert.equal(first.body.cached,false);
    assert.equal(first.body.status,'REVIEW');
    assert.equal(translationCalls,1);
    const again=await send({inspectAI:true});
    assert.equal(again.status,200);
    assert.equal(again.body.cached,true);
    assert.equal(again.body.status,'REVIEW');
    assert.deepEqual(again.body.issues,first.body.issues);
    assert.equal(again.body.requestUsage.totalTokens,0);
    assert.equal(again.body.requestUsage.estimatedCostUsd,0);
    assert.equal(translationCalls,1);
    assert.equal(usageCalls.length,1);
    const explicitRerun=await send({inspectAI:true,forceRefresh:true});
    assert.equal(explicitRerun.status,200);
    assert.equal(explicitRerun.body.cached,false);
    assert.equal(translationCalls,2);
    assert.equal(usageCalls.length,2);
  }finally{
    User.findById=originalFind;
    await new Promise(resolve=>server.close(resolve));
  }
});
