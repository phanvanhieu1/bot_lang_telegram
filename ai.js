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
  returnUsage = false
) {
  const lang = LANG_CONFIG[targetLangKey];
  const systemPrompt = isFastMode
  ? `Bạn là công cụ dịch Việt - ${lang.promptName}.

Hãy tự động nhận diện ngôn ngữ của văn bản đầu vào:
- Nếu đầu vào là tiếng Việt → dịch sang ${lang.promptName}.
- Nếu đầu vào là ${lang.promptName} → dịch sang tiếng Việt.
- Không được trả lại nguyên văn đầu vào.
- Chỉ trả về bản dịch.`
  : `Bạn là chuyên gia ngôn ngữ và dịch thuật.

NGÔN NGỮ:
- Ngôn ngữ người học: Tiếng Việt
- Ngôn ngữ đang học: ${lang.promptName}

Hãy tự động nhận diện ngôn ngữ của văn bản đầu vào.

QUY TẮC DỊCH:
- Tiếng Việt → dịch sang ${lang.promptName}.
- ${lang.promptName} → dịch sang tiếng Việt.
- Nếu đầu vào là ngôn ngữ khác, hãy dịch sang tiếng Việt.
- Không được lặp lại nguyên văn đầu vào.
- Bản dịch phải tự nhiên và đúng ngữ cảnh.

QUY TẮC PHIÊN ÂM:
- Nếu ${lang.promptName} là tiếng Trung, PRONUNCIATION bắt buộc phải là Pinyin.
- Pinyin phải có dấu thanh, ví dụ: nǐ hǎo, wǒ ài nǐ.
- Khi dịch Việt → Trung, PRONUNCIATION là Pinyin của câu tiếng Trung vừa dịch.
- Khi dịch Trung → Việt, PRONUNCIATION vẫn phải là Pinyin của câu tiếng Trung gốc.
- Tuyệt đối không viết PRONUNCIATION bằng tiếng Việt.
- Không dịch nội dung sang tiếng Việt trong trường PRONUNCIATION.

Định dạng BẮT BUỘC:
TRANSLATION: [Bản dịch]
PRONUNCIATION: [Pinyin]
VOCABULARY:
- [Từ vựng] : [Nghĩa]`;

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

module.exports = { translateFull, transcribeVoice, generateSpeech };