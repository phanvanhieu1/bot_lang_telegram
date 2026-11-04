'use strict';
// Normalized per-click billing summary for the web UI.
// Unknown provider charges must never be displayed as $0.
const {PRICES}=require('./ai/v2/accounting');
const GPT4O_RATES={input:2.5,output:10}; // legacy fallback USD per 1M tokens
function paidStageCost(model,input,output,cacheRead=0){
  const name=Object.keys(PRICES).find(key=>String(model||'').startsWith(key));
  if(!name)return null;
  const rate=PRICES[name],read=Math.min(input,Math.max(0,cacheRead));
  return Number((((input-read)*rate.input+
    read*(rate.cachedInput??rate.input)+output*rate.output)/1e6).toFixed(8));
}

function token(value){
  return typeof value==='number' && Number.isFinite(value) && value>=0
    ? value:null;
}
function hit(){
  return {cached:true,inputTokens:0,outputTokens:0,totalTokens:0,
    estimatedCostUsd:0,pricingIncomplete:false,stages:[]};
}
function proRequestUsage(usage,cached=false,trace=[]){
  if(cached)return hit();
  const input=token(usage?.prompt_tokens??usage?.promptTokens);
  const output=token(usage?.completion_tokens??usage?.completionTokens);
  const known=input!==null&&output!==null;
  const total=known?input+output:null;
  const actualModel=usage?.model||'gpt-4o';
  const cachedInput=token(usage?.prompt_tokens_details?.cached_tokens)??0;
  const cost=known?paidStageCost(actualModel,input,output,cachedInput):null;
  const knownStages=Array.isArray(trace)?trace.filter(x=>x&&x.usage):[];
  const stages=knownStages.length?knownStages.map(stage=>{
    const i=token(stage.usage.input),o=token(stage.usage.output);
    const ready=i!==null&&o!==null;
    const cached=token(stage.usage.cacheRead)??0;
    const stageCost=ready?paidStageCost(stage.model||'gpt-4o',i,o,cached):null;
    return {provider:'openai',model:stage.model||'gpt-4o',
      role:stage.role||'translator',inputTokens:i,outputTokens:o,
      cacheReadTokens:cached,
      ms:Number.isFinite(stage.ms)?stage.ms:null,
      estimatedKnownPaidUsd:stageCost,
      pricingIncomplete:stageCost===null};
  }):[{provider:'openai',model:actualModel,role:'translation / verification',
    inputTokens:input,outputTokens:output,cacheReadTokens:cachedInput,
    estimatedKnownPaidUsd:cost,pricingIncomplete:cost===null}];
  const summedStageCost=stages.every(s=>s.estimatedKnownPaidUsd!==null)
    ?Number(stages.reduce((n,s)=>n+s.estimatedKnownPaidUsd,0).toFixed(8)):null;
  return {cached:false,inputTokens:input,outputTokens:output,
    totalTokens:total,
    estimatedCostUsd:knownStages.length?summedStageCost:cost,
    pricingIncomplete:knownStages.length?summedStageCost===null:cost===null,stages};
}
function freeRequestUsage({usage,provider,cached}={}){
  if(cached)return hit();
  const input=token(usage?.input),output=token(usage?.output);
  const available=input!==null&&output!==null;
  return {cached:false,inputTokens:input,outputTokens:output,
    totalTokens:available?input+output:null,
    // FREE endpoints may have quota or hidden costs; never invent a tariff.
    estimatedCostUsd:null,pricingIncomplete:true,
    stages:[{provider:provider||'unknown',model:provider||'FREE',
      role:'translation',inputTokens:input,outputTokens:output,
      estimatedKnownPaidUsd:null,pricingIncomplete:true}]};
}
module.exports={proRequestUsage,freeRequestUsage,hit};
