'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {deepTranslate,missingProtected}=require('../ai/v2/engine');

const source='sắp xếp thêm 1 người nữa làm việc với tôi được không, tôi không thể làm nổi';
const translated='能不能再安排一个人跟我一起工作，我没法一个人完成。';

test('Vietnamese person counts accept equivalent Chinese numerals and classifiers',()=>{
  assert.deepEqual(missingProtected(source,translated),[]);
  assert.deepEqual(missingProtected('cần 1 người','需要一个人'),[]);
  assert.deepEqual(missingProtected('cần 1 người','需要一位同事'),[]);
  assert.deepEqual(missingProtected('cần 2 người','需要两个人'),[]);
  assert.deepEqual(missingProtected('cần 3 người','需要三个人'),[]);
  assert.deepEqual(missingProtected('cần 1 người','需要两个人'),['1']);
});
test('duplicate person counts require distinct corresponding Chinese quantities',()=>{
  assert.deepEqual(missingProtected('cần 1 người và 1 người nữa','需要一个人'),['1']);
  assert.deepEqual(missingProtected('cần 1 người và 1 người nữa','需要一个人，再来一个人'),[]);
  assert.deepEqual(missingProtected('cần 1 người và 1 người nữa','需要两个人'),['1','1']);
});
test('do not normalize amounts, identifiers or mixed-purpose digits',()=>{
  assert.deepEqual(missingProtected('API 返回 500','API 返回 1500'),['500']);
  assert.deepEqual(missingProtected('API 403','API 403'),[]);
  assert.deepEqual(missingProtected('X7','X70'),['X7']);
  assert.deepEqual(missingProtected('Mã 1','编号一'),['1']);
  assert.deepEqual(missingProtected('50%','百分之五十'),['50%']);
  assert.deepEqual(missingProtected('cần 1 người và 1 USD','需要一个人和一美元'),
    ['1','1','USD']);
});

test('reported V2 request passes with only the first GPT translation, no repair',async()=>{
  let openaiCalls=0;
  const providers={
    claude:async()=>({text:JSON.stringify({
      domain:'daily',intent:'Request one additional colleague',
      tone:'neutral',facts:[],terms:[],patterns:[],ambiguities:[],entities:[]
    }),model:'mock-claude',usage:{input:10,output:5}}),
    openai:async()=>{openaiCalls++;return {
      text:JSON.stringify({translation:translated,
        backTranslation:'Sắp xếp thêm một người làm cùng tôi được không? Tôi không thể làm một mình.',
        vocabulary:'',semanticReviewRequired:false,uncertainties:[]}),
      model:'mock-openai',usage:{input:20,output:10}
    };}
  };
  const result=await deepTranslate({text:source,context:'colleague',
    vocabulary:false,backTranslation:true,loadGlossary:async()=>[]},providers);
  assert.equal(result.translation,translated);
  assert.equal(result.status,'PASS');
  assert.deepEqual(result.issues,[]);
  assert.equal(openaiCalls,1);
  assert.deepEqual(result.usage.stages.map(x=>x.role),['analyzer','translator']);
});
