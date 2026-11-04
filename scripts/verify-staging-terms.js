'use strict';
// Read-only verification of a user-confirmed pair in a separate staging DB.
// No Claude/OpenAI requests; no fixture inserts, upserts or schema creation.
require('dotenv').config({quiet:true});
const mongoose=require('mongoose');
const {lookupUserTerms}=require('../ai/terminology/resolver');
const {detectDirection}=require('../ai/v2/engine');
const {cases}=require('../benchmarks/v2-glossary-fixtures.json');

function requireStagingConfig(env=process.env){
  if(env.V2_ALLOW_STAGING_DB_READ!=='true'||!env.V2_TEST_MONGODB_URI||
    !mongoose.isValidObjectId(env.V2_TEST_USER_ID))
    throw Error('STAGING_DB_CONFIG_REQUIRED');
  // Never silently use the live connection string under a staging flag.
  if(env.MONGODB_URI && env.V2_TEST_MONGODB_URI.trim()===env.MONGODB_URI.trim())
    throw Error('STAGING_URI_MATCHES_PRODUCTION');
  return {uri:env.V2_TEST_MONGODB_URI,user:env.V2_TEST_USER_ID};
}
async function checkStaging(){
  const {uri,user}=requireStagingConfig();
  const db=await mongoose.createConnection(uri,{
    serverSelectionTimeoutMS:7000,autoIndex:false,autoCreate:false
  }).asPromise();
  try {
    const model=db.model('TermGlossary',
      require('../ai/terminology/model').schema,'translation_terminology');
    const reports=[];
    for(const id of ['G01','G09']){
      const c=cases.find(x=>x.id===id);
      if(!c)throw Error('MISSING_TEST_FIXTURE_'+id);
      const direction=detectDirection(c.source);
      const terms=await lookupUserTerms(user,c.source,{
        context:c.context,analyzedDomain:c.claudeDomain,
        sourceLang:direction.source,targetLang:direction.target
      },model);
      const expectedSource=id==='G01'?'刷子':'đường dây bào khuyến mãi';
      const expectedTarget=id==='G01'?'đường dây bào khuyến mãi':'刷子';
      reports.push({id,sourceLanguage:direction.source,targetLanguage:direction.target,
        passed:terms.some(t=>t.source===expectedSource&&t.translation===expectedTarget),
        matchedTerms:terms.map(t=>({source:t.source,translation:t.translation}))});
    }
    const passed=reports.filter(r=>r.passed).length;
    console.log(JSON.stringify({mode:'staging-db-read-only',
      checked:reports.length,passed,reports,
      note:'No writes or paid AI calls. Never point staging credentials at production.'},null,2));
    if(passed!==reports.length)process.exitCode=1;
    return {passed,total:reports.length};
  }finally{await db.close();}
}
if(require.main===module)checkStaging().catch(error=>{
  console.error('Staging glossary check:',String(error?.code||error?.message||'UNAVAILABLE').slice(0,90));
  process.exitCode=1;
});
module.exports={requireStagingConfig,checkStaging};
