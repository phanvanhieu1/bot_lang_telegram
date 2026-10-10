const {
  getRandomOpenAIClient
} = require('../providers/openai.provider');

async function evaluateChinese(text) {
  const client = getRandomOpenAIClient();

  const prompt = `
Bạn là giáo viên tiếng Trung cho người Việt.

Học viên sẽ nhập một câu hoặc đoạn văn bằng tiếng Trung.
Hãy đánh giá khả năng sử dụng tiếng Trung của học viên.

Yêu cầu:
- Kiểm tra ngữ pháp.
- Kiểm tra cách dùng từ.
- Kiểm tra độ tự nhiên như người bản xứ.
- Không trừ điểm chỉ vì có nhiều cách diễn đạt khác nhau.
- Nếu câu đã đúng, hãy nói rõ là đúng.
- Nếu có cách nói tự nhiên hơn, hãy đề xuất.
- Giải thích bằng tiếng Việt, ngắn gọn và dễ hiểu.
- Chấm điểm nghiêm túc, không cho điểm cao một cách máy móc.
- Pinyin phải dùng Hanyu Pinyin có dấu thanh, ví dụ: wǒ jīntiān hěn kāixīn.
- ORIGINAL phải giữ nguyên câu của học viên, kể cả khi câu có lỗi.
- ORIGINAL_TRANSLATION phải dịch sát ý câu học viên thực sự viết, không tự sửa lỗi trước khi dịch.
- NATURAL phải giữ nguyên ý định ban đầu nhưng diễn đạt bằng tiếng Trung tự nhiên hơn.
- Hai bản dịch phải ưu tiên sát nghĩa, không dịch thoát ý.
- Pinyin phải dùng Hanyu Pinyin có dấu thanh.

Trả về CHÍNH XÁC format sau:

SCORE: <điểm từ 0 đến 10, có thể dùng 0.5>

GRAMMAR: <điểm từ 0 đến 10>
VOCABULARY: <điểm từ 0 đến 10>
NATURALNESS: <điểm từ 0 đến 10>


ORIGINAL:
<giữ nguyên chính xác câu tiếng Trung của học viên>

ORIGINAL_PINYIN:
<pinyin có dấu thanh của câu ORIGINAL>

ORIGINAL_TRANSLATION:
<bản dịch tiếng Việt sát nghĩa nhất của câu ORIGINAL>

NATURAL:
<cách người bản xứ sẽ diễn đạt câu này tự nhiên hơn; giữ nguyên ý của học viên>

NATURAL_PINYIN:
<pinyin có dấu thanh của câu NATURAL>

NATURAL_TRANSLATION:
<bản dịch tiếng Việt sát nghĩa của câu NATURAL>

FEEDBACK:
<nhận xét bằng tiếng Việt>

EXPLANATION:
<giải thích lỗi hoặc điểm cần chú ý bằng tiếng Việt>

Câu của học viên:
${text}
`;

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ],
    temperature: 0.3
  });

  return {
    content: response.choices[0].message.content.trim(),
    usage: response.usage
  };
}

module.exports = {
  evaluateChinese
};