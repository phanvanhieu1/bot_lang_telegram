'use strict';
// Opt-in, billable live test. Does not require website, DB or PRO sessions.
require('dotenv').config({quiet:true});
const fs=require('node:fs');
const path=require('node:path');
const {deepTranslate}=require('../ai/v2/engine');
const fixture=require('../benchmarks/v2-holdout.json');

const args=process.argv.slice(2);
function flag(name,defaultValue) {
  const value=args.find(x=>x.startsWith('--'+name+'='));
  return value?value.slice(name.length+3):defaultValue;
}
async function main(){
  const limit=Number(flag('limit','5'));
  const domain=flag('domain','all');
  const repeat=Number(flag('repeat','1'));
  const dryRun=args.includes('--dry-run');
  if(!Number.isInteger(limit)||limit<1||limit>35||
     !Number.isInteger(repeat)||repeat<1||repeat>3 ||
     !['all','work','friend','it','mixed'].includes(domain)) {
    throw new Error('Invalid flags: limit 1..35, repeat 1..3, domain work/friend/it/mixed/all');
  }
  const selected=fixture.cases.filter(item=>domain==='all'||item.domain===domain).slice(0,limit);
  if(dryRun) {
    console.log(JSON.stringify({count:selected.length,repeat,ids:selected.map(x=>x.id)},null,2));
    return;
  }
  const reports=[];
  for(let trial=1;trial<=repeat;trial++){
    for(const c of selected){
      const start=Date.now();
      try{
        const result=await deepTranslate({text:c.source,context:c.domain==='friend'?'friend':'auto'});
        reports.push({id:c.id,domain:c.domain,source:c.source,checks:c.checks,trial,
          translation:result.translation,status:result.status,
          issues:result.issues,analysis:result.analysis,usage:result.usage,
          latencyMs:Date.now()-start});
        console.log(c.id,'trial='+trial,result.status,'translation='+result.translation);
      }catch(error){
        reports.push({id:c.id,domain:c.domain,trial,errorCode:String(error?.code||'V2_UNAVAILABLE').slice(0,80)});
        console.warn(c.id,'trial='+trial,'ERROR',String(error?.code||'V2_UNAVAILABLE').slice(0,80));
      }
    }
  }
  const dir=path.join(__dirname,'..','benchmarks','results');
  fs.mkdirSync(dir,{recursive:true});
  const file=path.join(dir,'v2-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');
  fs.writeFileSync(file,JSON.stringify({schemaVersion:1,records:reports,
    note:'AI-generated PASS and checklists are not human evaluations; review all source meaning units.'},null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({file,records:reports.length,
    pass:reports.filter(x=>x.status==='PASS').length,
    needsReview:reports.filter(x=>x.status==='REVIEW').length,
    errors:reports.filter(x=>x.errorCode).length},null,2));
}
if(require.main===module)main().catch(e=>{console.error('Benchmark:',String(e?.code||e.message||e).slice(0,100));process.exitCode=1;});
