'use strict';
const axios = require('axios');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const MAX_BYTES = 20 * 1024 * 1024;

async function withDownloadedVoice(url, callback, http = axios) {
  if (typeof callback !== 'function') throw new TypeError('Callback required');
  const folder = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tg-voice-'));
  const audioPath = path.join(folder, 'recording.ogg');
  try {
    const response = await http.get(url, { responseType: 'stream',
      timeout: 20000, maxRedirects: 2 });
    let received = 0;
    const limiter = new Transform({
      transform(chunk, encoding, done) {
        received += chunk.length;
        if (received > MAX_BYTES) return done(new Error('Voice message exceeds 20 MB'));
        done(null, chunk);
      }
    });
    await pipeline(response.data, limiter, fs.createWriteStream(audioPath));
    return await callback(audioPath);
  } finally {
    await fs.promises.rm(folder, { recursive: true, force: true });
  }
}

module.exports = { withDownloadedVoice };
