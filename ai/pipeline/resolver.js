const { preprocess } = require('./preprocess');
const { matchingTerm } = require('../terminology/resolver');
const { isObjectIdOrHexString } = require('mongoose');
const {
  getResolverProfile
} = require('../../modules/personal-context/service');
const {
  getConversationContext
} = require('../../modules/personal-context/conversations');

const MIN_SCORE = 2;
const normalize = (text) =>
  text.normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, ' ').trim();

function resolveCandidates(text, contexts) {
  text = normalize(text);
  const evaluated = contexts
    .map((context) => {
      const evidence = [
        ...new Set(
          (context.keywords || [])
            .map((value) => normalize(String(value)))
            .filter(
              (value) =>
                Array.from(value).length >= 2 && matchingTerm(text, value) >= 0
            )
        )
      ].filter(
        (value, _, matched) =>
          !matched.some((other) => other !== value && other.includes(value))
      );
      const exactExample = (context.exampleUtterances || []).some(
        (example) =>
          typeof example === 'string' &&
          example.trim().length >= 8 &&
          matchingTerm(text, normalize(example)) >= 0
      );
      return {
        context,
        evidence,
        exactExample,
        score: evidence.length + (exactExample ? 2 : 0)
      };
    })
    .sort((a, b) => b.score - a.score);
  const ranked = evaluated.filter((item) => item.score);
  const [best, next] = ranked;
  const reason = !best
    ? 'no_candidate_match'
    : best.score < MIN_SCORE
      ? 'low_evidence'
      : best.score === next?.score
        ? 'ambiguous_candidates'
        : null;
  const selected = reason ? null : best;
  for (const item of evaluated) {
    item.method = item.exactExample
      ? 'rule'
      : item.evidence.length
        ? 'keyword'
        : null;
    item.reason =
      item === selected
        ? null
        : !item.score
          ? 'no_candidate_match'
          : item.score < MIN_SCORE
            ? 'low_evidence'
            : reason === 'ambiguous_candidates' && item.score === best.score
              ? reason
              : 'lower_score';
  }
  return {
    status: selected ? 'selected' : ranked.length ? 'ambiguous' : 'unknown',
    reason,
    threshold: MIN_SCORE,
    evaluated,
    ranked,
    ...(selected ? { best: selected } : {})
  };
}

async function resolveHybrid(
  { userId, prepared, sessionId, channel = 'web' },
  stores = {
    getResolverProfile,
    getConversationContext
  }
) {
  try {
    const [{ metadata, contexts }, session] = await Promise.all([
      stores.getResolverProfile(userId),
      isObjectIdOrHexString(sessionId)
        ? stores.getConversationContext(userId, sessionId, 3, channel)
        : null
    ]);
    const result = resolveCandidates(prepared.evidenceText, contexts);
    const relevant = (session?.status === 'active' ? session.turns : [])
      .filter(
        (turn) =>
          result.best?.evidence.some(
            (word) => matchingTerm(turn.source, word) >= 0
          ) ||
          (prepared.evidenceText.length >= 4 &&
            matchingTerm(turn.source, prepared.evidenceText) >= 0)
      )
      .filter(
        (turn) =>
          typeof turn.source === 'string' &&
          typeof turn.translation === 'string' &&
          turn.source.length + turn.translation.length <= 500 &&
          !preprocess(turn.source).spans.length &&
          !preprocess(turn.translation).spans.length
      )
      .slice(-2);
    return { ...result, metadata, contexts, session, relevant };
  } catch {
    return {
      status: 'fallback',
      ranked: [],
      evaluated: [],
      threshold: MIN_SCORE,
      reason: 'resolver_data_unavailable'
    };
  }
}

module.exports = { resolveHybrid, resolveCandidates };
