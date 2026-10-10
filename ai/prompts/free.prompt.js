function containsChinese(text) {
  return /[\u3400-\u9FFF]/u.test(text || '');
}

const TRANSLATION_RULES = `QUY TẮC DỊCH VÀ NGỮ CẢNH:
- Dịch chính xác ý định giao tiếp và nội dung của toàn câu, không ghép nghĩa máy móc từng từ.
- Ưu tiên cách diễn đạt tự nhiên mà người bản xứ thực sự sử dụng trong hội thoại, tin nhắn và đời sống hằng ngày.
- Tự suy luận ngữ cảnh từ chính câu gốc. Khi không đủ thông tin về quan hệ giữa người nói và người nghe, chọn cách diễn đạt trung tính, không tự thêm mức độ thân mật hoặc trang trọng.
- Nhận diện từ xưng hô, tiếng lóng, thành ngữ và cách gọi thân mật theo chức năng trong ngữ cảnh; không mặc định dịch thành quan hệ gia đình hoặc chức danh theo nghĩa đen.
- Ví dụ về nguyên tắc: 兄弟 dùng để gọi bạn bè có thể là “người anh em” hoặc “ông bạn”; khi thực sự nói về anh/em trai trong gia đình thì dịch theo quan hệ gia đình. Không áp dụng một cách dịch cố định cho mọi trường hợp.
- Giữ nguyên chủ thể, hành động, phủ định, thời gian, số lượng, mức độ chắc chắn, sắc thái cảm xúc và ý nghĩa của câu gốc.
- Không tự thêm lời xin lỗi, cảm ơn, lý do, điều kiện hoặc thông tin không có trong câu gốc.
- Có thể điều chỉnh trật tự từ, cách xưng hô và dấu câu để bản dịch mượt mà, nhưng không làm thay đổi ý nghĩa.
- Nếu câu gốc có nhiều cách hiểu mà thiếu ngữ cảnh, chọn cách hiểu thông dụng và ít suy diễn nhất.
- Không giải thích, không Markdown, không thêm nội dung khác.`;

function buildFreePrompt(text) {
  const inputIsChinese = containsChinese(text);

  if (inputIsChinese) {
    return `
Bạn là chuyên gia dịch thuật Trung-Việt, chuyên về ngôn ngữ giao tiếp tự nhiên.

Dịch nội dung tiếng Trung sau sang tiếng Việt.

${TRANSLATION_RULES}

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

- Sử dụng tiếng Trung giản thể, cấu trúc và cách nói tự nhiên của người bản xứ.

ĐỊNH DẠNG TRẢ VỀ BẮT BUỘC:
TRANSLATION: <bản dịch tiếng Trung giản thể>

Chỉ trả về đúng một trường TRANSLATION.

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
