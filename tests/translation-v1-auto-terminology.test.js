'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {resolveTerms,lookupUserTerms,glossaryInstructions,
  validateAppliedTerms,termHighlights}=require('../ai/terminology/resolver');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const entry=(data={})=>({_id:'684000000000000000000001',source:'澎湃',
  translation:'PP',sourceLang:'zh',targetLang:'vi',
  domain:'work',status:'approved',priority:100,...data});
const opts={context:'auto',sourceLang:'zh',targetLang:'vi',
  v1AutoCandidates:true};

test('V1 AUTO supplies PP as context-dependent approved hint without Claude',async()=>{
  const Model={find(query){
    assert.equal(query.owner,'user-1');
    assert.equal(query.status,'approved');
    return {limit:()=>({lean:async()=>[entry()]})};
  }};
  for(const input of ['澎湃那边的订单有没有暂停','是不是澎湃的，教我一下']){
    const detected=await lookupUserTerms('user-1',input,opts,Model);
    assert.equal(detected.length,1);
    assert.equal(detected[0].source,'澎湃');
    assert.equal(detected[0].translation,'PP');
    assert.equal(detected[0].conditional,true);
    assert.equal(detected[0].domain,'work');
    const prompt=glossaryInstructions(detected);
    assert.match(prompt,/GỢI Ý NGHĨA CHUYÊN NGÀNH/);
    assert.match(prompt,/"source":"澎湃","translation":"PP","domain":"work"/);
    assert.match(prompt,/CHÍNH câu gốc/);
    assert.deepEqual(validateAppliedTerms('Đơn hàng bên Pengpai có tạm dừng không?',detected),[]);
    assert.equal(termHighlights('Đơn hàng bên PP có tạm dừng không?',detected).length,1);
  }
});

test('V1 keeps manual context authoritative; V2 retains strict Claude-based filtering',()=>{
  const glossary=[entry()];
  assert.deepEqual(resolveTerms('澎湃那边的订单有没有暂停',glossary,
    {context:'auto',sourceLang:'zh',targetLang:'vi'}),[],
    'V2 without Claude conclusion cannot force domain-specific terminology');
  assert.equal(resolveTerms('澎湃那边的订单有没有暂停',glossary,
    {context:'auto',analyzedDomain:'work',sourceLang:'zh',targetLang:'vi'}).length,1);
  const manual=resolveTerms('是不是澎湃的，教我一下',glossary,
    {context:'colleague',sourceLang:'zh',targetLang:'vi',v1AutoCandidates:true});
  assert.equal(manual[0].conditional,false);
  assert.match(glossaryInstructions(manual),/THUẬT NGỮ ĐÃ ĐƯỢC NGƯỜI DÙNG XÁC NHẬN/);
  assert.doesNotMatch(glossaryInstructions(manual),/GỢI Ý NGHĨA CHUYÊN NGÀNH/);
  assert.deepEqual(validateAppliedTerms('Có phải Pengpai không?',manual),['澎湃']);
  assert.deepEqual(resolveTerms('是不是澎湃的',glossary,{
    context:'friend',sourceLang:'zh',targetLang:'vi',v1AutoCandidates:true}),[]);
});

test('V1 AUTO does not force business meaning in literal use and handles alternative domains',()=>{
  const source='情绪澎湃';
  const glossary=[entry(),entry({_id:'684000000000000000000002',
    domain:'daily',translation:'dâng trào'})];
  const matches=resolveTerms(source,glossary,opts);
  assert.equal(matches.length,2);
  assert.deepEqual(new Set(matches.map(x=>x.translation)),new Set(['PP','dâng trào']));
  assert.ok(matches.every(x=>x.conditional===true));
  const prompt=glossaryInstructions(matches);
  assert.match(prompt,/nghĩa từ điển thông thường/);
  assert.match(prompt,/đừng gộp các nghĩa/);
  assert.deepEqual(validateAppliedTerms('Cảm xúc dâng trào',matches),[]);
  // An all-domain approval wins over conflicting domain-only hints.
  const universal=[entry({domain:'any',translation:'PP'}),entry({domain:'daily',
    translation:'mãnh liệt',_id:'684000000000000000000003'})];
  const chosen=resolveTerms('澎湃',universal,opts);
  assert.equal(chosen.length,1);
  assert.equal(chosen[0].conditional,false);
  assert.equal(chosen[0].translation,'PP');
});

test('V1 scans full original text, direction and Latin boundaries exactly',()=>{
  const glossary=[entry({source:'API',translation:'giao diện lập trình',
    domain:'it',_id:'684000000000000000000004'})];
  assert.equal(resolveTerms('API返回 403',glossary,opts).length,1);
  assert.deepEqual(resolveTerms('RapidAPI返回 403',glossary,opts),[]);
  const reverseOnly=entry({source:'chi trả',translation:'出款',
    sourceLang:'vi',targetLang:'zh',domain:'work'});
  assert.equal(resolveTerms('Cần chi trả thủ công',[reverseOnly],{
    ...opts,sourceLang:'vi',targetLang:'zh'}).length,1);
  assert.deepEqual(resolveTerms('chi trả',[reverseOnly],opts),[],
    'No unapproved reverse glossary for existing one-way entry');
});

test('V1 FREE and PRO both call shared glossary scanner and include exact prompt hints',async()=>{
  const server=read('server.js'),pro=read('ai/services/pro.service.js');
  const free=read('ai/services/free.service.js');
  assert.match(server,/const freeTerms=await lookupUserTerms[\s\S]{0,250}v1AutoCandidates:true/);
  assert.match(server,/const appliedTerms=await lookupUserTerms[\s\S]{0,200}v1AutoCandidates:true/);
  assert.match(pro,/glossaryInstructions\(options\.terms\|\|\[\]\)/);
  assert.match(free,/buildFreePrompt\(text,context\)\+glossaryInstructions\(terms\)/);
  const provider=require('../ai/providers/openai.provider');
  const modulePath=require.resolve('../ai/services/pro.service');
  const old=provider.getShuffledOpenAIClients;
  let count=0,stage;
  provider.getShuffledOpenAIClients=()=>[{
    chat:{completions:{create:async({messages})=>{
      count++;
      assert.match(messages[0].content,/GỢI Ý NGHĨA CHUYÊN NGÀNH/);
      assert.match(messages[0].content,/"translation":"PP"/);
      assert.equal(messages[1].content[0].text,'澎湃那边的订单有没有暂停');
      return {model:'gpt-4o',choices:[{message:{content:'TRANSLATION: Đơn hàng bên PP có bị tạm dừng không?'}}],
        usage:{prompt_tokens:350,completion_tokens:34,total_tokens:384}};
    }}}
  }];
  delete require.cache[modulePath];
  try{
    const {translateFull}=require(modulePath);
    const output=await translateFull('澎湃那边的订单有没有暂停','zh',false,
      null,[],true,{context:'auto',vocabulary:false,backTranslation:false,
        terms:resolveTerms('澎湃那边的订单有没有暂停',[entry()],opts),
        inspectStage:x=>stage=x});
    assert.equal(count,1);
    assert.match(output.content,/PP/);
    assert.match(stage.system,/GỢI Ý NGHĨA CHUYÊN NGÀNH/);
  }finally{
    provider.getShuffledOpenAIClients=old;
    delete require.cache[modulePath];
  }
});
