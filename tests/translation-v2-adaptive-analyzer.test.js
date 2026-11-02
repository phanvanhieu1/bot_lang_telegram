'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {analyzerBudget}=require('../ai/v2/analyzer-budget');
const {deepTranslate,ENGINE_VERSION}=require('../ai/v2/engine');
const {sanitizeClaudeTerms}=require('../ai/v2/vocabulary');
const {parseAi1Items}=require('../web-vocabulary/ai-items');
const fs=require('node:fs');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');

test('Unicode codepoint counter chooses correct short/medium/long tiers',()=>{
  const expected=[
    ['🙂'.repeat(80),80,'short',6,8,3,2],
    ['中'.repeat(81),81,'medium',12,15,5,4],
    ['中'.repeat(400),400,'medium',12,15,5,4],
    ['中'.repeat(401),401,'long',20,20,6,5]
  ];
  for(const [source,count,tier,facts,terms,patterns,ambiguities] of expected){
    const b=analyzerBudget('  '+source+'  ');
    assert.equal(b.characters,count);
    assert.equal(b.tier,tier);
    assert.deepEqual([b.limits.facts,b.limits.terms,
      b.limits.patterns,b.limits.ambiguities],
    [facts,terms,patterns,ambiguities]);
    assert.ok(b.maxOutputTokens>=1050&&b.maxOutputTokens<=3600);
    assert.ok(b.retryMaxOutputTokens>b.maxOutputTokens);
    assert.ok(b.retryMaxOutputTokens<=5500);
  }
  assert.ok(analyzerBudget('中'.repeat(1500)).maxOutputTokens>
    analyzerBudget('中'.repeat(250)).maxOutputTokens);
  assert.equal(analyzerBudget('x'.repeat(2000)).maxOutputTokens,3600);
});

test('Claude receives length-based limits as user data and same caps prune response',async()=>{
  const cases=[80,81,400,401];
  for(const length of cases){
    const b=analyzerBudget('中'.repeat(length)),calls=[];
    const claudeOutput={
      domain:'work',intent:'x'.repeat(900),tone:'neutral',
      facts:Array.from({length:25},(_,i)=>'fact'+i),
      terms:Array.from({length:25},(_,i)=>({
        source:'中',meaning:'thuật ngữ '+i})),
      patterns:Array.from({length:10},(_,i)=>({
        source:'中',meaning:'mẫu câu '+i})),
      ambiguities:Array.from({length:10},(_,i)=>'ambiguity '+i)
    };
    const providers={
      claude:async(system,input,meta)=>{
        const data=JSON.parse(input);
        assert.deepEqual(data.analysisLimits,b.limits);
        assert.equal(data.original,'中'.repeat(length));
        assert.equal(meta.maxOutputTokens,b.maxOutputTokens);
        assert.match(system,/analysisLimits/);
        calls.push('claude');
        return {text:JSON.stringify(claudeOutput),
          model:'claude-mock',usage:{input:100,output:300}};
      },
      openai:async(system,input)=>{
        const data=JSON.parse(input),analysis=data.analysis;
        assert.equal(analysis.facts.length,b.limits.facts);
        assert.equal(analysis.terms.length,b.limits.terms);
        assert.equal(analysis.patterns.length,b.limits.patterns);
        assert.equal(analysis.ambiguities.length,b.limits.ambiguities);
        assert.equal(analysis.intent.length,b.limits.intentChars);
        assert.equal(analysis.domain,'work');
        calls.push('openai');
        return {text:JSON.stringify({translation:'Đơn hàng đang được xử lý.',
          backTranslation:'',vocabulary:'',
          semanticReviewRequired:false,uncertainties:[]}),
          model:'openai-mock',usage:{input:300,output:80}};
      }
    };
    const result=await deepTranslate({
      text:'中'.repeat(length),context:'colleague',
      loadGlossary:async()=>[],backTranslation:false,vocabulary:false
    },providers);
    assert.equal(result.status,'PASS');
    assert.deepEqual(calls,['claude','openai'],
      'dynamic limits must not create another AI stage');
    assert.equal(result.usage.totalInputTokens,400);
  }
  assert.equal(ENGINE_VERSION,'v2.5.0','new prompts invalidate prior V2 cache');
});

test('On malformed JSON, one retry receives bigger character-aware token headroom',async()=>{
  const b=analyzerBudget('中'.repeat(600)),calls=[];
  const result=await deepTranslate({text:'中'.repeat(600),
    context:'auto',loadGlossary:async()=>[],vocabulary:false},
  {
    claude:async(sys,input,meta)=>{
      calls.push(meta.maxOutputTokens);
      if(calls.length===1)return {text:'{"domain":',
        stopReason:'max_tokens',usage:{input:50,output:meta.maxOutputTokens}};
      return {text:JSON.stringify({domain:'daily',intent:'Hỏi thăm',
        facts:['Có câu hỏi'],terms:[],patterns:[],ambiguities:[]}),
        usage:{input:50,output:70}};
    },
    openai:async()=>({text:JSON.stringify({translation:'Xin chào',
      semanticReviewRequired:false,uncertainties:[]}),
      usage:{input:50,output:30}})
  });
  assert.deepEqual(calls,[b.maxOutputTokens,b.retryMaxOutputTokens]);
  assert.equal(result.usage.stages.filter(x=>x.role.startsWith('analyzer')).length,2);
});

test('Vocabulary sanitization permits confirmed budget above former fixed 8',()=>{
  const terms=Array.from({length:20},(_,i)=>({
    source:'cụm '+String.fromCharCode(97+i),meaning:'nghĩa tiếng Việt'
  }));
  const source=terms.map(x=>x.source).join(', ');
  assert.equal(sanitizeClaudeTerms(terms,source,'vi').length,8);
  assert.equal(sanitizeClaudeTerms(terms,source,'vi',15).length,15);
  assert.equal(sanitizeClaudeTerms(terms,source,'vi',20).length,20);
  assert.match(read('ai/v2/routes.js'),/analyzerBudget\(source\)\.limits\.patterns/);
  assert.match(read('ai/v2/engine.js'),/analysisBudget=analyzerBudget\(sourceText\)/);
});

test('V2 can request 26 study items while V1 parser retains legacy default of 24',()=>{
  const words='工作 银行 会员 订单 经理 金额 人工 后台 审核 暂停 确认 继续 活动 记录 客户 登录 退款 提现 支付 成功 失败 时间 系统 安全 产品 公司'.split(' ');
  const source=words.join('，');
  const content=words.map(word=>'[WORD] '+word+' : nghĩa').join('\n');
  assert.equal(words.length,26);
  assert.equal(parseAi1Items(content,source,'zh').length,24);
  assert.equal(parseAi1Items(content,source,'zh',26).length,26);
});
