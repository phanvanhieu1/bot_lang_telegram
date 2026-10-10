const fs = require('fs');

const {
  getRandomOpenAIClient,
  getOpenAIKeyCount
} = require('../providers/openai.provider');

// 4. CORE 2: Nhận diện giọng nói (Whisper) có FAILOVER (Chống sập)
async function transcribeVoice(filePath) {
  let attempts = 0;
  const maxAttempts = getOpenAIKeyCount();

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

module.exports = {
  transcribeVoice
};