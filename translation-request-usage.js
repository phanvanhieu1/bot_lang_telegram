'use strict';
// Normalized per-click billing summary for the web UI.
// Unknown provider charges must never be displayed as $0.
const GPT4O_RATES={input:2.5,output:10}; // USD per 1M tokens

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
  const cost=known?Number(((input*GPT4O_RATES.input+
    output*GPT4O_RATES.output)/1e6).toFixed(8)):null;
  const knownStages=Array.isArray(trace)?trace.filter(x=>x&&x.usage):[];
  const stages=knownStages.length?knownStages.map(stage=>{
    const i=token(stage.usage.input),o=token(stage.usage.output);
    const ready=i!==null&&o!==null;
    return {provider:'openai',model:stage.model||'gpt-4o',
      role:stage.role||'translator',inputTokens:i,outputTokens:o,
      ms:Number.isFinite(stage.ms)?stage.ms:null,
      estimatedKnownPaidUsd:ready?Number(((i*2.5+o*10)/1e6).toFixed(8)):null,
      pricingIncomplete:!ready};
  }):[{provider:'openai',model:'gpt-4o',role:'translation / verification',
    inputTokens:input,outputTokens:output,
    estimatedKnownPaidUsd:cost,pricingIncomplete:!known}];
  return {cached:false,inputTokens:input,outputTokens:output,
    totalTokens:total,estimatedCostUsd:cost,
    pricingIncomplete:!known,stages};
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
