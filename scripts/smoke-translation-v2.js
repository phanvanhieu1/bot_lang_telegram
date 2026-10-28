'use strict';
// Synthetic glossary smoke test; --mock (default) uses NO AI, DB or secrets.
// --live --accept-paid=true uses paid Claude+OpenAI; DB reads require --glossary=db
// with an explicitly configured TEST database, never MONGODB_URI production.
require('dotenv').config({quiet:true});
const fs=require('node:fs');
const path=require('node:path');
const mongoose=require('mongoose');
const {deepTranslate}=require('../ai/v2/engine');
const {resolveTerms,lookupUserTerms}=require('../ai/terminology/resolver');
const {cases}=require('../benchmarks/v2-glossary-fixtures.json');

function option(args,name,fallback) {
  const found=args.find(x=>x.startsWith('--'+name+'='));
  return found?found.slice(name.length+3):fallback;
}
function select(args) {
  const ids=option(args,'ids','').split(',').filter(Boolean);
  if(ids.some(id=>!cases.some(c=>c.id===id)))throw Error('UNKNOWN_GLOSSARY_CASE');
  const count=Number(option(args,'limit','8'));
  if(!Number.isInteger(count)||count<1||count>cases.length)throw Error('INVALID_LIMIT');
  return cases.filter(c=>!ids.length||ids.includes(c.id)).slice(0,count);
}
function makeFixtures(c) {
  return c.dictionary.map((t,index)=>({
    ...t,_id:String(index+1).padStart(24,'0'),status:'approved',
    sourceLang:'zh',targetLang:'vi',priority:100,version:1
  }));
}
function fakeProviders(c) {
  const calls={claude:0,openai:0};
  return {
    calls,
    claude:async()=>{
      calls.claude++;
      return {text:JSON.stringify({
        domain:c.claudeDomain,intent:'Phân tích giả lập để kiểm thử truyền ngữ cảnh',
        tone:c.context,facts:['Kiểm tra ngữ nghĩa'],terms:[
          {source:c.dictionary[0]?.source||'',meaning:c.claudeGuess}
        ],ambiguities:[]
      }),model:'claude-mock',usage:{input:0,output:0}};
    },
    openai:async(_system,user)=>{
      calls.openai++;
      const content=JSON.parse(user);
      const selected=content.approvedTerminology||[];
      const hasMatch=selected.length>0;
      const useWrong=c.forceWrong===true && (!content.errors||c.repairWrong===true);
      const result=useWrong?c.plainTranslation:
        hasMatch?c.verifiedTranslation:c.plainTranslation;
      return {text:JSON.stringify({translation:result,uncertainties:[]}),
        model:'openai-mock',usage:{input:0,output:0}};
    }
  };
}
async function runOne(c,{mode='mock',glossary='fixture',dbModel=null,providersOverride=null}={}) {
  const loadGlossary=glossary==='fixture'
    ? async(source,opts)=>resolveTerms(source,makeFixtures(c),opts)
    : glossary==='db'
      ? async(source,opts)=>lookupUserTerms(process.env.V2_TEST_USER_ID,source,opts,dbModel)
      : async()=>[];
  const mock=mode==='mock'?fakeProviders(c):null;
  const start=Date.now();
  try{
    const result=await deepTranslate({
      text:c.source,context:c.context,loadGlossary
    },providersOverride||mock||undefined);
    const actualTerms=result.appliedTerms.map(x=>x.source);
    const expectedTerms=c.expectTerms||[];
    const termMatchOK=expectedTerms.every(x=>actualTerms.includes(x)) &&
      actualTerms.every(x=>expectedTerms.includes(x));
    // Do NOT label live runs "plumbing OK" just because HTTP calls returned.
    // For live, this check verifies only exact glossary matching and cannot
    // assert semantic correctness of the entire translation.
    const plumbingOK=mode==='mock'?(
      termMatchOK && result.status===c.expectStatus &&
      mock.calls.claude===1 &&
      mock.calls.openai===(c.id==='G08'?2:1)
    ):null;
    return {id:c.id,mode,context:c.context,source:c.source,
      expectedTerms,actualTerms,termMatchOK,status:result.status,
      translation:result.translation,issues:result.issues,
      analysis:result.analysis,translationNotes:result.translationNotes,
      usage:result.usage,elapsedMs:Date.now()-start,plumbingOK,
      humanQualityReviewed:false};
  } catch(error){
    return {id:c.id,mode,errorCode:String(error.code||'V2_SMOKE_ERROR').slice(0,90),
      elapsedMs:Date.now()-start,plumbingOK:false};
  }
}
async function main(args=process.argv.slice(2)){
  const selected=select(args);
  const mode=option(args,'mode','mock');
  const glossary=option(args,'glossary','fixture');
  const dryRun=args.includes('--dry-run');
  if(!['mock','live'].includes(mode)||!['fixture','db','none'].includes(glossary))
    throw Error('INVALID_MODE_OR_GLOSSARY');
  if(mode==='mock'&&glossary==='db')throw Error('MOCK_DB_COMBINATION_UNSUPPORTED');
  if(dryRun){
    console.log(JSON.stringify({mode,glossary,total:selected.length,ids:selected.map(c=>c.id)},null,2));
    return {dryRun:true};
  }
  if(mode==='live'){
    if(option(args,'accept-paid','false')!=='true')throw Error('PAID_API_OPT_IN_REQUIRED');
    if(!(process.env.CLAUDE_API_KEY||process.env.ANTHROPIC_API_KEY||process.env.CLAUDE_API)||
       !(process.env.OPENAI_API_KEYS||process.env.OPENAI_API_KEY||process.env.OPENAI_API))
      throw Error('V2_TEST_API_KEYS_NOT_CONFIGURED');
  }
  let connection,model;
  if(glossary==='db'){
    // Read-only staging mode: no collection creation or writes.
    if(!process.env.V2_TEST_MONGODB_URI || process.env.V2_ALLOW_STAGING_DB_READ!=='true'||
      !mongoose.isValidObjectId(process.env.V2_TEST_USER_ID))
      throw Error('STAGING_DB_CONFIG_REQUIRED');
    connection=await mongoose.createConnection(process.env.V2_TEST_MONGODB_URI,{
      serverSelectionTimeoutMS:7000,autoIndex:false
    }).asPromise();
    model=connection.model('TermGlossary',
      require('../ai/terminology/model').schema,'translation_terminology');
  }
  const records=[];
  try{
    for(const c of selected){
      const outcome=await runOne(c,{mode,glossary,dbModel:model});
      records.push(outcome);
      console.log(c.id, outcome.errorCode||outcome.status,
        mode==='mock'?(outcome.plumbingOK?'fixture:OK':'fixture:FAIL'):'live:needs-human-review');
    }
  } finally {if(connection)await connection.close();}
  const directory=path.join(__dirname,'..','benchmarks','results');
  fs.mkdirSync(directory,{recursive:true});
  const out=path.join(directory,'v2-glossary-'+mode+'-'+
    new Date().toISOString().replace(/[:.]/g,'-')+'.json');
  fs.writeFileSync(out,JSON.stringify({mode,glossary,records,
    note:'Synthetic cases; model PASS is not independent human quality validation. No production changes.'},null,2)+'\n',{mode:0o600});
  const passed=records.filter(r=>
    !r.errorCode && (mode==='mock'?r.plumbingOK:r.termMatchOK)).length;
  const reportSummary={report:out,total:records.length,
    mockPlumbingPassed:mode==='mock'?passed:null,
    liveTermMatches:mode==='live'?passed:null,
    needsReview:records.filter(r=>r.status==='REVIEW').length,
    semanticQualityReviewed:false,
    failures:records.length-passed};
  console.log(JSON.stringify(reportSummary,null,2));
  if(passed!==records.length)process.exitCode=1;
  return {passed,total:records.length};
}
if(require.main===module)main().catch(error=>{
  console.error('Smoke setup failed:',String(error.code||error.message||'UNKNOWN').slice(0,100));
  process.exitCode=1;
});
module.exports={main,select,makeFixtures,fakeProviders,runOne};
