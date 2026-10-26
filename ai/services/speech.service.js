'use strict';
const axios = require('axios');
const { VOICES } = require('../../config');
const { buildSpeechRequest, VIETNAMESE_VOICE_ID } = require('../../tts-shared');

// A voice's ID is not a language. For Vietnamese, the shared request forces
// Flash v2.5 + language_code: 'vi', as does the web PRO endpoint.
function resolveBotSpeech(text, voiceKey, speed) {
  const language = voiceKey === 'vi' ? 'vi' : 'zh';
  const voiceId = language === 'zh' ? VOICES[voiceKey]?.id : VIETNAMESE_VOICE_ID;
  return buildSpeechRequest({
    text,
    voiceId,
    language,
    speed: Number(speed),
    modelId: process.env.ELEVENLABS_MODEL_ID
  });
}

async function generateSpeech(text, voiceKey, speed = 1) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('Chưa cấu hình ELEVENLABS_API_KEY');
  const request = resolveBotSpeech(text, voiceKey, speed);

  const response = await axios.post(request.url, request.body, {
    headers: {
      'xi-api-key': key,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg'
    },
    responseType: 'arraybuffer',
    timeout: 20000
  });
  const audio = Buffer.from(response.data);
  if (!audio.length || audio.length > 5 * 1024 * 1024) {
    throw new Error('Dữ liệu âm thanh không hợp lệ');
  }
  return audio;
}

module.exports = { generateSpeech, resolveBotSpeech, VIETNAMESE_VOICE_ID };
