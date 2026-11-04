'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {deepTranslate}=require('../ai/v2/engine');

function providersFor(initial,repair) {
  let calls=0;
  return {
    claude:async()=>({
      text:JSON.stringify({domain:'work',intent:'Report API error',tone:'neutral',
        facts:[],terms:[],patterns:[],ambiguities:[],entities:[]}),
      model:'mock-claude',usage:{input:10,output:10}
    }),
    openai:async()=>{
      const item=++calls===1?initial:repair;
      return {
        text:JSON.stringify({translation:item.translation,
          semanticReviewRequired:!!item.semanticReviewRequired,
          uncertainties:item.uncertainties||[]}),
        responseStatus:item.responseStatus||'completed',
        model:'mock-openai',usage:{input:10,output:10}
      };
    }
  };
}
const options={text:'API 返回 500',context:'colleague',vocabulary:false,
  backTranslation:false,loadGlossary:async()=>[]};

test('repair cannot exchange one missing protected token for another',async()=>{
  const result=await deepTranslate(options,providersFor(
    {translation:'API trả về lỗi'},
    {translation:'Trả về mã 500'}));
  assert.equal(result.translation,'API trả về lỗi');
  assert.equal(result.status,'REVIEW');
  assert.ok(result.issues.some(x=>x.includes('500')));
  assert.equal(result.usage.stages.filter(x=>x.role==='repair').length,1);
});
test('repair is applied when it removes a verified issue without regression',async()=>{
  const result=await deepTranslate(options,providersFor(
    {translation:'API trả về lỗi'},
    {translation:'API trả về mã 500'}));
  assert.equal(result.translation,'API trả về mã 500');
  assert.equal(result.status,'PASS');
});
test('a provider-incomplete repair cannot overwrite a complete translation',async()=>{
  const result=await deepTranslate(options,providersFor(
    {translation:'API trả về lỗi'},
    {translation:'API trả về mã 500',responseStatus:'incomplete'}));
  assert.equal(result.translation,'API trả về lỗi');
  assert.equal(result.status,'REVIEW');
});
test('repair must preserve prior semantic review warnings',async()=>{
  const result=await deepTranslate(options,providersFor(
    {translation:'API trả về lỗi',semanticReviewRequired:true,
      uncertainties:['Ambiguous original intent']},
    {translation:'API trả về mã 500',semanticReviewRequired:false}));
  assert.equal(result.translation,'API trả về mã 500');
  assert.equal(result.status,'REVIEW');
  assert.deepEqual(result.translationNotes,['Ambiguous original intent']);
});
