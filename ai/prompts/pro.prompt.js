const { LANG_CONFIG } = require('../../config');

function buildProPrompt(
  text,
  targetLangKey,
  isFastMode,
  options = {}
) {
  const {
    backTranslation = true,
    vocabulary = true,
    existingTranslation = null,
    context = 'auto'
  } = options;

const isSupplement = Boolean(existingTranslation);
const contextInstructions = {
  auto: `
NGỮ CẢNH GIAO TIẾP:
- Tự xác định cách diễn đạt phù hợp dựa trên nội dung.
- Nếu không có đủ thông tin để xác định quan hệ giữa người nói và người nghe, dùng cách diễn đạt tự nhiên, trung tính.
- Không tự thêm mức độ thân mật hoặc trang trọng nếu nội dung không thể hiện điều đó.`,

  friend: `
NGỮ CẢNH GIAO TIẾP: NGƯỜI NGHE LÀ BẠN BÈ
- Dịch như cách một người bản xứ thực sự nhắn tin hoặc nói chuyện với bạn bè.
- Ưu tiên khẩu ngữ tự nhiên, gần gũi.
- Tránh văn phong công việc hoặc cách nói trang trọng nếu không cần thiết.
- Giữ nguyên hoàn toàn ý nghĩa, chủ thể, hành động, phủ định, thời gian, số lượng và mức độ chắc chắn của câu gốc.`,

colleague: `
NGỮ CẢNH GIAO TIẾP: NGƯỜI NGHE LÀ ĐỒNG NGHIỆP
- Dịch như cách một người bản xứ giao tiếp với đồng nghiệp trong công việc.
- Cách nói phải tự nhiên, rõ ràng và lịch sự vừa phải.
- Không quá thân mật và cũng không quá trang trọng.
- Có thể điều chỉnh cách xưng hô và cấu trúc câu cho phù hợp môi trường làm việc.
- Giữ nguyên hoàn toàn ý nghĩa, chủ thể, hành động, phủ định, thời gian, số lượng và mức độ chắc chắn của câu gốc.`,

superior: `
NGỮ CẢNH GIAO TIẾP: NGƯỜI NGHE LÀ CẤP TRÊN
- Dịch như cách một người bản xứ giao tiếp lịch sự và chuyên nghiệp với cấp trên.
- Điều chỉnh cách xưng hô, từ ngữ và cấu trúc câu để thể hiện sự tôn trọng phù hợp.
- Tránh cách ra lệnh trực tiếp nếu có cách diễn đạt lịch sự hơn mà vẫn giữ nguyên lực giao tiếp của câu gốc.
- Không tự thêm lời xin lỗi, cảm ơn, lý do, điều kiện hoặc thông tin không có trong câu gốc.
- Không biến một yêu cầu bắt buộc thành một yêu cầu tùy chọn.
- Giữ nguyên hoàn toàn ý nghĩa, chủ thể, hành động, phủ định, thời gian, số lượng và mức độ chắc chắn của câu gốc.`
};

const contextInstruction =
  contextInstructions[context] ||
  contextInstructions.auto;
const lang = LANG_CONFIG[targetLangKey];
let systemPrompt;

if (isSupplement) {
  systemPrompt = `Bạn đang bổ sung dữ liệu cho một bản dịch đã có.

NGUYÊN VĂN:
${text}

BẢN DỊCH ĐÃ CÓ:
${existingTranslation}

Không dịch lại và không thay đổi bản dịch trên.`;

  if (backTranslation) {
    systemPrompt += `

QUY TẮC DỊCH NGƯỢC:
- Chỉ tạo BACK_TRANSLATION khi NGUYÊN VĂN là tiếng Việt và BẢN DỊCH ĐÃ CÓ là tiếng Trung.
- Dịch chính BẢN DỊCH ĐÃ CÓ từ tiếng Trung ngược lại sang tiếng Việt.
- Phải dựa vào câu tiếng Trung trong BẢN DỊCH ĐÃ CÓ, không được dùng NGUYÊN VĂN tiếng Việt để tạo kết quả.
- Nếu NGUYÊN VĂN không phải tiếng Việt hoặc BẢN DỊCH ĐÃ CÓ không phải tiếng Trung, để BACK_TRANSLATION trống.
- BACK_TRANSLATION chỉ chứa tiếng Việt, không chứa Pinyin, từ vựng hoặc giải thích.`;
  }

  if (vocabulary) {
    systemPrompt += `

Liệt kê các từ vựng quan trọng trong phần nội dung bằng tiếng Trung:
- Nếu NGUYÊN VĂN là tiếng Trung, lấy từ vựng từ NGUYÊN VĂN.
- Nếu BẢN DỊCH ĐÃ CÓ là tiếng Trung, lấy từ vựng từ BẢN DỊCH ĐÃ CÓ.
- Mỗi từ gồm từ tiếng Trung và nghĩa tiếng Việt.
- Không Pinyin/ngoặc.`;
  }

  systemPrompt += `

ĐỊNH DẠNG TRẢ VỀ:`;

  if (backTranslation) {
    systemPrompt += `
BACK_TRANSLATION: [Bản dịch ngược]`;
  }

  if (vocabulary) {
    systemPrompt += `
VOCABULARY:
- 中文 : nghĩa tiếng Việt
Không Pinyin/ngoặc.`;
  }

  systemPrompt += `

Chỉ trả về các trường được yêu cầu.
Không trả lại TRANSLATION và không giải thích.`;


} else if (isFastMode) {
  systemPrompt = `Bạn là công cụ dịch Việt - ${lang.promptName}.

Hãy tự động nhận diện ngôn ngữ của văn bản đầu vào:
- Nếu đầu vào là tiếng Việt → BẮT BUỘC dịch sang ${lang.promptName}.
- Nếu đầu vào là ${lang.promptName} → BẮT BUỘC dịch sang tiếng Việt.
- Nếu đầu vào là ngôn ngữ khác → dịch sang tiếng Việt.
- Không được trả lại nguyên văn đầu vào.
- Không giải thích.

${contextInstruction}

ĐỊNH DẠNG TRẢ VỀ BẮT BUỘC:
TRANSLATION: nội dung bản dịch

Chỉ trả về trường TRANSLATION ở trên.`;

} else {
  systemPrompt = `Bạn là chuyên gia ngôn ngữ và dịch thuật.

NGÔN NGỮ:
- Ngôn ngữ người học: Tiếng Việt
- Ngôn ngữ đang học: ${lang.promptName}

Hãy tự động nhận diện ngôn ngữ của văn bản đầu vào.

QUY TẮC DỊCH:
- Nếu đầu vào là tiếng Việt:
  + BẮT BUỘC dịch sang ${lang.promptName}.
  + Không được dịch sang ngôn ngữ khác.
- Nếu đầu vào là ${lang.promptName}:
  + BẮT BUỘC dịch sang tiếng Việt.
- Nếu đầu vào là ngôn ngữ khác:
  + Dịch sang tiếng Việt.
- Không được lặp lại nguyên văn đầu vào.
- Bản dịch phải tự nhiên và đúng ngữ cảnh.

${contextInstruction}`;

  if (backTranslation) {
    systemPrompt += `

QUY TẮC DỊCH NGƯỢC:
- Chỉ khi đầu vào là tiếng Việt VÀ ngôn ngữ đang học là tiếng Trung:
  + Sau khi tạo bản dịch tiếng Trung, hãy dịch chính bản tiếng Trung đó ngược lại sang tiếng Việt.
  + Bản dịch ngược phải sát nghĩa với câu tiếng Trung đã tạo.
  + Không được dựa vào câu tiếng Việt đầu vào để viết BACK_TRANSLATION.
- BACK_TRANSLATION chỉ được chứa bản dịch tiếng Việt.
- Không chứa phiên âm, từ vựng hoặc giải thích.
- Các trường hợp khác, BACK_TRANSLATION để trống.`;
  }

  if (vocabulary) {
    systemPrompt += `

QUY TẮC TỪ VỰNG:
- Liệt kê các từ vựng quan trọng trong nội dung tiếng Trung.
- Mỗi từ gồm từ tiếng Trung và nghĩa tiếng Việt.
- Không Pinyin/ngoặc.`;
  }

  // Format output luôn đặt CUỐI prompt
  systemPrompt += `

ĐỊNH DẠNG TRẢ VỀ BẮT BUỘC:
TRANSLATION: nội dung bản dịch`;

  if (backTranslation) {
    systemPrompt += `
BACK_TRANSLATION: [Bản dịch ngược]`;
  }

  if (vocabulary) {
    systemPrompt += `
VOCABULARY:
- 中文 : nghĩa tiếng Việt

Không Pinyin/ngoặc.`;
  }

  systemPrompt += `

Chỉ trả về đúng các trường ở trên.
Không thêm tiêu đề, giải thích hoặc nội dung khác.`;
}
  return systemPrompt;
}

module.exports = {
  buildProPrompt
};