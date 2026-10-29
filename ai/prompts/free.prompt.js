const {contextPolicy}=require('./context-policy');
function containsChinese(text) {
  return /[\u3400-\u9FFF]/u.test(text || '');
}

const TRANSLATION_RULES = `QUY TẮC DỊCH VÀ NGỮ CẢNH:
- Dịch chính xác ý định giao tiếp và nội dung của toàn câu, không ghép nghĩa máy móc từng từ.
- Ưu tiên cách diễn đạt tự nhiên mà người bản xứ thực sự sử dụng trong hội thoại, tin nhắn và đời sống hằng ngày.
- Chỉ tự suy luận ngữ cảnh giao tiếp khi người dùng chọn Tự động. Khi họ đã chọn thủ công, giữ đúng quan hệ đó; không tự thay đổi.
- Nhận diện từ xưng hô, tiếng lóng, thành ngữ và cách gọi thân mật theo chức năng trong ngữ cảnh; không mặc định dịch thành quan hệ gia đình hoặc chức danh theo nghĩa đen.
- Ví dụ về nguyên tắc: 兄弟 dùng để gọi bạn bè có thể là “người anh em” hoặc “ông bạn”; khi thực sự nói về anh/em trai trong gia đình thì dịch theo quan hệ gia đình. Không áp dụng một cách dịch cố định cho mọi trường hợp.
- Giữ nguyên chủ thể, hành động, phủ định, thời gian, số lượng, mức độ chắc chắn, sắc thái cảm xúc và ý nghĩa của câu gốc.
- Không tự thêm lời xin lỗi, cảm ơn, lý do, điều kiện hoặc thông tin không có trong câu gốc.
- Có thể điều chỉnh trật tự từ, cách xưng hô và dấu câu để bản dịch mượt mà, nhưng không làm thay đổi ý nghĩa.
- Nếu câu gốc có nhiều cách hiểu mà thiếu ngữ cảnh, chọn cách hiểu thông dụng và ít suy diễn nhất.
- Không giải thích, không Markdown, không thêm nội dung khác.`;

function buildFreePrompt(text,context='auto') {
  const inputIsChinese = containsChinese(text);

  if (inputIsChinese) {
    return `
Bạn là chuyên gia dịch thuật Trung-Việt, chuyên về ngôn ngữ giao tiếp tự nhiên.

Dịch nội dung tiếng Trung sau sang tiếng Việt.

${TRANSLATION_RULES}

${contextPolicy(context)}

ĐỊNH DẠNG TRẢ VỀ BẮT BUỘC:
TRANSLATION: <bản dịch tiếng Việt>

Chỉ trả về đúng một trường TRANSLATION.

Nội dung tiếng Trung:
${text}
`.trim();
  }

  return `
Bạn là chuyên gia dịch thuật Việt-Trung, chuyên về ngôn ngữ giao tiếp tự nhiên.

Dịch nội dung tiếng Việt sau sang tiếng Trung giản thể.

${TRANSLATION_RULES}

${contextPolicy(context)}

- Sử dụng tiếng Trung giản thể, cấu trúc và cách nói tự nhiên của người bản xứ.

QUY TRÌNH TRONG MỘT LẦN TRẢ LỜI:
1. Dịch câu tiếng Việt sang tiếng Trung giản thể, tự nhiên và đúng ngữ cảnh.
2. Đọc lại CHỈ câu tiếng Trung vừa tạo, rồi dịch nó sang tiếng Việt để đối chiếu ý nghĩa. Không sao chép nguyên câu tiếng Việt đầu vào làm bản dịch ngược.
3. Tự kiểm tra bản dịch ngược có giữ nguyên ý nghĩa, phủ định, chủ thể và sắc thái hay không. Nếu chưa chính xác, tự chỉnh bản dịch tiếng Trung và bản dịch ngược trước khi trả lời.
4. Hoàn thành cả hai bước nội bộ trong cùng một phản hồi; không yêu cầu gọi API lần hai.

ĐỊNH DẠNG TRẢ VỀ BẮT BUỘC (đúng hai dòng, không thêm giải thích):
TRANSLATION: <bản dịch tiếng Trung giản thể>
BACK_TRANSLATION: <dịch ngược sang tiếng Việt từ chính câu tiếng Trung trên>

Nội dung tiếng Việt:
${text}
`.trim();
}

function buildBackTranslationPrompt(chineseText) {
  return `
Bạn là chuyên gia dịch thuật Trung-Việt.

Dịch chính xác nội dung tiếng Trung sau sang tiếng Việt. Đây là bước dịch ngược để người học đối chiếu ý nghĩa của câu tiếng Trung đã tạo.

${TRANSLATION_RULES}

- Chỉ dựa vào câu tiếng Trung được cung cấp; không phỏng đoán hoặc khôi phục một câu tiếng Việt gốc không được cung cấp.

ĐỊNH DẠNG TRẢ VỀ BẮT BUỘC:
TRANSLATION: <bản dịch tiếng Việt>

Chỉ trả về đúng một trường TRANSLATION.

Nội dung tiếng Trung:
${chineseText}
`.trim();
}

module.exports = {
  containsChinese,
  buildFreePrompt,
  buildBackTranslationPrompt
};
