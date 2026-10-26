require('dotenv').config();
const OpenAI = require('openai');

const groqClient = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1'
});

async function requestGroq(prompt) {
  const { data, response } =
    await groqClient.chat.completions
      .create({
        model: 'qwen/qwen3.8-27b',
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
      'Groq returned empty translation'
    );
  }

  const rateLimit = {
    requests: {
      limit: Number(
        response.headers.get(
          'x-ratelimit-limit-requests'
        )
      ),
      remaining: Number(
        response.headers.get(
          'x-ratelimit-remaining-requests'
        )
      ),
      reset: response.headers.get(
        'x-ratelimit-reset-requests'
      )
    },

    tokens: {
      limit: Number(
        response.headers.get(
          'x-ratelimit-limit-tokens'
        )
      ),
      remaining: Number(
        response.headers.get(
          'x-ratelimit-remaining-tokens'
        )
      ),
      reset: response.headers.get(
        'x-ratelimit-reset-tokens'
      )
    }
  };

  return {
    content,
    provider: 'groq',
    rateLimit
  };
}

const { observed } = require('../../api-monitoring/observe');
module.exports = {
  requestGroq: (...args) => observed('groq', 'translate', () => requestGroq(...args))
};
