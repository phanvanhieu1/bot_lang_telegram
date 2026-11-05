'use strict';
// Conservative post-generation guard: detect clear English paragraphs where
// Chinese -> Vietnamese was requested. Never assume "no accents" means English.
// Domain labels, short names, IDs and mixed technical snippets are allowed.
const EN=new Set(('the a an of for with from that this these those is are was were be been to in on at by as and or but if then when which who whose it they them their we our you your can could should would will not do does did dont into over under more less many much some any each records agents collection payment third party success rate use using check please money unstable list high low').split(' '));
const VI=new Set(('tôi bạn anh chị em chúng ta họ những các của với cho từ trong trên dưới là có được không đã đang sẽ cần phải nên hãy đừng kiểm tra ghi nhận bên thu hộ tiền tỷ lệ thành công cao thấp bên thứ ba thanh toán nhiều ít ổn định thêm lên vào dùng sử dụng').split(' '));
const englishPhrases=/\b(?:the\s+\w+|of\s+the|for\s+(?:those|the|third)|with\s+the|do\s+not|don't\s+|should\s+|would\s+)\b/iu;
function clearEnglishInsteadOfVietnamese(value){
  const text=String(value||'').trim();
  if(!text||/[\u3400-\u9fff]/u.test(text))return false;
  // Vietnamese diacritics have strong precedence over English stopwords.
  if(/[ăâđêôơưĂÂĐÊÔƠƯ]|[àáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/iu.test(text))return false;
  const words=text.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g)||[];
  if(words.length<7)return false;
  const en=words.filter(w=>EN.has(w)).length;
  const vi=words.filter(w=>VI.has(w)).length;
  return en>=3&&en>vi*2&&en/words.length>=0.18&&englishPhrases.test(text);
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
  if(!/[\u3400-\u9fff]/u.test(String(source||'')))return null;
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
  if(/[\u3400-\u9fff]/u.test(String(source||'')))return null;
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
  const match=/(^|\n)(BACK_TRANSLATION:\s*)([^\n]*(?:\n(?!TRANSLATION:|VOCABULARY:|PRONUNCIATION:|VERIFICATION:)[^\n]*)*)/i.exec(raw);
  if(!match)return {content:raw,issue:null};
  const issue=backTranslationLanguageIssue(source,match[3].trim());
  if(!issue)return {content:raw,issue:null};
  return {content:raw.slice(0,match.index)+match[1]+'BACK_TRANSLATION: '+
    raw.slice(match.index+match[0].length),issue};
}
module.exports={clearEnglishInsteadOfVietnamese,clearChineseInsteadOfVietnamese,
  translationLanguageIssue,backTranslationLanguageIssue,sanitizeV1BackTranslation};
