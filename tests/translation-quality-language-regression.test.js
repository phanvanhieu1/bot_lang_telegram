'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {sourceLanguage,backTranslationLanguageIssue,sanitizeV1BackTranslation}=
  require('../ai/utils/translation-language');
const {directionFor,PRO_SYSTEM}=require('../ai/prompts/v1-optimized');
const {buildProPrompt}=require('../ai/prompts/pro.prompt');
const {detectDirection,deepTranslate}=require('../ai/v2/engine');
const {TRANSLATOR_SYSTEM}=require('../ai/v2/prompts-en');

const mixed='Đơn 澎湃 này đã xử lý chưa?';
const chinese='澎湃那边的订单有没有暂停';
const vietnameseBack='Đơn bên 澎湃 này đã được xử lý chưa?';
const englishBack='Has this 澎湃 order been processed yet?';

test('Chinese internal brand inside Vietnamese source must not reverse language direction',()=>{
  for(const src of [mixed,'don hang 澎湃 nay co gui duoc khong',
    'Kiểm tra đơn GU55 trên nền tảng 澎湃 giúp tôi']){
    assert.equal(sourceLanguage(src),'vi');
    assert.deepEqual(directionFor(src),{sourceLanguage:'vi',targetLanguage:'zh'});
    assert.deepEqual(detectDirection(src),{source:'vi',target:'zh'});
  }
  assert.equal(sourceLanguage(chinese),'zh');
  assert.deepEqual(detectDirection(chinese),{source:'zh',target:'vi'});
});

test('back-translation rejects English clauses, accepts Vietnamese and embedded identifiers',()=>{
  for(const en of [
    englishBack,'Please check order.','Order processing is paused.',
    'Can it be sent?','I need help.',
    'Đơn này đã được ghi nhận. Please check the order again.'
  ])assert.ok(backTranslationLanguageIssue(mixed,en),en);
  for(const ok of [
    vietnameseBack,'Tôi cần kiểm tra đơn này.','API 500 returned',
    'Đơn của 芳华 này có thể gửi không?'
  ])assert.equal(backTranslationLanguageIssue(mixed,ok),null,ok);
});

test('V1 sanitizes multiline English back-translation without deleting vocabulary or verification',()=>{
  const payload='TRANSLATION: 澎湃这个订单处理好了吗？\n'+
    'BACK_TRANSLATION: Has this 澎湃 order\nbeen processed yet?\n'+
    'VOCABULARY:\n[WORD] 订单 : đơn hàng\n'+
    'VERIFICATION: {"status":"PASS"}';
  const result=sanitizeV1BackTranslation(payload,mixed);
  assert.equal(result.issue,
    'EXPECTED_VIETNAMESE_BACK_TRANSLATION_GOT_ENGLISH');
  assert.ok(result.content.includes('TRANSLATION: 澎湃这个订单处理好了吗？'));
  assert.ok(result.content.includes('[WORD] 订单 : đơn hàng'));
  assert.ok(result.content.includes('VERIFICATION: {"status":"PASS"}'));
  assert.ok(!result.content.includes('Has this'));
  assert.ok(!result.content.includes('been processed yet'));
});

test('prompts retain actual target direction and distinct operational actions',()=>{
  const legacy=buildProPrompt(mixed,'zh',false,{
    context:'colleague',backTranslation:true,vocabulary:true});
  assert.match(legacy,/NGÔN NGỮ ĐÍCH BẮT BUỘC: TRANSLATION là TIẾNG TRUNG/);
  assert.match(legacy,/BACK_TRANSLATION phải là một câu TIẾNG VIỆT/);
  assert.ok(!legacy.includes('\\n\\nBẮT BUỘC'),
    'direction instructions must contain real newlines, not literal slash-n');
  for(const word of ['代收','代付','充值','投注','审核'])
    assert.ok(legacy.includes(word),word);
  assert.match(PRO_SYSTEM,/For each clause keep who acts/);
  assert.match(PRO_SYSTEM,/Do not conflate business actions/);
  assert.match(TRANSLATOR_SYSTEM,/preserve each instruction/);
  assert.match(TRANSLATOR_SYSTEM,/backTranslation is in Vietnamese/);
});

