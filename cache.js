'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Shared translations and speech use MongoDB. This module is only the offline
// Telegram MP3 fallback. Legacy cache_index.json stays on disk untouched.
const DATA_DIR = process.env.TELEGRAM_DATA_DIR || __dirname;
const CACHE_DIR = path.join(DATA_DIR, 'cache_audio');
fs.mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });

const hashAudio = (text, voice, speed) =>
  crypto.createHash('md5').update(`${text}_${voice}_${speed}`).digest('hex');

function getCachedAudio(text, voice, speed) {
  const hash = hashAudio(text, voice, speed);
  for (const extension of ['mp3', 'ogg']) {
    const file = path.join(CACHE_DIR, `${hash}.${extension}`);
    if (fs.existsSync(file)) return fs.readFileSync(file);
  }
  return null;
}

function setCachedAudio(text, voice, speed, buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new TypeError('Empty audio buffer');
  }
  const destination = path.join(CACHE_DIR, `${hashAudio(text, voice, speed)}.mp3`);
  // Write atomically so an interrupted synthesis never leaves partial audio.
  const temp = destination + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(temp, buffer, { mode: 0o600 });
    fs.renameSync(temp, destination);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

function clearAudioCache() {
  let removed = 0;
  for (const name of fs.readdirSync(CACHE_DIR)) {
    if (!/^[a-f0-9]{32}\.(mp3|ogg)$/.test(name)) continue;
    fs.unlinkSync(path.join(CACHE_DIR, name));
    removed++;
  }
  return removed;
}

module.exports = { getCachedAudio, setCachedAudio, clearAudioCache };
