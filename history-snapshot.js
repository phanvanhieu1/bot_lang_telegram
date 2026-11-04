'use strict';
// Persist only what the web translation detail pane needs to replay a completed
// request. Historic inspection content is stored only when the user explicitly
// enabled the AI inspector for that request.
function historySnapshot({engine,context='auto',options={},response={}}={}){
  const validEngine=['v1','v2','free'].includes(engine)?engine:'v1';
  const uiOptions={
    backTranslation:options.backTranslation!==false,
    pronunciation:options.pronunciation!==false,
    vocabulary:options.vocabulary!==false,
    verification:options.verification===true
  };
  const keys=['result','vocabularyItems','vocabularyError','cached','provider',
    'requestUsage','appliedTerms','terminologyWarnings','issues',
    'analysis','analysisTerms','translationNotes','sourceLanguage',
    'targetLanguage','needsReview','verificationError','verification'];
  const payload={};
  for(const key of keys){
    if(Object.hasOwn(response,key))payload[key]=response[key];
  }
  if(options.inspectAI===true&&response.inspection){
    payload.inspection=response.inspection;
  }
  return {version:1,engine:validEngine,context,options:uiOptions,
    inspectEnabled:options.inspectAI===true,payload};
}
module.exports={historySnapshot};
