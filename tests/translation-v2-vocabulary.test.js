'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {sanitizeClaudeTerms,toStudyVocabulary}=require('../ai/v2/vocabulary');
const {parseAi1Items}=require('../web-vocabulary/ai-items');
const {deepTranslate}=require('../ai/v2/engine');
const root=path.join(__dirname,'..');
const read=filename=>fs.readFileSync(path.join(root,filename),'utf8');

test('Claude suggestions are source-grounded, deduplicated and compatible with V1 study parser',()=>{
  const text='我下班以后去超市买刷子，刷子很便宜。';
  const terms=sanitizeClaudeTerms([
    {source:'下班',meaning:'tan làm'},
    {source:'超市',meaning:'siêu thị'},
    {source:'刷子',meaning:'bàn chải'},
    {source:'刷子',meaning:'bàn chải khác'},
    {source:'胡说',meaning:'điều không hề có'},
    {source:'http://example.com',meaning:'liên kết'},
    {source:'123456',meaning:'mã'},
    {source:'下班',meaning:'\nđịnh nghĩa lỗi'}
  ],text,'zh');
  assert.deepEqual(terms.map(x=>x.source),['下班','超市','刷子']);
  const vocabulary=toStudyVocabulary(terms,text,'zh');
  const parsed=parseAi1Items(vocabulary,text,'zh');
  assert.deepEqual(parsed.map(x=>x.key),['下班','超市','刷子']);
  assert.equal(parsed.find(x=>x.key==='刷子').occurrences,2);
  assert.equal(vocabulary.includes('胡说'),false);
  assert.equal(toStudyVocabulary(terms,text,'vi'),'');
});

test('Vietnamese Claude terms are display-only and never added to Chinese study library',()=>{
  const terms=sanitizeClaudeTerms([
    {source:'tan làm',meaning:'kết thúc công việc'},
    {source:'mua rau',meaning:'đi chợ mua đồ ăn'},
    {source:'付款',meaning:'thanh toán'}
  ],'Tôi tan làm rồi đi mua rau','vi');
  assert.deepEqual(terms.map(x=>x.source),['tan làm','mua rau']);
  assert.equal(toStudyVocabulary(terms,'Tôi tan làm rồi đi mua rau','vi'),'');
});

test('engine sends validated Claude vocabulary suggestions without another AI call',async()=>{
  let claudeCount=0,openaiCount=0;
  const providers={
    claude:async()=>{
      claudeCount++;
      return {text:JSON.stringify({
        domain:'daily',intent:'hỏi xác nhận',tone:'bình thường',
        facts:[],terms:[
          {source:'超市',meaning:'siêu thị'},
          {source:'没 trong câu?',meaning:'sai nguồn'},
          {source:'超市',meaning:'nghĩa lặp'}
        ],ambiguities:[]
      }),model:'claude-test',usage:{input:300,output:80}};
    },
    openai:async()=>{
      openaiCount++;
      return {text:JSON.stringify({translation:'Tôi đến siêu thị.',
        semanticReviewRequired:false,uncertainties:[]}),
        model:'openai-test',usage:{input:380,output:45}};
    }
  };
  const result=await deepTranslate({text:'我去超市',context:'friend'},providers);
  assert.equal(result.status,'PASS');
  assert.deepEqual(result.analysisTerms,[{source:'超市',meaning:'siêu thị'}]);
  assert.equal(claudeCount,1);
  assert.equal(openaiCount,1);
  assert.equal(result.usage.stages.length,2);
  assert.match(read('public/app.js'),/renderV2ClaudeTerms/);
  assert.match(read('public/app.js'),/renderTranslationVocabulary\?\.\(/);
  assert.match(read('public/index.html'),/id="v2ClaudeVocabulary"/);
});

test('Confirmed terminology takes precedence over Claude vocabulary guesses',async()=>{
  const providers={
    claude:async()=>({text:JSON.stringify({
      domain:'work',intent:'xác nhận',tone:'bình thường',facts:[],
      terms:[{source:'刷子',meaning:'nghĩa Claude dự đoán'}],
      ambiguities:[]
    }),model:'claude-test',usage:{input:100,output:60}}),
    openai:async()=>({text:JSON.stringify({
      translation:'Đây là tên nhóm đã xác nhận.',
      semanticReviewRequired:false,uncertainties:[]
    }),model:'gpt-test',usage:{input:90,output:30}})
  };
  const result=await deepTranslate({text:'这是刷子吗？',context:'colleague',
    loadGlossary:async()=>[{source:'刷子',translation:'tên nhóm đã xác nhận',
      domain:'work'}]
  },providers);
  assert.equal(result.status,'PASS');
  assert.deepEqual(result.analysisTerms,[{
    source:'刷子',meaning:'tên nhóm đã xác nhận'
  }]);
});
