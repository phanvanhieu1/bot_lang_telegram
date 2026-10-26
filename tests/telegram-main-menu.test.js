'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { MAIN_MENU, replyMenuMarkup, replyMenuOptions } = require('../telegram-main-menu');
const { LANG_CONFIG, VOICES, SPEED_OPTIONS } = require('../config');

const makeMarkup = () => ({
  inlineKeyboard: rows => ({ reply_markup: { inline_keyboard: rows } }),
  button: { callback: (text, data) => ({ text, callback_data: data }) }
});

test('persistent reply keyboard has six actions in three rows with valid styles', () => {
  const markup = replyMenuMarkup();
  assert.deepEqual(markup.keyboard.map(row => row.length), [2, 3, 1]);
  assert.deepEqual(markup.keyboard.flat().map(button => button.text), [
    MAIN_MENU.translate, MAIN_MENU.vocabulary, MAIN_MENU.voice,
    MAIN_MENU.practice, MAIN_MENU.settings, MAIN_MENU.statistics
  ]);
  assert.equal(markup.keyboard[0][0].style, 'success');
  assert.equal(markup.keyboard[0][1].style, 'primary');
  assert.equal(markup.keyboard[2][0].style, 'primary');
  assert.equal(markup.is_persistent, true);
  assert.equal(markup.resize_keyboard, true);
  assert.equal(markup.one_time_keyboard, false);
  assert.deepEqual(replyMenuOptions(), { reply_markup: markup });
});

test('settings dashboard works with saved numeric speed and all 4 voices', () => {
  const filename = path.join(__dirname, '..', 'ui.js');
  const source = fs.readFileSync(filename, 'utf8');
  const module = { exports: {} };
  const markup = makeMarkup();
  vm.runInNewContext(source, {
    module,
    require: name => name === 'telegraf'
      ? { Markup: markup }
      : { LANG_CONFIG, VOICES, SPEED_OPTIONS }
  });
  const ui = module.exports;
  const config = {
    targetLang: 'zh',
    voiceKey: 'female1',
    speed: 1,
    showVocabulary: true,
    showPronunciation: true,
    showBackTranslation: true
  };
  assert.equal(ui.getSpeedKey(1), '1.0');
  assert.equal(ui.getSpeedKey(1.15), '1.15');
  const dashboard = ui.renderDashboard(config);
  assert.match(dashboard.text, /Pinyin: BẬT/);
  assert.match(dashboard.text, /Dịch ngược: BẬT/);
  assert.match(dashboard.text, /Giọng tiếng Trung/);
  assert.match(dashboard.text, /1\.0x/);
  assert.equal(dashboard.keyboard.reply_markup.inline_keyboard.length, 3);
  for (const voice of Object.keys(VOICES)) {
    config.voiceKey = voice;
    assert.ok(ui.renderDashboard(config).text.includes(VOICES[voice].name));
  }
  const voices = ui.renderMenu('🎙 Giọng đọc', VOICES, 'female2', 'set_voice');
  assert.ok(voices.keyboard.reply_markup.inline_keyboard.flat().some(button =>
    button.callback_data === 'set_voice_female2' && button.text.includes('✅')
  ));
  const display = ui.renderDisplayMenu(config);
  assert.match(display.text, /Pinyin/);
  assert.deepEqual(display.keyboard.reply_markup.inline_keyboard.flat()
    .filter(button => button.callback_data.startsWith('toggle_'))
    .map(button => button.callback_data), ['toggle_pron', 'toggle_back', 'toggle_vocab']);
});

