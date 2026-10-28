'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const cases=require('../benchmarks/v2-glossary-fixtures.json').cases;
const {select,makeFixtures,fakeProviders,runOne}=require('../scripts/smoke-translation-v2');
const root=path.join(__dirname,'..');
test('eight synthetic cases cover work, daily, IT, no context, longest phrase, wrong repair',()=>{
  assert.equal(cases.length,8);
  assert.equal(new Set(cases.map(c=>c.id)).size,8);
  assert.ok(cases.find(c=>c.id==='G01').claudeGuess.includes('bàn chải'));
  assert.ok(cases.find(c=>c.id==='G01').verifiedTranslation.includes('đường dây bào khuyến mãi'));
  assert.deepEqual(select(['--ids=G01,G02']).map(c=>c.id),['G01','G02']);
  assert.throws(()=>select(['--ids=UNKNOWN']),/UNKNOWN_GLOSSARY_CASE/);
});
test('mocked multi-stage V2 works end-to-end and correctly prioritizes DB over Claude',async()=>{
  for(const c of cases){
    const result=await runOne(c,{mode:'mock',glossary:'fixture'});
    assert.equal(result.errorCode,undefined,c.id);
    assert.equal(result.plumbingOK,true,c.id+': '+JSON.stringify(result));
    assert.equal(result.status,c.expectStatus,c.id);
    if(c.expectTerms.length)assert.ok(result.actualTerms.length,c.id);
  }
});
test('specialized dictionary does not overwrite a normal everyday sentence',async()=>{
  const result=await runOne(cases.find(c=>c.id==='G02'),
    {mode:'mock',glossary:'fixture'});
  assert.match(result.translation,/bàn chải/);
  assert.deepEqual(result.actualTerms,[]);
});
test('smoke dry run emits plan without network calls or environment credentials',()=>{
  const run=spawnSync(process.execPath,[
    'scripts/smoke-translation-v2.js','--dry-run','--mode=live','--limit=2'
  ],{cwd:root,timeout:15000,encoding:'utf8',env:{...process.env,
    CLAUDE_API_KEY:'',OPENAI_API_KEY:'',OPENAI_API_KEYS:'',V2_TEST_MONGODB_URI:''}});
  assert.equal(run.status,0,run.stderr);
  assert.deepEqual(JSON.parse(run.stdout).ids,['G01','G02']);
});
test('paid provider use requires explicit flag and both credentials before any call',()=>{
  const run=spawnSync(process.execPath,[
    'scripts/smoke-translation-v2.js','--mode=live','--limit=1'
  ],{cwd:root,timeout:15000,encoding:'utf8'});
  assert.notEqual(run.status,0);
  assert.match(run.stderr,/PAID_API_OPT_IN_REQUIRED/);
});
test('fixture glossary is never written to MongoDB',()=>{
  const data=makeFixtures(cases[0]);
  assert.equal(data[0].source,'刷子');
  assert.equal(data[0].status,'approved');
  assert.ok(data.every(x=>x._id.length===24));
});

test('CLI mock smoke executes whole synthetic path without any paid API keys',()=>{
  const run=spawnSync(process.execPath,[
    'scripts/smoke-translation-v2.js','--mode=mock','--ids=G01,G02'
  ],{cwd:root,timeout:15000,encoding:'utf8',env:{
    ...process.env,CLAUDE_API_KEY:'',ANTHROPIC_API_KEY:'',
    OPENAI_API_KEY:'',OPENAI_API_KEYS:'',MONGODB_URI:''
  }});
  assert.equal(run.status,0,run.stderr);
  assert.match(run.stdout,/fixture:OK/);
  assert.match(run.stdout,/"mockPlumbingPassed": 2/);
});

test('live-mode report cannot falsely claim plumbing success on missing approved term',async()=>{
  const sample={...cases.find(x=>x.id==='G01'),forceWrong:true,repairWrong:true};
  const providers=fakeProviders(sample);
  const result=await runOne(sample,{mode:'live',glossary:'fixture',providersOverride:providers});
  assert.equal(result.status,'REVIEW');
  assert.equal(result.termMatchOK,false);
  assert.equal(result.plumbingOK,null);
  assert.equal(result.humanQualityReviewed,false);
});
test('G08 deliberately expects an omitted term in mock but requires the approved term live',async()=>{
  const c=cases.find(x=>x.id==='G08');
  const mocked=await runOne(c,{mode:'mock',glossary:'fixture'});
  assert.equal(mocked.status,'REVIEW');
  assert.deepEqual(mocked.expectedTerms,[]);
  assert.equal(mocked.termMatchOK,true);

  // Same G08 sentence, but without the deliberately broken mock provider.
  const realBehavior={...c,forceWrong:false,repairWrong:false};
  const simulatedLive=await runOne(realBehavior,{mode:'live',glossary:'fixture',
    providersOverride:fakeProviders(realBehavior)});
  assert.equal(simulatedLive.status,'PASS');
  assert.deepEqual(simulatedLive.expectedTerms,['刷子']);
  assert.deepEqual(simulatedLive.actualTerms,['刷子']);
  assert.equal(simulatedLive.termMatchOK,true);
  assert.equal(simulatedLive.plumbingOK,null);
  assert.equal(simulatedLive.humanQualityReviewed,false);
});
test('G08 live refusal of confirmed term is reported as a failure',async()=>{
  const c=cases.find(x=>x.id==='G08');
  const result=await runOne(c,{mode:'live',glossary:'fixture',providersOverride:fakeProviders(c)});
  assert.equal(result.status,'REVIEW');
  assert.deepEqual(result.expectedTerms,['刷子']);
  assert.deepEqual(result.actualTerms,[]);
  assert.equal(result.termMatchOK,false);
});

test('live-mode glossary match is not the same as a human translation quality PASS',async()=>{
  const sample=cases.find(x=>x.id==='G01');
  const result=await runOne(sample,{mode:'live',glossary:'fixture',
    providersOverride:fakeProviders(sample)});
  assert.equal(result.termMatchOK,true);
  assert.equal(result.plumbingOK,null);
  assert.equal(result.humanQualityReviewed,false);
});
