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

function safeSourceName(source,name){
  return typeof name==='string'&&
    name.length>=2&&name.length<=40&&
    !/[\r\n<>]/u.test(name)&&
    /\p{Script=Han}/u.test(name)&&
    source.includes(name);
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
    if(!safeSourceName(source,name)||approved.has(name)||unique.has(name))continue;
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

module.exports={NAME_PRESERVATION_RULES,sanitizeProperNames,missingProtectedNames};
