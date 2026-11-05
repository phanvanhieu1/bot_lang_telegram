'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {optimizedProRequest,optimizedFreeRequest,outputBudget,PRO_JSON_SYSTEM}=
  require('../ai/prompts/v1-optimized');
const {v1ModelFor,parseV1Json}=require('../ai/prompts/v1-output');
const {proRequestUsage}=require('../translation-request-usage');

test('V1 stable prefixes are identical across source, audience and glossary',()=>{
  const a=optimizedProRequest('你好','zh',false,{
    context:'friend',vocabulary:false,backTranslation:false});
  const b=optimizedProRequest('澎湃订单','zh',false,{
    context:'colleague',vocabulary:false,backTranslation:false,
    terms:[{source:'澎湃',translation:'PP',domain:'work'}]});
  assert.equal(a.system,b.system);
  assert.doesNotMatch(a.system,/你好|澎湃|PP/);
  assert.match(b.user,/PP/);
  assert.match(JSON.parse(b.user).glossary,/PP/);
  assert.equal(JSON.parse(a.user).context,'friend');
  assert.equal(JSON.parse(a.user).sourceLanguage,'zh');
  assert.equal(JSON.parse(a.user).targetLanguage,'vi');
  assert.equal(JSON.parse(a.user).learningLanguage,'zh');
  const reversed=JSON.parse(optimizedProRequest('Kiểm tra lịch sử','zh',false,{
    context:'colleague',backTranslation:false,vocabulary:false
  }).user);
  assert.equal(reversed.sourceLanguage,'vi');
  assert.equal(reversed.targetLanguage,'zh');
  assert.equal(reversed.learningLanguage,'zh');
  const free=JSON.parse(optimizedFreeRequest('你好','colleague').user);
  assert.equal(free.sourceLanguage,'zh');
  assert.equal(free.targetLanguage,'vi');
  assert.equal(optimizedFreeRequest('你好','friend').system,
    optimizedFreeRequest('澎湃','colleague').system);
  assert.ok(outputBudget('你好')<outputBudget('a'.repeat(1000),{
    vocabulary:true,backTranslation:true}));
});
test('V1 JSON compatibility adapter preserves legacy wire format',()=>{
  const raw=JSON.stringify({translation:'你好',
    backTranslation:'Xin chào',vocabulary:'[WORD] 你好 : xin chào'});
  assert.equal(parseV1Json(raw,{backTranslation:true,vocabulary:true}),
    'TRANSLATION: 你好\nBACK_TRANSLATION: Xin chào\nVOCABULARY:\n[WORD] 你好 : xin chào');
  assert.equal(parseV1Json(JSON.stringify({translation:'',
    backTranslation:'',vocabulary:'[WORD] 超市 : siêu thị'}),{
    supplement:true,backTranslation:false,vocabulary:true}),
    'VOCABULARY:\n[WORD] 超市 : siêu thị');
  assert.throws(()=>parseV1Json('not json'),/V1_INVALID_JSON/);
  assert.match(PRO_JSON_SYSTEM,/strict JSON/);
  assert.doesNotMatch(PRO_JSON_SYSTEM,/never JSON/);
});
test('V1 tier never downgrades workplace, numbers, unknown text or glossary',()=>{
  const env={V1_TIERED_ROUTING:'true',V1_OPENAI_SIMPLE_MODEL:'gpt-4o-mini'};
  const opt={context:'friend',backTranslation:false,vocabulary:false};
  assert.equal(v1ModelFor('你好',opt,env),'gpt-4o-mini');
  assert.equal(v1ModelFor('你好',opt,{}),'gpt-4o');
  for(const [text,extra] of [
    ['X855多出的芳华',{}],['澎湃那边的订单有没有暂停',{}],
    ['你好',{terms:[{source:'你好',translation:'Hi'}]}],
    ['你好',{context:'colleague'}],
    ['你好',{history:[{user:'a',bot:'b'}]}]
  ])assert.equal(v1ModelFor(text,{...opt,...extra},env),'gpt-4o');
});
test('V1 cached-token accounting uses cached input price and actual model',()=>{
  const usage=proRequestUsage({prompt_tokens:1200,completion_tokens:90},false,[
    {role:'translator',model:'gpt-4o-mini',ms:80,
      usage:{input:1200,output:90,cacheRead:1024}}]);
  assert.equal(usage.stages[0].cacheReadTokens,1024);
  assert.equal(usage.estimatedCostUsd,0.0001572);
});
test('V1 opt-in routes optimized Pro into real provider request and reports JSON raw trace',async()=>{
  const mod=require.resolve('../ai/services/pro.service');
  const provider=require('../ai/providers/openai.provider');
  const original=provider.getShuffledOpenAIClients;
  const keys=['V1_OPTIMIZED_PROMPTS','V1_OPTIMIZED_JSON_SCHEMA','V1_TIERED_ROUTING'];
  const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  Object.assign(process.env,{V1_OPTIMIZED_PROMPTS:'true',
    V1_OPTIMIZED_JSON_SCHEMA:'true',V1_TIERED_ROUTING:'true'});
  let sent,trace;
  provider.getShuffledOpenAIClients=()=>[{chat:{completions:{create:async body=>{
    sent=body;return {model:'gpt-4o-mini',
      choices:[{message:{content:JSON.stringify({translation:'Xin chào',
        backTranslation:'',vocabulary:''})}}],
      usage:{prompt_tokens:1300,completion_tokens:30,
        prompt_tokens_details:{cached_tokens:1024}}};
  }}}}];
  delete require.cache[mod];
  try{
    const {translateFull}=require(mod);
    const result=await translateFull('你好','zh',false,null,[],true,{
      context:'friend',backTranslation:false,vocabulary:false,
      inspectStage:x=>{trace=x;}});
    assert.equal(sent.model,'gpt-4o-mini');
    assert.equal(sent.response_format.type,'json_schema');
    assert.equal(sent.messages[0].role,'system');
    assert.equal(JSON.parse(sent.messages.at(-1).content[0].text).source,'你好');
    assert.equal(result.content,'TRANSLATION: Xin chào');
    assert.match(trace.rawOutput,/translation/);
    assert.equal(trace.usage.cacheRead,1024);
  }finally{
    provider.getShuffledOpenAIClients=original;
    for(const k of keys)if(saved[k]===undefined)delete process.env[k];
      else process.env[k]=saved[k];
    delete require.cache[mod];
  }
});
