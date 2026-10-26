'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { splitLongText, buildStudyMessages, copyButtonText, copyInlineButton } = require('../telegram-utils');
const { VOICES } = require('../config');
const { withDownloadedVoice } = require('../telegram-media');
const { classifyError } = require('../errorHandler');
const { exportAnkiCsv, vocabColumns } = require('../telegram-vocabulary');

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
  assert.deepEqual(copyInlineButton('我喜欢学习中文'), {
    text: '📋',
    copy_text: { text: '我喜欢学习中文' }
  });
  assert.equal(copyInlineButton('x'.repeat(257)), null);
  const source = fs.readFileSync(path.join(__dirname, '..', 'bot.js'), 'utf8');
  assert.doesNotMatch(source, /Markup\.button\.copyText/);
  assert.match(source, /copyInlineButton\(translatedText\)/);
});

test('Telegram uses exactly the four PRO web voice IDs', () => {
  const webHtml = fs.readFileSync(path.join(__dirname, '..', 'public/index.html'), 'utf8');
  const webTts = fs.readFileSync(path.join(__dirname, '..', 'web-tts.js'), 'utf8');
  const expected = [
    'ByhETIclHirOlWnWKhHc', 'D9bZgM9Er0PhIxuW9Jqa',
    '2I36mEahS1u7ZnTKUoaB', 'BqljjWyTnrioXPCNkCd4'
  ];
  assert.deepEqual(Object.values(VOICES).map(v => v.id), expected);
  for (const id of expected) {
    assert.ok(webHtml.includes(id), `Missing voice ${id} in web`);
    assert.ok(webTts.includes(id), `Missing voice ${id} in web TTS`);
  }
  const session = fs.readFileSync(path.join(__dirname, '..', 'session.js'), 'utf8');
  assert.match(session, /voiceKey: 'female1'/);
  assert.doesNotMatch(session, /voiceKey: 'sarah'/);
});

test('ElevenLabs uses PRO web model and correct chosen voice ID', async () => {
  const speechSource = fs.readFileSync(path.join(__dirname, '..', 'ai/services/speech.service.js'), 'utf8');
  assert.match(speechSource, /eleven_flash_v2_5/);
  assert.match(speechSource, /output_format=mp3_44100_128/);
  assert.match(speechSource, /VOICES\[voiceKey\]/);
  assert.doesNotMatch(speechSource, /VOICES\.sarah/);
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

test('CSV export has two quoted Anki columns and handles commas and quotes', () => {
  const csv = exportAnkiCsv(['- 你好 (nǐ hǎo): Xin chào, bạn', '- \"书\": quyển sách']);
  assert.ok(csv.startsWith(String.fromCharCode(0xFEFF)));
  assert.ok(csv.includes('\"Front\",\"Back\"'));
  assert.ok(csv.includes('\"你好 (nǐ hǎo)\",\"Xin chào, bạn\"'));
  assert.ok(csv.includes('\"\"书\"\"'));
  assert.deepEqual(vocabColumns('- 水：nước'), ['水', 'nước']);
});

test('error handler does not mention unused Gemini APIs', () => {
  const text = classifyError({ status: 429 });
  assert.match(text, /429/);
  assert.doesNotMatch(text, /Gemini/);
  assert.match(classifyError({ code: 'ETIMEDOUT' }), /thời gian/);
});

test('Telegram handlers scope vocab saves to unique callback ids', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'bot.js'), 'utf8');
  assert.match(source, /pendingVocabs\[vocabId\] = parsed\.vocabulary/);
  assert.match(source, /buildTranslationButtons\(/);
  assert.match(source, /bot\.command\('clearcache'/);
  assert.match(source, /getShuffledOpenAIClients|withDownloadedVoice/);
  assert.doesNotMatch(source, /fs\.unlinkSync\(filePath\)/);
});
