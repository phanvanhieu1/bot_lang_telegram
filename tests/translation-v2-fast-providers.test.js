'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createProviders,getV2ModelSettings,DEFAULTS}=require('../ai/v2/providers');
const {estimateUsage}=require('../ai/v2/accounting');
const {keyForRequest}=require('../ai/v2/cache');

test('fast V2 defaults are real low-latency models with explicit reasoning controls',()=>{
  assert.equal(DEFAULTS.claude,'claude-haiku-5-5');
  assert.equal(DEFAULTS.openai,'gpt-6.1-terra');
  assert.deepEqual(getV2ModelSettings({}),{
    openaiModel:'gpt-6.1-terra',
    claudeModel:'claude-haiku-5-5',
    openaiEffort:'none',
    claudeEffort:'low'
  });
  const deep=getV2ModelSettings({V2_CLAUDE_MODEL:'claude-sonnet-5-5',
    V2_OPENAI_MODEL:'gpt-6.1-sol'});
  assert.equal(deep.openaiEffort,'medium');
  assert.equal(deep.claudeEffort,null);
  assert.equal(getV2ModelSettings({V2_CLAUDE_EFFORT:'medium',
    V2_OPENAI_REASONING_EFFORT:'low'}).openaiEffort,'low');
});

test('cache fingerprints include model family and reasoning level',()=>{
  const opts={owner:'684000000000000000000001',text:'你好',context:'friend',
    signature:'fixture',env:{}};
  const fast=keyForRequest(opts);
  assert.notEqual(fast,keyForRequest({...opts,env:{
    V2_OPENAI_REASONING_EFFORT:'low'}}));
  assert.notEqual(fast,keyForRequest({...opts,env:{
    V2_CLAUDE_EFFORT:'medium'}}));
  assert.notEqual(fast,keyForRequest({...opts,env:{
    V2_CLAUDE_MODEL:'claude-sonnet-5-5',
    V2_OPENAI_MODEL:'gpt-6.1-sol'}}));
});

test('fast model per-stage and total billing uses their own published rates',()=>{
  const stages=[
    {role:'analyzer',model:'claude-haiku-5-5',provider:'claude',
      usage:{input:1000,output:200}},
    {role:'translator',model:'gpt-6.1-terra',provider:'openai',
      usage:{input:700,output:150}}
  ];
  assert.equal(estimateUsage({stages:[stages[0]]}).estimatedKnownPaidUsd,0.0002);
  assert.equal(estimateUsage({stages:[stages[1]]}).estimatedKnownPaidUsd,0.00145);
  assert.equal(estimateUsage({stages}).estimatedKnownPaidUsd,0.00165);
  assert.equal(estimateUsage({stages}).pricingIncomplete,false);
  assert.equal(estimateUsage({stages:[{model:'unknown',provider:'openai',
    usage:{input:500,output:40}}]}).pricingIncomplete,true);
});

test('provider requests use low effort Haiku and reasoning none Terra; no live API calls',async()=>{
  const before=global.fetch;
  const requests=[];
  global.fetch=async(url,opts)=>{
    const body=JSON.parse(opts.body);
    requests.push({url,body});
    if(url.includes('anthropic.com'))return {
      ok:true,json:async()=>({model:'claude-haiku-5-5',stop_reason:'end_turn',
        content:[{type:'text',text:'{"domain":"daily","intent":"xin chào"}'}],
        usage:{input_tokens:210,output_tokens:51}})
    };
    return {ok:true,json:async()=>({model:'gpt-6.1-terra',status:'completed',
      output_text:'{"translation":"Xin chào","semanticReviewRequired":false,"uncertainties":[]}',
      usage:{input_tokens:280,output_tokens:41}})};
  };
  try{
    const providers=createProviders({OPENAI_API_KEY:'unused-test',
      CLAUDE_API_KEY:'unused-test'});
    const analysis=await providers.claude('Analyze','{"original":"你好"}',{maxOutputTokens:800});
    const translated=await providers.openai('Translate','{"original":"你好"}',{
      maxOutputTokens:1500,
      jsonSchema:{type:'object',properties:{translation:{type:'string'}},required:['translation']}
    });
    assert.equal(analysis.model,'claude-haiku-5-5');
    assert.equal(translated.model,'gpt-6.1-terra');
    assert.deepEqual(analysis.usage,{input:210,output:51});
    assert.deepEqual(translated.usage,{input:280,output:41});
    assert.equal(requests.length,2);
    const haiku=requests.find(r=>r.url.includes('anthropic.com')).body;
    const terra=requests.find(r=>r.url.includes('openai.com')).body;
    assert.equal(haiku.model,'claude-haiku-5-5');
    assert.equal(haiku.output_config.effort,'low');
    assert.equal(haiku.max_tokens,800);
    assert.equal(terra.model,'gpt-6.1-terra');
    assert.equal(terra.reasoning.effort,'none');
    assert.equal(terra.text.format.type,'json_schema');
  }finally{global.fetch=before;}
});

test('original deep models can be selected through environment without changing V1',async()=>{
  const originalFetch=global.fetch;
  const seen=[];
  global.fetch=async(url,opts)=>{
    const body=JSON.parse(opts.body);seen.push(body);
    if(url.includes('anthropic.com'))return {
      ok:true,json:async()=>({content:[{type:'text',text:'{}'}],usage:{input_tokens:1,output_tokens:1}})
    };
    return {ok:true,json:async()=>({output_text:'{}',usage:{input_tokens:1,output_tokens:1}})};
  };
  try{
    const providers=createProviders({OPENAI_API_KEY:'unused-test',CLAUDE_API_KEY:'unused-test',
      V2_OPENAI_MODEL:'gpt-6.1-sol',V2_CLAUDE_MODEL:'claude-sonnet-5-5'});
    await providers.claude('','test');
    await providers.openai('','test');
    assert.equal(seen[0].model,'claude-sonnet-5-5');
    assert.equal(Object.hasOwn(seen[0],'output_config'),false);
    assert.equal(seen[1].model,'gpt-6.1-sol');
    assert.equal(seen[1].reasoning.effort,'medium');
  }finally{global.fetch=originalFetch;}
});