'use strict';

// Character count is Unicode code points, not UTF-16 code units.
// Length is only a heuristic for ANALYZER output capacity, not a semantic
// summary limit: never force the model to invent facts to fill a quota.
function analyzerBudget(sourceText) {
  const characters=Array.from(String(sourceText||'').trim()).length;
  const tier=characters<=80?'short':characters<=400?'medium':'long';
  const limits=tier==='short'
    ?{facts:6,terms:8,patterns:3,ambiguities:2,intentChars:220}
    :tier==='medium'
      ?{facts:12,terms:15,patterns:5,ambiguities:4,intentChars:400}
      :{facts:20,terms:20,patterns:6,ambiguities:5,intentChars:600};
  // Max output is a ceiling, not a target. Include headroom for JSON, CJK
  // tokenization, multiple clauses and real terminology extraction.
  const maxOutputTokens=Math.min(3600,Math.max(1050,Math.ceil(
    700+characters*1.25+limits.terms*20+limits.facts*25
  )));
  const retryMaxOutputTokens=Math.min(5500,Math.max(1800,
    Math.ceil(maxOutputTokens*1.6)));
  return {characters,tier,limits,maxOutputTokens,retryMaxOutputTokens};
}

module.exports={analyzerBudget};
