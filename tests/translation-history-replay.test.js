'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const mongoose=require('mongoose');
const {historySnapshot}=require('../history-snapshot');
const history=require('../history');
const Model=mongoose.model('TranslationHistory');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const OWNER='684000000000000000000001';
const OTHER='684000000000000000000002';
const ID='684000000000000000000003';

function sample(traceEnabled=true){
  const result='TRANSLATION: Các giao dịch chi trả có bình thường không?\n'+
    'VOCABULARY:\n[WORD] 代付 : chi trả thay';
  const response={
    result,requestUsage:{cached:false,inputTokens:651,outputTokens:75,
      totalTokens:726,estimatedCostUsd:0.00238,elapsedMs:3000,
      stages:[{provider:'openai',model:'gpt-4o-2024-08-06',role:'translator',
        inputTokens:651,outputTokens:75,ms:2220,estimatedKnownPaidUsd:0.00238}]},
    vocabularyItems:[{key:'代付',text:'代付',type:'word',pinyin:'dài fù',
      meaning:'thanh toán thay mặt',isNew:false,encounterCount:8,category:'work'}],
    appliedTerms:[{source:'澎湃',translation:'PP',start:1,end:3}],
    inspection:{cacheHit:false,notice:'Actual request',stages:[{
      role:'translator',model:'gpt-4o-2024-08-06',
      system:'System prompt: 澎湃 = PP',input:'user input',
      rawOutput:'TRANSLATION: ...',usage:{input:651,output:75},ms:2220
    }]}
  };
  return historySnapshot({engine:'v1',context:'colleague',
    options:{vocabulary:true,verification:false,inspectAI:traceEnabled},
    response});
}

test('snapshot retains the exact visible figures and opt-in GPT trace',()=>{
  const snap=sample(true);
  assert.equal(snap.version,1);
  assert.equal(snap.engine,'v1');
  assert.equal(snap.context,'colleague');
  assert.equal(snap.payload.requestUsage.inputTokens,651);
  assert.equal(snap.payload.vocabularyItems[0].encounterCount,8);
  assert.equal(snap.payload.inspection.stages[0].system,'System prompt: 澎湃 = PP');
  const hidden=sample(false);
  assert.equal(hidden.payload.inspection,undefined,'Never archive GPT prompts without opt-in');
  assert.equal(hidden.payload.requestUsage.estimatedCostUsd,0.00238);
});
test('snapshot accepts V2 analysis and FREE response and excludes unknown fields',()=>{
  const v2=historySnapshot({engine:'v2',context:'auto',options:{inspectAI:true},
    response:{result:'TRANSLATION: OK',analysis:{domain:'work'},
      analysisTerms:[{source:'出款',meaning:'chi tiền'}],
      requestUsage:{cached:true,inputTokens:0},inspection:{stages:[]},
      apiKey:'must-never-be-saved'}});
  assert.equal(v2.payload.analysis.domain,'work');
  assert.equal(v2.payload.requestUsage.inputTokens,0);
  assert.equal(v2.payload.apiKey,undefined);
  const free=historySnapshot({engine:'free',response:{
    result:{translation:'Xin chào'},provider:'cache',
    requestUsage:{cached:true,totalTokens:0}}});
  assert.equal(free.engine,'free');
  assert.equal(free.payload.provider,'cache');
});
test('history summary never returns archived prompt or full snapshot; detail is strictly owner scoped',async()=>{
  const original={create:Model.create,find:Model.find,findOne:Model.findOne,
    deleteMany:Model.deleteMany};
  let criteria=null,select=null;
  Model.create=async data=>({
    ...data,_id:ID,time:new Date('2026-10-30T04:00:00Z')
  });
  Model.find=cond=>({
    sort:()=>({skip:()=>({select:()=>({lean:async()=>[]})}),
      limit:()=>({select:projection=>({lean:async()=>{
        assert.ok(!projection.includes('details.payload'));
        return [{_id:ID,time:new Date('2026-10-30T04:00:00Z'),
          text:'是不是澎湃的',targetLang:'vi',learningLang:'zh',
          result:'TRANSLATION: PP',details:{engine:'v1',context:'colleague',
            payload:{inspection:{stages:[{system:'PRIVATE'}]}}}}];
      }})})
    })
  });
  Model.findOne=filter=>{
    criteria=filter;
    return {select:fields=>{
      select=fields;
      return {lean:async()=>({_id:ID,time:new Date('2026-10-30T04:00:00Z'),
        text:'是不是澎湃的',targetLang:'vi',learningLang:'zh',
        result:'TRANSLATION: PP',details:sample(true)})};
    }};
  };
  Model.deleteMany=async()=>{};
  try{
    const added=await history.addHistory({userId:OWNER,
      text:'是不是澎湃的',targetLang:'vi',
      result:'TRANSLATION: PP',details:sample(true)});
    assert.equal(added.result,'TRANSLATION: PP');
    const list=await history.getHistory(OWNER);
    assert.equal(list[0].engine,'v1');
    assert.equal(list[0].context,'colleague');
    assert.equal(list[0].details,undefined);
    assert.ok(!JSON.stringify(list).includes('PRIVATE'));
    const opened=await history.getHistoryDetail(OWNER,ID);
    assert.equal(opened.details.payload.inspection.stages[0].model,'gpt-4o-2024-08-06');
    assert.equal(String(criteria.userId),OWNER);
    assert.equal(String(criteria._id),ID);
    assert.ok(select.includes('details'));
    assert.equal(await history.getHistoryDetail(OWNER,'invalid'),null);
    const other=await history.getHistoryDetail(OTHER,ID);
    assert.equal(String(criteria.userId),OTHER,'lookup always filters by requesting user');
    assert.ok(other);
  }finally{
    for(const [key,value] of Object.entries(original))Model[key]=value;
  }
});

test('history UI requests only owner-checked detail and does not call translation API',()=>{
  const server=read('server.js'),app=read('public/app.js'),html=read('public/index.html');
  const detail=app.slice(app.indexOf('async function openHistoryDetail('),
    app.indexOf('function renderHistory('));
  assert.match(server,/app\.get\('\/api\/history\/:id',requireAuth/);
  assert.match(server,/getHistoryDetail\(req\.user\._id,req\.params\.id\)/);
  assert.match(detail,/fetch\('\/api\/history\/'\+encodeURIComponent\(item\.id\)/);
  assert.doesNotMatch(detail,/fetch\('\/api\/translate/);
  assert.match(detail,/parseResult\(archivedResult\)/);
  assert.match(detail,/renderTranslationVocabularySnapshot/);
  assert.match(detail,/renderRequestUsage/);
  assert.match(detail,/renderV2Inspection/);
  assert.match(detail,/historical:true/);
  assert.match(detail,/closeHistory\(\)/);
  assert.match(app,/element\.addEventListener\('click',\(\)=>openHistoryDetail\(item\)\)/);
  assert.match(html,/id="historyReplayNotice"/);
  assert.match(read('public/v2-inspector.js'),/hit&&!data\.historical/);
});
test('vocabulary playback renders from snapshot rather than refetching or incrementing encounters',()=>{
  const src=read('public/translation-vocab.js');
  const begin=src.indexOf('window.renderTranslationVocabularySnapshot=');
  const end=src.indexOf('window.renderTranslationVocabulary=render',begin);
  assert.ok(begin>0&&end>begin);
  const fn=src.slice(begin,end);
  assert.match(fn,/paint\(/);
  assert.doesNotMatch(fn,/fetch\(/);
  assert.doesNotMatch(fn,/resolveTranslationVocabulary/);
});
