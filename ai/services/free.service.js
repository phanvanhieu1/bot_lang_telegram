
const {
  getFreeCachedText,
  setFreeCachedText
} = require('../../cache');

const {
  requestGroq
} = require('../providers/groq.provider');

const {
  requestOpenRouter
} = require('../providers/openrouter.provider');

const {
  containsChinese,
  buildFreePrompt,
  buildBackTranslationPrompt
} = require('../prompts/free.prompt');

const {
  parseFreeTranslation
} = require('../utils/parser');

const {
  validateFreeTranslation
} = require('../utils/validator');

const FREE_CACHE_TTL = 24 * 60 * 60 * 1000;

function getFreeCachedTranslation(text) {
  const cached = getFreeCachedText(text);

  if (!cached) return null;

  if (
    !cached.createdAt ||
    Date.now() - cached.createdAt > FREE_CACHE_TTL
  ) {
    return null;
  }

  if (
    typeof cached.content !== 'string' ||
    !cached.content.trim()
  ) {
    return null;
  }

  let parsed = cached.parsed;

  if (
    !parsed ||
    typeof parsed.translation !== 'string' ||
    !parsed.translation.trim()
  ) {
    try {
      parsed = parseFreeTranslation(cached.content);
    } catch {
      return null;
    }
  }

  // Cache Việt → Trung phải có bản dịch ngược.
  // Cache cũ thiếu dữ liệu sẽ được tạo lại.
  if (
    !containsChinese(text) &&
    (
      typeof parsed.backTranslation !== 'string' ||
      !parsed.backTranslation.trim()
    )
  ) {
    return null;
  }

  return {
    content: cached.content,
    parsed
  };
}

function setFreeCachedTranslation(text, content, parsed) {
  setFreeCachedText(text, {
    content,
    parsed,
    createdAt: Date.now()
  });
}

function classifyProviderError(error, provider) {
  if (error?.code === 'INVALID_OUTPUT') {
    return {
      type: 'INVALID_OUTPUT',
      provider,
      retryable: true
    };
  }

  const status = error?.status;

  if (status === 429) {
    const metadata = error?.error?.metadata;

    if (
      provider === 'openrouter' &&
      metadata?.limit_source ===
        'upstream_provider_shared_pool'
    ) {
      return {
        type: 'UPSTREAM_RATE_LIMIT',
        provider,
        retryable: true
      };
    }

    return {
      type: 'RATE_LIMIT',
      provider,
      retryable: true
    };
  }

  if (status >= 500) {
    return {
      type: 'PROVIDER_ERROR',
      provider,
      retryable: true
    };
  }

  return {
    type: 'UNKNOWN',
    provider,
    retryable: false
  };
}

async function translateWithProvider(
  text,
  requestProvider,
  customPrompt = null
) {
  const prompt =
    customPrompt || buildFreePrompt(text);

  const result = await requestProvider(prompt);

  const parsed = parseFreeTranslation(result.content);

  validateFreeTranslation(text, parsed);

  return {
    content: result.content,
    parsed,
    provider: result.provider,
    rateLimit: result.rateLimit
  };
}

async function runTranslationPipeline(
  text,
  requestProvider
) {
  const inputIsChinese = containsChinese(text);

  const mainResult = await translateWithProvider(
    text,
    requestProvider
  );

  const finalParsed = {
    translation: mainResult.parsed.translation,
    backTranslation: null
  };

  let latestRateLimit = mainResult.rateLimit;

  if (!inputIsChinese) {
    const chineseTranslation =
      mainResult.parsed.translation;

    const backResult = await translateWithProvider(
      chineseTranslation,
      requestProvider,
      buildBackTranslationPrompt(chineseTranslation)
    );

    finalParsed.backTranslation =
      backResult.parsed.translation;

    latestRateLimit = backResult.rateLimit;
  }

  let finalContent =
    `TRANSLATION: ${finalParsed.translation}`;

  if (finalParsed.backTranslation) {
    finalContent +=
      `\nBACK_TRANSLATION: ${finalParsed.backTranslation}`;
  }

  return {
    content: finalContent,
    parsed: finalParsed,
    provider: mainResult.provider,
    cached: false,
    rateLimit: latestRateLimit
  };
}

async function translateFree(text) {
  const cachedResult = getFreeCachedTranslation(text);

  if (cachedResult) {
    return {
      content: cachedResult.content,
      parsed: cachedResult.parsed,
      provider: 'cache',
      cached: true,
      rateLimit: null
    };
  }

  let groqError = null;

  try {
    const result = await runTranslationPipeline(
      text,
      requestGroq
    );

    setFreeCachedTranslation(
      text,
      result.content,
      result.parsed
    );

    return result;
  } catch (error) {
    groqError = classifyProviderError(error, 'groq');

    console.error('Groq FREE error:', groqError);
  }

  // Chỉ fallback khi toàn bộ pipeline Groq thất bại.
  try {
    const result = await runTranslationPipeline(
      text,
      requestOpenRouter
    );

    setFreeCachedTranslation(
      text,
      result.content,
      result.parsed
    );

    return result;
  } catch (error) {
    const openRouterError = classifyProviderError(
      error,
      'openrouter'
    );

    console.error(
      'OpenRouter FREE error:',
      openRouterError
    );

    const finalError = new Error(
      'All FREE providers unavailable'
    );

    finalError.code =
      'FREE_PROVIDERS_UNAVAILABLE';

    finalError.providers = {
      groq: groqError,
      openrouter: openRouterError
    };

    throw finalError;
  }
}

module.exports = {
  translateFree
};
