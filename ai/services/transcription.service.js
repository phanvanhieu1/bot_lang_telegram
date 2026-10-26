const fs = require('fs');

const {
  getShuffledOpenAIClients
} = require('../providers/openai.provider');

// 4. CORE 2: Nhận diện giọng nói (Whisper) có FAILOVER (Chống sập)
async function transcribeVoice(filePath) {
  const clients = getShuffledOpenAIClients();
  if (!clients.length) throw new Error('Chưa cấu hình OPENAI_API_KEYS cho Whisper');
  let lastError = null;
  for (const [index, openai] of clients.entries()) {
    try {
      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(filePath),
        model: 'whisper-1'
      });
      return (transcription.text || '').trim();
    } catch (error) {
      lastError = error;
      if ([400, 413, 422].includes(error?.status)) throw error;
      // Never log API keys, including prefixes.
      console.error(`[Whisper] Lần ${index + 1}/${clients.length} thất bại:`, error?.status || error?.code || 'UNKNOWN');
    }
  }
  throw new Error('Tất cả API key OpenAI đã thử đều không khả dụng cho Whisper', { cause: lastError });
}

module.exports = {
  transcribeVoice
};