const {
  getRandomOpenAIClient
} = require('../providers/openai.provider');
const { DOMAIN_CONTEXT_RULES, audienceGuidance } = require('../prompts/context.rules');

async function verifyTranslation(
  original,
  translation,
  context = 'auto'
) {
  const client = getRandomOpenAIClient();

  const contextNames = {
    auto: 'Tự động',
    friend: 'Bạn bè',
    colleague: 'Đồng nghiệp',
    superior: 'Cấp trên'
  };

  const contextName =
    contextNames[context] || contextNames.auto;

  const prompt = `
Bạn là chuyên gia kiểm định chất lượng bản dịch.

Nhiệm vụ của bạn là KIỂM TRA bản dịch, KHÔNG dịch lại và KHÔNG đề xuất một bản dịch khác chỉ vì khác phong cách.

NGUYÊN VĂN:
${original}

BẢN DỊCH:
${translation}

NGỮ CẢNH GIAO TIẾP:
${contextName}
${audienceGuidance(context)}

${DOMAIN_CONTEXT_RULES}

Hãy kiểm tra nghiêm ngặt xem BẢN DỊCH có giữ nguyên ý nghĩa của NGUYÊN VĂN hay không.

Đặc biệt kiểm tra:
- Có bỏ sót thông tin không.
- Có tự thêm thông tin không có trong nguyên văn không.
- Chủ thể và đối tượng có đúng không.
- Hành động có đúng không.
- Phủ định có bị thay đổi không.
- Thời gian, ngày tháng, con số, số lượng có đúng không.
- Mức độ chắc chắn có bị thay đổi không.
- Yêu cầu, mệnh lệnh, đề nghị hoặc câu hỏi có bị làm mạnh hơn hoặc nhẹ đi không.
- Có bỏ sót mệnh đề điều kiện hoặc động từ yêu cầu cuối câu Trung (ví dụ 说下, 反馈, 处理下) không.
- Có hiểu nhầm thuật ngữ vận hành game, giao dịch, quay thưởng, hoặc IT thành nghĩa đời thường (và ngược lại) khi ngữ cảnh đã rõ không.
- Không kết luận thiếu nội dung nếu nguyên văn vốn lược bỏ chủ thể hoặc mơ hồ; chỉ chấm theo thông tin hiện có.
- Cách xưng hô và mức độ lịch sự có phù hợp với ngữ cảnh giao tiếp không.

Không đánh dấu lỗi chỉ vì:
- Hai ngôn ngữ có cấu trúc câu khác nhau.
- Có nhiều cách diễn đạt tự nhiên khác nhau.
- Bản dịch không dịch từng từ một nhưng vẫn giữ đúng nghĩa.

STATUS:
- PASS: đúng nghĩa, không có vấn đề đáng kể.
- WARNING: có vấn đề nhỏ nhưng người đọc vẫn hiểu đúng ý chính.
- FAIL: sai nghĩa, mất/thêm thông tin quan trọng hoặc có nguy cơ gây hiểu nhầm.

CONFIDENCE:
- Số nguyên từ 0 đến 100 thể hiện mức độ tin cậy rằng bản dịch truyền đạt chính xác nguyên văn.
- Đây là điểm chất lượng/ngữ nghĩa của bản dịch, không phải mức độ tự tin của bạn khi trả lời.

Chỉ trả về JSON hợp lệ theo đúng cấu trúc sau, không dùng Markdown và không thêm nội dung bên ngoài JSON:

{
  "status": "PASS",
  "confidence": 100,
  "issues": [],
  "message": "Nhận xét ngắn gọn bằng tiếng Việt"
}
`;

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ],
    temperature: 0
  });

  const content =
    response.choices[0]?.message?.content?.trim();

  if (!content) {
    throw new Error('Verification response is empty');
  }

  const cleaned = content
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  const verification = JSON.parse(cleaned);

  return {
    verification,
    usage: response.usage
  };
}

module.exports = {
  verifyTranslation
};