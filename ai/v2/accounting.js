'use strict';

// Approximate known paid-model charges only. Other providers may be billed
// despite a "free" plan. Never present these estimates as exact invoices.
const PRICES = Object.freeze({
  // Same GPT-4o tariff as V1 PRO: 2.50 / 10 USD per million tokens.
  'gpt-4o':{input:2.5,output:10},
  'gpt-6.1-sol': {input:2,output:10},
  'gpt-6.1-terra':{input:1,output:5},
  'claude-sonnet-5-5':{input:2,output:10},
  // Haiku 5.5 standard text price for prompts <=100K tokens (V2 <=2K chars).
  // Excludes any future prompt-cache and volume discounts.
  'claude-haiku-5-5':{input:0.10,output:0.50}
});
function estimateUsage(usage) {
  let known=0, unknown=false;
  for(const stage of usage?.stages || []) {
    if(!stage.usage) continue;
    const model=Object.keys(PRICES).find(id=>String(stage.model||'').startsWith(id));
    if(model) {
      const rates=PRICES[model];
      known+=((stage.usage.input||0)*rates.input+(stage.usage.output||0)*rates.output)/1e6;
    } else if(stage.provider!=='deepl' && ((stage.usage.input||0)+(stage.usage.output||0))>0) {
      unknown=true;
    } else if(stage.provider==='deepl') {
      unknown=true; // Deepl may be priced by characters beyond a free allowance.
    }
  }
  return {estimatedKnownPaidUsd:Number(known.toFixed(7)),pricingIncomplete:unknown};
}
module.exports={estimateUsage};
