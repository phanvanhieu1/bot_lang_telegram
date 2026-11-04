'use strict';
// Source-grounded name classification. This never queries an LLM or database.
// The owner-approved glossary is authoritative; Claude's entity guesses are
// advisory. Unknown Chinese spans are NOT globally replaced with placeholders.
const {extractSourceNames,sanitizeProperNames}=require('../prompts/proper-names');

function sourceOccurrences(source,term){
  const spans=[];
  if(!term)return spans;
  let index=0;
  while((index=source.indexOf(term,index))!==-1){
    spans.push([index,index+term.length]);
    index+=term.length;
    if(spans.length>=32)break;
  }
  return spans;
}
function approvedSourceSpans(source,terms){
  const spans=[];
  for(const term of terms||[]){
    const word=String(term?.source||'');
    if(!word)continue;
    const offset=Number(term?.offset);
    // The resolver supplies an exact source position for its selected hit.
    // Avoid assuming every repeated occurrence was glossary-approved.
    if(Number.isInteger(offset)&&offset>=0&&source.slice(offset,offset+word.length)===word){
      spans.push({span:[offset,offset+word.length],source:word});
    }else{
      for(const span of sourceOccurrences(source,word))
        spans.push({span,source:word});
    }
  }
  return spans;
}
function uncoveredNameSpans(source,name,approved){
  const covered=approvedSourceSpans(source,approved);
  return sourceOccurrences(source,name).filter(span=>!covered.some(row=>
    row.source.length>=name.length &&
    row.span[0]<=span[0]&&row.span[1]>=span[1]));
}
function fullyCoveredByApproved(source,name,approved){
  return sourceOccurrences(source,name).length>0 &&
    uncoveredNameSpans(source,name,approved).length===0;
}
function verifiedSourceName(raw,source){
  const names=sanitizeProperNames([raw],source);
  return names.length===1?names[0]:null;
}
function entityCandidates(source,max=10){
  const text=String(source||'');
  const strong=extractSourceNames(text,max);
  const output=[...strong];
  // Quotes or code-adjacent Chinese are candidates, not verified names;
  // the analyzer can mark them ordinary. Never force these to survive alone.
  const add=value=>{
    if(output.length>=max)return;
    const name=verifiedSourceName(value,text);
    if(name&&!output.includes(name))output.push(name);
  };
  for(const match of text.matchAll(/[「“【]([\p{Script=Han}]{2,8})[」”】]/gu))
    add(match[1]);
  for(const match of text.matchAll(
    /(?:^|\s)[A-Z]{1,8}\d[A-Z\d]*\s+([\p{Script=Han}]{2,6})(?=\s|[,，。；;、]|$)/gu))
    add(match[1]);
  return {strong,candidates:output};
}
function classifyNames({sourceText,candidates=[],strong=[],claudeNames=[],
  claudeEntities=[],approvedTerms=[]}={}){
  const source=String(sourceText||'');
  const positives=new Set([
    ...sanitizeProperNames(strong,source),
    ...sanitizeProperNames(claudeNames,source)
  ]);
  const conflicts=new Set();
  const suggestions=new Set(sanitizeProperNames(candidates,source));
  const observations=[];
  for(const row of Array.isArray(claudeEntities)?claudeEntities.slice(0,20):[]){
    if(!row||typeof row!=='object')continue;
    const name=verifiedSourceName(row.source,source);
    if(!name)continue;
    const type=String(row.type||'').toLowerCase();
    const action=String(row.action||'').toLowerCase();
    const confidence=String(row.confidence||'').toLowerCase();
    if(!['proper_name','label','common','uncertain'].includes(type)||
       !['keep','translate','review'].includes(action))continue;
    observations.push({source:name,type,action,confidence});
    if(type==='common'&&action==='translate'){
      conflicts.add(name);
      continue;
    }
    // Only source-grounded entities with an explicit preservation decision.
    // A weak, ungrounded guess is not strong enough to force an extra repair.
    if((type==='proper_name'||type==='label')&&action==='keep'&&
       ['high','medium'].includes(confidence))positives.add(name);
    if(type==='uncertain'&&action==='review'&&suggestions.has(name) &&
       ['high','medium'].includes(confidence))positives.add(name);
  }
  for(const name of conflicts)positives.delete(name);
  const protectedNames=[...positives].filter(name=>
    !fullyCoveredByApproved(source,name,approvedTerms)).slice(0,12);
  return {protectedNames,entityDecisions:observations};
}
function missingProtectedNameOccurrences(source,translation,names,approved=[]){
  const original=String(source||''),target=String(translation||'');
  return (names||[]).filter(name=>
    sourceOccurrences(target,name).length <
      uncoveredNameSpans(original,name,approved).length);
}
function conciseTranslationAnalysis(frame,resolvedDomain){
  const unique=new Set(),facts=[];
  for(const fact of frame.facts||[]){
    const clean=String(fact||'').trim();
    const key=clean.toLocaleLowerCase('vi-VN');
    if(!clean||unique.has(key))continue;
    unique.add(key);
    facts.push(clean);
  }
  const ambiguities=[...new Set((frame.ambiguities||[])
    .map(x=>String(x||'').trim()).filter(Boolean))];
  return {
    domain:resolvedDomain,
    intent:frame.intent,
    tone:frame.tone,
    facts,
    ambiguities,
    // Claude lexical guesses are study suggestions; don't send them to GPT.
    // The original text and approvedTerminology already carry the meaning.
  };
}
module.exports={sourceOccurrences,fullyCoveredByApproved,entityCandidates,
  classifyNames,missingProtectedNameOccurrences,conciseTranslationAnalysis};
