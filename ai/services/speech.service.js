'use strict';
const axios = require('axios');
const { VOICES } = require('../../config');

const DEFAULT_MODEL = 'eleven_flash_v2_5'; // Same as PRO web.
const VIETNAMESE_VOICE_ID = 'CQAD6iKxS73fEAGjSwt5';
const MAX_SPEECH_CHARS = 500; // Same as web Chinese TTS endpoint.

async function generateSpeech(text, voiceKey, speed = 1) {
  const voice = voiceKey === 'vi' ? { id: VIETNAMESE_VOICE_ID } : VOICES[voiceKey];
  if (!voice) {
    const error = new Error('Giọng đọc không hợp lệ');
    error.status = 400;
    throw error;
  }
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_SPEECH_CHARS) {
    const error = new Error('Nội dung giọng đọc cần từ 1 đến 500 ký tự');
    error.status = 400;
    throw error;
  }
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    const error = new Error('Chưa cấu hình ELEVENLABS_API_KEY');
    error.status = 503;
    throw error;
  }
  const normalizedSpeed = Number(speed);
  if (!Number.isFinite(normalizedSpeed) || normalizedSpeed < 0.7 || normalizedSpeed > 1.2) {
    const error = new Error('Tốc độ đọc không hợp lệ');
    error.status = 400;
    throw error;
  }

  const model = process.env.ELEVENLABS_MODEL_ID || DEFAULT_MODEL;
  // Align provider, model, voice, speed and MP3 format with web PRO.
  const response = await axios.post(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice.id)}?output_format=mp3_44100_128`,
    { text: text.trim(), model_id: model, voice_settings: { speed: normalizedSpeed } },
    { headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      responseType: 'arraybuffer', timeout: 20000 }
  );

  const audio = Buffer.from(response.data);
  if (!audio.length || audio.length > 5 * 1024 * 1024) {
    const error = new Error('Dữ liệu âm thanh không hợp lệ');
    error.status = 502;
    throw error;
  }
  return audio;
}

module.exports = { generateSpeech, VIETNAMESE_VOICE_ID };