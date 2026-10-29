'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const holdout=require('../benchmarks/v2-holdout.json');

test('V2 routing is feature-flagged, PRO-only and does not replace original V1 route',()=>{
  const server=read('server.js');
  const routing=read('ai/v2/routes.js');
  assert.match(server,/app\.post\('\/api\/translate',requirePro/);
  assert.match(server,/app\.use\('\/api\/translate\/v2', createV2Router\(\)\)/);
  assert.match(routing,/V2_ENABLED === 'true'/);
  assert.match(routing,/requireRole\('pro','admin'\)/);
  assert.match(routing,/active\.has\(id\)/);
  assert.match(routing,/loadGlossary:\(source,opts\)=>lookupUserTerms/);
});

test('One Dịch button dispatches to chosen V1/V2 and V2 remains gated',()=>{
  const html=read('public/index.html');
  const js=read('public/app.js');
  const css=read('public/compact-layout.css');
  assert.match(html, /id="translateBtn"/);
  assert.doesNotMatch(html, /id="translateV2Btn"/);
  assert.match(html, /id="translationEnginePicker"/);
  assert.match(html, /name="translationEngine" value="v1"/);
  assert.match(html, /name="translationEngine" value="v2"/);
  assert.match(js,/translateBtn\.addEventListener\('click', translate\)/);
  assert.match(js,/selectedEngine\(\)==='v2'/);
  assert.match(js,/async function translateV2\(/);
  assert.match(js,/fetch\('\/api\/translate\/v2'/);
  assert.match(js,/\/api\/translate\/v2\/status/);
  assert.match(css, /\.translation-engine-picker\[hidden\]/);
  assert.match(js,/v2Busy/);
});

test('V2 holdout has varied new inputs and semantic checklists, not baked into prompt',()=>{
  const ids=new Set(holdout.cases.map(x=>x.id));
  assert.equal(holdout.cases.length,35);
  assert.equal(ids.size,35);
  const engine=read('ai/v2/engine.js');
  const domains={};
  for(const c of holdout.cases){
    domains[c.domain]=(domains[c.domain]||0)+1;
    assert.ok(c.source.length>7 && c.checks.length>0);
    assert.equal(engine.includes(c.source),false);
  }
  assert.equal(domains.work,10);
  assert.equal(domains.friend,10);
  assert.equal(domains.it,10);
  assert.equal(domains.mixed,5);
});

test('V2 holdout dry-run requires no credentials and sends no calls',()=>{
  const p=spawnSync(process.execPath,['scripts/benchmark-translation-v2.js','--dry-run','--limit=4','--domain=work'],{
    cwd:root,timeout:15000,encoding:'utf8'
  });
  assert.equal(p.status,0,p.stderr);
  const out=JSON.parse(p.stdout);
  assert.equal(out.count,4);
  assert.deepEqual(out.ids,['C01','C02','C03','C04']);
});

test('Holdout CLI can select only untested IDs without paying for earlier cases',()=>{
  const run=spawnSync(process.execPath,[
    'scripts/benchmark-translation-v2.js','--dry-run',
    '--ids=C06,C07,C08,C09,C10','--domain=work'
  ],{cwd:root,timeout:15000,encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const plan=JSON.parse(run.stdout);
  assert.equal(plan.count,5);
  assert.deepEqual(plan.ids,['C06','C07','C08','C09','C10']);

  for(const ids of ['C06,C06','C06,UNKNOWN','F01']){
    const rejected=spawnSync(process.execPath,[
      'scripts/benchmark-translation-v2.js','--dry-run',
      '--ids='+ids,'--domain=work'
    ],{cwd:root,timeout:15000,encoding:'utf8'});
    assert.notEqual(rejected.status,0,'Rejected: '+ids);
  }
});

test('Holdout benchmark flags suspicious everyday classification without modifying translation status',()=>{
  const {domainReviewSuggested}=require('../scripts/benchmark-translation-v2');
  assert.equal(domainReviewSuggested('work','daily'),true,'C09-type mismatch');
  assert.equal(domainReviewSuggested('work','unknown'),true);
  assert.equal(domainReviewSuggested('work','it'),false,'C05-type overlap');
  assert.equal(domainReviewSuggested('work','mixed'),false,'C03-type overlap');
  assert.equal(domainReviewSuggested('it','daily'),true);
  assert.equal(domainReviewSuggested('friend','daily'),false);
  assert.equal(domainReviewSuggested('mixed','work'),false);
});
test('Glossary editor exposes both source directions and explicit reversal approval',()=>{
  const html=read('public/index.html');
  const ui=read('public/terminology.js');
  const model=read('ai/terminology/model.js');
  assert.match(html,/id="termSourceLang"/);
  assert.match(html,/id="termBidirectional"/);
  assert.match(ui,/bidirectional:twoWay.checked/);
  assert.match(ui,/targetLang:sourceLang.value==='vi'\?'zh':'vi'/);
  assert.match(ui,/entry.bidirectional/);
  assert.match(model,/bidirectional:\{type:Boolean,default:false\}/);
});

test('Staging DB verification requires explicit read-only config and never accepts the production URI',()=>{
  const {requireStagingConfig}=require('../scripts/verify-staging-terms');
  const good={V2_ALLOW_STAGING_DB_READ:'true',
    V2_TEST_MONGODB_URI:'mongodb://localhost:27017/test-translation',
    MONGODB_URI:'mongodb://localhost:27017/prod-translation',
    V2_TEST_USER_ID:'684000000000000000000001'};
  assert.deepEqual(requireStagingConfig(good),{
    uri:good.V2_TEST_MONGODB_URI,user:good.V2_TEST_USER_ID
  });
  assert.throws(()=>requireStagingConfig({...good,V2_ALLOW_STAGING_DB_READ:'false'}),
    /STAGING_DB_CONFIG_REQUIRED/);
  assert.throws(()=>requireStagingConfig({...good,
    V2_TEST_MONGODB_URI:good.MONGODB_URI}),/STAGING_URI_MATCHES_PRODUCTION/);
  assert.throws(()=>requireStagingConfig({...good,
    V2_TEST_USER_ID:'invalid'}),/STAGING_DB_CONFIG_REQUIRED/);
  assert.match(read('scripts/verify-staging-terms.js'),/autoCreate:false/);
});

test('Private results are ignored by git',()=>{
  assert.match(read('.gitignore'),/benchmarks\/results\//);
});
