const { preprocess, COPY_RULE } = require('../pipeline/preprocess');
const {
  restoreFields,
  maskExisting,
  locationPair
} = require('../pipeline/restore');
const { CONTEXT_RULE } = require('../pipeline/payload');
const { markContextSent } = require('../debug/inspector');
const {
  getShuffledOpenAIClients,
  requestChatCompletion
} = require('../providers/openai.provider');

const { buildProPrompt } = require('../prompts/pro.prompt');
const { glossaryInstructions } = require('../terminology/resolver');
const { optimizedProRequest } = require('../prompts/v1-optimized');
const {
  v1ModelFor,
  V1_JSON_SCHEMA,
  parseV1Json
} = require('../prompts/v1-output');
const {
  translationLanguageIssue,
  sanitizeV1BackTranslation
} = require('../utils/translation-language');

// 3. CORE 1: Dịch thuật & Phân tích ảnh có FAILOVER (Chống sập)
// Thêm tham số `history` vào hàm
async function translateFull(
  text,
  targetLangKey,
  isFastMode,
  imageUrl = null,
  history = [],
  returnUsage = false,
  options = {}
) {
  const prepared = options.prepared || preprocess(text, targetLangKey);
  const masked = prepared.input;
  const existingTranslation = maskExisting(
    options.existingTranslation,
    prepared
  );
  const promptOptions = {
    ...options,
    existingTranslation,
    directionText: prepared.evidenceText
  };
  const optimized =
    process.env.V1_OPTIMIZED_PROMPTS === 'true' &&
    !imageUrl &&
    targetLangKey === 'zh';
  const jsonMode = optimized && process.env.V1_OPTIMIZED_JSON_SCHEMA === 'true';
  const request = optimized
    ? optimizedProRequest(text, targetLangKey, isFastMode, {
        ...promptOptions,
        wireSource: masked,
        directionText: prepared.evidenceText,
        jsonMode
      })
    : null;
  const baseSystem = optimized
    ? request.system
    : buildProPrompt(masked, targetLangKey, isFastMode, promptOptions) +
      glossaryInstructions(options.terms || []);
  const pair = locationPair(prepared);
  const systemPrompt = [
    baseSystem,
    prepared.spans.length && COPY_RULE,
    pair &&
      'Exception for this source: the URL marker is explicitly the location and the ID marker is the item. Chinese may place 在 URL-marker 上 before the ID marker. The reverse binding is invalid.',
    options.contextHints && CONTEXT_RULE
  ]
    .filter(Boolean)
    .join('\n');
  const userContent = [];
  if (text) {
    const wire = optimized ? request.user : masked;
    const payload = options.contextHints
      ? JSON.stringify({
          ...(optimized ? JSON.parse(wire) : { source: wire }),
          contextHints: options.contextHints
        })
      : wire;
    userContent.push({ type: 'text', text: payload });
  }
  if (imageUrl) {
    userContent.push({ type: 'text', text: 'Dịch văn bản trong ảnh.' });
    userContent.push({ type: 'image_url', image_url: { url: imageUrl } });
  }

  // BƠM NGỮ CẢNH VÀO MẢNG MESSAGES
  const messages = [{ role: 'system', content: systemPrompt }];

  // Đưa 5 tin nhắn lịch sử vào để bot nhớ
  history.forEach((h) => {
    messages.push({ role: 'user', content: h.user });
    messages.push({ role: 'assistant', content: h.bot });
  });

  messages.push({ role: 'user', content: userContent });

  // Manual model selection applies to the primary V1 translation only.
  // Existing supplemental vocabulary/back-translation uses the prior model.
  // Legacy clients without a selection retain existing tier rules.
  if (
    options.translationModel != null &&
    !['gpt-4o', 'gpt-4o-mini'].includes(options.translationModel)
  )
    throw new Error('V1_INVALID_TRANSLATION_MODEL');
  const model =
    (!options.existingTranslation && options.translationModel) ||
    (optimized
      ? v1ModelFor(text, {
          ...options,
          history,
          imageUrl,
          backTranslation: !isFastMode && options.backTranslation !== false,
          vocabulary: !isFastMode && options.vocabulary !== false
        })
      : 'gpt-4o');
  const clients = getShuffledOpenAIClients();
  if (!clients.length)
    throw new Error('Chưa cấu hình OPENAI_API_KEYS cho Telegram bot');

  let lastError = null;
  let protectionRetried = false;
  for (const openai of clients) {
    try {
      const startedAt = Date.now();
      const callBody = {
        // Lower sampling variance for operational messages; semantic quality
        // is still driven by the prompt and verified examples.
        model,
        messages,
        temperature: 0.1,
        ...(optimized
          ? { max_completion_tokens: request.maxCompletionTokens }
          : {}),
        ...(jsonMode
          ? {
              response_format: {
                type: 'json_schema',
                json_schema: {
                  name: 'v1_translation',
                  strict: true,
                  schema: V1_JSON_SCHEMA
                }
              }
            }
          : {})
      };
      if (options.contextHints) markContextSent();
      let response = await requestChatCompletion(
        openai,
        callBody,
        options.existingTranslation ? 'supplement' : 'translator'
      );
      let rawContent = response.choices?.[0]?.message?.content?.trim();
      if (!rawContent) throw new Error('OpenAI returned an empty translation');
      const parseContent = (raw) =>
        jsonMode
          ? parseV1Json(raw, {
              supplement: Boolean(options.existingTranslation),
              backTranslation: !isFastMode && options.backTranslation !== false,
              vocabulary: !isFastMode && options.vocabulary !== false
            })
          : raw;
      const decode = (raw) => {
        const backCheck = sanitizeV1BackTranslation(parseContent(raw), text);
        return {
          backCheck,
          content: restoreFields(backCheck.content, prepared, {
            supplement: Boolean(existingTranslation)
          })
        };
      };
      const firstUsage = response.usage;
      let decoded;
      let acceptedMessages = messages;
      try {
        decoded = decode(rawContent);
      } catch (error) {
        if (error.code !== 'TRANSLATION_MARKER_MISMATCH' || protectionRetried)
          throw error;
        protectionRetried = true;
        // Reuse the same translator once, only after deterministic validation failed.
        const ordered = prepared.spans.map((span) => span.token).join(', ');
        const retryBody = {
          ...callBody,
          messages: [
            {
              role: 'system',
              content:
                systemPrompt +
                '\nThe previous response violated the marker sequence. Use this exact sequence: ' +
                ordered +
                '. The suffix is meaningful: an _ID marker stays attached to its item and an _URL marker stays the web address. For “submit ID on URL”, use “submit ID; the platform is URL”. Never make an ID the platform or a URL the item. Return only the requested fields.'
            },
            ...messages.slice(1)
          ]
        };
        response = await requestChatCompletion(
          openai,
          retryBody,
          'protection-retry'
        );
        acceptedMessages = retryBody.messages;
        rawContent = response.choices?.[0]?.message?.content?.trim();
        if (!rawContent) throw error;
        decoded = decode(rawContent);
      }
      const { content, backCheck } = decoded;
      const extractedTranslation = (raw) => {
        const lines = String(raw || '').split(String.fromCharCode(10));
        const index = lines.findIndex((line) =>
          line.trim().toUpperCase().startsWith('TRANSLATION:')
        );
        if (index < 0) return '';
        const first = lines[index].slice(lines[index].indexOf(':') + 1).trim();
        const remaining = [];
        for (const line of lines.slice(index + 1)) {
          const upper = line.trim().toUpperCase();
          if (
            ['BACK_TRANSLATION:', 'VOCABULARY:', 'VERIFICATION:'].some((x) =>
              upper.startsWith(x)
            )
          )
            break;
          remaining.push(line);
        }
        return [first, ...remaining].join(String.fromCharCode(10)).trim();
      };
      // Validate the requested output language locally, without another API call.
      // Wrong-language results fail closed and cannot enter the translation cache.
      if (
        !options.existingTranslation &&
        translationLanguageIssue(
          prepared.evidenceText,
          extractedTranslation(backCheck.content)
        )
      ) {
        const error = new Error('V1_WRONG_TARGET_LANGUAGE');
        error.code = 'V1_WRONG_TARGET_LANGUAGE';
        throw error;
      }
      const aggregateUsage = { ...response.usage };
      if (firstUsage && acceptedMessages !== messages) {
        for (const field of [
          'prompt_tokens',
          'completion_tokens',
          'total_tokens'
        ]) {
          aggregateUsage[field] =
            (firstUsage[field] || 0) + (aggregateUsage[field] || 0);
        }
        aggregateUsage.prompt_tokens_details = {
          ...aggregateUsage.prompt_tokens_details,
          cached_tokens:
            (firstUsage.prompt_tokens_details?.cached_tokens || 0) +
            (aggregateUsage.prompt_tokens_details?.cached_tokens || 0)
        };
      }
      // Exact provider-visible messages and raw output, captured only after
      // an explicitly requested V1 inspection. Never log or persist the trace.
      if (typeof options.inspectStage === 'function' && !imageUrl) {
        options.inspectStage({
          role: options.existingTranslation ? 'supplement' : 'translator',
          provider: 'openai',
          model: response.model || model,
          system: acceptedMessages[0].content,
          input: JSON.stringify(acceptedMessages.slice(1)),
          rawOutput: rawContent,
          ms: Date.now() - startedAt,
          usage: {
            input: aggregateUsage?.prompt_tokens || 0,
            output: aggregateUsage?.completion_tokens || 0,
            ...(optimized ||
            aggregateUsage?.prompt_tokens_details?.cached_tokens
              ? {
                  cacheRead:
                    aggregateUsage?.prompt_tokens_details?.cached_tokens || 0
                }
              : {})
          }
        });
      }
      return returnUsage
        ? {
            content,
            usage: { ...aggregateUsage, model: response.model || model },
            ...(backCheck.issue
              ? { backTranslationWarning: backCheck.issue }
              : {})
          }
        : content;
    } catch (error) {
      lastError = error;
      // Invalid input will fail for every key; do not burn retries.
      if (
        [400, 413, 422].includes(error?.status) ||
        ['V1_WRONG_TARGET_LANGUAGE', 'TRANSLATION_MARKER_MISMATCH'].includes(
          error?.code
        )
      )
        throw error;
      console.error(
        '[Telegram translation] OpenAI attempt failed:',
        error?.status || error?.code || 'UNKNOWN'
      );
    }
  }
  const finalError = new Error(
    'Tất cả API key OpenAI đã thử đều không khả dụng',
    { cause: lastError }
  );
  finalError.status = lastError?.status;
  throw finalError;
}

module.exports = {
  translateFull
};
