'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {deepTranslate,parseObject,missingProtected,ENGINE_VERSION} = require('../ai/v2/engine');
const {outputText,createProviders} = require('../ai/v2/providers');
const {estimateUsage}=require('../ai/v2/accounting');

const frame={domain:'work',intent:'yêu cầu báo lại khi phát hiện',tone:'colleague',
  facts:['Kiểm tra và báo lại nếu phát hiện điều kiện'],terms:[],ambiguities:[]};
function mockProviders(options={}) {
  const calls=[];
  let openaiCount=0;
  let claudeAuditCount=0;
  const provider = {
    groq:async(sys,input)=>{
      calls.push({provider:'groq',sys,input});
      if(options.noCheap)throw Object.assign(new Error('Unavailable'),{code:'RATE_LIMIT'});
      return {text:JSON.stringify(frame),model:'qwen',usage:{input:20,output:30}};
    },
    openrouter:async(sys,input)=>{
      calls.push({provider:'openrouter',sys,input});
      if(options.criticConcern)return {text:JSON.stringify({concern:true,issues:['Bản dịch còn thiếu điều kiện']})};
      return {text:JSON.stringify({concern:false,issues:[]})};
    },
    openai:async(sys,input)=>{
      calls.push({provider:'openai',sys,input});
      openaiCount++;
      if(options.failTranslator && /Dịch chuẩn nghĩa/.test(sys)) throw new Error('failed');
      if(/nhà phân tích ngôn ngữ/.test(sys)) return {text:JSON.stringify(frame)};
      if(/Dịch chuẩn nghĩa/.test(sys))return {text:'Nếu thấy hội viên còn cược thể thao được thì báo lại',
        model:'gpt-6.1-sol',usage:{input:100,output:50}};
      if(options.repair) {
        return {text:JSON.stringify(openaiCount===2
          ? {status:'REPAIR',preferred:'openai',issues:['Cần sửa ngữ khí'],reason:'sửa'}
          : {status:'PASS',preferred:'openai',issues:[],reason:'đạt'}),model:'gpt-6.1-sol'};
      }
      if(options.auditReview)return {text:JSON.stringify({
        status:'REVIEW',preferred:'none',issues:['Thiếu ngữ cảnh'],reason:'mơ hồ'})};
      return {text:JSON.stringify({status:'PASS',preferred:options.preferred||'claude',
        issues:[],reason:'đủ ý'}),model:'gpt-6.1-sol',usage:{input:100,output:30}};
    },
    claude:async(sys,input)=>{
      calls.push({provider:'claude',sys,input});
      if(options.failClaude)throw new Error('failed');
      if(/giám khảo dịch thuật/.test(sys)) {
        claudeAuditCount++;
        if(options.failClaudeAudit) throw new Error('Audit failed');
        const verdict=options.auditDisagree
          ? {status:'PASS',preferred:'openai',issues:[],reason:'Prefer OpenAI'}
          : options.repair && claudeAuditCount===1
            ? {status:'REPAIR',preferred:'openai',issues:['Cần sửa ngữ khí'],reason:'sửa'}
            : options.auditReview
              ? {status:'REVIEW',preferred:'none',issues:['Thiếu ngữ cảnh'],reason:'mơ hồ'}
              : {status:'PASS',preferred:options.preferred||'claude',issues:[],reason:'đủ ý'};
        return {text:JSON.stringify(verdict),model:'claude-sonnet-5-5'};
      }
      return /hiệu đính/.test(sys)
        ? {text:'Nếu kiểm tra còn hội viên cược thể thao được thì báo một tiếng',model:'claude-sonnet-5-5'}
        : {text:options.claudeText||'Lúc kiểm tra nếu hội viên còn cược thể thao được thì báo lại',
          model:'claude-sonnet-5-5',usage:{input:110,output:52}};
    },
    deepl:async(text,target)=>{
      calls.push({provider:'deepl',text,target});
      if(options.deeplFails)throw new Error('No DeepL');
      return {text:'Khi kiểm tra phát hiện hội viên',usage:{characters:text.length},model:'deepl-free'};
    }
  };
  return {provider,calls};
}

test('V2 full workflow uses independent OpenAI and Claude translators, cheap analysis and challenger, DeepL reference, and OpenAI adjudicator',async()=>{
  const mocks=mockProviders();
  const result=await deepTranslate({text:'审核的时候发现还有会员能投注体育的说下',context:'colleague'},mocks.provider);
  assert.equal(result.engine,ENGINE_VERSION);
  assert.equal(result.status,'PASS');
  assert.equal(result.needsReview,false);
  assert.match(result.translation,/Lúc kiểm tra/);
  assert.ok(result.usage.providers.includes('openai'));
  assert.ok(result.usage.providers.includes('claude'));
  assert.ok(result.usage.providers.includes('deepl'));
  assert.ok(mocks.calls.some(c=>c.provider==='groq'));
  assert.ok(mocks.calls.some(c=>c.provider==='openrouter'));
  const a=mocks.calls.find(c=>c.provider==='openai' && /Dịch chuẩn nghĩa/.test(c.sys));
  const b=mocks.calls.find(c=>c.provider==='claude' && /Dịch độc lập/.test(c.sys));
  assert.ok(a && b);
  assert.ok(a.input.includes('analysis'));
  assert.equal(b.input.includes('analysis'),false,'Claude translator must not see analyzer hypothesis');
  assert.equal(b.input.includes('candidates'),false,'Claude translator must not see OpenAI candidate');
});

