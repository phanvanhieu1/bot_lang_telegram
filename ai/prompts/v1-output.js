'use strict';
const {containsChinese}=require('./free.prompt');
// No model call and no ambiguity-prone classifier: only a small explicit
// everyday greeting whitelist can use the optional lightweight model.
const SIMPLE_ZH=new Set(['你好','您好','早上好','晚上好','晚安','谢谢','谢谢你','再见','明天见']);
function v1ModelFor(text,{context='auto',terms=[],backTranslation=true,
  vocabulary=true,existingTranslation=null,history=[],imageUrl=null}={},env=process.env){
  if(env.V1_TIERED_ROUTING!=='true')return 'gpt-4o';
  if(imageUrl||existingTranslation||history.length||terms.length||
    !['auto','friend'].includes(context)||backTranslation||vocabulary)return 'gpt-4o';
  if(!containsChinese(text)||!SIMPLE_ZH.has(String(text||'').trim()))return 'gpt-4o';
  return env.V1_OPENAI_SIMPLE_MODEL||'gpt-4o-mini';
}
const V1_JSON_SCHEMA={type:'object',additionalProperties:false,
  properties:{translation:{type:'string'},backTranslation:{type:'string'},
    vocabulary:{type:'string'}},
  required:['translation','backTranslation','vocabulary']};

function parseV1Json(raw,{supplement=false,backTranslation=true,vocabulary=true}={}){
  let obj;
  try{obj=JSON.parse(raw);}catch(_){throw new Error('V1_INVALID_JSON');}
  if(!obj||typeof obj!=='object'||Array.isArray(obj)||
    ['translation','backTranslation','vocabulary'].some(k=>typeof obj[k]!=='string'))
    throw new Error('V1_INVALID_JSON');
  if(!supplement&&!obj.translation.trim())throw new Error('V1_EMPTY_TRANSLATION');
  const output=[];
  if(!supplement)output.push('TRANSLATION: '+obj.translation.trim());
  if(backTranslation)output.push('BACK_TRANSLATION: '+obj.backTranslation.trim());
  if(vocabulary)output.push('VOCABULARY:\n'+obj.vocabulary.trim());
  return output.join('\n');
}
module.exports={v1ModelFor,V1_JSON_SCHEMA,parseV1Json};
