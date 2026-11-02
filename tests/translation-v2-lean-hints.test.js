'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {deepTranslate,ENGINE_VERSION}=require('../ai/v2/engine');
const {extractSourceNames}=require('../ai/prompts/proper-names');

const example='TX17935632022942941041  70  X855YC15  X855多出的芳华晚上你核实下';
const translated='TX17935632022942941041 70 X855YC15 X855: phần liên quan đến 芳华, tối bạn kiểm tra lại.';

function providersFor({output=translated,claudeNames=[],claudeTerms=[]}={}){
  const calls=[];
  return {calls,
    claude:async(system,user,meta)=>{
      const data=JSON.parse(user);
      calls.push({role:'claude',system,data,meta});
      return {text:JSON.stringify({domain:'work',intent:'Cần đối chiếu nghiệp vụ',
        tone:'neutral',facts:['Yêu cầu kiểm tra'],terms:claudeTerms,
        patterns:[{source:'核实下',meaning:'kiểm tra lại'}],
        names:claudeNames,ambiguities:[]}),
        usage:{input:150,output:70},model:'claude-mock'};
    },
    openai:async(system,user,meta)=>{
      const data=JSON.parse(user);
      calls.push({role:'openai',system,data,meta});
      return {text:JSON.stringify({translation:output,backTranslation:'',
        vocabulary:'',semanticReviewRequired:false,uncertainties:[]}),
        usage:{input:300,output:80},model:'gpt-mock'};
    }
  };
}
test('High-signal JS name extraction protects a name when Claude returns names=[]',async()=>{
  assert.deepEqual(extractSourceNames(example),['芳华']);
  const p=providersFor({claudeNames:[]});
  const result=await deepTranslate({text:example,context:'auto',
    vocabulary:false,backTranslation:false,loadGlossary:async()=>[]},p);
  assert.equal(result.status,'PASS');
  assert.deepEqual(result.analysis.names,['芳华']);
  assert.deepEqual(p.calls.map(x=>x.role),['claude','openai']);
  assert.deepEqual(p.calls[0].data.nameHints,['芳华']);
  assert.deepEqual(p.calls[1].data.protectedNames,['芳华']);
  assert.equal(p.calls[1].data.analysis.names,undefined);
  assert.equal(p.calls[1].data.analysis.patterns,undefined);
});
test('Ordinary Chinese nouns near an ID are not forced into protected names',async()=>{
  const s='X855多出的余额晚上你核实下';
  assert.deepEqual(extractSourceNames(s),[]);
  assert.deepEqual(extractSourceNames('我今天晚上吃饭然后睡觉'),[]);
  const p=providersFor({output:'Tối bạn kiểm tra giúp số dư thừa của X855.'});
  const result=await deepTranslate({text:s,context:'auto',
    vocabulary:false,backTranslation:false,loadGlossary:async()=>[]},p);
  assert.equal(result.status,'PASS');
  assert.deepEqual(result.analysis.names,[]);
  assert.equal(p.calls[0].data.nameHints,undefined);
  assert.deepEqual(p.calls[1].data.protectedNames,[]);
});
test('Explicitly marked internal label is protected, unlabelled everyday text is not',()=>{
  assert.deepEqual(extractSourceNames('名称：星河'),['星河']);
  assert.deepEqual(extractSourceNames('我想去超市买个刷子'),[]);
  assert.deepEqual(extractSourceNames('银行目前余额不足，无法进行交易'),[]);
});
test('Vocabulary off does not request Claude study terms or pass study patterns to GPT',async()=>{
  const p=providersFor({output:translated,claudeTerms:[
    {source:'核实',meaning:'xác minh'},
    {source:'芳华',meaning:'tuổi thanh xuân'}
  ]});
  const r=await deepTranslate({text:example,
    vocabulary:false,backTranslation:false,loadGlossary:async()=>[]},p);
  assert.equal(r.status,'PASS');
  assert.equal(p.calls[0].data.analysisLimits.terms,0);
  assert.equal(p.calls[0].data.analysisLimits.patterns,0);
  assert.equal(p.calls[1].data.analysis.patterns,undefined);
  assert.deepEqual(p.calls[1].data.analysis.terms,[]);
  assert.deepEqual(p.calls[1].data.protectedNames,['芳华']);
  assert.deepEqual(r.analysisTerms,[]);
  assert.equal(r.analysisPatterns.length,0);
});
test('Vietnamese source never requests Claude study terms; GPT handles Chinese vocabulary',async()=>{
  const p=providersFor({output:'请检查一下。'});
  const r=await deepTranslate({text:'Vui lòng kiểm tra giúp.',
    vocabulary:true,backTranslation:false,loadGlossary:async()=>[]},p);
  assert.equal(r.status,'PASS');
  assert.equal(p.calls[0].data.analysisLimits.terms,0);
  assert.equal(p.calls[0].data.analysisLimits.patterns,0);
  assert.equal(p.calls[1].data.includeChineseVocabulary,true);
});
test('Approved mappings are included exactly once in GPT user payload, not duplicated in system',async()=>{
  const p=providersFor({output:'TX17935632022942941041 70 X855YC15 X855: phần dư của FH, tối kiểm tra giúp.'});
  const mapping={source:'芳华',translation:'FH',domain:'work',offset:38,
    id:'glossary123',priority:100,version:1};
  const r=await deepTranslate({text:example,context:'colleague',
    vocabulary:false,backTranslation:false,loadGlossary:async()=>[mapping]},p);
  assert.equal(r.status,'PASS');
  assert.deepEqual(r.analysis.names,[]);
  const gpt=p.calls.find(x=>x.role==='openai');
  assert.deepEqual(gpt.data.approvedTerminology,[{source:'芳华',meaning:'FH',domain:'work'}]);
  assert.equal(gpt.data.protectedNames.length,0);
  assert.equal(gpt.data.analysis.names,undefined);
  assert.ok(!gpt.system.includes('"source":"芳华"'));
  assert.equal((JSON.stringify(gpt.data).match(/"meaning":"FH"/g)||[]).length,1);
  assert.equal(ENGINE_VERSION,'v2.7.0');
});
