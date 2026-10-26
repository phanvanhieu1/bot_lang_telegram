'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { VOICES } = require('../config');

function mockedSpeech(env = { ELEVENLABS_API_KEY: 'unit-test-key' }) {
  const calls = [];
  const axios = {
    post: async (url, body, options) => {
      calls.push({ url, body, options });
      return { data: Buffer.from([0x49, 0x44, 0x33]) };
    }
  };
  const file = fs.readFileSync(path.join(__dirname, '..', 'ai/services/speech.service.js'), 'utf8');
  const sandbox = {
    module: { exports: {} },
    require: name => {
      if (name === 'axios') return axios;
      if (name === '../../config') return { VOICES };
      throw new Error('Unexpected test module: ' + name);
    },
    process: { env },
    Buffer,
    encodeURIComponent
  };
  vm.runInNewContext(file, sandbox, { filename: 'speech.service.js' });
  return { generateSpeech: sandbox.module.exports.generateSpeech, calls };
}

test('all four Telegram voices exactly match the web PRO ElevenLabs IDs', async () => {
  const voiceIds = [
    'ByhETIclHirOlWnWKhHc', 'D9bZgM9Er0PhIxuW9Jqa',
    '2I36mEahS1u7ZnTKUoaB', 'BqljjWyTnrioXPCNkCd4'
  ];
  assert.deepEqual(Object.values(VOICES).map(v => v.id), voiceIds);
  const speech = mockedSpeech();
  for (const [key, voice] of Object.entries(VOICES)) {
    const audio = await speech.generateSpeech('你好，我在学习中文', key, 1);
    assert.equal(Buffer.from(audio).toString('hex'), '494433');
    const call = speech.calls.at(-1);
    assert.ok(call.url.includes('/' + voice.id + '?output_format=mp3_44100_128'));
    assert.equal(call.body.model_id, 'eleven_flash_v2_5');
    assert.equal(call.body.voice_settings.speed, 1);
    assert.equal(call.options.headers['xi-api-key'], 'unit-test-key');
  }
  assert.equal(speech.calls.length, 4);
});

test('invalid voice, empty text or missing credentials never call ElevenLabs', async () => {
  const speech = mockedSpeech();
  await assert.rejects(() => speech.generateSpeech('你好', 'sarah', 1), /Giọng đọc không hợp lệ/);
  await assert.rejects(() => speech.generateSpeech('', 'female1', 1), /Nội dung giọng đọc/);
  await assert.rejects(() => speech.generateSpeech('你好', 'female1', 3), /Tốc độ đọc/);
  assert.equal(speech.calls.length, 0);
  const missingKey = mockedSpeech({});
  await assert.rejects(() => missingKey.generateSpeech('你好', 'female1', 1), /ELEVENLABS_API_KEY/);
  assert.equal(missingKey.calls.length, 0);
});
