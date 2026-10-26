'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseTelegramTranslation } = require('../telegram-translation');

function setupCache(initial = {}, translatorResponse = '') {
  let cached = { ...initial };
  const calls = { api: [], writes: [] };
  const source = fs.readFileSync(path.join(__dirname, '..', 'telegram-sync/cache.js'), 'utf8');
  const mod = { exports: {} };
  vm.runInNewContext(source, {
    module: mod,
    Object,
    String,
    console,
    require: name => {
      if (name === 'mongoose') return { connection: { readyState: 1 } };
      if (name === '../web-cache') return {
        getWebCachedText: async () => Object.keys(cached).length ? { ...cached } : null,
        setWebCachedText: async (...args) => { calls.writes.push(args); Object.assign(cached, args.at(-1)); }
      };
      if (name === '../ai/services/pro.service') return {
        translateFull: async (...args) => { calls.api.push(args); return translatorResponse; }
      };
      if (name === '../telegram-translation') return { parseTelegramTranslation };
      throw new Error('Unexpected mock dependency: ' + name);
    }
  });
  return { ...mod.exports, calls, getCache: () => cached };
}

test('web cache hit shares the same translation and vocabulary, no paid API call', async () => {
  const cache = setupCache({
    translation: '你好',
    backTranslation: 'Xin chào',
    vocabulary: '- [WORD] 你好: xin chào',
    vocabularyVersion: 2
  });
  const item = await cache.translateViaSharedCache('Xin chào', 'zh', true);
  assert.equal(item.cached, true);
  assert.equal(item.translation, '你好');
  assert.equal(item.vocabulary, '- [WORD] 你好: xin chào');
  assert.equal(cache.calls.api.length, 0);
  assert.equal(cache.calls.writes.length, 0);
});

test('Chinese input adds its reverse translation without changing website backTranslation', async () => {
  const cache = setupCache({
    translation: 'Chào bạn',
    backTranslation: '',
    vocabulary: '- [WORD] 你好: xin chào',
    vocabularyVersion: 2
  }, 'BACK_TRANSLATION: 你好');
  const first = await cache.translateViaSharedCache('你好', 'zh', true);
  assert.equal(first.translation, 'Chào bạn');
  assert.equal(first.backTranslation, '你好');
  assert.equal(cache.calls.api.length, 1);
  assert.equal(cache.calls.api[0][6].existingTranslation, 'Chào bạn');
  assert.equal(cache.calls.api[0][6].telegramMode, true);
  assert.deepEqual(JSON.parse(JSON.stringify(cache.calls.writes[0].at(-1))),
    { telegramBackTranslation: '你好' });
  assert.equal(cache.getCache().backTranslation, '');
  const second = await cache.translateViaSharedCache('你好', 'zh', true);
  assert.equal(second.cached, true);
  assert.equal(cache.calls.api.length, 1);
});

test('uncached text populates the actual web PRO cache fields', async () => {
  const cache = setupCache({}, 'TRANSLATION: 你好\nBACK_TRANSLATION: Xin chào\nVOCABULARY:\n- [WORD] 你好: xin chào');
  const answer = await cache.translateViaSharedCache('Xin chào', 'zh', true);
  assert.equal(answer.translation, '你好');
  assert.equal(answer.backTranslation, 'Xin chào');
  assert.equal(answer.vocabulary, '- [WORD] 你好: xin chào');
  assert.deepEqual(JSON.parse(JSON.stringify(cache.getCache())), {
    translation: '你好', backTranslation: 'Xin chào',
    vocabulary: '- [WORD] 你好: xin chào', vocabularyVersion: 2
  });
});

test('bot saves linked vocabulary into website model, not its local JSON list', () => {
  const root = path.join(__dirname, '..');
  const bot = fs.readFileSync(path.join(root, 'bot.js'), 'utf8');
  const vocab = fs.readFileSync(path.join(root, 'telegram-sync/vocabulary.js'), 'utf8');
  const session = fs.readFileSync(path.join(root, 'session.js'), 'utf8');
  assert.match(bot, /saveLinkedVocabulary\(ctx.from.id/);
  assert.match(bot, /if \(!sharedDbReady\(\)\)/);
  assert.match(vocab, /resolveTranslationVocabulary\(/);
  assert.match(vocab, /VocabularyEntry\.find\(/);
  assert.match(session, /getVocabulary/); // legacy JSON can still be exported
  assert.doesNotMatch(session, /const saveVocabulary/); // new saves use MongoDB
  assert.doesNotMatch(bot, /saveVocabulary\(ctx.from.id/);
});

test('separate vocabulary bubble and shared audio Mongo cache when connected', () => {
  const root = path.join(__dirname, '..');
  const bot = fs.readFileSync(path.join(root, 'bot.js'), 'utf8');
  const web = fs.readFileSync(path.join(root, 'web-tts.js'), 'utf8');
  const cache = fs.readFileSync(path.join(root, 'web-cache.js'), 'utf8');
  assert.match(bot, /const mainMessages = splitLongText\(combinedText\)/);
  assert.match(bot, /splitLongText\('📝 Từ vựng:/);
  assert.match(bot, /await getVietnameseAudio\(record\.text, speed\)/);
  assert.match(bot, /await getChineseAudio\(record\.text, ttsRequest\.voiceId, speed\)/);
  assert.match(web, /WebAudioCache/);
  assert.match(cache, /web_translation_cache/);
  assert.match(cache, /telegramBackTranslation/);
});

test('linking requires authenticated web session and a private Telegram chat', () => {
  const root = path.join(__dirname, '..');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const routes = fs.readFileSync(path.join(root, 'telegram-sync/routes.js'), 'utf8');
  const link = fs.readFileSync(path.join(root, 'telegram-sync/link.js'), 'utf8');
  const bot = fs.readFileSync(path.join(root, 'bot.js'), 'utf8');
  assert.match(server, /app\.get\('\/telegram\/connect', requireRole\('pro','admin'\)/);
  assert.match(routes, /router\.use\(requireRole\('pro','admin'\)\)/);
  assert.match(link, /findOneAndDelete/);
  assert.match(link, /createHash\('sha256'\)/);
  assert.match(link, /expiresAt: new Date\(Date\.now\(\) \+ 10 \* 60_000\)/);
  assert.match(bot, /ctx\.chat\?\.type !== 'private'/);
});

test('test bot database URI opt-in and settings Mongo persistence', () => {
  const root = path.join(__dirname, '..');
  const entry = fs.readFileSync(path.join(root, 'bot-test.js'), 'utf8');
  const session = fs.readFileSync(path.join(root, 'telegram-sync/preferences.js'), 'utf8');
  const example = fs.readFileSync(path.join(root, '.env.telegram-test.example'), 'utf8');
  assert.match(entry, /process\.env\.MONGODB_URI = process\.env\.TELEGRAM_TEST_MONGODB_URI/);
  assert.match(entry, /delete process\.env\.MONGODB_URI/);
  assert.match(session, /namespace:\s*namespace\(\)/);
  assert.match(session, /TelegramPreferences\.updateOne\(/);
  assert.match(example, /TELEGRAM_TEST_MONGODB_URI=/);
});
