'use strict';
const {estimateUsage}=require('./accounting');
// Single source for per-request cost reporting and historical cache cost.
function summarizeV2Usage(usage,estimate=estimateUsage(usage)){
  const stages=(usage?.stages||[]).filter(x=>x.usage).map(x=>{
    const cost=estimateUsage({stages:[x]});
    return {role:x.role,provider:x.provider,model:x.model,
      inputTokens:Number(x.usage.input)||0,outputTokens:Number(x.usage.output)||0,
      estimatedKnownPaidUsd:cost.estimatedKnownPaidUsd,
      pricingIncomplete:cost.pricingIncomplete,
      ms:Number.isFinite(x.ms)&&x.ms>=0?x.ms:null};
  });
  const inputTokens=Number(usage?.totalInputTokens)||0;
  const outputTokens=Number(usage?.totalOutputTokens)||0;
  return {cached:false,inputTokens,outputTokens,totalTokens:inputTokens+outputTokens,
    estimatedCostUsd:estimate.estimatedKnownPaidUsd,
    pricingIncomplete:estimate.pricingIncomplete,
    stages};
}
function cachedV2Usage(originalUsage=null,elapsedMs=null){
  return {cached:true,inputTokens:0,outputTokens:0,totalTokens:0,
    elapsedMs,
    estimatedCostUsd:0,pricingIncomplete:false,stages:[],
    // Existing entries written before this feature have no historical costs.
    originalUsage:originalUsage&&typeof originalUsage==='object'?originalUsage:null};
}
module.exports={summarizeV2Usage,cachedV2Usage};
