'use strict';

// Approximate known paid-model charges only. Other providers may be billed
// despite a "free" plan. Never present these estimates as exact invoices.
const PRICES = Object.freeze({
  // Same GPT-4o tariff as V1 PRO: 2.50 / 10 USD per million tokens.
  'gpt-4o-mini':{input:0.15,cachedInput:0.075,output:0.6},
  'gpt-4o':{input:2.5,cachedInput:1.25,output:10},
  'gpt-6.1-sol': {input:2,cachedInput:0.1,output:10},
  'gpt-6.1-terra':{input:1,cachedInput:0.05,output:5},
  'claude-sonnet-5-5':{input:2,output:10},
  // Anthropic ephemeral cache reads cost 10% of standard input, and
  // 5-minute writes cost 125% of standard input.
  'claude-haiku-5-5':{input:0.10,output:0.50}
});
function estimateUsage(usage) {
  let known=0, unknown=false;
  for(const stage of usage?.stages || []) {
    if(!stage.usage) continue;
    const model=Object.keys(PRICES).find(id=>String(stage.model||'').startsWith(id));
    if(model) {
      const rates=PRICES[model];
      const totalInput=Math.max(0,Number(stage.usage.input)||0);
      const cacheRead=Math.max(0,Number(stage.usage.cacheRead)||0);
      const cacheWrite=Math.max(0,Number(stage.usage.cacheWrite)||0);
      const uncached=Number.isFinite(stage.usage.inputUncached)
        ?Math.max(0,Number(stage.usage.inputUncached))
        :Math.max(0,totalInput-cacheRead-cacheWrite);
      const isClaude=String(stage.provider||'')==='claude'||model.startsWith('claude-');
      // Haiku 5.5 cache reads are 0.1x; Sonnet 5.5 is 0.05x.
      const readRate=isClaude
        ?rates.input*(model==='claude-sonnet-5-5'?0.05:0.1)
        :(rates.cachedInput??rates.input);
      const writeRate=isClaude?rates.input*1.25:rates.input;
      known+=(uncached*rates.input+cacheRead*readRate+
        cacheWrite*writeRate+(stage.usage.output||0)*rates.output)/1e6;
    } else if(stage.provider!=='deepl' && ((stage.usage.input||0)+(stage.usage.output||0))>0) {
      unknown=true;
    } else if(stage.provider==='deepl') {
      unknown=true; // Deepl may be priced by characters beyond a free allowance.
    }
  }
  return {estimatedKnownPaidUsd:Number(known.toFixed(7)),pricingIncomplete:unknown};
}
module.exports={estimateUsage,PRICES};
