'use strict';
// V2 produces exactly the same labeled result blocks consumed by V1 UI.
// Never parse literal labels from untrusted translated text on the client:
// format with JSON-safe independently generated backend fields instead.
const {generatePinyin}=require('../utils/pinyin');

function pronounceChinese(original, translated, requested=true){
  if(!requested)return '';
  const source=/[\u3400-\u9fff]/u.test(original)?original:translated;
  return /[\u3400-\u9fff]/u.test(source||'')?generatePinyin(source):'';
}
function formatV1Details({translation,backTranslation='',pronunciation='',
  vocabulary='',verification=null}){
  const fields=['TRANSLATION: '+String(translation||'')];
  if(backTranslation)fields.push('BACK_TRANSLATION: '+backTranslation);
  if(pronunciation)fields.push('PRONUNCIATION: '+pronunciation);
  if(vocabulary)fields.push('VOCABULARY:\n'+vocabulary);
  if(verification)fields.push('VERIFICATION: '+JSON.stringify(verification));
  return fields.join('\n');
}
function verificationUsage(result){
  const usage=result?.usage||{};
  const input=Number(usage.prompt_tokens)||0,output=Number(usage.completion_tokens)||0;
  const cost=Number(((input*2.5+output*10)/1e6).toFixed(7));
  return {cached:false,inputTokens:input,outputTokens:output,
    totalTokens:input+output,estimatedCostUsd:cost,pricingIncomplete:false,
    stages:[{role:'verification',provider:'openai',model:'gpt-4o',
      inputTokens:input,outputTokens:output,estimatedKnownPaidUsd:cost,
      pricingIncomplete:false,ms:null}]};
}
module.exports={pronounceChinese,formatV1Details,verificationUsage};
