'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildClaudeBody,claudeUsage,getV2ModelSettings}=require('../ai/v2/providers');
const {estimateUsage}=require('../ai/v2/accounting');
const {summarizeV2Usage}=require('../ai/v2/request-usage');
const {ANALYZER_SYSTEM,ANALYZER_JSON_SCHEMA,TRANSLATOR_SYSTEM}=require('../ai/v2/prompts-en');
const {chooseTranslatorTier}=require('../ai/v2/model-router');
const {deepTranslate,ENGINE_VERSION}=require('../ai/v2/engine');
test('Claude system stays separate from user data with cache and strict JSON',()=>{
  const body=buildClaudeBody({model:'claude-haiku-5-5',
    system:ANALYZER_SYSTEM,user:'{"original":"你好"}',effort:'low',
    thinking:'disabled',jsonSchema:ANALYZER_JSON_SCHEMA});
  assert.deepEqual(body.system,[{type:'text',text:ANALYZER_SYSTEM,
    cache_control:{type:'ephemeral'}}]);
  assert.equal(body.messages[0].content,'{"original":"你好"}');
  assert.equal(body.output_config.format.type,'json_schema');
  assert.equal(body.output_config.effort,'low');
  assert.equal(ANALYZER_JSON_SCHEMA.additionalProperties,false);
  assert.ok(ANALYZER_JSON_SCHEMA.required.includes('entities'));
  assert.match(ANALYZER_SYSTEM,/Role:/);
  assert.match(TRANSLATOR_SYSTEM,/Role:/);
  assert.equal(buildClaudeBody({model:'claude-haiku-5-5',system:'test',
    user:'hi',cacheSystem:false}).system,'test');
});
test('Cached Claude usage includes read and write tokens without double counting',()=>{
  const stages=usage=>[{role:'analyzer',provider:'claude',
    model:'claude-haiku-5-5',usage}];
  const written=claudeUsage({input_tokens:20,cache_creation_input_tokens:800,
    output_tokens:80});
  const read=claudeUsage({input_tokens:20,cache_read_input_tokens:800,
    output_tokens:80});
  assert.equal(written.input,820);
  assert.equal(read.input,820);
  assert.equal(estimateUsage({stages:stages(written)}).estimatedKnownPaidUsd,0.000142);
  assert.equal(estimateUsage({stages:stages(read)}).estimatedKnownPaidUsd,0.00005);
  const shown=summarizeV2Usage({stages:stages(read),totalInputTokens:820,
    totalOutputTokens:80});
  assert.equal(shown.stages[0].cacheReadTokens,800);
  assert.equal(shown.stages[0].uncachedInputTokens,20);
  assert.equal(shown.totalTokens,900);
});
test('Tier routing is opt-in and never downgrades names, work or confirmed terms',()=>{
  const base={sourceText:'你好',context:'friend',
    frame:{domain:'daily',intent:'greeting',facts:[],ambiguities:[],entities:[]},
    glossary:[],protectedNames:[],direction:{source:'zh',target:'vi'},
    backTranslation:false,learningVocabulary:false};
  const on={tieredRouting:true,simpleOpenaiModel:'gpt-4o-mini'};
  assert.equal(getV2ModelSettings({}).tieredRouting,false);
  assert.equal(chooseTranslatorTier(base,on).modelOverride,'gpt-4o-mini');
  assert.equal(chooseTranslatorTier({...base,sourceText:'X855多出的芳华'},on).modelOverride,null);
  assert.equal(chooseTranslatorTier({...base,glossary:[{source:'好'}]},on).modelOverride,null);
  assert.equal(chooseTranslatorTier({...base,frame:{...base.frame,domain:'work'}},on).modelOverride,null);
});
test('English prompt remains identical across manual contexts and model changes only on safe tier',async()=>{
  const calls=[];
  const providers={
    claude:async(system,user,meta)=>{
      calls.push({role:'claude',system,user:JSON.parse(user),meta});
      return {text:JSON.stringify({domain:'daily',intent:'hello',tone:'neutral',
        facts:[],terms:[],patterns:[],ambiguities:[],entities:[]}),
        model:'mock-claude',usage:{input:100,output:20}};
    },
    openai:async(system,user,meta)=>{
      calls.push({role:'openai',system,meta});
      return {text:JSON.stringify({translation:'Xin chào.',
        semanticReviewRequired:false,uncertainties:[]}),
        model:'mock-gpt',usage:{input:100,output:15}};
    }
  };
  for(const context of ['friend','superior']){
    const result=await deepTranslate({text:'你好',context,vocabulary:false,
      backTranslation:false,loadGlossary:async()=>[],
      env:{V2_TIERED_ROUTING:'true'}},providers);
    assert.equal(result.status,'PASS');
  }
  assert.equal(calls.length,4);
  assert.equal(calls[0].system,calls[2].system);
  assert.equal(calls[1].system,calls[3].system);
  assert.notEqual(calls[0].user.context,calls[2].user.context);
  assert.deepEqual(calls[0].meta.jsonSchema,ANALYZER_JSON_SCHEMA);
  assert.equal(calls[1].meta.modelOverride,'gpt-4o-mini');
  assert.equal(calls[3].meta.modelOverride,undefined);
  assert.equal(ENGINE_VERSION,'v2.9.0');
});

test('Provider sends Anthropic system cache + structured output and retains real usage',async()=>{
  const previous=global.fetch,seen=[];
  global.fetch=async(url,options)=>{
    const body=JSON.parse(options.body);seen.push({url,body});
    if(url.includes('anthropic'))return {ok:true,json:async()=>({
      model:'claude-haiku-5-5',stop_reason:'end_turn',
      content:[{type:'text',text:'{"domain":"daily"}'}],
      usage:{input_tokens:20,cache_creation_input_tokens:600,
        cache_read_input_tokens:0,output_tokens:40}})};
    return {ok:true,json:async()=>({model:'gpt-4o-mini',
      output_text:'{"translation":"Xin chào"}',status:'completed',
      usage:{input_tokens:120,output_tokens:25}})};
  };
  try{
    const providers=require('../ai/v2/providers').createProviders({
      OPENAI_API_KEY:'test',CLAUDE_API_KEY:'test',
      V2_TIERED_ROUTING:'true'});
    const result=await providers.claude(ANALYZER_SYSTEM,
      '{"original":"你好"}',{maxOutputTokens:900,jsonSchema:ANALYZER_JSON_SCHEMA});
    assert.equal(result.usage.input,620);
    assert.equal(result.usage.cacheWrite,600);
    await providers.openai(TRANSLATOR_SYSTEM,'{"original":"你好"}',
      {modelOverride:'gpt-4o-mini'});
    assert.equal(seen[0].body.system[0].cache_control.type,'ephemeral');
    assert.equal(seen[0].body.output_config.format.type,'json_schema');
    assert.equal(seen[0].body.messages[0].content,'{"original":"你好"}');
    assert.equal(seen[1].body.model,'gpt-4o-mini');
    assert.equal(seen[1].body.instructions,TRANSLATOR_SYSTEM);
    assert.equal(seen[1].body.reasoning,undefined);
  }finally{global.fetch=previous;}
});
