'use strict';
const {addHistory}=require('./history');

// History is an optional side effect of a completed translation. Never hide a
// paid, successful result from a user just because MongoDB history failed.
async function recordTranslationHistorySafely(record,writer=addHistory){
  try{
    const saved=await writer(record);
    return saved?.id||null;
  }catch(_){
    console.warn('[Translation] History write unavailable');
    return null;
  }
}
module.exports={recordTranslationHistorySafely};
