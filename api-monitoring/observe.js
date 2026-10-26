'use strict';
const { recordEvent, recordQuota } = require('./core');

// Monitoring is best effort; it must never break a translation request.
function ignoreWrite(promise) {
  Promise.resolve(promise).catch(error => {
    console.warn('API monitoring write failed:', error.message);
  });
}

async function observed(provider, operation, work, options = {}) {
  const started = Date.now();
  const project = options.project || 'translator';
  try {
    const result = await work();
    ignoreWrite(recordEvent(project, { provider, operation, status: 200,
      latencyMs: Date.now() - started,
      tokens: result?.usage?.total_tokens || 0,
      costUsd: 0 }));
    const limits = result?.rateLimit?.requests;
    if (limits && Number.isFinite(limits.limit) && limits.limit > 0 &&
        Number.isFinite(limits.remaining) && limits.remaining >= 0) {
      ignoreWrite(recordQuota(project, { provider, metric: 'requests',
        unit: 'requests', source: 'response_header',
        limit: limits.limit, remaining: limits.remaining }));
    }
    return result;
  } catch (error) {
    const status = Number(error?.status || error?.response?.status);
    ignoreWrite(recordEvent(project, { provider, operation,
      status: Number.isInteger(status) && status >= 400 && status <= 599 ? status : 502,
      latencyMs: Date.now() - started }));
    throw error;
  }
}

module.exports = { observed };
