'use strict';
const { recordQuota } = require('./core');
const PROJECT = 'translator';
const TIMEOUT_MS = 8000;
let running = false;
let timer;

async function requestJson(url, headers) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error('Quota endpoint returned HTTP ' + response.status);
  return response.json();
}
async function pollDeepL() {
  const key = process.env.DEEPL_API_KEY;
  if (!key) return;
  const host = key.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
  const usage = await requestJson(host + '/v2/usage', {
    Authorization: 'DeepL-Auth-Key ' + key
  });
  const used = usage.character_count;
  const limit = usage.character_limit;
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return;
  await recordQuota(PROJECT, { provider: 'deepl', metric: 'characters',
    unit: 'characters', source: 'provider',
    limit, used, remaining: Math.max(0, limit - used) });
}
async function pollOpenRouter() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return;
  const result = await requestJson('https://openrouter.ai/api/v1/key', {
    Authorization: 'Bearer ' + key
  });
  const item = result?.data;
  // A null key limit means unlimited/unknown, NOT zero remaining balance.
  if (Number.isFinite(item?.limit) && Number.isFinite(item?.limit_remaining)) {
    await recordQuota(PROJECT, { provider: 'openrouter', metric: 'key_budget',
      unit: 'usd', source: 'provider', limit: item.limit,
      remaining: item.limit_remaining,
      used: Number.isFinite(item.usage) ? item.usage : null });
  }
  const daily = item?.free_model_daily_requests;
  if (Number.isFinite(daily?.limit) && Number.isFinite(daily?.remaining)) {
    await recordQuota(PROJECT, { provider: 'openrouter', metric: 'free_daily_requests',
      unit: 'requests', source: 'provider', limit: daily.limit,
      remaining: daily.remaining,
      used: Number.isFinite(daily.used) ? daily.used : null });
  }
}
async function pollAll() {
  if (running) return;
  running = true;
  try {
    const checks = [['deepl', pollDeepL], ['openrouter', pollOpenRouter]];
    const results = await Promise.allSettled(checks.map(([, task]) => task()));
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.warn('Quota polling (' + checks[index][0] + '):', result.reason?.message);
      }
    });
  } finally {
    running = false;
  }
}
function startQuotaPolling() {
  if (timer) return;
  // Startup and periodic reads only; no synthetic translation calls.
  void pollAll();
  timer = setInterval(() => void pollAll(), 15 * 60 * 1000);
  timer.unref?.();
}
module.exports = { pollAll, startQuotaPolling };
