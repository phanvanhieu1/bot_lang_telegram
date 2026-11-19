const { preprocess, COPY_RULE } = require('../pipeline/preprocess');
const { restore, restoreFields, maskExisting } = require('../pipeline/restore');
const { getFreeCachedText, setFreeCachedText } = require('../../web-cache');

const { requestGroq } = require('../providers/groq.provider');

const { requestOpenRouter } = require('../providers/openrouter.provider');

const { requestDeepL } = require('../providers/deepl.provider');

const { containsChinese, buildFreePrompt } = require('../prompts/free.prompt');

const { parseFreeTranslation } = require('../utils/parser');

const { validateFreeTranslation } = require('../utils/validator');

const FREE_CACHE_TTL = 24 * 60 * 60 * 1000;
const {
  glossaryInstructions,
  validateAppliedTerms
} = require('../terminology/resolver');
const {
  optimizedFreeRequest,
  outputBudget
} = require('../prompts/v1-optimized');

async function getFreeCachedTranslation(
  text,
  context = 'auto',
  prepared = preprocess(text)
) {
  const inputIsChinese = prepared.sourceLanguage === 'zh';
  const cached = await getFreeCachedText(text, 'zh', context);

  if (!cached) return null;

  if (!cached.createdAt || Date.now() - cached.createdAt > FREE_CACHE_TTL) {
    return null;
  }

  if (typeof cached.content !== 'string' || !cached.content.trim()) {
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

  // Reject old cache entries that saved English in place of Vietnamese.
  try {
    validateFreeTranslation(
      prepared.evidenceText,
      {
        ...parsed,
        translation: maskExisting(parsed.translation, prepared)
      },
      inputIsChinese
    );
  } catch (_) {
    return null;
  }

  // Cache Việt → Trung phải có bản dịch ngược.
  // Cache cũ thiếu dữ liệu sẽ được tạo lại.
  if (
    !inputIsChinese &&
    (typeof parsed.backTranslation !== 'string' ||
      !parsed.backTranslation.trim())
  ) {
    return null;
  }

  return {
    content: cached.content,
    parsed
  };
}

async function setFreeCachedTranslation(
  text,
  content,
  parsed,
  context = 'auto'
) {
  await setFreeCachedText(
    text,
    {
      content,
      parsed,
      createdAt: Date.now()
    },
    'zh',
    context
  );
}

// A successful provider response must not trigger a second paid AI request
// merely because the database failed to persist the cache.
async function persistFreeCache(text, result, context = 'auto') {
  try {
    await setFreeCachedTranslation(
      text,
      result.content,
      result.parsed,
      context
    );
  } catch (error) {
    console.error('FREE MongoDB cache write failed');
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
      metadata?.limit_source === 'upstream_provider_shared_pool'
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
  customPrompt = null,
  context = 'auto',
  prepared = preprocess(text)
) {
  const prompt =
    customPrompt ||
    (process.env.V1_OPTIMIZED_PROMPTS === 'true'
      ? optimizedFreeRequest(prepared.input, context, [], prepared.evidenceText)
      : buildFreePrompt(
          prepared.input,
          context,
          prepared.sourceLanguage === 'zh'
        ));

  const wire = prepared.spans.length
    ? typeof prompt === 'string'
      ? prompt + '\n' + COPY_RULE
      : { ...prompt, system: prompt.system + '\n' + COPY_RULE }
    : prompt;
  const result = await requestProvider(wire);
  const content = restoreFields(result.content, prepared);

  const parsed = parseFreeTranslation(content);

  validateFreeTranslation(
    prepared.evidenceText,
    parseFreeTranslation(result.content),
    prepared.sourceLanguage === 'zh'
  );

  return {
    content,
    parsed,
    provider: result.provider,
    rateLimit: result.rateLimit,
    usage: result.usage || null
  };
}

async function runTranslationPipeline(
  text,
  requestProvider,
  terms = [],
  context = 'auto',
  prepared = preprocess(text)
) {
  // Groq / OpenRouter: both directions are generated in ONE AI request.
  const result = await translateWithProvider(
    text,
    requestProvider,
    process.env.V1_OPTIMIZED_PROMPTS === 'true'
      ? {
          ...optimizedFreeRequest(
            prepared.input,
            context,
            terms,
            prepared.evidenceText
          ),
          maxCompletionTokens: outputBudget(text, {
            backTranslation: prepared.sourceLanguage !== 'zh'
          })
        }
      : terms.length
        ? buildFreePrompt(
            prepared.input,
            context,
            prepared.sourceLanguage === 'zh'
          ) + glossaryInstructions(terms)
        : null,
    context,
    prepared
  );

  const inputIsChinese = prepared.sourceLanguage === 'zh';

  if (!inputIsChinese) {
    if (
      typeof result.parsed.backTranslation !== 'string' ||
      !result.parsed.backTranslation.trim() ||
      containsChinese(preprocess(result.parsed.backTranslation).evidenceText)
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
      backTranslation: inputIsChinese ? null : result.parsed.backTranslation
    },
    provider: result.provider,
    cached: false,
    usage: result.usage || null,
    rateLimit: result.rateLimit
  };
}

async function runDeepLPipeline(text, prepared = preprocess(text)) {
  const inputIsChinese = prepared.sourceLanguage === 'zh';

  const maskedTranslation = await requestDeepL(
    prepared.input,
    inputIsChinese ? 'VI' : 'ZH'
  );
  const translation = restore(maskedTranslation, prepared);

  let backTranslation = null;

  if (!inputIsChinese) {
    backTranslation = restore(
      await requestDeepL(maskedTranslation, 'VI'),
      prepared
    );
  }

  const parsed = {
    translation,
    backTranslation
  };

  validateFreeTranslation(
    prepared.evidenceText,
    {
      translation: maskedTranslation,
      backTranslation
    },
    inputIsChinese
  );

  let content = `TRANSLATION: ${translation}`;

  if (backTranslation) {
    content += `\nBACK_TRANSLATION: ${backTranslation}`;
  }

  return {
    content,
    parsed,
    provider: 'deepl',
    cached: false,
    usage: null,
    rateLimit: null
  };
}

async function translateFree(text, options = {}) {
  const prepared = options.prepared || preprocess(text);
  const terms = options.terms || [],
    context = options.context || 'auto';
  // Shared cache cannot hold user-specific dictionary translations.
  const cachedResult = terms.length
    ? null
    : await getFreeCachedTranslation(text, context, prepared);

  if (cachedResult) {
    return {
      content: cachedResult.content,
      parsed: cachedResult.parsed,
      provider: 'cache',
      cached: true,
      usage: null,
      rateLimit: null
    };
  }

  let groqError = null;

  try {
    const result = await runTranslationPipeline(
      text,
      requestGroq,
      terms,
      context,
      prepared
    );

    if (!terms.length) await persistFreeCache(text, result, context);

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
      terms,
      context,
      prepared
    );

    if (!terms.length) await persistFreeCache(text, result, context);

    return result;
  } catch (error) {
    const openRouterError = classifyProviderError(error, 'openrouter');

    console.error('OpenRouter FREE error:', openRouterError);

    try {
      // DeepL cannot receive required glossary instructions; never silently
      // ignore approved user terminology during fallback.
      if (terms.length || context !== 'auto') {
        const e = new Error(
          'Glossary cannot be enforced with DeepL; explicit context also requires prompt-capable AI'
        );
        e.code = 'TERMINOLOGY_REQUIRED';
        throw e;
      }
      const result = await runDeepLPipeline(text, prepared);

      await persistFreeCache(text, result, context);

      return result;
    } catch (error) {
      const deeplError = classifyProviderError(error, 'deepl');

      console.error('DeepL FREE error:', deeplError);

      if (
        prepared.spans.length &&
        error?.code === 'TRANSLATION_MARKER_MISMATCH'
      )
        throw error;
      const finalError = new Error('All FREE providers unavailable');

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
