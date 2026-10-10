const axios = require('axios');
const { VOICES } = require('../../config');

const ELEVENLABS_API_KEY =
  process.env.ELEVENLABS_API_KEY;

  // 5. Sinh giọng đọc (Giữ nguyên)
async function generateSpeech(text, voiceKey, speed) {
  const res = await axios.post(`https://api.elevenlabs.io/v1/text-to-speech/${VOICES[voiceKey]?.id || VOICES.sarah.id}`,
    { text, model_id: 'eleven_turbo_v2_5', voice_settings: { stability: 0.5, similarity_boost: 0.8, speed } },
    { headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json' }, responseType: 'arraybuffer' });
  return Buffer.from(res.data);
}

module.exports = {
  generateSpeech
};