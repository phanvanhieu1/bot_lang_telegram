'use strict';
// Conservative post-generation guard: detect clear English paragraphs where
// Chinese -> Vietnamese was requested. Never assume "no accents" means English.
// Domain labels, short names, IDs and mixed technical snippets are allowed.
const EN=new Set(('the a an of for with from that this these those is are was were be been to in on at by as and or but if then when which who whose it they them their we our you your can could should would will not do does did dont into over under more less many much some any each records agents collection payment third party success rate use using check please money unstable list high low').split(' '));
const VI=new Set(('tôi bạn anh chị em chúng ta họ những các của với cho từ trong trên dưới là có được không đã đang sẽ cần phải nên hãy đừng kiểm tra ghi nhận bên thu hộ tiền tỷ lệ thành công cao thấp bên thứ ba thanh toán nhiều ít ổn định thêm lên vào dùng sử dụng').split(' '));
const englishPhrases=/\b(?:the\s+\w+|of\s+the|for\s+(?:those|the|third)|with\s+the|do\s+not|don't\s+|should\s+|would\s+)\b/iu;
// Detect the dominant language of a SOURCE, not the mere presence of one
// Chinese character. Vietnamese messages often contain a Chinese brand or
// colleague's name, e.g. "Đơn 澎湃 này đã xử lý chưa?".
const VI_ACCENTS=/[ăâđêôơưĂÂĐÊÔƠƯàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/iu;
const VI_UNACCENTED=new Set(['toi','ban','minh','chung','nhung','khong','duoc','gui','kiem','tra','don','hang','nay','da','chua','can','phai','hay','voi','cho','them','sau']);
function sourceLanguage(source){
  const text=String(source||'').trim();
  const han=(text.match(/[\u3400-\u9fff]/gu)||[]).length;
  if(!han)return 'vi';
  const words=text.toLowerCase().match(/[A-Za-zÀ-ỹĐđ]+/gu)||[];
  const latinLetters=(text.match(/[A-Za-zÀ-ỹĐđ]/gu)||[]).length;
  // This intentionally favors Chinese for ambiguous mixed messages.
  if(words.length>=3&&latinLetters>han*2&&VI_ACCENTS.test(text))
    return 'vi';
  if(words.length>=5&&han<=8&&latinLetters>han*3&&
    words.filter(w=>VI_UNACCENTED.has(w)).length>=3)
    return 'vi';
  return 'zh';
}
const EN_SYNTAX=/\b(?:the\s+\w+|of\s+the|has\s+been|have\s+been|had\s+been|is\s+(?:not|being|already|[a-z]+(?:ed|ing)\b)|are\s+(?:not|being)|was\s+(?:not|already)|were\s+not|can\s+(?:you|we|it|they)|could\s+you|would\s+you|please\s+\w+|should\s+\w+|must\s+\w+|need\s+to|will\s+\w+|do\s+not|does\s+not|did\s+not|doesn't|don't|won't|i\s+(?:am|have|need|want|cannot)|we\s+(?:are|have|need|want)|you\s+(?:are|have|need|can)|this\s+\w+|these\s+\w+)\b/iu;
const EN_EXTRA=new Set(('i me my mine he she his her they their ours we us your yours have has had need needs needed want wants wanted cannot unable never before after here there already still yet only also sent send sending received receive getting getting processed process withdraw withdrawal order orders platform account accounts colleague colleagues asked ask waiting pending please today tomorrow yesterday hours minutes checked checking requested request allow allowed work working finished done').split(' '));
function clearEnglishInsteadOfVietnamese(value){
  const text=String(value||'').trim();
  if(!text)return false;
  const candidate=text.replace(/[\u3400-\u9fff]+/gu,' ');
  // Check clauses individually: a complete English sentence must not hide
  // behind an otherwise Vietnamese back-translation. English brand names and
  // brief technical labels do not by themselves count as a wrong language.
  const clauses=candidate.split(/[\n.!?;]+/u).map(x=>x.trim()).filter(Boolean);
  for(const clause of clauses){
    const words=clause.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g)||[];
    if(words.length<2)continue;
    // Recognize unmistakable two-word English commands/statuses, but keep
    // ambiguous product labels and identifiers (e.g. "PP order") untouched.
    if(words.length===2&&/^(?:please\s+(?:check|confirm|send|wait|review)|(?:order|payment|withdrawal|request)\s+(?:sent|received|approved|rejected|completed|processed))$/iu.test(clause))
      return true;
    if(words.length<3)continue;
    const en=words.filter(w=>EN.has(w)||EN_EXTRA.has(w)).length;
    const vi=words.filter(w=>VI.has(w)).length;
    const grammar=EN_SYNTAX.test(clause)||englishPhrases.test(clause);
    // An English sentence can contain an accented Vietnamese person's name.
    // Do not let one proper name defeat detection of an English clause.
    if(VI_ACCENTS.test(clause)&&(vi>=2||en<3))continue;
    if(grammar&&en>=2&&en>vi*2&&en/words.length>=0.20)return true;
    if(words.length>=5&&en>=3&&vi===0&&en/words.length>=0.48)return true;
    if(words.length>=9&&en>=5&&vi<=1&&en/words.length>=0.43)return true;
  }
  return false;
}
// Chinese proper names may remain in an otherwise Vietnamese sentence.
// Reject only a substantial, still-Chinese sentence or paragraph.
function clearChineseInsteadOfVietnamese(value){
  const text=String(value||'').trim();
  const han=(text.match(/[\u3400-\u9fff]/gu)||[]).length;
  if(han<5)return false; // short protected names and codes are not enough
  const latinWords=text.match(/[A-Za-zÀ-ỹĐđ]+/gu)||[];
  const latinLetters=(text.match(/[A-Za-zÀ-ỹĐđ]/gu)||[]).length;
  // Leave mixed Vietnamese explanations containing Chinese platform names alone.
  return han>=12
    ?han>=latinLetters*0.65 && latinWords.length<Math.max(8,han/2)
    :han>latinLetters*1.5 && latinWords.length<4;
}
function translationLanguageIssue(source,translation){
  if(sourceLanguage(source)!=='zh')return null;
  if(clearChineseInsteadOfVietnamese(translation))
    return 'EXPECTED_VIETNAMESE_GOT_CHINESE';
  if(clearEnglishInsteadOfVietnamese(translation))
    return 'EXPECTED_VIETNAMESE_GOT_ENGLISH';
  return null;
}
// For Vietnamese -> Chinese requests, BACK_TRANSLATION is a new Vietnamese
// translation of the generated Chinese. It must never silently become English.
// Allow embedded Chinese proper nouns and codes (e.g. PP, 芳华).
function backTranslationLanguageIssue(source,backTranslation){
  if(sourceLanguage(source)!=='vi')return null;
  if(clearEnglishInsteadOfVietnamese(backTranslation))
    return 'EXPECTED_VIETNAMESE_BACK_TRANSLATION_GOT_ENGLISH';
  if(clearChineseInsteadOfVietnamese(backTranslation))
    return 'EXPECTED_VIETNAMESE_BACK_TRANSLATION_GOT_CHINESE';
  return null;
}
// Used on the normalized V1 output after optional JSON-to-label conversion.
// Return the original string unchanged unless the back-translation is clearly
// in the wrong language. Never modify the primary TRANSLATION or vocabulary.
function sanitizeV1BackTranslation(content,source){
  const raw=String(content||'');
  const lines=raw.split(/\r?\n/u);
  const start=lines.findIndex(line=>/^\s*BACK_TRANSLATION\s*:/iu.test(line));
  if(start<0)return {content:raw,issue:null};
  let end=start+1;
  const value=[lines[start].replace(/^\s*BACK_TRANSLATION\s*:\s*/iu,'')];
  while(end<lines.length&&!/^\s*(?:TRANSLATION|VOCABULARY|PRONUNCIATION|VERIFICATION)\s*:/iu.test(lines[end])){
    value.push(lines[end]);
    end++;
  }
  const issue=backTranslationLanguageIssue(source,value.join('\n').trim());
  if(!issue)return {content:raw,issue:null};
  // Never consume the following VOCABULARY/PRONUNCIATION/VERIFICATION fields.
  lines.splice(start,end-start,'BACK_TRANSLATION: ');
  return {content:lines.join('\n'),issue};
}
module.exports={sourceLanguage,clearEnglishInsteadOfVietnamese,clearChineseInsteadOfVietnamese,
  translationLanguageIssue,backTranslationLanguageIssue,sanitizeV1BackTranslation};
