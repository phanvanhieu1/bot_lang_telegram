const { LANG_CONFIG } = require('../../config');
const { DOMAIN_CONTEXT_RULES, audienceGuidance } = require('./context.rules');

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
const contextInstruction = audienceGuidance(context);
const lang = LANG_CONFIG[targetLangKey];
let systemPrompt;

if (isSupplement) {
  systemPrompt = `Bạn đang bổ sung dữ liệu cho một bản dịch đã có.

NGUYÊN VĂN:
${text}

BẢN DỊCH ĐÃ CÓ:
${existingTranslation}

Không dịch lại và không thay đổi bản dịch trên.

${DOMAIN_CONTEXT_RULES}
${contextInstruction}
- Các quy tắc ngữ cảnh chỉ dùng để hiểu ngữ nghĩa khi tạo dịch ngược / từ vựng; tuyệt đối không tự sửa TRANSLATION đã lưu.`;

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
- Không tạo tên riêng, mã định danh hay mẫu giả. Nếu không chắc mẫu ngữ pháp đúng, bỏ PATTERN đó; không cố liệt kê đủ số lượng. Không Pinyin.
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

${DOMAIN_CONTEXT_RULES}

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

${DOMAIN_CONTEXT_RULES}

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
- Không liệt kê toàn bộ câu dài thành cụm từ, không bịa mẫu cấu trúc. Nếu không chắc một PATTERN đúng, bỏ qua; không cần điền đủ số lượng.
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