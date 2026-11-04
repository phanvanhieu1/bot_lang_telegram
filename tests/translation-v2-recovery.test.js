'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {deepTranslate}=require('../ai/v2/engine');

const FRAME={domain:'work',intent:'nhờ kiểm tra',tone:'colleague',
  facts:['câu hỏi'],terms:[],ambiguities:[]};
const JSON_FRAME=JSON.stringify(FRAME);
const JSON_TRANSLATION=JSON.stringify({
  translation:'Xem giúp, đây có phải là đường dây bào khuyến mãi không?',
  semanticReviewRequired:false,uncertainties:[]
});
function mockClaude(replies){
  const calls=[];
  const providers={
    claude:async(_system,_user,meta)=>{
      calls.push({role:'claude',maxOutputTokens:meta.maxOutputTokens});
      const reply=replies.shift();
      if(reply instanceof Error)throw reply;
      return {model:'claude-test',usage:{input:45,output:reply.output||200},
        stopReason:reply.reason||'end_turn',text:reply.text};
    },
    openai:async()=>{
      calls.push({role:'openai'});
      return {text:JSON_TRANSLATION,model:'openai-test',
        usage:{input:80,output:50}};
    }
  };
  return {providers,calls};
}
async function translateWith(providers){
  return deepTranslate({text:'帮忙看下，这是刷子吗？',context:'colleague',
    loadGlossary:async()=>[]},providers);
}
test('Claude response cut at max_tokens is retried ONCE with larger output cap',async()=>{
  const m=mockClaude([
    {reason:'max_tokens',text:'{"domain":"work","intent":"nhờ',output:800},
    {reason:'end_turn',text:JSON_FRAME,output:250}
  ]);
  const result=await translateWith(m.providers);
  assert.equal(result.status,'PASS');
  assert.deepEqual(m.calls.map(x=>x.role),['claude','claude','openai']);
  assert.ok(m.calls[1].maxOutputTokens>m.calls[0].maxOutputTokens);
  assert.equal(result.usage.stages[0].role,'analyzer');
  assert.equal(result.usage.stages[1].role,'analyzer-retry');
  assert.equal(result.usage.totalOutputTokens,1100);
});
test('Claude invalid JSON with end_turn gets one bounded retry',async()=>{
  const m=mockClaude([
    {text:'{"domain":"work","intent":',output:123},
    {text:JSON_FRAME,output:140}
  ]);
  const result=await translateWith(m.providers);
  assert.equal(result.status,'PASS');
  assert.equal(m.calls.filter(x=>x.role==='claude').length,2);
});
test('second malformed Claude response fails closed with useful sanitized diagnostics',async()=>{
  const m=mockClaude([
    {reason:'max_tokens',text:'{"domain":"work"',output:800},
    {reason:'max_tokens',text:'{"domain":"work","intent":"x"',output:1600}
  ]);
  let error;
  try{await translateWith(m.providers);}catch(e){error=e;}
  assert.equal(error?.code,'V2_CLAUDE_ANALYSIS_TRUNCATED');
  assert.equal(error?.diagnostics?.stage,'claude_analysis');
  assert.equal(error?.diagnostics?.attempts,2);
  assert.deepEqual(error?.diagnostics?.stages?.map(x=>x.usage.output),[800,1600]);
  assert.equal(m.calls.filter(x=>x.role==='openai').length,0);
  assert.ok(!JSON.stringify(error.diagnostics).includes('{"domain"'));
});
test('second malformed completed JSON gets precise error, never a fake PASS',async()=>{
  const m=mockClaude([{text:'broken',output:300},{text:'invalid',output:300}]);
  await assert.rejects(translateWith(m.providers),{code:'V2_CLAUDE_ANALYSIS_INVALID_JSON'});
  assert.equal(m.calls.length,2);
});
test('valid Claude JSON performs only one analysis call',async()=>{
  const m=mockClaude([{text:JSON_FRAME,output:290}]);
  const r=await translateWith(m.providers);
  assert.equal(r.status,'PASS');
  assert.deepEqual(m.calls.map(x=>x.role),['claude','openai']);
});
test('Claude network/provider errors do not cause repeated billable attempts',async()=>{
  const error=new Error('offline');
  error.code='V2_PROVIDER_NETWORK_ERROR';
  const m=mockClaude([error]);
  await assert.rejects(translateWith(m.providers),{code:'V2_PROVIDER_NETWORK_ERROR'});
  assert.equal(m.calls.length,1);
});
test('invalid OpenAI output is diagnosed as translation-stage JSON failure',async()=>{
  const m=mockClaude([{text:JSON_FRAME,output:190}]);
  m.providers.openai=async()=>({text:'not json',model:'openai-test',usage:{input:80,output:50}});
  let error;
  try{await translateWith(m.providers);}catch(e){error=e;}
  assert.equal(error?.code,'V2_OPENAI_TRANSLATION_INVALID_JSON');
  assert.equal(error?.diagnostics?.stage,'openai_translation');
  assert.equal(error?.diagnostics?.stages?.length,2);
});
test('OpenAI incomplete structured response is not marked as valid',async()=>{
  const m=mockClaude([{text:JSON_FRAME,output:190}]);
  m.providers.openai=async()=>({
    text:JSON_TRANSLATION,responseStatus:'incomplete',incompleteReason:'max_output_tokens',
    model:'openai-test',usage:{input:80,output:1500}
  });
  await assert.rejects(translateWith(m.providers),{code:'V2_OPENAI_TRANSLATION_INCOMPLETE'});
});
