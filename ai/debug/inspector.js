const { AsyncLocalStorage } = require('node:async_hooks');
const { isObjectIdOrHexString } = require('mongoose');
const { normalizeContext } = require('../prompts/context-policy');

const requests = new AsyncLocalStorage();
const MAX_STAGES = 24;
const MAX_RAW_BYTES = 120_000;
const MAX_STAGE_BYTES = 48_000;
const SECRET_FIELD =
  /(?:^|[-_])(?:authorization|cookies?|password|secret|token|api[-_]?key)(?:$|[-_])|^(?:accessToken|refreshToken|sessionToken|authToken|clientSecret|privateKey|headers)$/i;
const REQUEST_FIELDS = new Set([
  'model',
  'system',
  'instructions',
  'messages',
  'input',
  'text',
  'target_lang',
  'temperature',
  'max_completion_tokens',
  'max_tokens',
  'max_output_tokens',
  'reasoning',
  'thinking',
  'response_format',
  'output_config',
  'stream'
]);

function secretValues() {
  return Object.entries(process.env)
    .filter(([key]) =>
      /KEYS?|TOKEN|SECRET|PASSWORD|MONGODB_URI|COOKIE|AUTHORIZATION/i.test(key)
    )
    .flatMap(([key, value]) =>
      /KEYS$/.test(key) ? value.split(/[\s,;]+/) : [value]
    )
    .filter((value) => value.length >= 8);
}

function redactText(value, secrets) {
  let text = value;
  for (const secret of secrets) text = text.split(secret).join('[redacted]');
  return text
    .replace(
      /-----BEGIN [^-\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\n]*PRIVATE KEY-----/g,
      '[redacted]'
    )
    .replace(
      /(?:mongodb(?:\+srv)?:\/\/|https?:\/\/)[^\s/@"']+:[^\s/@"']+@/gi,
      '[redacted]@'
    )
    .replace(
      /\b(?:Bearer|Basic|DeepL-Auth-Key)\s+[A-Za-z0-9+/_.=-]+/gi,
      '[redacted]'
    )
    .replace(
      /\b(?:sk-|gsk_|ghp_|github_pat_|xox[baprs]-|AIza)[A-Za-z0-9_-]{8,}\b/g,
      '[redacted]'
    )
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      '[redacted]'
    )
    .replace(/\b\d{6,12}:[A-Za-z0-9_-]{25,}\b/g, '[redacted]')
    .replace(
      /(^|\r?\n)([ \t]*(?:authorization|set-cookie|cookie)[ \t]*:)[^\r\n]*/gi,
      '$1$2 [redacted]'
    )
    .replace(
      /((?:"|\\")?(?:authorization|set-cookie|cookie|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|auth[_ -]?token|password|client[_ -]?secret|session[_ -]?secret|private[_ -]?key|token|secret)(?:"|\\")?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\n,;}]+)/gi,
      '$1[redacted]'
    );
}

