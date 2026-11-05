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
function translationLanguageIssue(source,translation){
  if(!/[\u3400-\u9fff]/u.test(String(source||'')))return null;
  if(clearEnglishInsteadOfVietnamese(translation))
    return 'EXPECTED_VIETNAMESE_GOT_ENGLISH';
  return null;
}
module.exports={clearEnglishInsteadOfVietnamese,translationLanguageIssue};
