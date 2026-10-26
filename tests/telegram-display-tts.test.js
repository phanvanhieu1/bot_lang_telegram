'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildSpeechRequest, VIETNAMESE_VOICE_ID, CHINESE_VOICE_IDS } = require('../tts-shared');
const { buildCompactTranslation } = require('../telegram-translation');

test('Vietnamese is explicitly selected; voice alone is not the language', () => {
  const req = buildSpeechRequest({
    language: 'vi',
    text: 'Tối nay ăn gì?',
    voiceId: CHINESE_VOICE_IDS[0],
    speed: 1,
    modelId: 'eleven_multilingual_v2'
  });
  assert.equal(req.voiceId, VIETNAMESE_VOICE_ID);
  assert.equal(req.body.model_id, 'eleven_flash_v2_5');
  assert.equal(req.body.language_code, 'vi');
  assert.equal(req.body.text, 'Tối nay ăn gì?');
  assert.ok(req.url.includes(VIETNAMESE_VOICE_ID));
});

test('Chinese uses selected voice and matching language code', () => {
  const req = buildSpeechRequest({
    language: 'zh',
    text: '你好，朋友！',
    voiceId: CHINESE_VOICE_IDS[2],
    speed: 0.8
  });
  assert.equal(req.voiceId, CHINESE_VOICE_IDS[2]);
  assert.equal(req.body.language_code, 'zh');
  assert.equal(req.body.voice_settings.speed, 0.8);
});

test('cache identity includes model, language and voice ID', () => {
  const vi = buildSpeechRequest({ language: 'vi', text: 'Xin chào', speed: 1 });
  const zh = buildSpeechRequest({
    language: 'zh', text: '你好', speed: 1, voiceId: CHINESE_VOICE_IDS[0]
  });
  const zhCustom = buildSpeechRequest({
    language: 'zh', text: '你好', speed: 1, voiceId: CHINESE_VOICE_IDS[0],
    modelId: 'eleven_multilingual_v2'
  });
  assert.notEqual(vi.cacheVoice, zh.cacheVoice);
  assert.notEqual(zh.cacheVoice, zhCustom.cacheVoice);
  assert.equal(zhCustom.body.language_code, undefined);
  const bot = fs.readFileSync(path.join(__dirname, '..', 'bot.js'), 'utf8');
  assert.match(bot, /getCachedAudio\(record\.text, ttsRequest\.cacheVoice, speed\)/);
});

test('one message includes vocabulary only when enabled', () => {
  const vocab = '- [WORD] 你好: xin chào\n- [PHRASE] 早上好: chào buổi sáng';
  const base = { translation: '你好！', pinyin: 'nǐ hǎo', backTranslation: 'Xin chào!' };
  const enabled = buildCompactTranslation({ ...base, vocabulary: vocab });
  assert.match(enabled, /📝 Từ vựng:/);
  assert.match(enabled, /\[WORD\] 你好/);
  assert.match(enabled, /\[PHRASE\] 早上好/);
  const disabled = buildCompactTranslation(base);
  assert.equal(disabled.split('\n').length, 3);
  assert.doesNotMatch(disabled, /Từ vựng/);
});

test('display preferences affect actual Telegram output and persist per user', () => {
  const root = path.join(__dirname, '..');
  const bot = fs.readFileSync(path.join(root, 'bot.js'), 'utf8');
  const session = fs.readFileSync(path.join(root, 'session.js'), 'utf8');
  const menu = fs.readFileSync(path.join(root, 'ui.js'), 'utf8');
  assert.match(bot, /c\.showPronunciation \? generatePinyin/);
  assert.match(bot, /c\.showBackTranslation \? parsed\.backTranslation : ''/);
  assert.match(bot, /c\.showVocabulary \? parsed\.vocabulary : ''/);
  assert.match(session, /showBackTranslation: true/);
  assert.match(menu, /toggle_pron/);
  assert.match(menu, /toggle_back/);
  assert.match(menu, /toggle_vocab/);
});

test('web and Telegram use the same translator service and prompt builder', () => {
  const root = path.join(__dirname, '..');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const bot = fs.readFileSync(path.join(root, 'bot.js'), 'utf8');
  const translate = fs.readFileSync(path.join(root, 'ai/services/pro.service.js'), 'utf8');
  const webTts = fs.readFileSync(path.join(root, 'web-tts.js'), 'utf8');
  const telegramTts = fs.readFileSync(path.join(root, 'ai/services/speech.service.js'), 'utf8');
  assert.match(server, /translateFull\(/);
  assert.match(bot, /translateFull\(/);
  assert.match(translate, /buildProPrompt/);
  assert.match(webTts, /buildSpeechRequest/);
  assert.match(telegramTts, /buildSpeechRequest/);
});
