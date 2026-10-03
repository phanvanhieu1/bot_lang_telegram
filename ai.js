const OpenAI = require('openai');
const axios = require('axios');
const fs = require('fs');
const { LANG_CONFIG, VOICES } = require('./config');

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

// 1. Tách chuỗi API keys từ .env thành một mảng
const OPENAI_KEYS_ARRAY = process.env.OPENAI_API_KEYS 
  ? process.env.OPENAI_API_KEYS.split(',').map(key => key.trim()) 
  : [];

// 2. Hàm lấy ngẫu nhiên 1 client OpenAI
function getRandomOpenAIClient() {
  if (OPENAI_KEYS_ARRAY.length === 0) {
    throw new Error('❌ Không tìm thấy OPENAI_API_KEYS trong file .env');
  }
  const randomIndex = Math.floor(Math.random() * OPENAI_KEYS_ARRAY.length);
  const selectedKey = OPENAI_KEYS_ARRAY[randomIndex];
  return new OpenAI({ apiKey: selectedKey });
}

// 3. CORE 1: Dịch thuật & Phân tích ảnh có FAILOVER (Chống sập)
// Thêm tham số `history` vào hàm
async function translateFull(
  text,
  targetLangKey,
  isFastMode,
  imageUrl = null,
  history = [],
  returnUsage = false,
  options = {}
) {
  const {
  backTranslation = true,
  pronunciation = true,
  vocabulary = true,
  existingTranslation = null
} = options;
const isSupplement = Boolean(existingTranslation);
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

  if (pronunciation) {
    systemPrompt += `

Tạo phiên âm cho phần nội dung bằng tiếng Trung:
- Nếu NGUYÊN VĂN là tiếng Trung, phiên âm NGUYÊN VĂN.
- Nếu BẢN DỊCH ĐÃ CÓ là tiếng Trung, phiên âm BẢN DỊCH ĐÃ CÓ.
- Dùng Pinyin có dấu thanh.
- Chỉ trả về phiên âm trong PRONUNCIATION.`;
  }

  if (vocabulary) {
    systemPrompt += `

Liệt kê các từ vựng quan trọng trong phần nội dung bằng tiếng Trung:
- Nếu NGUYÊN VĂN là tiếng Trung, lấy từ vựng từ NGUYÊN VĂN.
- Nếu BẢN DỊCH ĐÃ CÓ là tiếng Trung, lấy từ vựng từ BẢN DỊCH ĐÃ CÓ.
- Mỗi từ gồm từ tiếng Trung và nghĩa tiếng Việt.`;
  }

  systemPrompt += `

ĐỊNH DẠNG TRẢ VỀ:`;

  if (backTranslation) {
    systemPrompt += `
BACK_TRANSLATION: [Bản dịch ngược]`;
  }

  if (pronunciation) {
    systemPrompt += `
PRONUNCIATION: [Phiên âm]`;
  }

  if (vocabulary) {
    systemPrompt += `
VOCABULARY:
- [Từ vựng] : [Nghĩa]`;
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

ĐỊNH DẠNG TRẢ VỀ BẮT BUỘC:
TRANSLATION: [Bản dịch]

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
- Bản dịch phải tự nhiên và đúng ngữ cảnh.`;

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

  if (pronunciation) {
    systemPrompt += `

QUY TẮC PHIÊN ÂM:
- Nếu ${lang.promptName} là tiếng Trung, PRONUNCIATION bắt buộc phải là Pinyin.
- Pinyin phải có dấu thanh.
- Khi dịch Việt → Trung, PRONUNCIATION là Pinyin của câu tiếng Trung vừa dịch.
- Khi dịch Trung → Việt, PRONUNCIATION vẫn là Pinyin của câu tiếng Trung gốc.
- PRONUNCIATION chỉ chứa phiên âm.
- Không chứa bản dịch hoặc từ vựng.`;
  }

  if (vocabulary) {
    systemPrompt += `

QUY TẮC TỪ VỰNG:
- Liệt kê các từ vựng quan trọng trong nội dung tiếng Trung.
- Mỗi từ gồm từ tiếng Trung và nghĩa tiếng Việt.`;
  }

  // Format output luôn đặt CUỐI prompt
  systemPrompt += `

ĐỊNH DẠNG TRẢ VỀ BẮT BUỘC:
TRANSLATION: [Bản dịch]`;

  if (backTranslation) {
    systemPrompt += `
BACK_TRANSLATION: [Bản dịch ngược]`;
  }

  if (pronunciation) {
    systemPrompt += `
PRONUNCIATION: [Phiên âm]`;
  }

  if (vocabulary) {
    systemPrompt += `
VOCABULARY:
- [Từ vựng] : [Nghĩa]`;
  }

  systemPrompt += `

Chỉ trả về đúng các trường ở trên.
Không thêm tiêu đề, giải thích hoặc nội dung khác.`;
}

  const userContent = [];
  if (text) userContent.push({ type: 'text', text: text });
  if (imageUrl) {
    userContent.push({ type: 'text', text: 'Dịch văn bản trong ảnh.' });
    userContent.push({ type: 'image_url', image_url: { url: imageUrl } });
  }

  // BƠM NGỮ CẢNH VÀO MẢNG MESSAGES
  const messages = [{ role: 'system', content: systemPrompt }];
  
  // Đưa 5 tin nhắn lịch sử vào để bot nhớ
  history.forEach(h => {
    messages.push({ role: 'user', content: h.user });
    messages.push({ role: 'assistant', content: h.bot });
  });

  messages.push({ role: 'user', content: userContent });

  let attempts = 0;
  const maxAttempts = OPENAI_KEYS_ARRAY.length;

  while (attempts < maxAttempts) {
    try {
      const openai = getRandomOpenAIClient();
      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: messages, // Đã bao gồm cả system, history và tin nhắn mới
        temperature: 0.3,
      });
      const content = response.choices[0].message.content.trim();

if (returnUsage) {
  return {
    content,
    usage: response.usage
  };
}

return content;
    } catch (error) {
      attempts++;
      if (attempts >= maxAttempts) throw new Error('❌ Hết Key.');
    }
  }
}

// 4. CORE 2: Nhận diện giọng nói (Whisper) có FAILOVER (Chống sập)
async function transcribeVoice(filePath) {
  let attempts = 0;
  const maxAttempts = OPENAI_KEYS_ARRAY.length;

  while (attempts < maxAttempts) {
    try {
      const openai = getRandomOpenAIClient();
      console.log(`[Whisper] Thử (Lần ${attempts + 1}/${maxAttempts}) bằng Key: ${openai.apiKey.substring(0, 12)}...`);
      
      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(filePath),
        model: 'whisper-1',
      });
      
      return transcription.text.trim(); // Thành công trả về text
      
    } catch (error) {
      attempts++;
      console.error(`[LỖI WHISPER] Key bị lỗi/hết tiền: ${error.message}`);
      
      if (attempts >= maxAttempts) {
        throw new Error('❌ Đã thử hết toàn bộ API Keys nhưng Whisper đều thất bại.');
      }
      console.log(`⏳ Tự động đổi sang Key khác cho Whisper...`);
    }
  }
}

// 5. Sinh giọng đọc (Giữ nguyên)
async function generateSpeech(text, voiceKey, speed) {
  const res = await axios.post(`https://api.elevenlabs.io/v1/text-to-speech/${VOICES[voiceKey]?.id || VOICES.sarah.id}`, 
    { text, model_id: 'eleven_turbo_v2_5', voice_settings: { stability: 0.5, similarity_boost: 0.8, speed } }, 
    { headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json' }, responseType: 'arraybuffer' });
  return Buffer.from(res.data);
}

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
  translateFull,
  transcribeVoice,
  generateSpeech,
  evaluateChinese
};