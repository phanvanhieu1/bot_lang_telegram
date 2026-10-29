'use strict';
// One explicit-vs-automatic context contract for both translation engines.
// Context describes the intended audience, not a license to invent facts.
const VALID_CONTEXTS=new Set(['auto','friend','colleague','superior']);
const LABELS={auto:'Tự động',friend:'Bạn bè',
  colleague:'Đồng nghiệp',superior:'Cấp trên'};
function normalizeContext(value){
  return VALID_CONTEXTS.has(value)?value:'auto';
}
function contextPolicy(value){
  const context=normalizeContext(value);
  if(context==='auto')return [
    'NGỮ CẢNH: TỰ ĐỘNG (NGƯỜI DÙNG KHÔNG CHỌN THỦ CÔNG).',
    'Chỉ trong chế độ này, hãy dựa trên tín hiệu thực sự có trong câu gốc để suy luận lĩnh vực và quan hệ giao tiếp.',
    'Nếu không đủ căn cứ, dùng văn phong tự nhiên, trung tính; không tự gán người nói là bạn bè, đồng nghiệp hay cấp trên.',
    'Tên nền tảng, nhãn kênh thanh toán, mã sản phẩm có thể là tên riêng; không tự ép nghĩa từ điển khi có dấu hiệu là tên riêng.'
  ].join(' ');
  const fixed={
    friend:'NGƯỜI NGHE: BẠN BÈ. Viết tự nhiên, thân mật vừa phải, như lời nhắn giữa bạn bè.',
    colleague:'NGƯỜI NGHE: ĐỒNG NGHIỆP. Viết rõ ràng, tự nhiên, lịch sự vừa phải trong môi trường công việc.',
    superior:'NGƯỜI NGHE: CẤP TRÊN. Viết lịch sự, chuyên nghiệp, tôn trọng nhưng không làm nhẹ hoặc mạnh thêm yêu cầu.'
  }[context];
  return [
    'NGỮ CẢNH DO NGƯỜI DÙNG CHỌN THỦ CÔNG: '+LABELS[context]+'.',
    fixed,
    'BẮT BUỘC giữ ngữ cảnh giao tiếp này; KHÔNG tự suy đoán hoặc đổi quan hệ người nói/người nghe thành một lựa chọn khác.',
    'Vẫn đọc nội dung thực tế để hiểu thuật ngữ, nhưng không bịa chủ thể, vai trò, mức độ chắc chắn, lời cảm ơn, mệnh lệnh hay điều kiện.'
  ].join(' ');
}
module.exports={VALID_CONTEXTS,LABELS,normalizeContext,contextPolicy};
