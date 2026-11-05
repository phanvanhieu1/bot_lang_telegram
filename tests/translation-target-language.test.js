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
const good='Kiểm tra lịch sử của các bên thu hộ. Với các bên thứ ba có tỷ lệ chi hộ thành công cao, hãy đưa 3 bên thu hộ lên để thu thêm tiền; những bên không ổn định thì đừng đưa lên thu quá nhiều tiền.';

test('the exact reported English output is blocked without rejecting Vietnamese or IDs',()=>{
  assert.equal(translationLanguageIssue(original,bad),'EXPECTED_VIETNAMESE_GOT_ENGLISH');
  assert.equal(translationLanguageIssue(original,good),null);
  assert.equal(translationLanguageIssue(original,'API 500 returned'),null);
  assert.equal(clearEnglishInsteadOfVietnamese('Xem giúp tôi, đây có phải đường dây bào khuyến mãi không?'),false);
  assert.throws(()=>validateFreeTranslation(original,{translation:bad}),{code:'INVALID_OUTPUT'});
  assert.doesNotThrow(()=>validateFreeTranslation(original,{translation:good}));
  assert.match(PRO_SYSTEM,/TRANSLATION must be natural Vietnamese/);
  assert.match(PRO_JSON_SYSTEM,/TRANSLATION must be natural Vietnamese/);
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
test('V2 rejects English immediately without an extra paid translator call',async()=>{
  const m=v2Mocks(bad,good);
  await assert.rejects(deepTranslate({text:original,context:'colleague',
    vocabulary:false,backTranslation:false,loadGlossary:async()=>[]},m.providers),
    {code:'V2_WRONG_TARGET_LANGUAGE'});
  assert.equal(m.calls(),1);
});
test('V2 fails closed even when next fake response would be English',async()=>{
  const m=v2Mocks(bad,bad);
  await assert.rejects(deepTranslate({text:original,context:'colleague',
    vocabulary:false,backTranslation:false,loadGlossary:async()=>[]},m.providers),
    {code:'V2_WRONG_TARGET_LANGUAGE'});
  assert.equal(m.calls(),1);
});
test('V1 PRO never calls GPT twice solely to correct output language',async()=>{
  const provider=require('../ai/providers/openai.provider');
  const old=provider.getShuffledOpenAIClients;
  const path=require.resolve('../ai/services/pro.service');
  const keys=['V1_OPTIMIZED_PROMPTS','V1_OPTIMIZED_JSON_SCHEMA'];
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  process.env.V1_OPTIMIZED_PROMPTS='true';
  process.env.V1_OPTIMIZED_JSON_SCHEMA='false';
  let attempts=0;
  provider.getShuffledOpenAIClients=()=>[{chat:{completions:{create:async()=>({
    model:'gpt-4o',choices:[{message:{content:'TRANSLATION: '+(++attempts===1?bad:good)}}],
    usage:{prompt_tokens:100,completion_tokens:70,total_tokens:170}
  })}}}];
  delete require.cache[path];
  try{
    const {translateFull}=require(path);
    await assert.rejects(translateFull(original,'zh',false,null,[],true,{
      backTranslation:false,vocabulary:false,context:'colleague'}),
      {code:'V1_WRONG_TARGET_LANGUAGE'});
    assert.equal(attempts,1);
  }finally{
    provider.getShuffledOpenAIClients=old;
    for(const key of keys){
      if(previous[key]===undefined)delete process.env[key];
      else process.env[key]=previous[key];
    }
    delete require.cache[path];
  }
});

const chineseSource='让他们下发不要只留一个三方啊 那些代付不稳定的三方 代收就要下掉 收了又出不了款';
const chineseWrong='让他们下发只保留一个第三方支付平台，那些代付不稳定的第三方支付平台，代收就要去掉，收了又无法出款。';
const chineseCorrect='Bảo họ đừng chỉ giữ lại một bên thứ ba. Những bên chi hộ không ổn định thì phải gỡ khỏi phần thu hộ, vì nhận tiền vào rồi lại không thể chi tiền ra.';

test('regression: screenshot V1 Chinese paraphrase is not a Vietnamese translation',()=>{
  assert.equal(translationLanguageIssue(chineseSource,chineseWrong),'EXPECTED_VIETNAMESE_GOT_CHINESE');
  assert.equal(translationLanguageIssue(chineseSource,chineseCorrect),null);
  assert.throws(()=>validateFreeTranslation(chineseSource,{translation:chineseWrong}),{code:'INVALID_OUTPUT'});
});
test('Chinese protected names in a Vietnamese translation are allowed',()=>{
  assert.equal(translationLanguageIssue(chineseSource,
    'Bên 澎湃 vẫn đang xử lý, nhưng 芳华 chưa xác nhận lệnh rút tiền.'),null);
  assert.equal(translationLanguageIssue(chineseSource,'Kiểm tra đơn GU55 tại PP.'),null);
  assert.equal(translationLanguageIssue(chineseSource,'Kiểm tra nhãn 第三方支付平台 và đối chiếu lại hồ sơ.'),null);
});
test('V2 rejects Chinese paraphrase without a second GPT call',async()=>{
  const m=v2Mocks(chineseWrong,chineseCorrect);
  await assert.rejects(deepTranslate({text:chineseSource,context:'colleague',
    vocabulary:false,backTranslation:false,loadGlossary:async()=>[]},m.providers),
    {code:'V2_WRONG_TARGET_LANGUAGE'});
  assert.equal(m.calls(),1);
});
test('V2 rejects repeated Chinese paraphrase instead of marking PASS',async()=>{
  const m=v2Mocks(chineseWrong,chineseWrong);
  await assert.rejects(deepTranslate({text:chineseSource,context:'colleague',
    vocabulary:false,backTranslation:false,loadGlossary:async()=>[]},m.providers),
    {code:'V2_WRONG_TARGET_LANGUAGE'});
  assert.equal(m.calls(),1);
});
