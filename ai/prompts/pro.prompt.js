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
    context = 'auto',
    telegramMode = false
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
    if (telegramMode) {
      systemPrompt += `

QUY TẮC DỊCH NGƯỢC CHO TELEGRAM:
- Dịch ngược chính BẢN DỊCH ĐÃ CÓ sang ngôn ngữ của NGUYÊN VĂN.
- Nếu BẢN DỊCH ĐÃ CÓ là tiếng Trung, BACK_TRANSLATION phải là tiếng Việt.
- Nếu BẢN DỊCH ĐÃ CÓ là tiếng Việt, BACK_TRANSLATION phải là tiếng Trung.
- Không dịch lại phần TRANSLATION, không thêm Pinyin, giải thích, từ vựng.`;
    } else {
      systemPrompt += `

QUY TẮC DỊCH NGƯỢC:
- Chỉ tạo BACK_TRANSLATION khi NGUYÊN VĂN là tiếng Việt và BẢN DỊCH ĐÃ CÓ là tiếng Trung.
- Dịch chính BẢN DỊCH ĐÃ CÓ từ tiếng Trung ngược lại sang tiếng Việt.
- Phải dựa vào câu tiếng Trung trong BẢN DỊCH ĐÃ CÓ, không được dùng NGUYÊN VĂN tiếng Việt để tạo kết quả.
- Nếu NGUYÊN VĂN không phải tiếng Việt hoặc BẢN DỊCH ĐÃ CÓ không phải tiếng Trung, để BACK_TRANSLATION trống.
- BACK_TRANSLATION chỉ chứa tiếng Việt, không chứa Pinyin, từ vựng hoặc giải thích.`;
    }
  }

  if (vocabulary) {
    systemPrompt += `

Phân tích nội dung tiếng Trung thành ba nhóm học tập:
- [WORD]: từ đơn hoặc từ ghép có ý nghĩa; tối đa 8 mục.
- [PHRASE]: cụm từ thông dụng hoặc kết hợp từ quan trọng; tối đa 5 mục.
- [PATTERN]: cấu trúc ngữ pháp thực sự xuất hiện; tối đa 4 mẫu, diễn đạt ngắn gọn bằng A/B nếu cần.
- Nếu NGUYÊN VĂN là tiếng Trung, lấy mục từ NGUYÊN VĂN.
- Nếu BẢN DỊCH ĐÃ CÓ là tiếng Trung, lấy mục từ BẢN DỊCH ĐÃ CÓ.
- Mỗi mục phải có nghĩa hoặc cách dùng tiếng Việt rõ ràng, chính xác.
- Tuyệt đối không liệt kê từ/cụm không có trong câu hoặc mẫu câu không áp dụng cho câu.
- Không tạo tên riêng, mã định danh hay mẫu giả. Không Pinyin.
- Không giải thích ngoài định dạng.`;
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
- [WORD] 中文词 : nghĩa tiếng Việt
- [PHRASE] 中文短语 : nghĩa tiếng Việt
- [PATTERN] A + 结构 + B : giải thích mẫu câu bằng tiếng Việt
Chỉ đưa các dòng có nội dung thật; không ghi tiêu đề nhóm hoặc Pinyin.`;
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
    if (telegramMode) {
      systemPrompt += `

DỊCH NGƯỢC CHO TELEGRAM:
- Luôn tạo BACK_TRANSLATION bằng cách dịch NGƯỢC chính nội dung TRANSLATION về ngôn ngữ của câu đầu vào.
- Nếu đầu vào là tiếng Việt: TRANSLATION bằng tiếng Trung, BACK_TRANSLATION bằng tiếng Việt.
- Nếu đầu vào là tiếng Trung: TRANSLATION bằng tiếng Việt, BACK_TRANSLATION bằng tiếng Trung.
- Không chép lại TRANSLATION hoặc trộn Pinyin vào BACK_TRANSLATION.
- BACK_TRANSLATION chỉ chứa câu được dịch ngược, không kèm chú thích.`;
    } else {
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
  }

  if (vocabulary) {
    systemPrompt += `

QUY TẮC TỪ VỰNG, CỤM TỪ VÀ MẪU CÂU:
- Chỉ phân tích nội dung tiếng Trung (nguyên văn nếu là tiếng Trung, ngược lại là bản dịch).
- [WORD]: chọn tối đa 8 từ đơn/từ ghép hữu ích.
- [PHRASE]: chọn tối đa 5 cụm từ tự nhiên, hữu ích cho giao tiếp.
- [PATTERN]: chọn tối đa 4 mẫu ngữ pháp có thật trong câu; có thể dùng ký hiệu A/B.
- Với mỗi mục, cung cấp nghĩa tiếng Việt ngắn gọn, sát ngữ cảnh.
- Chỉ chọn những mục thật sự xuất hiện hoặc mẫu cấu trúc thật sự được sử dụng.
- Không liệt kê toàn bộ câu dài thành một cụm từ, không sáng tạo thêm cấu trúc.
- Không ghi Pinyin, chủ đề công việc/đời sống hay đánh giá tần suất; những phần đó do website xử lý.`;
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
- [WORD] 中文词 : nghĩa tiếng Việt
- [PHRASE] 中文短语 : nghĩa tiếng Việt
- [PATTERN] A + 结构 + B : giải thích mẫu câu bằng tiếng Việt
Chỉ đưa các dòng có nội dung thật; không ghi tiêu đề nhóm hoặc Pinyin.`;
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