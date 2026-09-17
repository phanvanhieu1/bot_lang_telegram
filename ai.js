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
async function translateFull(text, targetLangKey, isFastMode, imageUrl = null, history = []) {
  const lang = LANG_CONFIG[targetLangKey];
  const systemPrompt = isFastMode
  ? `Bạn là công cụ dịch song ngữ Việt - ${lang.promptName}.
Nếu văn bản đầu vào là tiếng Việt, hãy dịch sang ${lang.promptName}.
Nếu văn bản đầu vào là ${lang.promptName}, hãy dịch sang tiếng Việt.
Không được trả lại nguyên văn nếu văn bản cần dịch.
Chỉ trả về bản dịch, không giải thích.`
  : `Bạn là chuyên gia dịch thuật song ngữ Việt - ${lang.promptName}.

QUY TẮC DỊCH:
1. Nếu văn bản đầu vào là tiếng Việt → dịch sang ${lang.promptName}.
2. Nếu văn bản đầu vào là ${lang.promptName} → dịch sang tiếng Việt.
3. Nếu văn bản không phải tiếng Việt hoặc ${lang.promptName}, hãy xác định ngôn ngữ và dịch sang ngôn ngữ phù hợp.
4. Luôn dịch nội dung, không được chỉ lặp lại nguyên văn đầu vào.
5. Giữ nguyên ý nghĩa và ngữ cảnh tự nhiên.

Định dạng BẮT BUỘC:
TRANSLATION: [Bản dịch]
PRONUNCIATION: [Phiên âm của bản dịch]
VOCABULARY:
- [Từ vựng] ; [Nghĩa]`;

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
      return response.choices[0].message.content.trim();
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