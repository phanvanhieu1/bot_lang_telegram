const crypto = require('crypto');
const mongoose = require('mongoose');
const { buildSpeechRequest, CHINESE_VOICE_IDS, VIETNAMESE_VOICE_ID } = require('./tts-shared');

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_TEXT_LENGTH = 500;
const VOICE_IDS = CHINESE_VOICE_IDS;
const SPEEDS = [0.8, 0.9, 1, 1.1, 1.2];

const audioSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  audio: { type: Buffer, required: true },
  expiresAt: { type: Date, required: true }
}, { versionKey: false, timestamps: true });
audioSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const AudioCache = mongoose.models.WebAudioCache ||
  mongoose.model('WebAudioCache', audioSchema, 'web_audio_cache');

function hasChinese(text) {
  return /[\u3400-\u9FFF]/u.test(text);
}

async function getElevenLabsAudio(text, requestedVoiceId, requestedSpeed, language) {
  const vietnamese = language === 'vi';
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT_LENGTH || (vietnamese ? (hasChinese(text) || !/[A-Za-zÀ-ỹ]/u.test(text)) : !hasChinese(text))) {
    const error = new Error(vietnamese ? 'Chỉ hỗ trợ câu tiếng Việt tối đa 500 ký tự' : 'Chỉ hỗ trợ câu tiếng Trung tối đa 500 ký tự');
    error.status = 400;
    throw error;
  }
  if (!process.env.ELEVENLABS_API_KEY) {
    const error = new Error('Chưa cấu hình ELEVENLABS_API_KEY');
    error.status = 503;
    throw error;
  }
  const normalized = text.trim();
  const speed = requestedSpeed === undefined ? 1 : requestedSpeed;
  if (!SPEEDS.includes(speed) ||
      (!vietnamese && requestedVoiceId !== undefined && !VOICE_IDS.includes(requestedVoiceId))) {
    const error = new Error('Giọng đọc hoặc tốc độ không hợp lệ');
    error.status = 400;
    throw error;
  }
  const request = buildSpeechRequest({
    text: normalized, language, speed,
    voiceId: vietnamese ? VIETNAMESE_VOICE_ID : (requestedVoiceId || VOICE_IDS[0]),
    modelId: process.env.ELEVENLABS_MODEL_ID
  });
  const { voiceId } = request;
  const key = crypto.createHash('sha256')
    .update(JSON.stringify(['elevenlabs', request.cacheVoice, speed, normalized]))
    .digest('hex');
  const cached = await AudioCache.findOne({ key, expiresAt: { $gt: new Date() } }).lean();
  if (cached) {
    // Lean Mongoose documents may expose BSON Binary rather than Node Buffer.
    const stored = cached.audio;
    const audio = Buffer.isBuffer(stored)
      ? stored
      : stored?.buffer
        ? Buffer.from(stored.buffer)
        : Buffer.from(stored || []);
    if (audio.length > 0 && audio.length <= 5 * 1024 * 1024) {
      return { audio, cached: true };
    }
    // Do not serve malformed cache entries as audio.
    await AudioCache.deleteOne({ key });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  let response;
  try {
    response = await fetch(
      request.url,
      {
        method: 'POST',
        headers: {
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg'
        },
        body: JSON.stringify(request.body),
        signal: controller.signal
      }
    );
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    const error = new Error(`ElevenLabs trả về HTTP ${response.status}`);
    error.status = 502;
    throw error;
  }
  const audio = Buffer.from(await response.arrayBuffer());
  if (!audio.length || audio.length > 5 * 1024 * 1024) {
    const error = new Error('Dữ liệu âm thanh không hợp lệ');
    error.status = 502;
    throw error;
  }
  try {
    await AudioCache.updateOne(
      { key },
      { $set: { audio, expiresAt: new Date(Date.now() + CACHE_TTL_MS) } },
      { upsert: true }
    );
  } catch (error) {
    console.error('ElevenLabs audio cache write error:', error.message);
  }
  return { audio, cached: false };
}

async function getChineseAudio(text, requestedVoiceId, requestedSpeed) {
  return getElevenLabsAudio(text, requestedVoiceId, requestedSpeed, 'zh');
}

async function getVietnameseAudio(text, requestedSpeed) {
  return getElevenLabsAudio(text, VIETNAMESE_VOICE_ID, requestedSpeed, 'vi');
}

module.exports = { getChineseAudio, getVietnameseAudio, VIETNAMESE_VOICE_ID };
