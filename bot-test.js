'use strict';
const path = require('node:path');
const fs = require('node:fs');
const dotenv = require('dotenv');
const { validateTestConfig } = require('./telegram-test-config');

// Existing .env is read only to compare the production Telegram token.
// Its AI credentials are deliberately NOT reused without explicit opt-in.
dotenv.config({ path: path.join(__dirname, '.env') });
const productionToken = process.env.TELEGRAM_BOT_TOKEN || '';
const testEnvFile = path.join(__dirname, '.env.telegram-test');
if (fs.existsSync(testEnvFile)) {
  dotenv.config({ path: testEnvFile });
}

function main() {
  const config = validateTestConfig(process.env, productionToken);

  process.env.TELEGRAM_TEST_MODE = '1';
  process.env.TELEGRAM_BOT_TOKEN = config.token;
  process.env.MASTER_ADMIN = config.adminId;
  process.env.TELEGRAM_DATA_DIR = config.dataDir;
  process.env.OPENAI_API_KEYS = config.openAIKeys;
  if (config.elevenLabsKey) {
    process.env.ELEVENLABS_API_KEY = config.elevenLabsKey;
  } else {
    delete process.env.ELEVENLABS_API_KEY;
  }

  // Load bot.js only AFTER setting the isolated identity and data directory.
  const { bot, launchTelegramBot } = require('./bot');
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
  console.log('🧪 Telegram TEST mode: lưu dữ liệu riêng trong .telegram-test-data/');
  if (!config.openAIKeys) {
    console.log('🧪 Chưa cấu hình AI key test: có thể kiểm tra menu; chức năng dịch cần key riêng.');
  }
  if (!config.elevenLabsKey) {
    console.log('🧪 Chưa cấu hình ElevenLabs test: giọng đọc chưa thể hoạt động.');
  }
  return launchTelegramBot();
}

if (require.main === module) {
  main().catch(error => {
    // Never print bot tokens or secret values in error messages.
    console.error('Không thể khởi chạy test bot:', error.message);
    process.exitCode = 1;
  });
}
module.exports = { main };
