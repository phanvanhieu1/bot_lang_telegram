'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {deepTranslate,parseObject,missingProtected,detectDirection}=require('../ai/v2/engine');
const {createProviders,outputText}=require('../ai/v2/providers');
const {resolveTerms,glossaryInstructions,termHighlights,validateAppliedTerms}=require('../ai/terminology/resolver');
function mocked({domain='work',translation='Xem giúp, đây có phải đường dây bào khuyến mãi không?',
  failClaude=false,failOpenAI=false,repair=null,ambiguities=[],semanticReviewRequired=false,translationNotes=[]}={}){
  const calls=[];
  const providers={
    claude:async(sys,input)=>{
      calls.push({which:'claude',sys,input});
      if(failClaude)throw new Error('failed');
      return {text:JSON.stringify({domain,intent:'hỏi/nhờ kiểm tra',tone:'colleague',
        facts:['câu hỏi'],terms:[{source:'刷子',meaning:'cái bàn chải'}],ambiguities}),
        model:'claude-test',usage:{input:20,output:30}};
    },
    openai:async(sys,input)=>{
      calls.push({which:'openai',sys,input});
      if(failOpenAI)throw new Error('failed');
      const repairing=input.includes('"errors"');
      return {text:JSON.stringify({translation:repairing&&repair!==null?repair:translation,
        semanticReviewRequired,uncertainties:translationNotes}),model:'gpt-test',usage:{input:70,output:50}};
    }
  };
  return {providers,calls};
}
function term(overrides={}){
  return {_id:'684000000000000000000001',source:'刷子',
    translation:'đường dây bào khuyến mãi',domain:'work',
    sourceLang:'zh',targetLang:'vi',priority:100,status:'approved',version:1,...overrides};
}
test('Claude analyzes first; DB approved glossary overrides Claude guessed terminology for OpenAI',async()=>{
  const {providers,calls}=mocked();
  let loaded=false;
  const result=await deepTranslate({text:'帮忙看下，这是刷子吗？',context:'colleague',
    loadGlossary:async(text,options)=>{
      loaded=true;assert.equal(calls[0].which,'claude');
      assert.equal(options.analyzedDomain,'work');
      return resolveTerms(text,[term()],options);
    }
  },providers);
  assert.equal(loaded,true);assert.equal(result.status,'PASS');
  assert.equal(result.appliedTerms.length,1);
  assert.equal(result.appliedTerms[0].source,'刷子');
  assert.deepEqual(result.usage.providers.sort(),['claude','openai']);
  assert.ok(calls[1].input.includes('đường dây bào khuyến mãi'));
  assert.ok(calls[1].input.includes('cái bàn chải'));
  assert.ok(calls[1].sys.includes('ưu tiên'));
});
test('No matching domain means do not force workplace meaning',async()=>{
  const rows=[term()];
  assert.deepEqual(resolveTerms('我想买个刷子',rows,{context:'friend',analyzedDomain:'daily'}),[]);
  assert.deepEqual(resolveTerms('这是刷子吗',rows,{context:'auto',analyzedDomain:'unknown'}),[]);
  assert.equal(resolveTerms('这是刷子吗',rows,{context:'colleague',analyzedDomain:'unknown'}).length,1);
  assert.equal(resolveTerms('这是刷子吗',rows,{context:'auto',analyzedDomain:'work'}).length,1);
});
test('Longest approved phrase wins over overlapping short term',()=>{
  const rows=[term(),term({source:'这是刷子',translation:'nghĩa của cụm dài'})];
  const found=resolveTerms('帮忙看下，这是刷子吗？',rows,{context:'colleague'});
  assert.equal(found.length,1);assert.equal(found[0].source,'这是刷子');
});
test('Only confirmed status, matching language and content are applied',()=>{
  const rows=[term({status:'suggested'}),term({sourceLang:'vi'}),term({source:'充值'})];
  assert.deepEqual(resolveTerms('刷子',rows,{context:'colleague'}),[]);
});
test('Resolves hard glossary output into safe exact highlights and term mismatch',()=>{
  const t=resolveTerms('刷子',[term()],{context:'colleague'});
  const translated='Đây là đường dây bào khuyến mãi.';
  const spans=termHighlights(translated,t);
  assert.equal(spans.length,1);
  assert.equal(translated.slice(spans[0].start,spans[0].end),'đường dây bào khuyến mãi');
  assert.deepEqual(validateAppliedTerms(translated,t),[]);
  assert.deepEqual(validateAppliedTerms('Đây là bàn chải',t),['刷子']);
  assert.ok(glossaryInstructions(t).includes('đường dây bào khuyến mãi'));
});
test('Missing verified term triggers at most one targeted OpenAI correction',async()=>{
  const m=mocked({translation:'Xem giúp, đây là bàn chải à?',
    repair:'Xem giúp, đây có phải đường dây bào khuyến mãi không?'});
  const result=await deepTranslate({text:'帮忙看下，这是刷子吗？',context:'colleague',
    loadGlossary:async(text,opts)=>resolveTerms(text,[term()],opts)},m.providers);
  assert.equal(result.status,'PASS');
  assert.equal(m.calls.filter(x=>x.which==='openai').length,2);
  assert.ok(m.calls[2].input.includes('errors'));
});
test('If correction still misses term, V2 must report REVIEW',async()=>{
  const m=mocked({translation:'Đây là bàn chải',repair:'Đây vẫn là bàn chải'});
  const r=await deepTranslate({text:'这是刷子吗',context:'colleague',
    loadGlossary:async(text,opts)=>resolveTerms(text,[term()],opts)},m.providers);
  assert.equal(r.status,'REVIEW');
  assert.ok(r.issues.some(x=>x.includes('刷子')));
});
test('Preserves API codes and numbers; flags omissions for review',async()=>{
  const m=mocked({translation:'Kiểm tra log giúp'});
  const r=await deepTranslate({text:'API 返回 500',context:'colleague'},m.providers);
  assert.equal(r.status,'REVIEW');
  assert.ok(r.issues.some(x=>x.includes('500')));
  assert.deepEqual(missingProtected('API 500 X7','API X7'),['500']);
});
test('Claude failure and unavailable database never quietly become valid translation',async()=>{
  await assert.rejects(deepTranslate({text:'刷子'},mocked({failClaude:true}).providers));
  await assert.rejects(deepTranslate({text:'刷子',loadGlossary:async()=>{throw Error('db down')}},
    mocked().providers),{code:'V2_GLOSSARY_UNAVAILABLE'});
});
test('Unspecified details and Claude guesses are advisory, not automatic translation failures',async()=>{
  const m=mocked({ambiguities:['Không biết đây là vật nào'],
    translationNotes:['Câu không nói rõ loại bàn chải']});
  const r=await deepTranslate({text:'这是刷子吗'},m.providers);
  assert.equal(r.status,'PASS');
  assert.equal(r.needsReview,false);
  assert.deepEqual(r.analysis.ambiguities,['Không biết đây là vật nào']);
  assert.deepEqual(r.translationNotes,['Câu không nói rõ loại bàn chải']);
});
test('Important unresolved semantic ambiguity explicitly marked by translator triggers REVIEW',async()=>{
  const m=mocked({semanticReviewRequired:true,translationNotes:['Có hai chủ thể khác nhau']});
  const r=await deepTranslate({text:'他说让他先走'},m.providers);
  assert.equal(r.status,'REVIEW');
  assert.match(r.issues.join(' '),/mơ hồ quan trọng/);
});
test('Claude analysis output is bounded for short inputs',async()=>{
  const m=mocked();
  const r=await deepTranslate({text:'这是刷子吗'},m.providers);
  assert.equal(r.status,'PASS');
  assert.match(m.calls[0].sys,/Ambiguities tối đa 2/);
  assert.match(m.calls[0].sys,/Không liệt kê chi tiết/);
});
test('Input and provider schema failures are bounded',async()=>{
  await assert.rejects(deepTranslate({text:'a'.repeat(2001)},mocked().providers),{code:'V2_INVALID_INPUT'});
  assert.throws(()=>parseObject('not json'),{code:'V2_INVALID_AGENT_JSON'});
  assert.deepEqual(detectDirection('刷子'),{source:'zh',target:'vi'});
  assert.equal(outputText({output_text:' Xin chào '}),'Xin chào');
  assert.deepEqual(Object.keys(createProviders({})).sort(),['claude','deepl','groq','openai','openrouter']);
});
