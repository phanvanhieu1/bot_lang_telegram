// Run locally with: node --test tests/image-translation.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { actualImageType, parseVisionResult } = require('../web-image-translate');

test('accepts only PNG, JPEG and WebP magic bytes', () => {
  assert.equal(actualImageType(Buffer.from([137,80,78,71,13,10,26,10])), 'image/png');
  assert.equal(actualImageType(Buffer.from([0xff,0xd8,0xff])), 'image/jpeg');
  assert.equal(actualImageType(Buffer.from('RIFFabcdWEBP', 'ascii')), 'image/webp');
  assert.equal(actualImageType(Buffer.from('not an image')), null);
  assert.equal(actualImageType(null), null);
});

test('converts Chinese chat with quotes and timestamps to Vietnamese', () => {
  const input = {
    sourceLanguage: 'zh',
    messages: [
      { side: 'left', time: '7:18 AM', original: '代付 U2C吗', translation: 'Có phải dịch vụ chi hộ U2C không?', uncertain: false },
      { side: 'right', time: '7:19 AM', original: '等一下，哥', translation: 'Đợi một chút nhé, anh.',
        quoteOriginal: '代付 U2C吗', quoteTranslation: 'Có phải dịch vụ chi hộ U2C không?' }
    ],
    notes: ['Không suy đoán U2C là gì.']
  };
  const output = parseVisionResult(JSON.stringify(input), 'zh');
  assert.equal(output.sourceLanguage, 'zh');
  assert.equal(output.targetLanguage, 'vi');
  assert.equal(output.messages.length, 2);
  assert.equal(output.messages[0].time, '7:18 AM');
  assert.equal(output.messages[1].side, 'right');
  assert.match(output.messages[1].quoteTranslation, /U2C/);
  assert.equal(output.notes.length, 1);
});

test('switches Vietnamese screenshot translation to English based on selected language', () => {
  const input = {
    sourceLanguage: 'vi',
    messages: [{ side: 'left', original: 'Chờ tôi một lát', translation: 'Please wait a moment.' }]
  };
  const output = parseVisionResult(JSON.stringify(input), 'en');
  assert.equal(output.sourceLanguage, 'vi');
  assert.equal(output.targetLanguage, 'en');
});

test('handles uncertain messages and rejects missing or invalid outputs', () => {
  const clean = parseVisionResult(JSON.stringify({
    sourceLanguage: 'zh',
    messages: [{ side: 'bad', original: 'X7', translation: '[không đọc rõ]', uncertain: true }]
  }), 'zh');
  assert.equal(clean.messages[0].side, 'unknown');
  assert.equal(clean.messages[0].uncertain, true);
  assert.throws(() => parseVisionResult('{bad json', 'zh'), { status: 502 });
  assert.throws(() => parseVisionResult('{"messages":[]}', 'zh'), { status: 422 });
});
