
const OpenAI = require('openai');

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
    apiKey: keys[randomIndex]
  });
}

function getOpenAIKeyCount() {
  return getOpenAIKeys().length;
}

module.exports = {
  getRandomOpenAIClient,
  getOpenAIKeyCount
};
