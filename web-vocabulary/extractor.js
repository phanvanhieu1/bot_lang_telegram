// Pure, deterministic tokenizer and candidate generator. No AI, API, or database calls.
const { entries, patterns } = require('./rules');
const LANGUAGES = new Set(['zh', 'en']);
const EN_STOP = new Set(('a an the and or but for to of on in at with as by from is are was were be been being i you he she it we they my your our their his her its not do does did can could would should will shall may might must this that these those there here what when where why who how have has had no yes so just very really more most than then about because into over after before if else also too up down out off some any all one two three please').split(' '));
const EN_INFLECT = {
  confirmed:'confirm',confirming:'confirm',processed:'process',processing:'process',
  solved:'solve',solving:'solve',completed:'complete',completing:'complete',
  approved:'approve',approving:'approve',reviewed:'review',
  checking:'check',checked:'check',updated:'update',updating:'update',
  orders:'order',meetings:'meeting',issues:'issue'
};

function normalize(text, language, type = 'word') {
  let value = String(text || '').normalize('NFKC').trim();
  value = value.replace(/\s+/g, ' ').replace(/^[\s,.!?，。！？:;；、]+|[\s,.!?，。！？:;；、]+$/g, '');
  if (language === 'en') value = value.toLocaleLowerCase('en-US');
  if (language === 'en' && type === 'word') value = EN_INFLECT[value] || value;
  return value.slice(0, 90);
}

function isSafeTerm(term, language, type = 'word') {
  if (!term || term.length > 90 || /[\d@#:/\\]|https?|www\.|[_=]|[\r\n]/iu.test(term)) return false;
  if (type === 'pattern') return /^[\p{L}\p{Script=Han}\s.+?!，,？]+$/u.test(term);
  if (language === 'zh') return /^[\p{Script=Han}]+$/u.test(term) && term.length >= 2 && term.length <= 12;
  if (language === 'en') {
    const words = term.split(' ');
    return words.length <= 6 && words.every(word => /^[a-z]+(?:'[a-z]+)?$/i.test(word)) &&
      term.length >= 3;
  }
  return false;
}
function occurrences(input, phrase) {
  const haystack = input.toLowerCase();
  const needle = phrase.toLowerCase();
  let count = 0, start = 0;
  while ((start = haystack.indexOf(needle, start)) !== -1) {
    const before = haystack[start - 1] || '';
    const after = haystack[start + needle.length] || '';
    const wordBoundary = /[a-z]/i.test(needle[0]) &&
      (/[a-z]/i.test(before) || /[a-z]/i.test(after));
    if (!wordBoundary) count++;
    start += needle.length;
  }
  return count;
}

function categoryFromContext(text, language, context = 'auto') {
  if (context === 'colleague' || context === 'superior') return 'work';
  if (context === 'friend') return 'daily_life';
  const s = String(text || '').toLowerCase();
  const cues = language === 'zh'
    ? { work:['工作','确认','处理','老板','经理','工资','审核','订单','申请','同事','付款','上班','项目','三方','代付'],
        daily:['吃饭','睡觉','洗澡','起床','超市','衣服','朋友','回家','喝水','天气'] }
    : { work:['confirm','process','manager','meeting','task','approval','payment','report','deadline','office','order'],
        daily:['dinner','lunch','breakfast','home','supermarket','grocery','friend','sleep','weather'] };
  const work = cues.work.reduce((n,snippet)=>n+Number(s.includes(snippet)),0);
  const daily = cues.daily.reduce((n,snippet)=>n+Number(s.includes(snippet)),0);
  return work > daily ? 'work' : daily > work ? 'daily_life' : null;
}

function extractCandidates({ foreignText, language, context = 'auto' }) {
  if (!LANGUAGES.has(language) || typeof foreignText !== 'string') return [];
  // Never store or send full conversations; only vetted lexical candidates.
  const source = foreignText.trim().slice(0, 3000);
  if (!source || source.length > 3000) return [];
  const topicHint = categoryFromContext(source, language, context);
  const normalizedSource = language === 'en' ? source.toLowerCase() : source;
  const candidates = new Map();
  function add(term, type, count, rule = null) {
    const key = normalize(term, language, type);
    if (!isSafeTerm(key, language, type) || !count) return;
    if (type === 'word' && language === 'en' && EN_STOP.has(key)) return;
    const id = type + ':' + key;
    if (candidates.has(id)) return;
    candidates.set(id, {
      key, text: key, type, language,
      meaning: rule?.[0] || '',
      category: rule?.[1] || null,
      topicHint,
      source: rule ? 'rule' : 'pending',
      occurrences: Math.min(50, count)
    });
  }
  // Phrase and grammar matching before segmentation protects multi-token units.
  for (const [phrase, meaning] of Object.entries(entries[language].phrase)) {
    add(phrase, 'phrase', occurrences(normalizedSource, phrase), meaning);
  }
  for (const item of patterns[language]) {
    const match = item.regex.test(normalizedSource);
    if (match) add(item.key, 'pattern', 1, [item.meaning, item.category]);
  }
  for (const [word, meaning] of Object.entries(entries[language].word)) {
    add(word, 'word', occurrences(normalizedSource, word), meaning);
  }
  const segmenter = new Intl.Segmenter(language === 'zh' ? 'zh-Hans' : 'en',
    { granularity:'word' });
  const wordCounts = new Map();
  for (const segment of segmenter.segment(source)) {
    if (!segment.isWordLike) continue;
    const raw = segment.segment;
    // Don't extract personal names or brands from mid-sentence capitalized Latin.
    if (language === 'en' && /^[A-Z]/.test(raw) && segment.index !== 0) continue;
    const key = normalize(raw, language);
    if (!isSafeTerm(key, language) || (language === 'en' && EN_STOP.has(key))) continue;
    wordCounts.set(key, (wordCounts.get(key) || 0) + 1);
  }
  for (const [word, count] of wordCounts) {
    add(word, 'word', count, entries[language].word[word] || null);
  }
  // Prioritize useful known phrases/rules and frequent unknown words.
  return [...candidates.values()]
    .sort((a,b)=>Number(b.source==='rule')-Number(a.source==='rule') ||
      ({phrase:0,pattern:1,word:2}[a.type]-{phrase:0,pattern:1,word:2}[b.type]) ||
      b.occurrences-a.occurrences)
    .slice(0, 32);
}
module.exports = { extractCandidates, normalize, isSafeTerm, categoryFromContext };
