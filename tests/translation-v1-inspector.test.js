'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {proRequestUsage}=require('../translation-request-usage');
const repo=path.join(__dirname,'..');
const file=relative=>fs.readFileSync(path.join(repo,relative),'utf8');

test('V1 GPT-4o translation exposes exact system, user messages, raw response, model and usage without a second call',async()=>{
  const modulePath=require.resolve('../ai/services/pro.service');
  const provider=require('../ai/providers/openai.provider');
  const original=provider.getShuffledOpenAIClients;
  let requests=0;
  const samples=[];
  provider.getShuffledOpenAIClients=()=>[{
    chat:{completions:{create:async body=>{
      requests++;
      assert.equal(body.model,'gpt-4o');
      assert.equal(body.temperature,0.3);
      assert.match(body.messages[0].content,/PP/);
      assert.equal(body.messages.at(-1).content[0].text,'是不是澎湃的，教我一下');
      return {model:'gpt-4o',choices:[{message:{
        content:'TRANSLATION: Cái này có phải bên PP không? Chỉ giúp tôi nhé.'
      }}],usage:{prompt_tokens:440,completion_tokens:51,total_tokens:491}};
    }}}
  }];
  delete require.cache[modulePath];
  try{
    const {translateFull}=require(modulePath);
    const args=['是不是澎湃的，教我一下','zh',false,null,[],true];
    const options={context:'colleague',backTranslation:false,vocabulary:false,
      terms:[{source:'澎湃',translation:'PP',domain:'work'}],
      inspectStage:stage=>samples.push(stage)};
    const result=await translateFull(...args,options);
    assert.match(result.content,/PP/);
    assert.equal(result.usage.total_tokens,491);
    assert.equal(requests,1);
    assert.equal(samples.length,1);
    assert.equal(samples[0].role,'translator');
    assert.equal(samples[0].model,'gpt-4o');
    assert.equal(samples[0].provider,'openai');
    assert.match(samples[0].system,/NGƯỜI NGHE: ĐỒNG NGHIỆP/);
    assert.match(samples[0].system,/THUẬT NGỮ ĐÃ ĐƯỢC NGƯỜI DÙNG XÁC NHẬN/);
    assert.equal(JSON.parse(samples[0].input)[0].role,'user');
    assert.match(samples[0].rawOutput,/TRANSLATION:/);
    assert.deepEqual(samples[0].usage,{input:440,output:51});
    assert.ok(Number.isInteger(samples[0].ms));
    await translateFull(...args,{...options,inspectStage:null});
    assert.equal(samples.length,1,'disabled inspector must not collect anything');
    assert.equal(requests,2,'enabling inspector must not add API calls');
  }finally{
    provider.getShuffledOpenAIClients=original;
    delete require.cache[modulePath];
  }
});

test('V1 GPT supplement is clearly labeled instead of claiming a new translation',async()=>{
  const modulePath=require.resolve('../ai/services/pro.service');
  const provider=require('../ai/providers/openai.provider');
  const original=provider.getShuffledOpenAIClients;
  provider.getShuffledOpenAIClients=()=>[{
    chat:{completions:{create:async()=>({
      model:'gpt-4o',
      choices:[{message:{content:'VOCABULARY:\n[WORD] 超市 : siêu thị'}}],
      usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}
    })}}
  }];
  delete require.cache[modulePath];
  const trace=[];
  try{
    const {translateFull}=require(modulePath);
    await translateFull('我去超市','zh',false,null,[],true,{
      existingTranslation:'Tôi đi siêu thị.',backTranslation:false,vocabulary:true,
      inspectStage:x=>trace.push(x)});
    assert.equal(trace.length,1);
    assert.equal(trace[0].role,'supplement');
    assert.match(trace[0].system,/BẢN DỊCH ĐÃ CÓ/);
    assert.match(trace[0].rawOutput,/VOCABULARY/);
  }finally{
    provider.getShuffledOpenAIClients=original;
    delete require.cache[modulePath];
  }
});

