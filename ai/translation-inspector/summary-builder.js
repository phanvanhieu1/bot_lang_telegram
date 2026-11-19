const { debugResponse } = require('../debug/inspector');
const { traceStore } = require('./trace-store');

function buildSummary(trace, sourceLanguage, targetLanguage) {
  const personal = trace.personalContext;
  const glossary = trace.glossary;
  const terms = (glossary.selected || [])
    .slice(0, 12)
    .map(({ source, meaning, domain, sent, status, outputMatch }) => ({
      source,
      meaning,
      domain,
      sent,
      conditional: status === 'conditional_candidate',
      outputMatch
    }));
  const stages = trace.providers.map(
    ({ role, provider, model, status, elapsedMs }) => ({
      role,
      provider,
      model,
      status,
      elapsedMs
    })
  );
  const primary = stages.find(
    (stage) => stage.role === 'translator' && stage.status === 'received'
  );
  const reason =
    personal.status === 'unknown' &&
    personal.userProfile.retrieved &&
    !personal.retrievedCount
      ? 'no_active_contexts'
      : personal.reason;
  return {
    resolver: {
      enabled: !['disabled', 'not_implemented'].includes(personal.status),
      status: personal.status,
      reason,
      profileRetrieved: personal.userProfile.retrieved,
      profileFound: personal.userProfile.found,
      contextName: personal.selected?.name ?? null,
      candidates: personal.candidates.filter((item) => item.score > 0).length,
      evaluatedCount: personal.evaluatedCount,
      threshold: personal.threshold,
      topCandidates: personal.candidates
        .slice(0, 3)
        .map(({ name, score, evidence, method, reason }) => ({
          name,
          score,
          evidence,
          method,
          reason
        })),
      method: personal.method,
      evidence: personal.evidence.slice(0, 6),
      applied: Boolean(personal.sent),
      sentContextName: personal.sent || null,
      audience: personal.requestAudience
    },
    conversation: {
      mode: trace.conversationContext.mode,
      used: trace.conversationContext.sentTurns.length,
      reason: trace.conversationContext.reason
    },
    glossary: {
      matchedCount: glossary.candidates?.length ?? 0,
      appliedCount: terms.filter((term) => term.sent && term.outputMatch)
        .length,
      terms,
      rejected: (glossary.rejected || [])
        .slice(0, 8)
        .map(({ source, meaning, reason }) => ({ source, meaning, reason }))
    },
    preprocessing: trace.preprocessing,
    ai: {
      sourceLanguage: sourceLanguage ?? null,
      targetLanguage: targetLanguage ?? null,
      model: primary?.model ?? null,
      calls: trace.performance.capturedCalls + trace.performance.omittedCalls,
      classifier: stages.some(
        (stage) =>
          stage.provider === 'claude' && stage.role.startsWith('analyzer')
      ),
      stages
    },
    cache: { hit: trace.cache.cacheHit, status: trace.cache.status },
    performance: {
      durationMs: trace.performance.elapsedMs,
      inputTokens: trace.performance.usage?.inputTokens ?? null,
      outputTokens: trace.performance.usage?.outputTokens ?? null,
      tokens: trace.performance.usage?.totalTokens ?? null,
      costUsd: trace.performance.usage?.estimatedCostUsd ?? null
    }
  };
}

function processingSummary(req, res, options) {
  const trace = debugResponse(req, res, options);
  const summary = buildSummary(
    trace,
    options.sourceLanguage,
    options.targetLanguage
  );
  const traceId = traceStore.save(req.user._id, {
    ...trace,
    languages: {
      source: summary.ai.sourceLanguage,
      target: summary.ai.targetLanguage
    }
  });
  return {
    ...summary,
    traceId,
    rawCaptured: trace.providers.some((stage) => stage.request || stage.output)
  };
}

module.exports = { buildSummary, processingSummary };
