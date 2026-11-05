// Parse only AI1's selected vocabulary, phrases and patterns.
// Does not independently invent new terms or call AI / the database.
const { normalize, isSafeTerm, removeSensitiveSegments } = require('./extractor');

const MAX_AI1_ITEMS = 24;
const TYPE_MAP = {
  WORD:'word', PHRASE:'phrase', PATTERN:'pattern',
  'TỪ VỰNG':'word', 'CỤM TỪ':'phrase', 'MẪU CÂU':'pattern'
};

function findOccurrences(source, term, language) {
  if (!term || !source) return 0;
  const haystack = language === 'en' ? source.toLowerCase() : source;
  const needle = language === 'en' ? term.toLowerCase() : term;
  let count = 0, index = 0;
  while ((index = haystack.indexOf(needle, index)) !== -1) {
    const before = haystack[index-1] || '';
    const after = haystack[index+needle.length] || '';
    const boundaryInvalid = language === 'en' &&
      (/[a-z]/i.test(before) || /[a-z]/i.test(after));
    if (!boundaryInvalid) count++;
    index += needle.length;
  }
  return count;
}

function patternBelongsToSource(key, source, language) {
  // Example: "A 不如 B + tính từ" -> source must contain 不如.
  const words = language === 'zh'
    ? key.match(/[\p{Script=Han}]{2,}/gu) || []
    : (key.match(/[a-z]{3,}/gi) || [])
        .filter(word=>!['pattern','subject','object','verb','noun','adjective','tense','something'].includes(word.toLowerCase()));
  if(words.some(word=>source.toLowerCase().includes(word.toLowerCase())))return true;
  // Some Chinese grammar markers consist of a single character ("比", "把",
  // "被"). Never accept arbitrary one-character overlap.
  if(language==='zh') {
    return ['比','把','被','得','过','着'].some(mark=>
      key.includes(mark)&&source.includes(mark));
  }
  return false;
}

function inferLegacyType(term, language) {
  if (language === 'en') return term.includes(' ') ? 'phrase' : 'word';
  return term.length > 4 ? 'phrase' : 'word';
}

function parseAi1Items(vocabulary, foreignText, language, maxItems=MAX_AI1_ITEMS) {
  const limit=Number.isFinite(maxItems)
    ?Math.max(1,Math.min(32,Math.floor(maxItems))):MAX_AI1_ITEMS;
  if (!['zh','en'].includes(language) ||
      typeof vocabulary !== 'string' || !vocabulary.trim() ||
      typeof foreignText !== 'string') return [];
  const source = removeSensitiveSegments(foreignText).slice(0,3000);
  const unique = new Map();
  const lines = vocabulary.split(/\r?\n/).slice(0,60);
  for (const original of lines) {
    // Small GPT models sometimes wrap otherwise valid selected entries in
    // Markdown or number them. Normalize markup, not semantic content:
    // source-occurrence and sensitive-term guards remain authoritative.
    const line = original.trim()
      .replace(/^(?:[-•*]|\d{1,2}[.)])\s*/u,'')
      .replace(/^\*\*(?=\[|[\p{Script=Han}])/u,'')
      .replace(/\*\*$/u,'').trim();
    if (!line) continue;
    // New format: [WORD] 工资 : tiền lương
    // Legacy format: 工资 (gōng zī) : tiền lương
    const match = line.match(/^(?:\[(WORD|PHRASE|PATTERN|TỪ VỰNG|CỤM TỪ|MẪU CÂU)\]\s*)?(.{1,110}?)\s*[:：]\s*(.{1,450})$/iu);
    if (!match) continue;
    const explicitType = match[1] ? TYPE_MAP[match[1].toUpperCase()] : null;
    const cleanedTerm = match[2].trim().replace(/\s*\([^()]*\)\s*$/u,'').trim();
    const type = explicitType || inferLegacyType(cleanedTerm,language);
    const key = normalize(cleanedTerm,language,type);
    if (!isSafeTerm(key,language,type)) continue;

    const meaning = removeSensitiveSegments(match[3]).replace(/^[\s"'“”]+|[\s"'“”]+$/gu,'').trim().slice(0,450);
    if (!meaning || meaning.length<2 || /[\r\n]|https?:|@/iu.test(meaning)) continue;

    const count = type==='pattern'
      ? Number(patternBelongsToSource(key,source,language))
      : findOccurrences(source,key,language);
    if (!count) continue; // Do not persist hallucinated/out-of-source terms.
    const id=type+':'+key;
    if (unique.has(id)) continue;
    unique.set(id,{
      key, text:cleanedTerm.slice(0,90), type, meaning,
      occurrences:Math.min(50,count)
    });
    if (unique.size>=limit) break;
  }
  return [...unique.values()];
}
module.exports={parseAi1Items,findOccurrences,patternBelongsToSource,MAX_AI1_ITEMS};
