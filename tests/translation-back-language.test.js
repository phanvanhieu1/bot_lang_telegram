'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {backTranslationLanguageIssue,sanitizeV1BackTranslation}=
  require('../ai/utils/translation-language');
const {deepTranslate}=require('../ai/v2/engine');
const {PRO_SYSTEM,PRO_JSON_SYSTEM}=require('../ai/prompts/v1-optimized');
const {TRANSLATOR_SYSTEM}=require('../ai/v2/prompts-en');

const source='đơn hàng bên PP này, đã treo được 2 tiếng, nhưng không tham gia đặt cược, có thể gửi không?';
const chinese='这个PP的订单已经挂了两个小时，但没有参与投注，可以发吗？';
const english='This PP order has been hanging for two hours, but did not participate in the betting, can it be sent?';
const vietnamese='Đơn hàng bên PP đã treo hai tiếng nhưng không tham gia đặt cược, có thể gửi không?';

test('regression: screenshot English back-translation is rejected, Vietnamese accepted',()=>{
  assert.equal(backTranslationLanguageIssue(source,english),
    'EXPECTED_VIETNAMESE_BACK_TRANSLATION_GOT_ENGLISH');
  assert.equal(backTranslationLanguageIssue(source,vietnamese),null);
  assert.ok(backTranslationLanguageIssue(source,'Can it be sent?'));
  assert.ok(backTranslationLanguageIssue(source,
    'This 芳华 order has been hanging for two hours, but did not participate in the betting.'));
  assert.equal(backTranslationLanguageIssue(source,
    'Đơn của 芳华 có thể gửi không?'),null);
  assert.equal(backTranslationLanguageIssue(source,'API 500 returned'),null);
});

test('V1 sanitizer keeps original translation and vocabulary, removing only incorrect English BACK_TRANSLATION',()=>{
  const content='TRANSLATION: '+chinese+'\nBACK_TRANSLATION: '+english+
    '\nVOCABULARY:\n[WORD] 订单 : đơn hàng';
  const clean=sanitizeV1BackTranslation(content,source);
  assert.equal(clean.issue,'EXPECTED_VIETNAMESE_BACK_TRANSLATION_GOT_ENGLISH');
  assert.equal(clean.content,'TRANSLATION: '+chinese+
    '\nBACK_TRANSLATION: \nVOCABULARY:\n[WORD] 订单 : đơn hàng');
  assert.equal(sanitizeV1BackTranslation(
    'TRANSLATION: '+chinese+'\nBACK_TRANSLATION: '+vietnamese,source).issue,null);
});

test('V1 GPT-4o mini returns valid Chinese primary translation and drops wrong English back without retry',async()=>{
  const provider=require('../ai/providers/openai.provider');
  const old=provider.getShuffledOpenAIClients;
  const modulePath=require.resolve('../ai/services/pro.service');
  const previous=process.env.V1_OPTIMIZED_PROMPTS;
  process.env.V1_OPTIMIZED_PROMPTS='false';
  let calls=0;
  provider.getShuffledOpenAIClients=()=>[{
    chat:{completions:{create:async body=>{
      calls++;
      assert.equal(body.model,'gpt-4o-mini');
      assert.match(body.messages[0].content,/BACK_TRANSLATION/);
      assert.match(body.messages[0].content,/TIẾNG VIỆT/);
      return {model:body.model,choices:[{message:{
        content:'TRANSLATION: '+chinese+'\nBACK_TRANSLATION: '+english
      }}],usage:{prompt_tokens:180,completion_tokens:55,total_tokens:235}};
    }}}
  }];
  delete require.cache[modulePath];
  try{
    const {translateFull}=require(modulePath);
    const result=await translateFull(source,'zh',false,null,[],true,{
      translationModel:'gpt-4o-mini',backTranslation:true,vocabulary:false});
    assert.equal(calls,1,'invalid back-translation must not request a paid retry');
    assert.match(result.content,/TRANSLATION: 这个PP的订单/);
    assert.match(result.content,/BACK_TRANSLATION:\s*$/);
    assert.ok(!result.content.includes(english));
    assert.equal(result.backTranslationWarning,
      'EXPECTED_VIETNAMESE_BACK_TRANSLATION_GOT_ENGLISH');
  }finally{
    provider.getShuffledOpenAIClients=old;
    if(previous===undefined)delete process.env.V1_OPTIMIZED_PROMPTS;
    else process.env.V1_OPTIMIZED_PROMPTS=previous;
    delete require.cache[modulePath];
  }
});

test('V2 GPT output also suppresses an English back-translation without repair',async()=>{
  const original='đơn hàng bên PP này đang treo nhưng không tham gia đặt cược, có thể gửi không?';
  let gptCalls=0;
  const providers={
    claude:async()=>({text:JSON.stringify({domain:'work',intent:'hỏi có thể gửi đơn',
      tone:'colleague',facts:[],terms:[],patterns:[],ambiguities:[],entities:[]}),
      model:'mock-claude',usage:{input:60,output:20}}),
    openai:async()=>{gptCalls++;return {text:JSON.stringify({
      translation:'这个PP订单还挂着，没参与投注，可以发吗？',
      backTranslation:english,vocabulary:'',
      semanticReviewRequired:false,uncertainties:[]}),
      model:'gpt-4o-mini',usage:{input:70,output:25}};}
  };
  const result=await deepTranslate({text:original,context:'colleague',
    backTranslation:true,vocabulary:false,translationModel:'gpt-4o-mini',
    loadGlossary:async()=>[]},providers);
  assert.equal(gptCalls,1);
  assert.equal(result.backTranslation,'');
  assert.equal(result.translation,'这个PP订单还挂着，没参与投注，可以发吗？');
  assert.equal(result.backTranslationWarning,
    'EXPECTED_VIETNAMESE_BACK_TRANSLATION_GOT_ENGLISH');
  assert.deepEqual(result.usage.stages.map(x=>x.role),['analyzer','translator']);
});

test('cache guards and prompts protect the reverse-translation language',()=>{
  const root=path.join(__dirname,'..');
  const read=p=>fs.readFileSync(path.join(root,p),'utf8');
  const server=read('server.js'),v2=read('ai/v2/routes.js');
  assert.match(PRO_SYSTEM,/BACK_TRANSLATION MUST be a fluent Vietnamese/);
  assert.match(PRO_JSON_SYSTEM,/BACK_TRANSLATION MUST be a fluent Vietnamese/);
  assert.match(TRANSLATOR_SYSTEM,/NEVER write backTranslation in English/);
  assert.match(server,/backTranslationLanguageIssue\(inputText,cachedData\.backTranslation\)/);
  assert.match(v2,/backTranslationLanguageIssue\(original,translated\.backTranslation\)/);
  assert.match(read('web-cache.js'),/pro-model-choice-2-vietnamese-backtranslation/);
  assert.match(read('ai\/v2\/cache.js'),/v2-cache-5-vi-backtranslation/);
});
