'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {translationLanguageIssue,clearEnglishInsteadOfVietnamese}=
  require('../ai/utils/translation-language');
const {validateFreeTranslation}=require('../ai/utils/validator');
const {deepTranslate}=require('../ai/v2/engine');
const {PRO_SYSTEM,PRO_JSON_SYSTEM}=require('../ai/prompts/v1-optimized');

const original='代收的看一下记录 代付成功率高的三方 上3个代收收多一点钱 那些代付不稳定的三方代收就不要挂上去收那么多钱';
const bad='Check the records of the collection agents. For third-party payment agents with a high success rate, use three collection agents to collect more money. For those third-party payment agents with unstable collection, do not list them to collect so much money.';
const good='Kiểm tra lịch sử của các bên thu hộ. Với các bên thứ ba có tỷ lệ chi hộ thành công cao, hãy đưa ba bên thu hộ lên để thu thêm tiền; những bên không ổn định thì đừng đưa lên thu quá nhiều tiền.';

test('the exact reported English output is blocked without rejecting Vietnamese or IDs',()=>{
  assert.equal(translationLanguageIssue(original,bad),'EXPECTED_VIETNAMESE_GOT_ENGLISH');
  assert.equal(translationLanguageIssue(original,good),null);
  assert.equal(translationLanguageIssue(original,'API 500 returned'),null);
  assert.equal(clearEnglishInsteadOfVietnamese('Xem giúp tôi, đây có phải đường dây bào khuyến mãi không?'),false);
  assert.throws(()=>validateFreeTranslation(original,{translation:bad}),{code:'INVALID_OUTPUT'});
  assert.doesNotThrow(()=>validateFreeTranslation(original,{translation:good}));
  assert.match(PRO_SYSTEM,/NEVER English/);
  assert.match(PRO_JSON_SYSTEM,/NEVER English/);
});

function v2Mocks(first,second){
  let calls=0;
  return {calls:()=>calls,providers:{
    claude:async()=>({text:JSON.stringify({domain:'work',intent:'Check payment collection',tone:'colleague',
      facts:[],terms:[],patterns:[],ambiguities:[],entities:[]}),model:'mock-claude',
      usage:{input:100,output:20}}),
    openai:async()=>{calls++;return {text:JSON.stringify({
      translation:calls===1?first:second,
      backTranslation:'',vocabulary:'',semanticReviewRequired:false,uncertainties:[]
    }),model:'mock-openai',usage:{input:100,output:50}};}
  }};
}
test('V2 repairs English into Vietnamese and charges for repair',async()=>{
  const m=v2Mocks(bad,good);
  const result=await deepTranslate({text:original,context:'colleague',vocabulary:false,
    backTranslation:false,loadGlossary:async()=>[]},m.providers);
  assert.equal(result.translation,good);
  assert.equal(result.status,'PASS');
  assert.equal(m.calls(),2);
  assert.equal(result.usage.stages.filter(x=>x.role==='repair').length,1);
});
test('V2 never returns persistent English as a valid Vietnamese translation',async()=>{
  const m=v2Mocks(bad,bad);
  await assert.rejects(deepTranslate({text:original,context:'colleague',
    vocabulary:false,backTranslation:false,loadGlossary:async()=>[]},m.providers),
    {code:'V2_WRONG_TARGET_LANGUAGE'});
  assert.equal(m.calls(),2);
});
test('V1 PRO retries wrong language once using original source and legacy format',async()=>{
  const key='V1_OPTIMIZED_PROMPTS',previous=process.env[key];
  const provider=require('../ai/providers/openai.provider');
  const old=provider.getShuffledOpenAIClients;
  const path=require.resolve('../ai/services/pro.service');
  let attempts=0;
  process.env[key]='true';
  provider.getShuffledOpenAIClients=()=>[{chat:{completions:{create:async()=>({
    model:'gpt-4o',choices:[{message:{content:'TRANSLATION: '+(++attempts===1?bad:good)}}],
    usage:{prompt_tokens:100,completion_tokens:70,total_tokens:170}
  })}}}];
  delete require.cache[path];
  try{
    const {translateFull}=require(path);
    const result=await translateFull(original,'zh',false,null,[],true,{
      backTranslation:false,vocabulary:false,context:'colleague'});
    assert.equal(attempts,2);
    assert.equal(result.content,'TRANSLATION: '+good);
    assert.equal(result.usage.prompt_tokens,200);
    assert.equal(result.usage.completion_tokens,140);
  }finally{
    provider.getShuffledOpenAIClients=old;
    if(previous===undefined)delete process.env[key];else process.env[key]=previous;
    delete require.cache[path];
  }
});
