'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {boundedHistoryDetails}=require('../history');
const {historySnapshot}=require('../history-snapshot');
const {recordTranslationHistorySafely}=require('../history-guard');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');

test('oversized real V1/V2 inspection in payload.inspection is trimmed, not the accounting',()=>{
  const original=historySnapshot({engine:'v1',context:'colleague',
    options:{inspectAI:true,vocabulary:true},
    response:{result:'TRANSLATION: Có thể chi trả không?',
      vocabularyItems:[{text:'出款',meaning:'chi trả'}],
      requestUsage:{totalTokens:726,inputTokens:651,outputTokens:75,
        estimatedCostUsd:0.00238},
      inspection:{stages:[{system:'private '.repeat(40000),
        input:'source',rawOutput:'TRANSLATION: ...'}]}}});
  const cleaned=boundedHistoryDetails(original);
  assert.equal(original.payload.inspection.stages.length,1,
    'do not mutate caller-owned snapshot');
  assert.equal(cleaned.payload.inspection,undefined);
  assert.equal(cleaned.payload.requestUsage.inputTokens,651);
  assert.equal(cleaned.payload.vocabularyItems[0].text,'出款');
  assert.match(cleaned.inspectionUnavailable,/quá dài/);
  assert.ok(Buffer.byteLength(JSON.stringify(cleaned),'utf8')<=200000);
});

test('metadata beyond the cap keeps request usage and never silently stores megabyte payload',()=>{
  const large=historySnapshot({engine:'v2',context:'auto',options:{},
    response:{result:'TRANSLATION: 安全',
      vocabularyItems:[{text:'k'.repeat(300000)}],
      requestUsage:{inputTokens:999,estimatedCostUsd:0.0012}}});
  const cleaned=boundedHistoryDetails(large);
  assert.equal(cleaned.engine,'v2');
  assert.equal(cleaned.payload.requestUsage.inputTokens,999);
  assert.equal(cleaned.payload.vocabularyItems,undefined);
  assert.ok(Buffer.byteLength(JSON.stringify(cleaned),'utf8')<=200000);
  assert.equal(boundedHistoryDetails(null),null);
  assert.equal(boundedHistoryDetails({version:1,payload:{foo:'small'}}).payload.foo,'small');
});

test('history write failure returns null instead of failing an already paid translation',async()=>{
  const previous=console.warn;let warns=0;
  console.warn=()=>{warns++};
  try{
    const ok=await recordTranslationHistorySafely(
      {text:'澎湃那边的订单'},async()=>({id:'history-123'}));
    assert.equal(ok,'history-123');
    const unavailable=await recordTranslationHistorySafely(
      {text:'澎湃那边的订单'},async()=>{throw Error('sensitive MongoDB credential')});
    assert.equal(unavailable,null);
    assert.equal(warns,1);
    const missing=await recordTranslationHistorySafely(
      {text:'你好'},async()=>null);
    assert.equal(missing,null);
  }finally{console.warn=previous;}
  const server=read('server.js');
  assert.match(server,/require\('\.\/history-guard'\)/);
  assert.equal((server.match(/recordTranslationHistorySafely\(\{userId:req\.user\._id/g)||[]).length,4);
  assert.equal((server.match(/return res\.json\(\{\.\.\.responseBody,historyId\}\)/g)||[]).length,4);
});

test('both engines reject stale source changes and history details before rendering',()=>{
  const s=read('public/app.js');
  assert.match(s,/let translationViewVersion=0/);
  assert.match(s,/textInput\.addEventListener\('input',\(\)=>\{\s*translationViewVersion\+\+/);
  const v1=s.slice(s.indexOf('async function translate(forceRefresh=false) {'),
    s.indexOf('let freeResetTimer'));
  assert.match(v1,/const viewVersion=\+\+translationViewVersion/);
  assert.match(v1,/viewVersion !== translationViewVersion/);
  assert.match(v1,/textInput\.value\.trim\(\) !== text/);
  const v2=s.slice(s.indexOf('async function translateV2(forceRefresh=false){'),
    s.indexOf('\/\/ =========================\n\/\/ PARSE RESULT'));
  assert.match(v2,/const viewVersion=\+\+translationViewVersion/);
  assert.match(v2,/viewVersion !== translationViewVersion/);
  const archive=s.slice(s.indexOf('async function openHistoryDetail(item){'),
    s.indexOf('function renderHistory(items) {'));
  assert.match(archive,/const viewVersion=\+\+translationViewVersion/);
  assert.match(archive,/viewVersion!==translationViewVersion/);
  assert.match(s,/learning-language-change', \(\) => \{\s*languageRequestVersion\+\+;\s*translationViewVersion\+\+;\s*historyDetailLoad\+\+;\s*setSaveState\(\)/);
});

test('orphaned saved records are excluded from reads and have bounded undo retention',()=>{
  const source=read('saved-translations.js');
  assert.match(source,/ORPHAN_UNDO_MS=30\*60\*1000/);
  assert.match(source,/schema\.index\(\{expiresAt:1\},\{expireAfterSeconds:0\}\)/);
  assert.match(source,/SavedTranslation\.find\(\{owner,deletedAt:null\}\)/);
  assert.match(source,/expiresAt:\{\$gt:new Date\(\)\}/);
  assert.match(source,/deletedAt:\{\$ne:null\}/);
  assert.match(source,/getHistoryDetail\(owner,saved\.historyId\)/);
});
