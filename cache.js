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
const getHash = (text, lang, isFast) => {
  return crypto
    .createHash('md5')
    .update(`${text}_${lang}_${isFast}`)
    .digest('hex');
};
const getAudioHash = (text, voice, speed) => crypto.createHash('md5').update(`${text}_${voice}_${speed}`).digest('hex');

const getCachedText = (text, lang, isFast) => {
  return cacheIndex[getHash(text, lang, isFast)] || null;
};

const setCachedText = (text, lang, isFast, data) => {
  cacheIndex[getHash(text, lang, isFast)] = data;
  saveCacheIndex();
};

const getWebHash = (text, lang, isFast, context = 'auto') => {
  return crypto
    .createHash('md5')
    .update(`web_${text}_${lang}_${isFast}_${context}`)
    .digest('hex');
};

const getWebCachedText = (
  text,
  lang,
  isFast,
  context = 'auto'
) => {
  const value = cacheIndex[
    getWebHash(text, lang, isFast, context)
  ];

  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return null;
  }

  return value;
};

const setWebCachedText = (
  text,
  lang,
  isFast,
  context = 'auto',
  data
) => {
  const hash = getWebHash(
    text,
    lang,
    isFast,
    context
  );

  const existing = cacheIndex[hash];

  const current =
    existing &&
    typeof existing === 'object' &&
    !Array.isArray(existing)
      ? existing
      : {};

  cacheIndex[hash] = {
    ...current,
    ...data
  };

  saveCacheIndex();
};

const getFreeHash = (text) => {
  const normalizedText = text
    .trim()
    .replace(/\s+/g, ' ');

  return crypto
    .createHash('md5')
    .update(`free_${normalizedText}`)
    .digest('hex');
};

const getFreeCachedText = (text) => {
  const value =
    cacheIndex[getFreeHash(text)];

  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return null;
  }

  return value;
};

const setFreeCachedText = (
  text,
  data
) => {
  cacheIndex[getFreeHash(text)] = data;
  saveCacheIndex();
};

const getCachedAudio = (text, voice, speed) => {
  const hash = getAudioHash(text, voice, speed);
  for (const ext of ['mp3', 'ogg']) {
    const file = path.join(CACHE_DIR, `${hash}.${ext}`);
    if (fs.existsSync(file)) return fs.readFileSync(file);
  }
  return null;
};

const setCachedAudio = (text, voice, speed, buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new TypeError('Empty audio buffer');
  const file = path.join(CACHE_DIR, `${getAudioHash(text, voice, speed)}.mp3`);
  fs.writeFileSync(file, buffer);
};

const clearAudioCache = () => {
  let removed = 0;
  for (const name of fs.readdirSync(CACHE_DIR)) {
    if (!/^[a-f0-9]{32}\\.(ogg|mp3)$/.test(name)) continue;
    fs.unlinkSync(path.join(CACHE_DIR, name));
    removed++;
  }
  return removed;
};

module.exports = {
  getCachedText,
  setCachedText,
  getWebCachedText,
  setWebCachedText,

  getFreeCachedText,
  setFreeCachedText,

  getCachedAudio,
  setCachedAudio,
  clearAudioCache
};