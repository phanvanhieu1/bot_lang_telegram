'use strict';

// Approximate known paid-model charges only. Other providers may be billed
// despite a "free" plan. Never present these estimates as exact invoices.
const PRICES = Object.freeze({
  'gpt-6.1-sol': {input:2,output:10},
  'claude-sonnet-5-5':{input:2,output:10}
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
