'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const mongoose=require('mongoose');
const fs=require('node:fs');
const path=require('node:path');
const history=require('../history');
const repo=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(repo,p),'utf8');
const OWNER='684000000000000000000001';
const OTHER='684000000000000000000002';
const HISTORY_ID='684000000000000000000003';
const SAVED_ID='684000000000000000000004';

test('saved translations copy owner-scoped history snapshot and survive history deletion',async()=>{
  const originalGetter=history.getHistoryDetail;
  const mockHistory={id:HISTORY_ID,time:'2026-10-30T04:00:00.000Z',
    text:'能出款吗',targetLang:'zh',learningLang:'zh',
    result:'TRANSLATION: Có thể rút tiền không?',
    details:{engine:'v1',context:'colleague',
      payload:{requestUsage:{inputTokens:651,outputTokens:75,
        estimatedCostUsd:0.00238},inspection:{stages:[{
        system:'private glossary',rawOutput:'TRANSLATION: ...'}]}}}};
  history.getHistoryDetail=async(owner,id)=>
    owner===OWNER&&id===HISTORY_ID?mockHistory:null;
  const modPath=require.resolve('../saved-translations');
  delete require.cache[modPath];
  const saved=require('../saved-translations');
  const Model=saved.SavedTranslation;
  const original={updateOne:Model.updateOne,findOne:Model.findOne,
    find:Model.find,deleteOne:Model.deleteOne};
  const storage=new Map();
  let updates=0;
  const toRow=(owner,historyId)=>storage.get(owner+':'+historyId);
  Model.updateOne=async(filter,update)=>{
    updates++;
    if(!toRow(String(filter.owner),String(filter.historyId))){
      storage.set(String(filter.owner)+':'+String(filter.historyId),{
        _id:SAVED_ID,...update.$setOnInsert});
    }
    return {acknowledged:true};
  };
  Model.findOne=filter=>{
    const owner=String(filter.owner);
    const row=filter._id?Array.from(storage.values()).find(item=>
      String(item._id)===String(filter._id)&&String(item.owner)===owner)
      :toRow(owner,String(filter.historyId));
    return {select:()=>({lean:async()=>row||null})};
  };
  Model.find=filter=>({
    sort:()=>({select:()=>({lean:async()=>Array.from(storage.values())
      .filter(x=>String(x.owner)===String(filter.owner))})})
  });
  Model.deleteOne=async filter=>{
    const owner=String(filter.owner);
    const key=Array.from(storage.entries()).find(([,row])=>
      String(row.owner)===owner&&String(row._id)===String(filter._id))?.[0];
    if(key)storage.delete(key);
    return {deletedCount:key?1:0};
  };
  try{
    assert.equal(await saved.saveHistoryTranslation(OTHER,HISTORY_ID),null,
      'cannot bookmark another user history');
    assert.equal(await saved.saveHistoryTranslation(OWNER,'not-an-id'),null);
    const added=await saved.saveHistoryTranslation(OWNER,HISTORY_ID);
    assert.equal(added.id,SAVED_ID);
    assert.equal(added.historyId,HISTORY_ID);
    assert.equal(added.text,'能出款吗');
    assert.equal((await saved.listSavedTranslations(OWNER)).length,1);
    assert.equal((await saved.listSavedTranslations(OTHER)).length,0);
    const repeated=await saved.saveHistoryTranslation(OWNER,HISTORY_ID);
    assert.equal(repeated.id,SAVED_ID);
    assert.equal(updates,2,'idempotent upserts not duplicate bookmarks');
    assert.equal(storage.size,1);
    const detail=await saved.getSavedTranslation(OWNER,SAVED_ID);
    assert.equal(detail.details.payload.requestUsage.inputTokens,651);
    assert.equal(detail.details.payload.inspection.stages[0].system,'private glossary');
    assert.equal(await saved.getSavedTranslation(OTHER,SAVED_ID),null);
    // Simulate history deletion by returning no source; saved copy remains.
    history.getHistoryDetail=async()=>null;
    assert.equal((await saved.getSavedTranslation(OWNER,SAVED_ID)).text,'能出款吗');
    assert.equal(await saved.getSavedStatus(OWNER,HISTORY_ID),SAVED_ID);
    assert.equal(await saved.getSavedStatus(OTHER,HISTORY_ID),null);
    assert.equal(await saved.removeSavedTranslation(OTHER,SAVED_ID),false);
    assert.equal(await saved.removeSavedTranslation(OWNER,SAVED_ID),true);
    assert.equal(await saved.getSavedTranslation(OWNER,SAVED_ID),null);
  }finally{
    for(const [name,fn] of Object.entries(original))Model[name]=fn;
    history.getHistoryDetail=originalGetter;
    delete require.cache[modPath];
  }
});

