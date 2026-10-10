require('dotenv').config();
const OpenAI = require('openai');

const openRouterClient = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1'
});

async function requestOpenRouter(prompt) {
  const { data, response } =
    await openRouterClient.chat.completions
      .create({
        model: 'google/gemma-4-31b-it:free',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0
      })
      .withResponse();

  const content =
    data.choices[0]?.message?.content?.trim();

  if (!content) {
    throw new Error(
      'OpenRouter returned empty translation'
    );
  }

  const rateLimit = {
    requests: {
      limit: getHeaderNumber(
        response.headers,
        'x-ratelimit-limit'
      ),
      remaining: getHeaderNumber(
        response.headers,
        'x-ratelimit-remaining'
      ),
      reset: response.headers.get(
        'x-ratelimit-reset'
      )
    }
  };

  return {
    content,
    provider: 'openrouter',
    rateLimit
  };
}

function getHeaderNumber(headers, name) {
  const value = headers.get(name);

  if (value === null || value === '') {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

module.exports = {
  requestOpenRouter
};
