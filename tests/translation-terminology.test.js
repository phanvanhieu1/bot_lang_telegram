'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {resolveTerms,lookupUserTerms,glossaryInstructions,
  termHighlights,contextDomain}=require('../ai/terminology/resolver');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
function entry(data={}) {
  return {_id:'684000000000000000000001',
    source:'刷子',translation:'đường dây bào khuyến mãi',
    sourceLang:'zh',targetLang:'vi',status:'approved',domain:'work',
    priority:100,...data};
}
test('Glossary load always scopes approved entries to logged-in owner and direction',async()=>{
  let query;
  const Model={find(criteria) {
    query=criteria;
    return {limit(max){
      assert.ok(max<=2000);
      return {lean:async()=>[entry()]};
    }};
  }};
  const results=await lookupUserTerms('uid_A','这是刷子吗？',
    {context:'colleague',sourceLang:'zh',targetLang:'vi'},Model);
  assert.deepEqual(query,{owner:'uid_A',sourceLang:'zh',targetLang:'vi',status:'approved'});
  assert.equal(results.length,1);
  assert.equal(results[0].translation,'đường dây bào khuyến mãi');
});
test('Term only matches an allowed domain, including colleague IT overrides',()=>{
  assert.equal(contextDomain('colleague','it'),'it');
  assert.equal(contextDomain('colleague','daily'),'work');
  assert.equal(contextDomain('superior','daily'),'work');
  assert.equal(contextDomain('colleague','unknown'),'work');
  assert.equal(contextDomain('friend','work'),'daily');
  assert.equal(contextDomain('auto','daily'),'daily');
  assert.deepEqual(resolveTerms('这是刷子吗',[entry()],{
    context:'friend',analyzedDomain:'work'}),[]);
  assert.deepEqual(resolveTerms('这是刷子吗',[entry()],{
    context:'auto',analyzedDomain:'unknown'}),[]);
  assert.equal(resolveTerms('这是刷子吗',[entry()],{
    context:'colleague',analyzedDomain:'daily'}).length,1);
  assert.equal(resolveTerms('这是刷子吗',[entry()],{
    context:'superior',analyzedDomain:'daily'}).length,1);
});
test('Overlapping variants resolve longest first and preserve exact position',()=>{
  const rows=[entry({source:'刷子'}),entry({source:'这是刷子',translation:'đây là đường dây'})];
  const selected=resolveTerms('帮忙看下，这是刷子吗？',rows,{context:'colleague'});
  assert.equal(selected.length,1);
  assert.equal(selected[0].source,'这是刷子');
  const result='Giúp mình xem đây là đường dây phải không?';
  assert.equal(termHighlights(result,selected).length,1);
});
test('Glossary prompts are only injected on actual matches',()=>{
  assert.equal(glossaryInstructions([]),'');
  const r=resolveTerms('刷子',[entry()],{context:'colleague'});
  const instr=glossaryInstructions(r);
  assert.ok(instr.includes('đường dây bào khuyến mãi'));
  assert.ok(instr.includes('không diễn dịch lại nghĩa từ AI'));
});
test('Glossary CRUD must be owner-scoped, authorized, unique and validated',()=>{
  const model=read('ai/terminology/model.js');
  const routes=read('ai/terminology/routes.js');
  assert.match(model,/owner:.*ObjectId/);
  assert.match(model,/unique:true/);
  assert.match(routes,/router\.use\(requireAuth\)/);
  assert.match(routes,/owner:req\.user\._id/);
  assert.match(routes,/status:'approved'/);
  assert.match(routes,/source\.length>100/);
  assert.match(routes,/res\.status\(409\)/);
});
test('V1 and V2 both use the same resolver without cross-user shared cache',()=>{
  const server=read('server.js');
  const pro=read('ai/services/pro.service.js');
  const free=read('ai/services/free.service.js');
  const v2=read('ai/v2/routes.js');
  assert.match(server,/app\.use\('\/api\/terminology',glossaryRoutes\)/);
  assert.match(server,/lookupUserTerms\(req\.user\._id,inputText/);
  assert.match(server,/lookupUserTerms\(req\.user\._id,text\.trim\(\)/);
  assert.match(server,/const cachedData = appliedTerms\.length \? null/);
  assert.match(server,/if\(!appliedTerms\.length\) await persistProCache/);
  assert.match(free,/const cachedResult = terms\.length\?null/);
  assert.match(free,/if\(!terms\.length\)await persistFreeCache/);
  assert.match(free,/Glossary cannot be enforced with DeepL/);
  assert.match(pro,/glossaryInstructions\(options\.terms\|\|\[\]\)/);
  assert.match(v2,/lookupUserTerms\(req\.user\._id,source,opts\)/);
});
test('Web UI includes editor, term cards and secure textual highlights',()=>{
  const html=read('public/index.html');
  const ui=read('public/terminology.js');
  const app=read('public/app.js');
  const cards=read('public/translation-vocab.js');
  assert.match(html,/id="termEditor"/);
  assert.match(html,/id="termAddBtn"/);
  assert.match(ui,/document\.createTextNode/);
  assert.match(ui,/mark\.textContent=/);
  assert.match(ui,/window\.openTerminologyEditor/);
  assert.match(app,/window\.renderTermHighlights/);
  assert.match(cards,/term-vocab-add/);
});
