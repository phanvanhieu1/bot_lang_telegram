
const OpenAI = require('openai');
const { recordEvent } = require('../../api-monitoring/core');

function getOpenAIKeys() {
  return (process.env.OPENAI_API_KEYS || '')
    .split(',')
    .map(key => key.trim())
    .filter(Boolean);
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

  return new OpenAI({
    apiKey: keys[randomIndex],
    // Keep the SDK's retry/error handling; record transport results, not prompt text.
    fetch: async (url, options) => {
      const started = Date.now();
      let status = 502;
      try {
        const response = await fetch(url, options);
        status = response.status;
        return response;
      } finally {
        // Do not await metrics writes: monitoring must not delay or fail OpenAI calls.
        void recordEvent('translator', {
          provider: 'openai', operation: 'api',
          status, latencyMs: Date.now() - started
        }).catch(error => console.warn('OpenAI monitoring:', error.message));
      }
    }
  });
}

function getOpenAIKeyCount() {
  return getOpenAIKeys().length;
}

module.exports = {
  getRandomOpenAIClient,
  getOpenAIKeyCount
};