function redact(value, secrets, depth = 0) {
  if (depth > 40) return '[redacted: nesting limit]';
  if (typeof value === 'string') {
    if (/^\s*(?:\{|\[)/.test(value)) {
      let parsed;
      try {
        parsed = JSON.parse(value);
      } catch {}
      if (parsed && typeof parsed === 'object') {
        const original = JSON.stringify(parsed);
        const filtered = JSON.stringify(redact(parsed, secrets, depth + 1));
        return filtered === original ? value : filtered;
      }
    }
    return redactText(value, secrets);
  }
  if (Array.isArray(value))
    return value.map((item) => redact(item, secrets, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !SECRET_FIELD.test(key))
        .map(([key, item]) => [key, redact(item, secrets, depth + 1)])
    );
  }
  return value;
}

function translationDebug(engine) {
  return (req, res, next) => {
    const debug = {
      engine,
      startedAt: Date.now(),
      stages: [],
      glossary: null,
      raw: req.user?.role === 'admin' && req.body?.inspectAI === true,
      remaining: MAX_RAW_BYTES,
      omittedStages: 0
    };
    req.translationDebug = debug;
    res.set('Cache-Control', 'private, no-store');
    return requests.run(debug, next);
  };
}

function glossaryObserver() {
  const debug = requests.getStore();
  return (
    debug &&
    ((decision) => {
      debug.glossary = decision;
    })
  );
}

function recordPipeline(prepared, resolution, hints, bypassCache) {
  const debug = requests.getStore();
  if (!debug) return;
  const counts = {};
  for (const { kind } of prepared.spans) counts[kind] = (counts[kind] || 0) + 1;
  debug.preprocessing = {
    sourceLanguage: prepared.sourceLanguage,
    fallback: prepared.fallback,
    characters: prepared.characters,
    lines: prepared.lines,
    protected: counts
  };
  debug.resolution = resolution;
  debug.hints = hints;
  debug.bypassCache = bypassCache;
}

function markContextSent() {
  const debug = requests.getStore();
  if (debug) debug.contextSent = true;
}

function safeUsage(usage = {}) {
  return Object.fromEntries(
    Object.entries(usage).filter(
      ([key, value]) =>
        ['input', 'output', 'cacheRead', 'cacheWrite'].includes(key) &&
        Number.isFinite(value)
    )
  );
}

async function observeProvider(
  { provider, role, body, model = body.model },
  send,
  read
) {
  const debug = requests.getStore();
  if (!debug) return send();
  if (debug.stages.length >= MAX_STAGES) {
    debug.omittedStages++;
    return send();
  }
  const stage = { provider, role, model: model ?? null, status: 'attempted' };
  debug.stages.push(stage);
  const startedAt = Date.now();
  const secrets = debug.raw ? secretValues() : [];
  function attach(field, value) {
    if (!debug.raw) return;
    try {
      if (Buffer.byteLength(JSON.stringify(value)) > MAX_STAGE_BYTES) {
        stage[field + 'Status'] = 'size_limit';
        return;
      }
      const filtered = redact(value, secrets);
      const bytes = Buffer.byteLength(JSON.stringify(filtered));
      if (bytes <= Math.min(MAX_STAGE_BYTES, debug.remaining)) {
        stage[field] = filtered;
        debug.remaining -= bytes;
      } else stage[field + 'Status'] = 'size_limit';
    } catch {
      stage[field + 'Status'] = 'capture_unavailable';
    }
  }
  if (debug.raw)
    attach(
      'request',
      Object.fromEntries(
        Object.entries(body).filter(([key]) => REQUEST_FIELDS.has(key))
      )
    );
  try {
    const result = await send();
    stage.status = 'received';
    try {
      const details = read(result);
      stage.usage = safeUsage(details.usage);
      if (typeof details.output === 'string') attach('output', details.output);
    } catch {
      stage.outputStatus = 'capture_unavailable';
    }
    return result;
  } catch (error) {
    stage.status = 'failed';
    const status = Number(
      error.status || error.statusCode || error.response?.status
    );
    if (status >= 100 && status <= 599) stage.httpStatus = status;
    throw error;
  } finally {
    stage.elapsedMs = Date.now() - startedAt;
  }
}

function chatDetails(response) {
  return {
    output: response.choices?.[0]?.message?.content,
    usage: {
      input: response.usage?.prompt_tokens,
      output: response.usage?.completion_tokens,
      cacheRead: response.usage?.prompt_tokens_details?.cached_tokens
    }
  };
}

function debugResponse(
  req,
  res,
  {
    context,
    cacheHit = false,
    cacheStatus = cacheHit ? 'hit' : 'miss',
    translation = '',
    glossaryUsage = 'not_used',
    requestUsage
  } = {}
) {
  const debug = req.translationDebug;
  const session = req.get('x-conversation-session');
  const saved = res.get('X-Conversation-Turn') === 'saved';
  const glossary = debug.glossary;
  const { matchingTerm } = require('../terminology/resolver');
  const sent =
    glossaryUsage === 'sent' &&
    glossary?.selected.length > 0 &&
    debug.stages.some((stage) =>
      ['translator', 'supplement', 'repair'].includes(stage.role)
    );
  const selected = glossary?.selected.map((term) => ({
    ...term,
    sent,
    status: term.conditional ? 'conditional_candidate' : 'selected',
    outputMatch: matchingTerm(translation, term.meaning) >= 0
  }));
  const terms = glossary
    ? {
        ...glossary,
        selected,
        observedMeanings: selected
          .filter((term) => term.outputMatch)
          .map(({ source, meaning, domain }) => ({ source, meaning, domain })),
        outputEvidence: 'text_match_only'
      }
    : null;
  const resolution = debug.resolution;
  const best = resolution?.best;
  const contextSummary = ({ contextId, name, domain, description }) => ({
    contextId,
    name,
    domain,
    description
  });
  const secrets = secretValues();
  const personal = {
    status:
      resolution?.status ||
      (debug.engine === 'v2' ? 'not_implemented' : 'disabled'),
    reason:
      resolution?.reason ||
      (best
        ? null
        : resolution
          ? 'insufficient_source_evidence'
          : debug.engine === 'v2'
            ? 'personal_context_resolver_not_connected'
            : 'resolver_disabled'),
    userProfile: {
      retrieved: Boolean(resolution?.metadata),
      found: resolution?.metadata
        ? (resolution.metadata.revision ??
            (resolution.metadata.setupStatus === 'configured' ? 1 : 0)) > 0
        : null,
      setupStatus: resolution?.metadata?.setupStatus,
      used: null,
      sent: null
    },
    retrievedCount: resolution?.contexts?.length || 0,
    threshold: resolution?.threshold ?? null,
    evaluatedCount:
      resolution?.evaluated?.length ?? resolution?.contexts?.length ?? 0,
    candidates:
      (resolution?.evaluated || resolution?.ranked)?.map((item) => ({
        ...contextSummary(item.context),
        evidence: item.evidence,
        score: item.score,
        method: item.method,
        reason: item.reason
      })) || [],
    selected: best ? contextSummary(best.context) : null,
    method: best ? (best.exactExample ? 'rule' : 'keyword') : null,
    evidence: best?.evidence || [],
    sent: debug.contextSent ? debug.hints?.topic || null : null,
    requestAudience: normalizeContext(context)
  };
  if (resolution && terms) {
    const meanings = new Map();
    for (const term of terms.selected) {
      if (!term.conditional) continue;
      const options = meanings.get(term.source) || new Set();
      options.add(term.meaning);
      meanings.set(term.source, options);
    }
    terms.ambiguousSources = [...meanings]
      .filter(([, options]) => options.size > 1)
      .map(([source]) => source);
  }
  const prior = resolution?.session?.turns || [];
  const sentTurns = debug.contextSent ? resolution?.relevant || [] : [];
  return {
    version: 1,
    engine: debug.engine,
    rawAccess: debug.raw ? 'enabled' : 'restricted_or_disabled',
    preprocessing: debug.preprocessing || { status: 'not_used' },
    resolverStatus: personal.status,
    personalContext: redact(personal, secrets),
    conversationContext: {
      mode: session ? 'conversation' : 'standalone',
      sessionId:
        resolution?.session?.sessionId ||
        (saved && isObjectIdOrHexString(session) ? session : null),
      status: sentTurns.length ? 'used' : 'not_used',
      reason: sentTurns.length
        ? null
        : !session
          ? 'no_session_requested'
          : !resolution
            ? 'resolver_disabled'
            : debug.bypassCache
              ? 'no_provider_call'
              : 'no_relevant_active_session_turns',
      retrievedTurns: prior.map(({ sequence }) => sequence),
      sentTurns: sentTurns.map(({ sequence }) => sequence),
      currentTurn: saved ? 'saved' : session ? 'not_saved' : 'not_requested'
    },
    glossary: terms
      ? {
          status: 'evaluated',
          ...redact(terms, secretValues()),
          providerUsage: sent
            ? 'sent'
            : glossaryUsage === 'not_sent_cache'
              ? glossaryUsage
              : 'not_sent'
        }
      : {
          status: 'not_used',
          reason: cacheHit
            ? 'translation_from_cache_without_current_matching'
            : 'glossary_matching_not_run'
        },
    providers: debug.stages,
    cache: {
      cacheHit,
      status: debug.bypassCache ? 'bypass_conversation' : cacheStatus,
      provenance: 'not_available',
      scope: 'current_request'
    },
    performance: {
      elapsedMs: Date.now() - debug.startedAt,
      usage: requestUsage && {
        inputTokens: requestUsage.inputTokens,
        outputTokens: requestUsage.outputTokens,
        totalTokens: requestUsage.totalTokens,
        estimatedCostUsd: requestUsage.estimatedCostUsd
      },
      capturedCalls: debug.stages.length,
      omittedCalls: debug.omittedStages
    }
  };
}

function omitArchivedInspection(item) {
  if (!item?.details?.payload?.inspection) return item;
  const { inspection, ...payload } = item.details.payload;
  return {
    ...item,
    details: {
      ...item.details,
      payload,
      inspectionUnavailable:
        'Dữ liệu debug chỉ có trong phản hồi của lượt dịch trực tiếp.'
    }
  };
}

module.exports = {
  translationDebug,
  observeProvider,
  chatDetails,
  glossaryObserver,
  debugResponse,
  omitArchivedInspection,
  recordPipeline,
  markContextSent
};
