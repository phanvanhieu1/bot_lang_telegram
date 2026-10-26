'use strict';

// Shared speech contract used by the PRO web and Telegram.
// Eleven Flash v2.5 understands Vietnamese; explicitly constrain languages.
// The voice ID selects the speaker, not the target language.
const { VOICES } = require('./config');
const FLASH_MODEL = 'eleven_flash_v2_5';
const VIETNAMESE_VOICE_ID = 'CQAD6iKxS73fEAGjSwt5';
const CHINESE_VOICE_IDS = Object.freeze(Object.values(VOICES).map(v => v.id));

function buildSpeechRequest({ text, language, voiceId, speed = 1, modelId } = {}) {
  if (language !== 'vi' && language !== 'zh') throw new TypeError('Unsupported speech language');
  if (typeof text !== 'string' || !text.trim() || text.length > 500) {
    throw new TypeError('Speech input must be 1 to 500 characters');
  }
  const normalized = text.trim();
  const selectedVoice = language === 'vi' ? VIETNAMESE_VOICE_ID : voiceId;
  if (language === 'zh' && !CHINESE_VOICE_IDS.includes(selectedVoice)) {
    throw new TypeError('Unknown Chinese speech voice');
  }
  if (typeof speed !== 'number' || !Number.isFinite(speed) || speed < 0.7 || speed > 1.2) {
    throw new TypeError('Invalid speech speed');
  }
  // A custom default cannot accidentally disable Vietnamese: multilingual_v2
  // doesn't support it. Mandarin can retain the configured provider model.
  const model = language === 'vi' ? FLASH_MODEL : (modelId || FLASH_MODEL);
  const body = {
    text: normalized,
    model_id: model,
    voice_settings: { speed }
  };
  if (model === FLASH_MODEL) body.language_code = language;
  const cacheVoice = [model, language, selectedVoice].join(':');
  return {
    voiceId: selectedVoice,
    body,
    cacheVoice,
    url: `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(selectedVoice)}?output_format=mp3_44100_128`
  };
}

module.exports = { FLASH_MODEL, VIETNAMESE_VOICE_ID, CHINESE_VOICE_IDS, buildSpeechRequest };
