'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {proKey}=require('../web-cache');
const {keyForRequest}=require('../ai/v2/cache');
const {proRequestUsage}=require('../translation-request-usage');
const {deepTranslate}=require('../ai/v2/engine');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('web PRO shows the GPT model picker and sends it in both translation modes',()=>{
  const html=read('public/index.html'),ui=read('public/app.js');
  assert.match(html,/id="translationModelSelect"/);
  assert.match(html,/<option value="gpt-4o">/);
  assert.match(html,/<option value="gpt-4o-mini" selected>/);
  assert.match(ui,/translationModel:translationModelSelect\?\.value\|\|'gpt-4o-mini'/);
  assert.match(ui,/translationModelPicker\.hidden=/);
  assert.match(ui,/localStorage\.setItem\('translationModel'/);
});

test('manually selected V1/V2 models never share translation-result cache',()=>{
  const args=['你好','zh',false,'colleague'];
  assert.notEqual(proKey(...args,'gpt-4o'),proKey(...args,'gpt-4o-mini'));
  assert.notEqual(proKey(...args),proKey(...args,'gpt-4o'));
  assert.equal(proKey(...args),proKey(...args,null));
  const base={owner:'684000000000000000000001',text:'你好',
    context:'colleague',signature:'glossary-v1',env:{}};
  assert.notEqual(keyForRequest({...base,translationModel:'gpt-4o'}),
    keyForRequest({...base,translationModel:'gpt-4o-mini'}));
  assert.notEqual(keyForRequest({...base,translationModel:'gpt-4o'}),
    keyForRequest(base));
  assert.match(read('ai/v2/cache.js'),/repair-model-gpt-4o-mini-v1/);
});

test('V1 passes user-selected GPT model into the primary provider without modifying prompt',async()=>{
  const provider=require('../ai/providers/openai.provider');
  const old=provider.getShuffledOpenAIClients;
  const modulePath=require.resolve('../ai/services/pro.service');
  const previous=process.env.V1_OPTIMIZED_PROMPTS;
  process.env.V1_OPTIMIZED_PROMPTS='false';
  const requests=[];
  provider.getShuffledOpenAIClients=()=>[{
    chat:{completions:{create:async body=>{
      requests.push(body);
      return {model:body.model,choices:[{message:{content:'TRANSLATION: Xin chào'}}],
        usage:{prompt_tokens:150,completion_tokens:20,total_tokens:170}};
    }}}
  }];
  delete require.cache[modulePath];
  try{
    const {translateFull}=require(modulePath);
    for(const name of ['gpt-4o-mini','gpt-4o']){
      const result=await translateFull('你好','zh',false,null,[],true,{
        context:'colleague',backTranslation:false,vocabulary:false,
        translationModel:name});
      assert.equal(result.usage.model,name);
      assert.match(result.content,/TRANSLATION: Xin chào/);
    }
    assert.deepEqual(requests.map(x=>x.model),['gpt-4o-mini','gpt-4o']);
    assert.equal(requests[0].messages[0].content,requests[1].messages[0].content);
    await translateFull('你好','zh',false,null,[],true,{
      translationModel:'gpt-4o-mini',existingTranslation:'Xin chào',
      backTranslation:false,vocabulary:true});
    assert.equal(requests[2].model,'gpt-4o',
      'supplemental AI should retain its previous model');
    await assert.rejects(translateFull('你好','zh',false,null,[],true,{
      translationModel:'not-allowed'}),/V1_INVALID_TRANSLATION_MODEL/);
    assert.equal(requests.length,3);
  }finally{
    provider.getShuffledOpenAIClients=old;
    if(previous===undefined)delete process.env.V1_OPTIMIZED_PROMPTS;
    else process.env.V1_OPTIMIZED_PROMPTS=previous;
    delete require.cache[modulePath];
  }
});

test('V2 selection affects translator and forces mini only for GPT Repair',async()=>{
  const seen=[];
  const providers={
    claude:async(system,input,meta)=>{
      seen.push({stage:'claude',meta});
      return {text:JSON.stringify({domain:'it',intent:'API error',
        tone:'colleague',facts:[],terms:[],patterns:[],ambiguities:[],entities:[]}),
        model:'mock-claude',usage:{input:25,output:10}};
    },
    openai:async(system,input,meta)=>{
      const n=seen.filter(x=>x.stage==='openai').length;
      seen.push({stage:'openai',meta});
      return {text:JSON.stringify({translation:n===0?'API báo lỗi':'API trả về mã 500',
        backTranslation:'',vocabulary:'',semanticReviewRequired:false,uncertainties:[]}),
        model:meta.translationModel||'gpt-4o',usage:{input:40,output:20}};
    }
  };
  const result=await deepTranslate({text:'API 返回 500',context:'colleague',
    backTranslation:false,vocabulary:false,translationModel:'gpt-4o-mini',
    loadGlossary:async()=>[]},providers);
  assert.equal(result.status,'PASS');
  assert.deepEqual(seen.map(x=>x.stage),['claude','openai','openai']);
  assert.equal(seen[0].meta.translationModel,undefined);
  assert.equal(seen[1].meta.translationModel,'gpt-4o-mini');
  assert.equal(seen[2].meta.translationModel,'gpt-4o-mini');
  assert.deepEqual(result.usage.stages.filter(x=>x.role==='repair').map(x=>x.model),
    ['gpt-4o-mini']);
  const fullModelStages=[];
  const fullProviders={
    ...providers,
    openai:async(_system,_user,meta)=>{
      const initial=fullModelStages.length===0;
      fullModelStages.push(meta.translationModel);
      return {text:JSON.stringify({
        translation:initial?'API báo lỗi':'API trả về mã 500',
        backTranslation:'',vocabulary:'',semanticReviewRequired:false,uncertainties:[]
      }),model:meta.translationModel,usage:{input:40,output:20}};
    }
  };
  const fullResult=await deepTranslate({text:'API 返回 500',context:'colleague',
    backTranslation:false,vocabulary:false,translationModel:'gpt-4o',
    loadGlossary:async()=>[]},fullProviders);
  assert.equal(fullResult.status,'PASS');
  assert.deepEqual(fullModelStages,['gpt-4o','gpt-4o-mini']);
  await assert.rejects(deepTranslate({text:'你好',translationModel:'not-allowed'},providers),
    {code:'V2_INVALID_TRANSLATION_MODEL'});
});

test('V1 mini usage is priced at its own tariff, not GPT-4o tariff',()=>{
  const usage={prompt_tokens:1000,completion_tokens:100};
  const mini=proRequestUsage({...usage,model:'gpt-4o-mini'});
  const full=proRequestUsage({...usage,model:'gpt-4o'});
  assert.equal(mini.estimatedCostUsd,0.00021);
  assert.equal(full.estimatedCostUsd,0.0035);
});

test('V2 provider sends selected model to Responses API, without tier routing or prompt changes',async()=>{
  const {createProviders}=require('../ai/v2/providers');
  const priorFetch=global.fetch;
  const requests=[];
  global.fetch=async(_url,options)=>{
    const body=JSON.parse(options.body);
    requests.push(body);
    return {ok:true,json:async()=>({model:body.model,status:'completed',
      output_text:'{"translation":"Xin chào"}',
      usage:{input_tokens:300,output_tokens:30}})};
  };
  try{
    const provider=createProviders({OPENAI_API_KEY:'test',
      V2_OPENAI_MODEL:'gpt-4o',V2_TIERED_ROUTING:'false'});
    const first=await provider.openai('stable instructions','{}',{
      translationModel:'gpt-4o-mini'});
    const second=await provider.openai('stable instructions','{}',{});
    assert.equal(first.model,'gpt-4o-mini');
    assert.equal(second.model,'gpt-4o');
    assert.deepEqual(requests.map(x=>x.model),['gpt-4o-mini','gpt-4o']);
    assert.equal(requests[0].instructions,requests[1].instructions);
    await assert.rejects(provider.openai('stable instructions','{}',{
      translationModel:'unapproved-model'}),{code:'V2_INVALID_TRANSLATION_MODEL'});
    assert.equal(requests.length,2);
  }finally{global.fetch=priorFetch;}
});

test('model API input is allowlisted and kept separate from FREE and English flows',()=>{
  const server=read('server.js'),v2Route=read('ai/v2/routes.js');
  assert.match(server,/!\['gpt-4o','gpt-4o-mini'\]\.includes\(translationModel\)/);
  assert.match(v2Route,/!\['gpt-4o','gpt-4o-mini'\]\.includes\(translationModel\)/);
  assert.match(server,/text\.trim\(\),targetLang,fastMode,context,translationModel/);
  assert.match(v2Route,/backTranslation,vocabulary,translationModel/);
});
