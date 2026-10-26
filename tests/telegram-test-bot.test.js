'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateTestConfig } = require('../telegram-test-config');

const TOKEN = '123456789:' + 'A'.repeat(35);
const ANOTHER_TOKEN = '987654321:' + 'B'.repeat(35);
const base = {
  TELEGRAM_TEST_BOT_TOKEN: TOKEN,
  TELEGRAM_TEST_MASTER_ADMIN: '123456789'
};

test('test token must be present and must not equal production token', () => {
  assert.throws(() => validateTestConfig({ ...base, TELEGRAM_TEST_BOT_TOKEN: '' }, ANOTHER_TOKEN), /TELEGRAM_TEST_BOT_TOKEN/);
  assert.throws(() => validateTestConfig(base, TOKEN), /trùng token production/);
  const config = validateTestConfig(base, ANOTHER_TOKEN);
  assert.equal(config.token, TOKEN);
  assert.equal(config.adminId, '123456789');
});

test('test bot requires its own admin and deliberately declared AI keys', () => {
  assert.throws(() => validateTestConfig({ ...base, TELEGRAM_TEST_MASTER_ADMIN: '' }, ''), /TELEGRAM_TEST_MASTER_ADMIN/);
  const config = validateTestConfig(base, '');
  assert.equal(config.openAIKeys, '');
  assert.equal(config.elevenLabsKey, '');
  assert.equal(config.dataDir, path.join(__dirname, '..', '.telegram-test-data'));
});

test('test storage and secret file are excluded from Git', () => {
  const root = path.join(__dirname, '..');
  const ignored = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  const launcher = fs.readFileSync(path.join(root, 'bot-test.js'), 'utf8');
  const session = fs.readFileSync(path.join(root, 'session.js'), 'utf8');
  const cache = fs.readFileSync(path.join(root, 'cache.js'), 'utf8');
  assert.match(ignored, /\.env\.telegram-test/);
  assert.match(ignored, /\.telegram-test-data\//);
  assert.match(launcher, /process\.env\.TELEGRAM_DATA_DIR = config\.dataDir/);
  assert.match(launcher, /process\.env\.TELEGRAM_BOT_TOKEN = config\.token/);
  assert.match(launcher, /process\.env\.OPENAI_API_KEYS = config\.openAIKeys/);
  assert.match(session, /path\.join\(DATA_DIR, 'vocabulary\.json'\)/);
  assert.match(cache, /path\.join\(DATA_DIR, 'cache_audio'\)/);
});

test('production behavior still defaults to its legacy data files', () => {
  const root = path.join(__dirname, '..');
  const session = fs.readFileSync(path.join(root, 'session.js'), 'utf8');
  const cache = fs.readFileSync(path.join(root, 'cache.js'), 'utf8');
  assert.match(session, /process\.env\.TELEGRAM_DATA_DIR \|\| __dirname/);
  assert.match(cache, /process\.env\.TELEGRAM_DATA_DIR \|\| __dirname/);
});

test('test mode does not write OpenAI events to production monitoring', () => {
  const root = path.join(__dirname, '..');
  const openai = fs.readFileSync(path.join(root, 'ai/providers/openai.provider.js'), 'utf8');
  assert.match(openai, /process\.env\.TELEGRAM_TEST_MODE !== '1'/);
});
