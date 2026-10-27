
const OpenAI = require('openai');
const { recordEvent } = require('../../api-monitoring/core');

function getOpenAIKeys() {
  return (process.env.OPENAI_API_KEYS || '')
    .split(',')
    .map(key => key.trim())
    .filter(Boolean);
}

function createOpenAIClient(key) {
  return new OpenAI({
    apiKey: key,
    // Monitoring never records prompts, responses or credentials.
    fetch: async (url, options) => {
      const started = Date.now();
      let status = 502;
      try {
        const response = await fetch(url, options);
        status = response.status;
        return response;
      } finally {
        // Local test bot should not write events into the production DB.
        if (process.env.TELEGRAM_TEST_MODE !== '1') {
          void recordEvent('translator', {
            provider: 'openai', operation: 'api',
            status, latencyMs: Date.now() - started
          }).catch(error => console.warn('OpenAI monitoring:', error.message));
        }
      }
    }
  });
}

function getShuffledOpenAIClients() {
  const keys = [...new Set(getOpenAIKeys())];
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }
  return keys.map(createOpenAIClient);
}

function getRandomOpenAIClient() {
  const keys = getOpenAIKeys();

  if (keys.length === 0) {
    throw new Error(
      '❌ Không tìm thấy OPENAI_API_KEYS trong file .env'
    );
  }

  const randomIndex =
    Math.floor(Math.random() * keys.length);

  return createOpenAIClient(keys[randomIndex]);
}

function getOpenAIKeyCount() {
  return getOpenAIKeys().length;
}

module.exports = {
  getRandomOpenAIClient,
  getOpenAIKeyCount,
  getShuffledOpenAIClients
};
