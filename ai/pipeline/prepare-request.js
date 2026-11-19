const { createHash } = require('node:crypto');
const { preprocess } = require('./preprocess');
const { resolveHybrid } = require('./resolver');
const { buildContextPayload } = require('./payload');
const { recordPipeline } = require('../debug/inspector');

async function prepareRequest(
  {
    text,
    targetLang,
    user,
    sessionId,
    channel,
    enabled = user?.hybridContextEnabled === true,
    prepared: input
  },
  stores
) {
  const prepared = input || preprocess(text, targetLang);
  const resolution = enabled
    ? await resolveHybrid(
        { userId: user._id, prepared, sessionId, channel },
        stores
      )
    : null;
  const contextHints = buildContextPayload(resolution);
  const bypassCache = Boolean(resolution?.relevant?.length);
  const cacheScope = enabled
    ? createHash('sha256')
        .update(
          JSON.stringify([
            'hybrid-v1',
            String(user._id),
            resolution.status,
            resolution.metadata?.revision ?? null,
            contextHints
          ])
        )
        .digest('hex')
    : null;
  recordPipeline(prepared, resolution, contextHints, bypassCache);
  return { prepared, contextHints, bypassCache, cacheScope };
}

module.exports = { prepareRequest };
