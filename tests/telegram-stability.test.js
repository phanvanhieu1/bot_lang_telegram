'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { splitLongText, buildStudyMessages, copyButtonText } = require('../telegram-utils');
const { withDownloadedVoice } = require('../telegram-media');
const { classifyError } = require('../errorHandler');

test('splits long texts without exceeding Telegram limit or corrupting Unicode', () => {
  const original = '你好 🌟\n'.repeat(1200) + 'kết thúc';
  const chunks = splitLongText(original);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(x => x.length <= 3500));
  assert.equal(chunks.join(''), original);
  assert.ok(chunks.every(x => !/[\uD800-\uDBFF]$/.test(x) && !/^[\uDC00-\uDFFF]/.test(x)));
});

test('rendered translation messages are safe plain text even with Markdown syntax', () => {
  const output = buildStudyMessages([
    { title: '📖 Bản dịch:', body: '_start_ *bold* [broken](markdown) ' + '🤖'.repeat(3000) },
    { title: '📝 Từ vựng:', body: '- 中文: tiếng Trung' }
  ]);
  assert.ok(output.length >= 3);
  assert.ok(output.every(x => x.length <= 4096));
  assert.match(output[0], /\[broken\]\(markdown\)/);
  assert.match(output.at(-1), /中文/);
});

test('copy button rejects values exceeding Telegram 256 character limit', () => {
  assert.equal(copyButtonText('a'.repeat(256)), 'a'.repeat(256));
  assert.equal(copyButtonText('a'.repeat(257)), null);
  assert.equal(copyButtonText(''), null);
});

test('voice helper writes and deletes temporary file on success', async () => {
  let captured;
  const mockHttp = { get: async () => ({ data: Readable.from([Buffer.from('fake ogg')]) }) };
  const result = await withDownloadedVoice('https://example.com/file', async audio => {
    captured = audio;
    assert.equal(fs.readFileSync(audio, 'utf8'), 'fake ogg');
    return 42;
  }, mockHttp);
  assert.equal(result, 42);
  assert.equal(fs.existsSync(captured), false);
  assert.equal(fs.existsSync(path.dirname(captured)), false);
});

test('voice helper deletes temporary file even when transcriber fails', async () => {
  let captured;
  const mockHttp = { get: async () => ({ data: Readable.from([Buffer.from('ogg')]) }) };
  await assert.rejects(withDownloadedVoice('https://example.com/file', async audio => {
    captured = audio;
    throw new Error('Whisper unavailable');
  }, mockHttp), /Whisper unavailable/);
  assert.equal(fs.existsSync(captured), false);
});

test('voice helper rejects oversized downloads', async () => {
  const mockHttp = { get: async () => ({ data: Readable.from([Buffer.alloc(20 * 1024 * 1024 + 1)]) }) };
  await assert.rejects(withDownloadedVoice('https://example.com/large', async () => true, mockHttp), /20 MB/);
});

test('error handler does not mention unused Gemini APIs', () => {
  const text = classifyError({ status: 429 });
  assert.match(text, /429/);
  assert.doesNotMatch(text, /Gemini/);
  assert.match(classifyError({ code: 'ETIMEDOUT' }), /thời gian/);
});

test('Telegram handlers scope vocab saves to unique callback ids', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'bot.js'), 'utf8');
  assert.match(source, /pendingVocabs\[nonce\] = vocab/);
  assert.match(source, /save_vocab_' \+ nonce/);
  assert.match(source, /bot\.command\('clearcache'/);
  assert.match(source, /getShuffledOpenAIClients|withDownloadedVoice/);
  assert.doesNotMatch(source, /fs\.unlinkSync\(filePath\)/);
});
