'use strict';
// Claude's semantic term hypotheses are learning suggestions, NEVER approved
// terminology. Only source-grounded Chinese words/phrases may enter the
// existing MongoDB study library; Vietnamese source terms are display-only.
const {parseAi1Items}=require('../../web-vocabulary/ai-items');
const {normalize,isSafeTerm,removeSensitiveSegments}=require('../../web-vocabulary/extractor');

const MAX_TERMS=8;
function sanitizeClaudeTerms(raw,sourceText,sourceLanguage){
  if(!Array.isArray(raw)||!['zh','vi'].includes(sourceLanguage))return [];
  const source=removeSensitiveSegments(String(sourceText||'')).slice(0,2000);
  const unique=new Set(),result=[];
  for(const row of raw.slice(0,24)){
    if(!row||typeof row.source!=='string'||typeof row.meaning!=='string')continue;
    const term=row.source.trim().normalize('NFKC').slice(0,80);
    const meaning=removeSensitiveSegments(row.meaning).trim().slice(0,160);
    if(!term||!meaning||meaning.length<2||
       /[\r\n:@#<>]/u.test(term)||/[\r\n<>]/u.test(meaning)||
       !source.includes(term)||unique.has(term))continue;
    if(sourceLanguage==='zh'){
      const key=normalize(term,'zh',term.length>4?'phrase':'word');
      if(!isSafeTerm(key,'zh',term.length>4?'phrase':'word'))continue;
    }else{
      if(!/[\p{L}]/u.test(term)||/[\d]/u.test(term))continue;
    }
    unique.add(term);
    result.push({source:term,meaning});
    if(result.length>=MAX_TERMS)break;
  }
  return result;
}

function toStudyVocabulary(terms,sourceText,sourceLanguage){
  if(sourceLanguage!=='zh')return '';
  const lines=(terms||[]).map(row=>{
    const kind=row.source.length>4?'PHRASE':'WORD';
    return '['+kind+'] '+row.source+' : '+row.meaning;
  });
  // Reuse V1's source validation before ever writing to MongoDB.
  const parsed=parseAi1Items(lines.join('\n'),sourceText,'zh');
  return parsed.map(row=>'['+row.type.toUpperCase()+'] '+row.text+' : '+row.meaning).join('\n');
}

module.exports={sanitizeClaudeTerms,toStudyVocabulary};
