const axios = require('axios');

const DEEPL_API_URL =
  'https://api-free.deepl.com/v2/translate';

/**
 * Dịch văn bản bằng DeepL API Free.
 *
 * @param {string} text - Văn bản cần dịch
 * @param {'ZH'|'VI'} targetLang - Ngôn ngữ đích
 * @returns {Promise<string>}
 */
async function requestDeepL(text, targetLang) {
  const apiKey = process.env.DEEPL_API_KEY;

  if (!apiKey) {
    throw new Error('DEEPL_API_KEY is missing');
  }

  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('DeepL text is empty');
  }

  if (!['ZH', 'VI'].includes(targetLang)) {
    throw new Error('Unsupported DeepL target language');
  }

  try {
    const response = await axios.post(
      DEEPL_API_URL,
      {
        text: [text],
        target_lang: targetLang
      },
      {
        headers: {
          Authorization: `DeepL-Auth-Key ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    const translation =
      response.data?.translations?.[0]?.text;

    if (!translation || !translation.trim()) {
      const error = new Error(
        'DeepL returned an empty translation'
      );
      error.code = 'INVALID_OUTPUT';
      throw error;
    }

    return translation.trim();
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const wrappedError = new Error(
        `DeepL request failed: ${error.response?.status || error.code || 'UNKNOWN'}`
      );

      wrappedError.status = error.response?.status;
      wrappedError.code = error.code;

      throw wrappedError;
    }

    throw error;
  }
}

module.exports = {
  requestDeepL
};