test('saved API uses authentication, server-owned history, and independent per-owner detail',()=>{
  const server=read('server.js');
  assert.match(server,/app\.post\('\/api\/saved',requireAuth,savedSameOrigin/);
  assert.match(server,/saveHistoryTranslation\(req\.user\._id,req\.body\?\.historyId\)/);
  assert.match(server,/app\.get\('\/api\/saved\/:id',requireAuth/);
  assert.match(server,/getSavedTranslation\(req\.user\._id,req\.params\.id\)/);
  assert.match(server,/app\.delete\('\/api\/saved\/:id',requireAuth,savedSameOrigin/);
  assert.match(server,/removeSavedTranslation\(req\.user\._id,req\.params\.id\)/);
  assert.match(read('saved-translations.js'),/schema\.index\(\{owner:1,historyId:1\},\{unique:true\}\)/);
  assert.match(read('saved-translations.js'),/getHistoryDetail\(owner,historyId\)/);
  assert.match(read('saved-translations.js'),/\$setOnInsert/);
  assert.doesNotMatch(read('saved-translations.js'),/deleteMany/);
  assert.match(server,/historyId:savedHistory\.id/);
  assert.match(read('ai/v2/routes.js'),/return res\.json\(\{\.\.\.responseBody,historyId\}\)/);
});

test('saved UI uses existing translation detail renderer; one-click star does not call AI',()=>{
  const html=read('public/index.html'),app=read('public/app.js');
  assert.match(html,/id="saveTranslationBtn"/);
  assert.match(html,/id="savedBtn"/);
  assert.match(html,/aria-pressed="false"/);
  assert.match(app,/saveTranslationBtn\.addEventListener\('click'/);
  const start=app.indexOf("saveTranslationBtn.addEventListener('click'");
  const end=app.indexOf("let languageRequestVersion",start);
  const callback=app.slice(start,end);
  assert.match(callback,/fetch\(existing/);
  assert.doesNotMatch(callback,/\/api\/translate/);
  assert.match(app,/savedBtn\.addEventListener\('click',openSaved\)/);
  assert.match(app,/sidebarView='saved'/);
  assert.match(app,/\/api\/saved\/status\//);
  assert.match(app,/\/api\/saved\/'/);
  assert.match(app,/saveTranslationBtn\.setAttribute\('aria-pressed'/);
  assert.match(app,/setSaveState\(\{historyId:data\.historyId\|\|null,source:text\}\)/);
  assert.match(app,/setSaveState\(\{historyId:currentHistoryId/);
  const css=read('public/compact-layout.css');
  assert.match(css,/#saveTranslationBtn\[aria-pressed="true"\]/);
  assert.match(css,/fill:#facc15/);
});

test('saved list replay is independent of editable history and retains owner-only detail data',()=>{
  const app=read('public/app.js');
  const open=app.slice(app.indexOf('async function openHistoryDetail(item)'),
    app.indexOf('function renderHistory(items)'));
  assert.match(open,/source==='saved'\?'\/api\/saved\/':'\/api\/history\/'/);
  assert.match(open,/parseResult\(archivedResult\)/);
  assert.match(open,/renderTranslationVocabularySnapshot/);
  assert.match(open,/renderRequestUsage/);
  assert.match(open,/renderV2Inspection/);
  assert.match(open,/source==='saved'\?saved\.historyId:saved\.id/);
  assert.doesNotMatch(open,/\/api\/translate/);
  assert.match(app,/clearHistoryBtn\.hidden=true/);
  assert.match(app,/clearHistoryBtn\.hidden=false/);
});
