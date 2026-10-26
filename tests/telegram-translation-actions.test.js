'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseTelegramTranslation, buildTranslationButtons } = require('../telegram-translation');
const { copyInlineButton } = require('../telegram-utils');

const cb = (text, data) => ({ text, callback_data: data });
const makeActions = (translation, vocabId = 'aabbccddeeff', speechId = 'ffeeddccbbaa') =>
  buildTranslationButtons({ translation, vocabId, speechId, copyInlineButton, callbackButton: cb });

test('copy and speaker use only TRANSLATION, never BACK_TRANSLATION', () => {
  const parsed = parseTelegramTranslation(
    'TRANSLATION: 大哥，快下班了。\nBACK_TRANSLATION: Anh ơi, sắp tan làm rồi.\n' +
    'VOCABULARY:\n- [WORD] 大哥: anh ơi'
  );
  assert.equal(parsed.translation, '大哥，快下班了。');
  assert.equal(parsed.backTranslation, 'Anh ơi, sắp tan làm rồi.');
  assert.equal(parsed.vocabulary, '- [WORD] 大哥: anh ơi');
  const keyboard = makeActions(parsed.translation);
  assert.equal(keyboard.inline_keyboard.length, 1);
  assert.deepEqual(keyboard.inline_keyboard[0].map(x => x.text), ['📋', '💾', '🔊']);
  assert.deepEqual(keyboard.inline_keyboard[0][0].copy_text, { text: '大哥，快下班了。' });
  assert.ok(!JSON.stringify(keyboard).includes('BACK_TRANSLATION'));
  assert.ok(!JSON.stringify(keyboard).includes('Anh ơi'));
});

test('reverse Chinese -> Vietnamese copies Vietnamese translation only', () => {
  const parsed = parseTelegramTranslation(
    'TRANSLATION: Anh ơi, sắp tan làm rồi.\n' +
    'BACK_TRANSLATION: 大哥，快下班了。\n' +
    'PRONUNCIATION: dǎ gē'
  );
  assert.equal(parsed.translation, 'Anh ơi, sắp tan làm rồi.');
  assert.equal(makeActions(parsed.translation).inline_keyboard[0][0].copy_text.text,
    'Anh ơi, sắp tan làm rồi.');
});

test('fast mode TRANSLATION and CRLF are cleaned', () => {
  const parsed = parseTelegramTranslation('TRANSLATION:    你好！\r\n');
  assert.equal(parsed.translation, '你好！');
  assert.equal(parsed.backTranslation, '');
  assert.equal(parsed.pronunciation, '');
});

test('parse all sections regardless of order and preserve newlines in the main translation', () => {
  const p = parseTelegramTranslation(
    'VOCABULARY:\n- [WORD] 朋友 : bạn bè\n' +
    'TRANSLATION: 你好！\n你今天有空吗？\n' +
    'BACK_TRANSLATION: Xin chào, hôm nay bạn có rảnh không?\n' +
    'PRONUNCIATION: nǐ hǎo'
  );
  assert.equal(p.translation, '你好！\n你今天有空吗？');
  assert.equal(p.backTranslation, 'Xin chào, hôm nay bạn có rảnh không?');
  assert.equal(p.vocabulary, '- [WORD] 朋友 : bạn bè');
  assert.equal(p.pronunciation, 'nǐ hǎo');
});

test('never fall back to an entire tagged response if TRANSLATION is absent', () => {
  assert.throws(() => parseTelegramTranslation(
    'BACK_TRANSLATION: Từ vựng\nVOCABULARY:\n- [WORD] 好: tốt'
  ), /TRANSLATION/);
});

test('older untagged text remains readable, not fabricated', () => {
  assert.equal(parseTelegramTranslation('Xin chào!').translation, 'Xin chào!');
});

test('copy button is optional for >256 chars but Save and Speaker remain in a single row', () => {
  const buttons = makeActions('汉'.repeat(260));
  assert.equal(buttons.inline_keyboard.length, 1);
  assert.deepEqual(buttons.inline_keyboard[0].map(x => x.text), ['💾', '🔊']);
  assert.equal(buttons.inline_keyboard[0][0].callback_data, 'save_vocab_aabbccddeeff');
  assert.equal(buttons.inline_keyboard[0][1].callback_data, 'speak_translation_ffeeddccbbaa');
});

test('no vocabulary only gives Copy and Speaker', () => {
  const buttons = makeActions('你好', null);
  assert.deepEqual(buttons.inline_keyboard[0].map(x => x.text), ['📋', '🔊']);
});

test('bot no longer calls speech automatically and keeps on-demand text per message', () => {
  const root = path.join(__dirname, '..');
  const bot = fs.readFileSync(path.join(root, 'bot.js'), 'utf8');
  const settings = fs.readFileSync(path.join(root, 'ui.js'), 'utf8');
  const sessions = fs.readFileSync(path.join(root, 'session.js'), 'utf8');
  assert.match(bot, /parseTelegramTranslation\(aiResult\)/);
  assert.match(bot, /c\.pendingSpeech\[nonce\]\s*=\s*\{\s*text: translatedText/);
  assert.match(bot, /bot\.action\(\/\^speak_translation_/);
  assert.match(bot, /const record = c\.pendingSpeech\?\.\[ctx\.match\[1\]\]/);
  assert.match(bot, /await ctx\.replyWithVoice/);
  assert.match(bot, /if \(index === 0\) extra\.reply_markup = actions/);
  assert.doesNotMatch(bot, /if \(c\.enableVoice && translatedText\)/);
  assert.match(bot, /const isFast = false/);
  assert.match(bot, /activeSpeechRequests\.has\(requestKey\)/);
  assert.doesNotMatch(settings, /Giọng đọc AI: BẬT|Giọng đọc AI: TẮT/);
  assert.match(sessions, /pendingSpeech: \{\}/);
  assert.match(bot, /oldRows\.map\(row => row\.map/); // preserve Copy/Speaker after Save
});
