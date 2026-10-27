'use strict';
const path = require('node:path');

// Pure validation so configuration safety can be verified without Telegram.
function validateTestConfig(env, productionBotToken) {
  const token = (env.TELEGRAM_TEST_BOT_TOKEN || '').trim();
  const adminId = (env.TELEGRAM_TEST_MASTER_ADMIN || '').trim();

  if (!/^\d{5,16}:[A-Za-z0-9_-]{30,150}$/.test(token)) {
    throw new Error('Thiếu hoặc sai TELEGRAM_TEST_BOT_TOKEN. Tạo bot thử nghiệm bằng @BotFather.');
  }
  if (productionBotToken && token === productionBotToken) {
    throw new Error('Token test trùng token production. Không khởi động để tránh xung đột VPS.');
  }
  if (!/^\d{5,20}$/.test(adminId)) {
    throw new Error('Thiếu TELEGRAM_TEST_MASTER_ADMIN (Telegram user ID dạng số).');
  }
  return {
    token,
    adminId,
    // AI key must be deliberately configured for the test bot, never inherited.
    openAIKeys: (env.TELEGRAM_TEST_OPENAI_API_KEYS || '').trim(),
    elevenLabsKey: (env.TELEGRAM_TEST_ELEVENLABS_API_KEY || '').trim(),
    dataDir: path.join(__dirname, '.telegram-test-data')
  };
}

module.exports = { validateTestConfig };
