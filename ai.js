const {
  translateFull
} = require('./ai/services/pro.service');

const {
  verifyTranslation
} = require('./ai/services/verification.service');

const {
  evaluateChinese
} = require('./ai/services/evaluation.service');

const {
  transcribeVoice
} = require('./ai/services/transcription.service');

const {
  generateSpeech
} = require('./ai/services/speech.service');

const {
  generatePinyin
} = require('./ai/utils/pinyin');

module.exports = {
  translateFull,
  transcribeVoice,
  generateSpeech,
  evaluateChinese,
  generatePinyin,
  verifyTranslation
};