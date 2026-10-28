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
  assert.deepEqual(query,{
    owner:'uid_A',status:'approved',
    $or:[
      {sourceLang:'zh',targetLang:'vi'},
      {sourceLang:'vi',targetLang:'zh',bidirectional:true}
    ]
  });
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

test('One approved pair is reversible only after explicit opt-in',()=>{
  const approved=entry({bidirectional:true});
  const opts={context:'colleague',analyzedDomain:'work',sourceLang:'vi',targetLang:'zh'};
  const input='Đây có phải là đường dây bào khuyến mãi không?';
  const reversed=resolveTerms(input,[approved],opts);
  assert.equal(reversed.length,1);
  assert.equal(reversed[0].source,'đường dây bào khuyến mãi');
  assert.equal(reversed[0].translation,'刷子');
  assert.equal(reversed[0].domain,'work');
  assert.deepEqual(termHighlights('这是刷子吗？',reversed).map(x=>x.source),
    ['đường dây bào khuyến mãi']);
  assert.deepEqual(resolveTerms(input,[entry()],opts),[],
    'Legacy one-way records must not gain reverse approval automatically');
  assert.deepEqual(resolveTerms(input,[approved],{...opts,context:'friend'}),[],
    'A reverse work term must still honor the selected domain');
  assert.equal(resolveTerms('刷子',[approved],{
    ...opts,sourceLang:'zh',targetLang:'vi'
  }).length,1,'Opt-in must preserve original translation direction');
});

test('Explicit Vietnamese source entries work without reverse approval',()=>{
  const opts={context:'colleague',sourceLang:'vi',targetLang:'zh'};
  const vietnamese=entry({source:'kiểm soát rủi ro',translation:'风控',
    sourceLang:'vi',targetLang:'zh',bidirectional:false});
  const selected=resolveTerms('Hồ sơ chưa qua kiểm soát rủi ro',[vietnamese],opts);
  assert.equal(selected.length,1);
  assert.equal(selected[0].source,'kiểm soát rủi ro');
  assert.equal(selected[0].translation,'风控');
});

test('Vietnamese and Latin word boundaries avoid substring-only matches',()=>{
  const v=entry({source:'tiền',translation:'款项',
    sourceLang:'vi',targetLang:'zh',domain:'any'});
  const opts={context:'auto',sourceLang:'vi',targetLang:'zh'};
  assert.equal(resolveTerms('đồng tiền',[v],opts).length,1);
  assert.deepEqual(resolveTerms('kiếm tiềnlương',[v],opts),[]);
  const api=entry({source:'API',translation:'接口',domain:'it'});
  assert.equal(resolveTerms('API返回 403',[api],{
    context:'auto',analyzedDomain:'it',sourceLang:'zh',targetLang:'vi'
  }).length,1,'Chinese adjacent to Latin term should not break match');
});

test('Owner-scoped Mongo lookup supports only explicitly reversible approved rows',async()=>{
  const opts={context:'colleague',sourceLang:'vi',targetLang:'zh'};
  const searched=[];
  const Model={find(criteria){
    searched.push(criteria);
    return {limit:()=>({lean:async()=>[entry({bidirectional:true})]})};
  }};
  const result=await lookupUserTerms('uid_B','đường dây bào khuyến mãi',opts,Model);
  assert.equal(result.length,1);
  assert.equal(result[0].translation,'刷子');
  assert.equal(searched[0].owner,'uid_B');
  assert.equal(searched[0].status,'approved');
  assert.deepEqual(searched[0].$or[1],{
    sourceLang:'zh',targetLang:'vi',bidirectional:true
  });
});

test('CRUD enforces explicit boolean two-way approval and both language directions',()=>{
  const {validateGlossaryPayload}=require('../ai/terminology/routes');
  const base={source:'刷子',translation:'đường dây bào khuyến mãi',
    sourceLang:'zh',targetLang:'vi',domain:'work'};
  assert.equal(validateGlossaryPayload(base).bidirectional,false,
    'Old clients must default to one-way');
  assert.equal(validateGlossaryPayload({...base,bidirectional:true}).bidirectional,true);
  assert.equal(validateGlossaryPayload({...base,bidirectional:'true'}),null);
  const flipped=validateGlossaryPayload({source:'đường dây bào khuyến mãi',
    translation:'刷子',sourceLang:'vi',targetLang:'zh',domain:'work'});
  assert.equal(flipped.sourceLang,'vi');
  assert.equal(flipped.targetLang,'zh');
  assert.equal(validateGlossaryPayload({...base,targetLang:'zh'}),null);
});
