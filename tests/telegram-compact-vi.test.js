'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { buildCompactTranslation, getChineseSentence, getSpeechLanguage } = require('../telegram-translation');
const { generatePinyin } = require('../ai/utils/pinyin');
const { buildProPrompt } = require('../ai/prompts/pro.prompt');

test('Mandarin Telegram shows translation, pinyin and back translation in one bubble', () => {
  const zh = '今晚喝点什么吗，兄弟？';
  const compact = buildCompactTranslation({
    translation: zh,
    pinyin: generatePinyin(getChineseSentence('Tối nay uống gì không anh em?', zh)),
    backTranslation: 'Tối nay uống chút gì không, anh em?'
  });
  const lines = compact.split('\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[0], '📖 ' + zh);
  assert.ok(lines[1].startsWith('🔤 '));
  assert.match(lines[1], /jīn|wǎn|hē/);
  assert.equal(lines[2], '🔁 Tối nay uống chút gì không, anh em?');
});

test('Chinese source yields pinyin from original and Vietnamese TTS voice', () => {
  const input = '今晚喝点什么吗，兄弟？';
  const translation = 'Tối nay uống chút gì không, anh em?';
  assert.equal(getChineseSentence(input, translation), input);
  assert.equal(getSpeechLanguage(input, translation, 'zh'), 'vi');
  assert.equal(getSpeechLanguage(translation, input, 'zh'), 'zh');
  assert.match(generatePinyin(getChineseSentence(input, translation)), /jīn|wǎn/);
});

test('Telegram prompt reverses both directions without changing web PRO prompt', () => {
  const telegram = buildProPrompt('你好', 'zh', false, { telegramMode: true });
  const web = buildProPrompt('你好', 'zh', false);
  assert.match(telegram, /DỊCH NGƯỢC CHO TELEGRAM/);
  assert.match(telegram, /Nếu đầu vào là tiếng Trung/);
  assert.doesNotMatch(web, /DỊCH NGƯỢC CHO TELEGRAM/);
  assert.match(web, /Chỉ khi đầu vào là tiếng Việt/);
});

test('both Vietnamese TTS routes require provider keys on server, web is PRO-only', () => {
  const root = path.join(__dirname, '..');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const client = fs.readFileSync(path.join(root, 'public/google-style.js'), 'utf8');
  const bot = fs.readFileSync(path.join(root, 'bot.js'), 'utf8');
  assert.match(server, /app\.post\('\/api\/tts\/vietnamese', requirePro/);
  assert.match(client, /\/api\/tts\/vietnamese/);
  assert.match(client, /speechLanguage === 'vi'/);
  assert.match(bot, /record\.language === 'vi' \? 'vi' : c\.voiceKey/);
  assert.doesNotMatch(bot, /buildStudyMessages\(sections\)/);
});

function mockedWebTts() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'web-tts.js'), 'utf8');
  const requests = [], saved = [];
  const AudioCache = {
    findOne: () => ({ lean: async () => null }),
    updateOne: async (...args) => saved.push(args),
    deleteOne: async () => null
  };
  class Schema {
    index() {}
  }
  const sandbox = {
    module: { exports: {} },
    require: name => {
      if (name === 'crypto') return crypto;
      if (name === 'mongoose') return {
        Schema,
        models: { WebAudioCache: AudioCache },
        model: () => AudioCache
      };
      throw new Error('Unexpected dependency: ' + name);
    },
    process: { env: { ELEVENLABS_API_KEY: 'fake-key' } },
    Buffer,
    Date,
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, arrayBuffer: async () => Buffer.from('mp3') };
    }
  };
  vm.runInNewContext(source, sandbox);
  return { ...sandbox.module.exports, requests, saved };
}

test('Vietnamese synthesis uses the exact dedicated ElevenLabs voice', async () => {
  const api = mockedWebTts();
  const result = await api.getVietnameseAudio('Tối nay uống chút gì không?', 1);
  assert.equal(result.cached, false);
  assert.equal(result.audio.toString(), 'mp3');
  assert.equal(api.VIETNAMESE_VOICE_ID, 'CQAD6iKxS73fEAGjSwt5');
  assert.match(api.requests[0].url, /CQAD6iKxS73fEAGjSwt5/);
  assert.equal(JSON.parse(api.requests[0].options.body).text, 'Tối nay uống chút gì không?');
  assert.equal(api.saved.length, 1);
});

test('Vietnamese synthesis rejects Chinese input instead of misrouting it', async () => {
  const api = mockedWebTts();
  await assert.rejects(() => api.getVietnameseAudio('你好', 1), /tiếng Việt/);
  assert.equal(api.requests.length, 0);
});