test('V2 keeps the source Chinese name, rejects English back output without a repair request',async()=>{
  let calls=0;
  const providers={
    claude:async()=>({text:JSON.stringify({domain:'work',
      intent:'Ask whether an order is processed',tone:'colleague',
      facts:[],terms:[],patterns:[],ambiguities:[],entities:[]}),
      model:'mock-claude',usage:{input:50,output:20}}),
    openai:async()=>{calls++;return {text:JSON.stringify({
      translation:'澎湃这个订单处理好了吗？',
      backTranslation:englishBack,vocabulary:'',
      semanticReviewRequired:false,uncertainties:[]
    }),model:'gpt-4o-mini',usage:{input:80,output:35}};}
  };
  const r=await deepTranslate({text:mixed,context:'colleague',
    backTranslation:true,vocabulary:false,translationModel:'gpt-4o-mini',
    loadGlossary:async()=>[]},providers);
  assert.equal(calls,1);
  assert.equal(r.sourceLanguage,'vi');
  assert.equal(r.targetLanguage,'zh');
  assert.equal(r.translation,'澎湃这个订单处理好了吗？');
  assert.equal(r.backTranslation,'');
  assert.equal(r.backTranslationWarning,
    'EXPECTED_VIETNAMESE_BACK_TRANSLATION_GOT_ENGLISH');
  assert.deepEqual(r.usage.stages.map(x=>x.role),['analyzer','translator']);
});

test('V1 mini does not call again to remove an English back-translation',async()=>{
  const provider=require('../ai/providers/openai.provider');
  const old=provider.getShuffledOpenAIClients;
  const modulePath=require.resolve('../ai/services/pro.service');
  const prior=process.env.V1_OPTIMIZED_PROMPTS;
  process.env.V1_OPTIMIZED_PROMPTS='false';
  let calls=0;
  provider.getShuffledOpenAIClients=()=>[{
    chat:{completions:{create:async request=>{
      calls++;
      assert.equal(request.model,'gpt-4o-mini');
      assert.equal(request.temperature,0.1);
      assert.match(request.messages[0].content,/TIẾNG TRUNG GIẢN THỂ/);
      return {model:request.model,choices:[{message:{content:
        'TRANSLATION: 澎湃这个订单处理好了吗？\n'+
        'BACK_TRANSLATION: '+englishBack}}],
        usage:{prompt_tokens:125,completion_tokens:30,total_tokens:155}};
    }}}
  }];
  delete require.cache[modulePath];
  try{
    const {translateFull}=require(modulePath);
    const result=await translateFull(mixed,'zh',false,null,[],true,{
      context:'colleague',translationModel:'gpt-4o-mini',
      vocabulary:false,backTranslation:true});
    assert.equal(calls,1);
    assert.equal(result.backTranslationWarning,
      'EXPECTED_VIETNAMESE_BACK_TRANSLATION_GOT_ENGLISH');
    assert.match(result.content,/TRANSLATION: 澎湃这个订单处理好了吗/);
    assert.ok(!result.content.includes(englishBack));
  }finally{
    provider.getShuffledOpenAIClients=old;
    if(prior===undefined)delete process.env.V1_OPTIMIZED_PROMPTS;
    else process.env.V1_OPTIMIZED_PROMPTS=prior;
    delete require.cache[modulePath];
  }
});

test('new quality rules invalidate only previous cached output namespace',()=>{
  const root=path.join(__dirname,'..');
  const cache1=fs.readFileSync(path.join(root,'web-cache.js'),'utf8');
  const cache2=fs.readFileSync(path.join(root,'ai/v2/cache.js'),'utf8');
  assert.match(cache1,/pro-model-choice-3-fidelity-vietnamese-backtranslation/);
  assert.match(cache2,/v2-cache-6-fidelity-vi-backtranslation/);
});
