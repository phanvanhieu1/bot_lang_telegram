'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {entityCandidates,classifyNames,fullyCoveredByApproved,
  missingProtectedNameOccurrences,conciseTranslationAnalysis}=
  require('../ai/v2/entity-detection');
const {deepTranslate,ENGINE_VERSION}=require('../ai/v2/engine');
const original='TX17935632022942941041 70 X855YC15 X855多出的芳华晚上你核实下';
test('Entity candidates remain grounded and do not classify everyday words',()=>{
  assert.deepEqual(entityCandidates(original).strong,['芳华']);
  assert.deepEqual(entityCandidates('X855多出的余额晚上你核实下').strong,[]);
  assert.deepEqual(entityCandidates('我去超市买东西').candidates,[]);
});
test('Claude explicitly identifies novel names without fixed JS regex examples',()=>{
  const r=classifyNames({sourceText:'请联系青岚确认退款',claudeEntities:[
    {source:'青岚',type:'proper_name',action:'keep',confidence:'medium'},
    {source:'根本不存在',type:'proper_name',action:'keep',confidence:'high'}]});
  assert.deepEqual(r.protectedNames,['青岚']);
});
test('Claude common-word classification can reject weak or heuristic guesses',()=>{
  const e=entityCandidates(original);
  const r=classifyNames({sourceText:original,...e,claudeEntities:[
    {source:'芳华',type:'common',action:'translate',confidence:'high'}]});
  assert.deepEqual(r.protectedNames,[]);
  const u=classifyNames({sourceText:original,candidates:['芳华'],
    claudeEntities:[{source:'芳华',type:'uncertain',action:'review',
      confidence:'medium'}]});
  assert.deepEqual(u.protectedNames,['芳华']);
});
test('Glossary overlap is checked at source offsets, not by includes',()=>{
  const source='芳华要联系芳华银行';
  const approved=[{source:'芳华银行',translation:'Ngân hàng FH'}];
  assert.equal(fullyCoveredByApproved(source,'芳华',approved),false);
  assert.deepEqual(classifyNames({sourceText:source,claudeNames:['芳华'],
    approvedTerms:approved}).protectedNames,['芳华']);
  assert.deepEqual(classifyNames({sourceText:'芳华银行已确认',
    claudeNames:['芳华'],approvedTerms:approved}).protectedNames,[]);
  assert.deepEqual(classifyNames({sourceText:'请找芳华',
    claudeNames:['芳华'],approvedTerms:[{source:'芳',translation:'P'}]}).protectedNames,['芳华']);
});
test('Repeated names need repeated preservation',()=>{
  assert.deepEqual(missingProtectedNameOccurrences('芳华帮芳华检查',
    'Nhờ 芳华 kiểm tra',['芳华']),['芳华']);
  assert.deepEqual(missingProtectedNameOccurrences('芳华帮芳华检查',
    'Nhờ 芳华 và 芳华 kiểm tra',['芳华']),[]);
});
test('GPT receives deduplicated facts, not study-only lexical guesses',()=>{
  const a=conciseTranslationAnalysis({intent:'Kiểm tra',tone:'normal',
    facts:['Đã xử lý',' Đã xử lý ','Chưa duyệt'],
    ambiguities:['Không rõ người','Không rõ người'],terms:[{source:'芳华'}],
    patterns:[{source:'如果'}]},'work',[],[]);
  assert.deepEqual(a.facts,['Đã xử lý','Chưa duyệt']);
  assert.deepEqual(a.ambiguities,['Không rõ người']);
  assert.equal(a.terms,undefined);
  assert.equal(a.patterns,undefined);
});
test('New entity output protects a novel proper name with no extra model call',async()=>{
  const calls=[];
  const providers={
    claude:async(system,user)=>{
      calls.push({stage:'claude',data:JSON.parse(user)});
      return {text:JSON.stringify({domain:'work',intent:'Nhờ kiểm tra',
        tone:'colleague',facts:['Kiểm tra tối'],terms:[],patterns:[],
        ambiguities:[],entities:[{source:'芳华',type:'proper_name',
          action:'keep',confidence:'high'}]}),usage:{input:150,output:90}};
    },
    openai:async(system,user)=>{
      calls.push({stage:'gpt',data:JSON.parse(user),system});
      return {text:JSON.stringify({translation:
        'TX17935632022942941041 70 X855YC15 X855: tối kiểm tra lại phần phát sinh của 芳华.',
        semanticReviewRequired:false,uncertainties:[]}),
        usage:{input:180,output:55}};
    }
  };
  const r=await deepTranslate({text:original,vocabulary:false,
    backTranslation:false,loadGlossary:async()=>[]},providers);
  assert.equal(r.status,'PASS');
  assert.deepEqual(calls.map(x=>x.stage),['claude','gpt']);
  assert.deepEqual(calls[1].data.protectedNames,['芳华']);
  assert.equal(calls[1].data.analysis.entities,undefined);
  assert.equal(calls[1].data.analysis.terms,undefined);
  assert.equal(ENGINE_VERSION,'v2.8.0');
});