test('settings actions do not change hidden legacy toggles or translate menu labels', async () => {
  const botFile = fs.readFileSync(path.join(__dirname, '..', 'bot.js'), 'utf8');
  const uiFile = fs.readFileSync(path.join(__dirname, '..', 'ui.js'), 'utf8');
  const handlers = { action: [], hears: [], command: [], on: [] };
  const state = {
    targetLang: 'zh',
    voiceKey: 'female1',
    speed: 1,
    showVocabulary: true,
    showTranslation: true,
    showPronunciation: true,
    showBackTranslation: true
  };
  let saves = 0, translations = 0;

  class TelegrafStub {
    constructor() { this.telegram = { setMyCommands: async () => {} }; }
    use(fn) { handlers.use = fn; }
    command(name, fn) { handlers.command.push([name, fn]); }
    start(fn) { handlers.start = fn; }
    hears(name, fn) { handlers.hears.push([name, fn]); }
    action(pattern, fn) { handlers.action.push([pattern, fn]); }
    on(name, fn) { handlers.on.push([name, fn]); }
    catch(fn) { handlers.catch = fn; }
  }
  const Markup = makeMarkup();
  const uiModule = { exports: {} };
  vm.runInNewContext(uiFile, {
    module: uiModule,
    require: name => name === 'telegraf'
      ? { Markup }
      : { LANG_CONFIG, VOICES, SPEED_OPTIONS }
  });

  const fakeSession = {
    getUserConfig: () => state,
    saveDatabase: () => { saves++; },
    isAuthorized: () => true,
    addAuthorizedUser: () => {},
    removeAuthorizedUser: () => {},
    getWhitelist: () => [],
    saveVocabulary: () => 0,
    getVocabulary: () => [],
    clearVocabulary: () => {}
  };
  const stub = {
    'dotenv': { config: () => {} },
    'telegraf': { Telegraf: TelegrafStub, Markup },
    './session': fakeSession,
    './ui': uiModule.exports,
    './config': { LANG_CONFIG, VOICES, SPEED_OPTIONS },
    './cache': {},
    './telegram-utils': {},
    './telegram-vocabulary': {},
    './telegram-translation': {},
    './telegram-main-menu': { MAIN_MENU, replyMenuOptions },
    './telegram-media': {},
    './ai': { translateFull: async () => { translations++; } },
    './ai/services/speech.service': { resolveBotSpeech: () => ({ cacheVoice: 'test' }) },
    './telegram-sync/cache': { ready: () => false, translateViaSharedCache: async () => ({}) },
    './telegram-sync/link': { connectTelegram: async () => ({ ok: false }), findLinkedUser: async () => null },
    './telegram-sync/vocabulary': { saveLinkedVocabulary: async () => ({}), exportLinkedVocabulary: async () => ({}) },
    './telegram-sync/preferences': { syncTelegramPreferences: async (ctx, next) => next() },
    './config/database': async () => {},
    './web-tts': { getChineseAudio: async () => ({audio: Buffer.from([])}), getVietnameseAudio: async () => ({audio: Buffer.from([])}) },
    './errorHandler': async () => {}
  };
  const fakeModule = { exports: {} };
  const fakeRequire = name => {
    if (name === 'node:crypto') return require('node:crypto');
    if (!(name in stub)) throw new Error('Unknown bot dependency: ' + name);
    return stub[name];
  };
  fakeRequire.main = null;
  vm.runInNewContext(botFile, {
    module: fakeModule,
    require: fakeRequire,
    process: { env: { TELEGRAM_BOT_TOKEN: 'fake-test-token', MASTER_ADMIN: '12345', TELEGRAM_TEST_MODE: '1' } },
    console,
    Buffer
  });
  const context = () => {
    const messages = [], answers = [];
    return {
      from: { id: 12345 },
      message: { text: '' },
      messages, answers,
      reply: async (text, opts) => { messages.push({ text, opts }); },
      editMessageText: async (text, opts) => { messages.push({ text, opts, edit: true }); },
      answerCbQuery: async text => { answers.push(text); }
    };
  };
  const callback = data => {
    const found = handlers.action.filter(([pattern]) =>
      (pattern instanceof RegExp
        ? new RegExp(pattern.source, pattern.flags).test(data)
        : pattern === data)
    );
    // Pattern RegExps are created in another VM context.
    const exact = handlers.action.filter(([pattern]) =>
      typeof pattern === 'string' ? pattern === data : pattern && pattern.source
        ? new RegExp(pattern.source, pattern.flags).test(data) : false
    );
    assert.equal(exact.length, 1, 'Must have one action for ' + data);
    return [exact[0][1], data.match(new RegExp(exact[0][0].source, exact[0][0].flags))];
  };
  const runAction = async data => {
    const [fn, match] = callback(data);
    const ctx = context();
    ctx.match = match || [];
    await fn(ctx);
    return ctx;
  };
  const started = context();
  await handlers.start(started);
  assert.equal(started.messages.length, 1);
  assert.equal(started.messages[0].opts.reply_markup.keyboard.length, 3);

  const settingsHandler = handlers.hears.find(([name]) => name === MAIN_MENU.settings);
  const settings = context();
  await settingsHandler[1](settings);
  assert.ok(settings.messages[0].opts.reply_markup.inline_keyboard);
  assert.match(settings.messages[0].text, /Giọng tiếng Trung/);

  await runAction('set_voice_female2');
  assert.equal(state.voiceKey, 'female2');
  await runAction('set_speed_1.15');
  assert.equal(state.speed, 1.15);
  assert.equal(saves, 2);
  await runAction('toggle_vocab');
  assert.equal(state.showVocabulary, false);
  assert.equal(saves, 3);
  await runAction('toggle_pron');
  assert.equal(state.showPronunciation, false);
  await runAction('toggle_back');
  assert.equal(state.showBackTranslation, false);
  assert.equal(saves, 5);
  await runAction('toggle_trans');
  assert.equal(state.showTranslation, true);
  assert.equal(saves, 5);

  const oldInvalidEdit = context();
  oldInvalidEdit.editMessageText = async () => { throw new Error('message to edit not found'); };
  const [menuHandler] = callback('menu_voice');
  await menuHandler(oldInvalidEdit);
  assert.equal(oldInvalidEdit.messages.length, 1);
  assert.equal(oldInvalidEdit.answers.length, 1);

  assert.equal(handlers.hears.length, 6);
  for (const label of [MAIN_MENU.vocabulary, MAIN_MENU.practice, MAIN_MENU.statistics]) {
    const fn = handlers.hears.find(([name]) => name === label)[1];
    const ctx = context();
    await fn(ctx);
    assert.match(ctx.messages[0].text, label === MAIN_MENU.vocabulary
      ? /web PRO|\/link/ : /đang được phát triển/);
  }
  // Even if a menu label reaches the generic text fallback, it must be ignored.
  const fallback = handlers.on.find(([name]) => name === 'text')[1];
  const menuText = context();
  menuText.message.text = MAIN_MENU.settings;
  await fallback(menuText);
  assert.equal(translations, 0);
});

test('translation cache varies with vocabulary settings', () => {
  const bot = fs.readFileSync(path.join(__dirname, '..', 'bot.js'), 'utf8');
  assert.match(bot, /translateViaSharedCache\(text, c\.targetLang, c\.showVocabulary\)/);
});
