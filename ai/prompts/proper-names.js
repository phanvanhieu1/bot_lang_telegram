'use strict';

// Unverified names are opaque labels, not words to reinterpret. Approved
// owner terminology may still explicitly define a translation for a label.
const NAME_PRESERVATION_RULES=[
  'BẢO TOÀN TÊN RIÊNG/NHÃN NỘI BỘ: Trước khi dịch, phân biệt tên người, tên nền tảng, kênh thanh toán, thương hiệu, tên nhóm/đơn vị hoặc nhãn hệ thống với từ thông dụng.',
  'Tên hoặc nhãn chưa có nghĩa dịch CHẮC CHẮN, đã được xác nhận: CHÉP Y NGUYÊN từng chữ/ký tự trong bản dịch; không dịch nghĩa, phiên âm, đổi chữ, tự ghép với từ kế cận hoặc bỏ qua.',
  'Tên viết bằng chữ Hán cũng được giữ nguyên khi chưa có tên Việt chính thức. Chỉ dịch theo ánh xạ từ điển cá nhân đã được người dùng phê duyệt hoặc tên dịch chính thức thực sự chắc chắn.',
  'Giữ nguyên mã đơn/giao dịch, ID, tên hệ thống và số; không tự suy diễn quan hệ giữa các mã. Tách tên riêng khỏi các từ chỉ thời gian, hành động và ngữ pháp xung quanh.',
  'Nếu chưa chắc một cụm là tên riêng hay từ thường, dựa vào cú pháp và vai trò trong câu; không tùy tiện Việt hóa thành tên khác. Không dịch toàn bộ câu nguyên văn, chỉ giữ nguyên những tên/nhãn cần bảo vệ.'
].join(' ');

// A short V2-specific instruction: entities already come from source-checked
// classification, so GPT does not need the longer V1 detection policy.
const V2_NAME_RULES='protectedNames là các nhãn/tên riêng CHÉP Y NGUYÊN từ nguồn, kể cả chữ Hán. Không phiên âm, dịch nghĩa, đổi tên hay bỏ sót. approvedTerminology là ánh xạ do người dùng xác nhận và có ưu tiên cao hơn. Dịch đầy đủ phần còn lại của câu; giữ mã, số và quan hệ giữa các đối tượng.';

function safeSourceName(source,name){
  return typeof name==='string'&&
    name.length>=2&&name.length<=40&&
    !/[\r\n<>]/u.test(name)&&
    /\p{Script=Han}/u.test(name)&&
    source.includes(name);
}

// These are high-signal source spans, NOT a list of names. Never embed a
// particular platform/person in the rules. Restrict this fallback to labelled
// names or business messages with a code + possessive + time boundary.
const GENERIC_WORDS=new Set([
  '余额','金额','订单','交易','账户','资金','款项','费用','差额','银行',
  '时间','晚上','下午','上午','今天','明天','昨天','会员','客户',
  '核实','查看','确认','审核','支付','充值','提现','通道','平台',
  '问题','部分','工作','结果','系统','活动','记录'
]);
function extractSourceNames(sourceText,max=12){
  const source=String(sourceText||'');
  const found=new Set();
  const add=name=>{
    if(safeSourceName(source,name)&&!GENERIC_WORDS.has(name)&&found.size<max)
      found.add(name);
  };
  // Explicit names: require matched quotes, or a clear boundary after an
  // unquoted name. Otherwise "平台：星河今天..." could capture a whole clause.
  const label='(?:平台|渠道|商户|品牌|项目|用户名|昵称|名字|名称|代号)';
  for(const match of source.matchAll(new RegExp(
    label+'\\s*[:：]\\s*[「“【]([\\p{Script=Han}]{2,8})[」”】]','gu')))add(match[1]);
  // Bare labels are safest only when the value is one independent Chinese
  // lexical token; otherwise "平台：星河今天来过" looks like a whole sentence.
  const segmenter=new Intl.Segmenter('zh-Hans',{granularity:'word'});
  for(const match of source.matchAll(new RegExp(
    label+'\\s*[:：]\\s*([\\p{Script=Han}]{2,8})(?=\\s|[,，。；;、]|$)','gu'))){
    const words=[...segmenter.segment(match[1])].filter(item=>item.isWordLike);
    if(words.length===1&&words[0].segment===match[1])add(match[1]);
  }
  // A generic high-signal pattern in informal operational messages. The
  // identifier and time boundary reduce false positives; common nouns remain
  // unprotected. Claude can still classify ordinary words independently.
  for(const match of source.matchAll(
    /[A-Z]{1,8}\d[A-Z\d]*[^。！？\n]{0,40}?(?:多出(?:来)?的)([\p{Script=Han}]{2,6})(?=晚上|下午|早上|今天|明天|后天|昨天|上午|中午)/gu))add(match[1]);
  return [...found];
}

// Claude suggestions are not verified glossary definitions. Keep only
// literal Chinese spans from the current source, never generated names.
function sanitizeProperNames(raw,sourceText,approvedTerms=[],max=12){
  if(!Array.isArray(raw))return [];
  const source=String(sourceText||'');
  const approved=new Set((approvedTerms||[]).map(t=>String(t.source||'')));
  const unique=new Set(),names=[];
  for(const candidate of raw.slice(0,24)){
    const name=typeof candidate==='string'?candidate.trim():'';
    if(!safeSourceName(source,name)||GENERIC_WORDS.has(name)||
      [...approved].some(x=>x===name||x.includes(name)||name.includes(x))||
      unique.has(name))continue;
    unique.add(name);
    names.push(name);
    if(names.length>=max)break;
  }
  return names;
}

function missingProtectedNames(translation,names){
  const target=String(translation||'');
  return (names||[]).filter(name=>!target.includes(name));
}

module.exports={NAME_PRESERVATION_RULES,V2_NAME_RULES,extractSourceNames,
  sanitizeProperNames,missingProtectedNames};
