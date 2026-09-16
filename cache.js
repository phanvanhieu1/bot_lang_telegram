const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CACHE_DIR = path.join(__dirname, 'cache_audio');
const CACHE_DB = path.join(__dirname, 'cache_index.json');

// Tạo thư mục lưu audio nếu chưa có
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);

let cacheIndex = {};
if (fs.existsSync(CACHE_DB)) {
  try { cacheIndex = JSON.parse(fs.readFileSync(CACHE_DB, 'utf8')); } catch (e) {}
}

const saveCacheIndex = () => fs.writeFileSync(CACHE_DB, JSON.stringify(cacheIndex), 'utf8');

// Tạo mã băm duy nhất cho câu chat
const getHash = (text, lang, isFast) => crypto.createHash('md5').update(`${text}_${lang}_${isFast}`).digest('hex');
const getAudioHash = (text, voice, speed) => crypto.createHash('md5').update(`${text}_${voice}_${speed}`).digest('hex');

const getCachedText = (text, lang, isFast) => cacheIndex[getHash(text, lang, isFast)];
const setCachedText = (text, lang, isFast, result) => {
  cacheIndex[getHash(text, lang, isFast)] = result;
  saveCacheIndex();
};

const getCachedAudio = (text, voice, speed) => {
  const audioPath = path.join(CACHE_DIR, `${getAudioHash(text, voice, speed)}.ogg`);
  return fs.existsSync(audioPath) ? fs.readFileSync(audioPath) : null;
};

const setCachedAudio = (text, voice, speed, buffer) => {
  const audioPath = path.join(CACHE_DIR, `${getAudioHash(text, voice, speed)}.ogg`);
  fs.writeFileSync(audioPath, buffer);
};

module.exports = { getCachedText, setCachedText, getCachedAudio, setCachedAudio };