test('V2 degrades explicitly to review on critic concerns even if arbiter passes',async()=>{
  const mocks=mockProviders({criticConcern:true});
  const result=await deepTranslate({text:'审核的时候发现还有会员能投注体育的说下'},mocks.provider);
  assert.equal(result.status,'REVIEW');
  assert.equal(result.needsReview,true);
  assert.ok(result.issues.some(x=>x.includes('thiếu điều kiện')));
});

test('V2 repairs at most once, then independently rechecks',async()=>{
  const mocks=mockProviders({repair:true});
  const result=await deepTranslate({text:'有异常的说下'},mocks.provider);
  assert.equal(result.status,'PASS');
  assert.ok(mocks.calls.filter(c=>c.provider==='claude' && /hiệu đính/.test(c.sys)).length===1);
  assert.equal(mocks.calls.filter(c=>c.provider==='openai' && /giám khảo/.test(c.sys)).length,2);
  assert.equal(mocks.calls.filter(c=>c.provider==='claude' && /giám khảo/.test(c.sys)).length,2);
});

test('V2 refuses to claim multi-AI verification if paid translator is absent',async()=>{
  await assert.rejects(deepTranslate({text:'有异常的说下'},mockProviders({failClaude:true}).provider),
    {code:'V2_REQUIRES_OPENAI_AND_CLAUDE'});
  await assert.rejects(deepTranslate({text:'有异常的说下'},mockProviders({failTranslator:true}).provider),
    {code:'V2_REQUIRES_OPENAI_AND_CLAUDE'});
});

test('V2 remains operational when independent DeepL is unavailable',async()=>{
  const result=await deepTranslate({text:'有异常的说下'},mockProviders({deeplFails:true}).provider);
  assert.equal(result.status,'PASS');
  assert.equal(result.usage.stages.some(s=>s.provider==='deepl'&&s.error),true);
});

test('V2 falls back to paid analyzer when free models are down and still uses two paid translators',async()=>{
  const p=mockProviders({noCheap:true});
  const result=await deepTranslate({text:'有异常的说下'},p.provider);
  assert.equal(result.status,'PASS');
  assert.ok(result.usage.stages.some(s=>s.role==='analyzer'&&s.provider==='openai'));
});

test('V2 flags protected code/number omissions instead of approving',async()=>{
  const r=await deepTranslate({text:'API 返回 500，先看看日志'},
    mockProviders({claudeText:'Hãy kiểm tra log trước'}).provider);
  assert.equal(r.status,'REVIEW');
  assert.ok(r.issues.some(x=>x.includes('500')));
  assert.deepEqual(missingProtected('API 500 X7','API X7'),['500']);
});

test('V2 rejects malformed input and schema',async()=>{
  await assert.rejects(deepTranslate({text:'a'.repeat(2001)},mockProviders().provider),{code:'V2_INVALID_INPUT'});
  await assert.rejects(deepTranslate({text:'test',context:'root'},mockProviders().provider),{code:'V2_INVALID_CONTEXT'});
  assert.throws(()=>parseObject('not json',['domain']),{code:'V2_INVALID_AGENT_JSON'});
  assert.throws(()=>parseObject('{"foo":1}',['domain']),{code:'V2_INVALID_AGENT_SCHEMA'});
});

test('V2 partial price estimate never claims unsupported models have exact costs',()=>{
  const cost=estimateUsage({stages:[
    {provider:'openai',model:'gpt-6.1-sol',usage:{input:1000000,output:1000000}},
    {provider:'claude',model:'claude-sonnet-5-5',usage:{input:1000000,output:1000000}},
    {provider:'deepl',model:'deepl-free',usage:{characters:20}}
  ]});
  assert.equal(cost.estimatedKnownPaidUsd,24);
  assert.equal(cost.pricingIncomplete,true);
});

test('V2 provider output parser supports Responses API typed text',()=>{
  assert.equal(outputText({output:[{content:[{type:'output_text',text:'你好'}]}]}),'你好');
  assert.equal(outputText({output_text:'  Xin chào '}),'Xin chào');
  assert.deepEqual(Object.keys(createProviders({})).sort(),['claude','deepl','groq','openai','openrouter']);
});

test('V2 dual auditors must agree on preferred candidate; disagreement triggers human review',async()=>{
  const result=await deepTranslate({text:'有异常的说下'},
    mockProviders({auditDisagree:true}).provider);
  assert.equal(result.status,'REVIEW');
  assert.equal(result.needsReview,true);
  assert.ok(result.issues.some(x=>x.includes('chưa thống nhất')));
});

test('V2 never asserts PASS when one strong auditor is unavailable',async()=>{
  await assert.rejects(deepTranslate({text:'有异常的说下'},
    mockProviders({failClaudeAudit:true}).provider),
    {code:'V2_AUDIT_UNAVAILABLE'});
});
