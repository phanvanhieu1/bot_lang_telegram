'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {deepTranslate}=require('../ai/v2/engine');
const {NAME_PRESERVATION_RULES,sanitizeProperNames,missingProtectedNames}=
  require('../ai/prompts/proper-names');
const repo=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(repo,p),'utf8');
const original='TX17935632022942941041  70  X855YC15  X855多出的芳华晚上你核实下';
const preserved='TX17935632022942941041 70 X855YC15 — X855 có phần dư liên quan đến 芳华, tối bạn xác minh giúp.';

function fakeProviders({translations=[preserved],names=['芳华'],terms=[]}={}){
  const requests=[];
  return {requests,
    claude:async(system,user,meta)=>{
      requests.push({role:'claude',system,user,meta});
      assert.match(system,/names/);
      return {model:'claude-mock',usage:{input:500,output:125},
        text:JSON.stringify({domain:'work',intent:'Nhờ kiểm tra phần dư trong giao dịch',
          tone:'colleague',facts:['Cần kiểm tra'],terms,patterns:[],
          ambiguities:[],names})};
    },
    openai:async(system,user,meta)=>{
      const data=JSON.parse(user);
      requests.push({role:'openai',system,user:data,meta});
      const translation=translations.shift()||'';
      return {model:'gpt-mock',usage:{input:800,output:145},
        text:JSON.stringify({translation,backTranslation:'',vocabulary:'',
          semanticReviewRequired:false,uncertainties:[]})};
    }
  };
}

test('V2 extracts exact proprietary Chinese names and preserves them with identifiers',async()=>{
  const providers=fakeProviders();
  const result=await deepTranslate({
    text:original,context:'auto',vocabulary:false,backTranslation:false,
    loadGlossary:async()=>[]
  },providers);
  assert.equal(result.status,'PASS');
  assert.deepEqual(result.analysis.names,['芳华']);
  assert.ok(result.translation.includes('芳华'));
  assert.deepEqual(providers.requests.map(x=>x.role),['claude','openai']);
  const prompt=providers.requests[1];
  assert.deepEqual(prompt.user.protectedNames,['芳华']);
  assert.equal(prompt.user.analysis.names,undefined,
    'protectedNames must not be repeated inside GPT analysis');
  assert.match(prompt.system,/CHÉP Y NGUYÊN/);
  for(const code of ['TX17935632022942941041','70','X855YC15','X855'])
    assert.ok(result.translation.includes(code),code);
});


test('Named entity protection excludes conflicting Claude vocabulary hypotheses',async()=>{
  const providers=fakeProviders({terms:[
    {source:'芳华',meaning:'thanh xuân'},
    {source:'核实',meaning:'xác minh'}
  ]});
  const result=await deepTranslate({
    text:original,context:'auto',loadGlossary:async()=>[]
  },providers);
  assert.equal(result.status,'PASS');
  assert.deepEqual(providers.requests[1].user.protectedNames,['芳华']);
  assert.ok(!providers.requests[1].user.analysis.terms.some(x=>x.source==='芳华'));
  assert.ok(providers.requests[1].user.analysis.terms.some(x=>x.source==='核实'));
  assert.ok(!result.analysisTerms.some(x=>x.source==='芳华'));
});

test('V2 invokes at most its existing one-pass repair on omitted Chinese name',async()=>{
  const providers=fakeProviders({translations:[
    'TX17935632022942941041 70 X855YC15 — tối bạn kiểm tra phần dư của X855.',
    preserved
  ]});
  const result=await deepTranslate({
    text:original,context:'auto',vocabulary:false,backTranslation:false,
    loadGlossary:async()=>[]
  },providers);
  assert.equal(result.status,'PASS');
  assert.equal(result.needsReview,false);
  assert.equal(providers.requests.length,3);
  const repair=providers.requests[2];
  assert.deepEqual(repair.user.protectedNames,['芳华']);
  assert.ok(repair.user.errors.some(x=>x.includes('芳华')));
  assert.equal(result.translation,preserved);
});

test('If even repair omits a name, V2 reports review rather than silent PASS',async()=>{
  const missing='TX17935632022942941041 70 X855YC15 — tối bạn kiểm tra phần dư của X855.';
  const providers=fakeProviders({translations:[missing,missing]});
  const result=await deepTranslate({text:original,
    vocabulary:false,backTranslation:false,loadGlossary:async()=>[]},providers);
  assert.equal(result.status,'REVIEW');
  assert.equal(result.needsReview,true);
  assert.ok(result.issues.some(x=>x.includes('芳华')));
  assert.equal(providers.requests.filter(x=>x.role==='openai').length,2);
});

test('User-confirmed glossary translation outranks analyzer protected-name guess',async()=>{
  const providers=fakeProviders({
    translations:['TX17935632022942941041 70 X855YC15 — phần dư X855 của FH, tối kiểm tra lại.']
  });
  const result=await deepTranslate({
    text:original,context:'colleague',
    vocabulary:false,backTranslation:false,
    loadGlossary:async()=>[{
      id:'name-confirmed',source:'芳华',translation:'FH',
      domain:'work',offset:29,priority:100
    }]
  },providers);
  assert.equal(result.status,'PASS');
  assert.deepEqual(result.analysis.names,[]);
  assert.deepEqual(providers.requests[1].user.protectedNames,[]);
  assert.ok(providers.requests[1].user.approvedTerminology.some(x=>x.source==='芳华'));
  assert.equal(providers.requests.length,2);
});

test('Name sanitizer only accepts literal Chinese spans, never hallucinated source',()=>{
  assert.deepEqual(sanitizeProperNames(['芳华','芳华','华芳','XYZ','不在原文'],
    original),['芳华']);
  assert.deepEqual(missingProtectedNames('X855 tại 芳华',['芳华']),[]);
  assert.deepEqual(missingProtectedNames('X855 tại Hoa Vãn',['芳华']),['芳华']);
  assert.deepEqual(sanitizeProperNames(['芳华'],original,[{source:'芳华',translation:'FH'}]),[]);
  assert.doesNotMatch(NAME_PRESERVATION_RULES,/TX17935632022942941041|芳华/);
});

test('V1 PRO/FREE keep uncertain proper names in Chinese and change only zh cache namespace',()=>{
  const pro=read('ai/prompts/pro.prompt.js');
  const free=read('ai/prompts/free.prompt.js');
  const cache=read('web-cache.js');
  assert.match(pro,/NAME_PRESERVATION_RULES/);
  assert.match(free,/NAME_PRESERVATION_RULES/);
  assert.match(pro,/tên riêng\/nhãn\/mã/);
  assert.match(cache,/free-context-3-names/);
  assert.match(cache,/pro-context-3-names/);
  assert.match(cache,/free-context-2/);
  assert.match(cache,/pro-context-2/);
  assert.doesNotMatch(pro,/芳华|X855/);
  assert.doesNotMatch(free,/芳华|X855/);
});
