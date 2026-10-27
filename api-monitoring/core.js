'use strict';
const { ApiMonitorEvent, ApiMonitorQuota } = require('./models');

const NAME = /^[a-z][a-z0-9_-]{0,47}$/;
const OPER = /^[a-z][a-z0-9_-]{0,63}$/;
const finite = n => typeof n === 'number' && Number.isFinite(n);
const bounded = (n, max) => finite(n) && n >= 0 && n <= max;

function normalizeEvent(project, input) {
  if (!NAME.test(project) || !input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Invalid project or event');
  }
  const { provider, operation = 'request', status, latencyMs = 0, tokens = 0, costUsd = null } = input;
  if (!NAME.test(provider) || !OPER.test(operation) ||
      !Number.isInteger(status) || status < 100 || status > 599 ||
      !bounded(latencyMs, 3_600_000) ||
      !Number.isSafeInteger(tokens) || tokens < 0 || tokens > 1_000_000_000 ||
      (costUsd !== null && !bounded(costUsd, 1_000_000))) {
    throw new TypeError('Invalid monitoring fields');
  }
  return { project, provider, operation, status, latencyMs, tokens, costUsd, at: new Date() };
}

function normalizeQuota(project, input) {
  if (!NAME.test(project) || !input || typeof input !== 'object' || Array.isArray(input) ||
      !NAME.test(input.provider) || !NAME.test(input.metric) ||
      !['requests','tokens','characters','usd'].includes(input.unit) ||
      !['provider','response_header','reported'].includes(input.source)) {
    throw new TypeError('Invalid quota fields');
  }
  const values = {};
  for (const field of ['limit','remaining','used']) {
    const value = input[field] == null ? null : input[field];
    if (value !== null && !bounded(value, 1_000_000_000_000)) {
      throw new TypeError('Invalid quota amount');
    }
    values[field] = value;
  }
  return { project, provider: input.provider, metric: input.metric, unit: input.unit,
    source: input.source, ...values, checkedAt: new Date() };
}

async function recordEvent(project, input) {
  return ApiMonitorEvent.create(normalizeEvent(project, input));
}

async function recordQuota(project, input) {
  const quota = normalizeQuota(project, input);
  const { project: p, provider, metric } = quota;
  return ApiMonitorQuota.updateOne(
    { project: p, provider, metric },
    { $set: quota }, { upsert: true }
  );
}

async function summary({ project, hours }) {
  const since = new Date(Date.now() - hours * 3600_000);
  const filter = { at: { $gte: since }, ...(project ? { project } : {}) };
  const [providers, trend, quotas] = await Promise.all([
    ApiMonitorEvent.aggregate([
      { $match: filter },
      { $group: { _id: { project: '$project', provider: '$provider' },
        requests: { $sum: 1 },
        succeeded: { $sum: { $cond: [{ $lt: ['$status', 400] }, 1, 0] } },
        avgLatencyMs: { $avg: '$latencyMs' },
        tokens: { $sum: '$tokens' }, costUsd: { $sum: '$costUsd' },
        pricedRequests: { $sum: { $cond: [{ $ne: ['$costUsd', null] }, 1, 0] } },
        lastSeen: { $max: '$at' } } },
      { $sort: { requests: -1 } }, { $limit: 200 }
    ]),
    ApiMonitorEvent.aggregate([
      { $match: filter },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%dT%H:00:00Z',
        date: '$at', timezone: 'UTC' } },
        requests: { $sum: 1 },
        succeeded: { $sum: { $cond: [{ $lt: ['$status', 400] }, 1, 0] } } } },
      { $sort: { _id: 1 } }, { $limit: 720 }
    ]),
    ApiMonitorQuota.find(project ? { project } : {}).select('-_id -__v')
      .sort({ project: 1, provider: 1, metric: 1 }).limit(300).lean()
  ]);
  const total = providers.reduce((o, p) => ({
    requests: o.requests + p.requests,
    succeeded: o.succeeded + p.succeeded,
    tokens: o.tokens + p.tokens,
    costUsd: o.costUsd + p.costUsd,
    pricedRequests: o.pricedRequests + p.pricedRequests
  }), { requests: 0, succeeded: 0, tokens: 0, costUsd: 0, pricedRequests: 0 });
  return { hours, project: project || null, total, providers: providers.map(p => ({
    project: p._id.project, provider: p._id.provider,
    requests: p.requests, succeeded: p.succeeded,
    avgLatencyMs: p.avgLatencyMs, tokens: p.tokens,
    costUsd: p.costUsd, pricedRequests: p.pricedRequests, lastSeen: p.lastSeen
  })), trend: trend.map(t => ({ hour: t._id, requests: t.requests,
    succeeded: t.succeeded })), quotas };
}
module.exports = { normalizeEvent, normalizeQuota, recordEvent, recordQuota, summary, NAME };