test('V1 per-stage usage reflects actual billable GPT stages and fallback aggregate',()=>{
  const trace=[
    {provider:'openai',model:'gpt-4o',role:'translator',
      ms:250,usage:{input:300,output:100}},
    {provider:'openai',model:'gpt-4o',role:'verification',
      ms:150,usage:{input:200,output:50}}
  ];
  const result=proRequestUsage({prompt_tokens:500,completion_tokens:150},false,trace);
  assert.equal(result.cached,false);
  assert.equal(result.stages.length,2);
  assert.equal(result.stages[0].ms,250);
  assert.equal(result.stages[0].estimatedKnownPaidUsd,0.00175);
  assert.equal(result.stages[1].estimatedKnownPaidUsd,0.001);
  assert.equal(result.estimatedCostUsd,0.00275);
  assert.equal(proRequestUsage({prompt_tokens:0,completion_tokens:0},true,trace).stages.length,0);
  const fallback=proRequestUsage({prompt_tokens:500,completion_tokens:150});
  assert.equal(fallback.stages.length,1);
});

test('V1 PRO route returns trace only on opt-in and forbids forcing refresh without opt-in',()=>{
  const server=file('server.js');
  assert.match(server,/inspectAI = false/);
  assert.match(server,/forceRefresh = false/);
  assert.match(server,/forceRefresh&&!inspectAI/);
  assert.match(server,/const trace=\[\]/);
  assert.match(server,/inspectStage:onInspect/);
  assert.match(server,/const cachedData = appliedTerms\.length\|\|forceRefresh \? null/);
  assert.match(server,/onInspect\?\{onInspect\}:null/);
  assert.match(server,/\.\.\.inspectionFor\(!result\)/);
  assert.match(server,/requestUsage:\{\.\.\.proRequestUsage\(usage,!result && !verificationUsage,trace\)/);
  assert.match(file('web-english.js'),/options\.forceRefresh\?null:await getWebCachedText/);
  assert.match(file('web-english.js'),/options\.inspectStage/);
  assert.match(file('public/index.html'),/id="v1InspectToggle"/);
  assert.match(file('public/app.js'),/window\.requestV1LiveTrace/);
  assert.match(file('public/app.js'),/inspectAI:v1InspectToggle\?\.checked===true/);
  assert.match(file('public/app.js'),/forceRefresh:forceRefresh===true/);
});

test('V1/V2 share one safe inspector renderer and rerun only after explicit click',async()=>{
  class Node{
    constructor(){this.hidden=false;this.children=[];this.listeners={};
      this.textContent='';this.className='';this.checked=false;}
    appendChild(n){this.children.push(n);return n;}
    replaceChildren(...n){this.children=n;}
    addEventListener(name,callback){this.listeners[name]=callback;}
    setAttribute(){}
    click(){this.listeners.click?.();}
  }
  const keys=['v2InspectPanel','v2InspectNotice','v2InspectStages','v2InspectRerun',
    'v1InspectToggle','v2InspectToggle','aiInspectTitle'];
  const refs=Object.fromEntries(keys.map(k=>[k,new Node()]));
  const win={};let reruns=0;
  const context={
    document:{getElementById:id=>refs[id]||null,createElement:()=>new Node()},
    navigator:{clipboard:{writeText:async()=>{}}},
    window:win,Number,JSON
  };
  const vm=require('node:vm');
  vm.runInNewContext(file('public/v2-inspector.js'),context);
  win.requestV1LiveTrace=()=>{reruns++};
  win.renderV2Inspection({cacheHit:true,notice:'Cache hit',stages:[]},'v1');
  assert.equal(refs.aiInspectTitle.textContent,'Luồng xử lý AI · V1');
  assert.equal(refs.v2InspectPanel.hidden,false);
  assert.equal(refs.v2InspectRerun.hidden,false);
  assert.equal(reruns,0);
  refs.v2InspectRerun.click();
  assert.equal(reruns,1);
  win.renderV2Inspection({cacheHit:false,stages:[{
    role:'supplement',model:'gpt-4o',provider:'openai',
    usage:{input:100,output:20},ms:100,
    system:'SYSTEM',input:'[{"role":"user","content":"test"}]',
    rawOutput:'VOCABULARY:\n[WORD] 超市 : siêu thị'
  }]},'v1');
  assert.match(refs.v2InspectStages.children[0].children[0].textContent,
    /GPT · Bổ sung từ vựng\/dịch ngược/);
  refs.v1InspectToggle.listeners.change({target:{checked:false}});
  assert.equal(refs.v2InspectPanel.hidden,true);
  assert.equal(refs.v2InspectStages.children.length,0);
});
