
const {
  getFreeCachedText,
  setFreeCachedText
} = require('../../web-cache');

const {
  requestGroq
} = require('../providers/groq.provider');

const {
  requestOpenRouter
} = require('../providers/openrouter.provider');

const {
  requestDeepL
} = require('../providers/deepl.provider');

const {
  containsChinese,
  buildFreePrompt
} = require('../prompts/free.prompt');

const {
  parseFreeTranslation
} = require('../utils/parser');

const {
  validateFreeTranslation
} = require('../utils/validator');

const FREE_CACHE_TTL = 24 * 60 * 60 * 1000;
const {glossaryInstructions,validateAppliedTerms}=require('../terminology/resolver');

async function getFreeCachedTranslation(text,context='auto') {
  const cached = await getFreeCachedText(text,'zh',context);

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

async function setFreeCachedTranslation(text, content, parsed,context='auto') {
  await setFreeCachedText(text, {
    content,
    parsed,
    createdAt: Date.now()
  },'zh',context);
}

// A successful provider response must not trigger a second paid AI request
// merely because the database failed to persist the cache.
async function persistFreeCache(text, result,context='auto') {
  try {
    await setFreeCachedTranslation(text, result.content, result.parsed,context);
  } catch (error) {
    console.error('FREE MongoDB cache write error:', error);
  }
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
  customPrompt = null,context='auto'
) {
  const prompt =
    customPrompt || buildFreePrompt(text,context);

  const result = await requestProvider(prompt);

  const parsed = parseFreeTranslation(result.content);

  validateFreeTranslation(text, parsed);

  return {
    content: result.content,
    parsed,
    provider: result.provider,
    rateLimit: result.rateLimit,
    usage: result.usage||null
  };
}

async function runTranslationPipeline(
  text,
  requestProvider,
  terms=[],context='auto'
) {
  // Groq / OpenRouter: both directions are generated in ONE AI request.
  const result = await translateWithProvider(
    text,
    requestProvider,
    terms.length?buildFreePrompt(text,context)+glossaryInstructions(terms):null,
    context
  );

  const inputIsChinese = containsChinese(text);

  if (!inputIsChinese) {
    if (
      typeof result.parsed.backTranslation !== 'string' ||
      !result.parsed.backTranslation.trim() ||
      containsChinese(result.parsed.backTranslation)
    ) {
      const error = new Error('Missing or invalid reverse translation');
      error.code = 'INVALID_OUTPUT';
      throw error;
    }
  }

  return {
    content: result.content,
    parsed: {
      translation: result.parsed.translation,
      backTranslation: inputIsChinese
        ? null
        : result.parsed.backTranslation
    },
    provider: result.provider,
    cached: false,
    usage:result.usage||null,
    rateLimit: result.rateLimit
  };
}

async function runDeepLPipeline(text) {
  const inputIsChinese = containsChinese(text);

  const translation = await requestDeepL(
    text,
    inputIsChinese ? 'VI' : 'ZH'
  );

  let backTranslation = null;

  if (!inputIsChinese) {
    backTranslation = await requestDeepL(
      translation,
      'VI'
    );
  }

  const parsed = {
    translation,
    backTranslation
  };

  validateFreeTranslation(text, parsed);

  let content = `TRANSLATION: ${translation}`;

  if (backTranslation) {
    content +=
      `\nBACK_TRANSLATION: ${backTranslation}`;
  }

  return {
    content,
    parsed,
    provider: 'deepl',
    cached: false,
    usage:null,
    rateLimit: null
  };
}

async function translateFree(text,options={}) {
  const terms=options.terms||[],context=options.context||'auto';
  // Shared cache cannot hold user-specific dictionary translations.
  const cachedResult = terms.length?null:await getFreeCachedTranslation(text,context);

  if (cachedResult) {
    return {
      content: cachedResult.content,
      parsed: cachedResult.parsed,
      provider: 'cache',
      cached: true,
      usage:null,
      rateLimit: null
    };
  }

  let groqError = null;

  try {
    const result = await runTranslationPipeline(
      text,
      requestGroq,
      terms,context
    );

    if(!terms.length)await persistFreeCache(text, result,context);

    return result;
  } catch (error) {
    groqError = classifyProviderError(error, 'groq');

    console.error('Groq FREE error:', groqError);
  }

  // Chỉ fallback khi toàn bộ pipeline Groq thất bại.
  try {
    const result = await runTranslationPipeline(
      text,
      requestOpenRouter,
      terms,context
    );

    if(!terms.length)await persistFreeCache(text, result,context);

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

    try {
  // DeepL cannot receive required glossary instructions; never silently
  // ignore approved user terminology during fallback.
  if(terms.length||context!=='auto'){
    const e=new Error('Glossary or explicit context cannot be enforced with DeepL');
    e.code='TERMINOLOGY_REQUIRED';throw e;
  }
  const result = await runDeepLPipeline(text);

  await persistFreeCache(text, result,context);

  return result;
} catch (error) {
  const deeplError = classifyProviderError(
    error,
    'deepl'
  );

  console.error('DeepL FREE error:', deeplError);

  const finalError = new Error(
    'All FREE providers unavailable'
  );

  finalError.code = 'FREE_PROVIDERS_UNAVAILABLE';

  finalError.providers = {
    groq: groqError,
    openrouter: openRouterError,
    deepl: deeplError
  };

  throw finalError;
}
  }
}

module.exports = {
  translateFree
};
