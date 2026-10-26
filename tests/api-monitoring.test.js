'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeEvent, normalizeQuota } = require('../api-monitoring/core');

test('accepts independent projects and only whitelisted event fields', () => {
  const data = normalizeEvent('ecommerce', {
    provider: 'stripe', operation: 'payment', status: 200,
    latencyMs: 123, tokens: 0, costUsd: 0.12,
    apiKey: 'must-not-be-stored', prompt: 'private'
  });
  assert.equal(data.project, 'ecommerce');
  assert.equal(data.status, 200);
  assert.equal(data.costUsd, 0.12);
  assert.equal(data.apiKey, undefined);
  assert.equal(data.prompt, undefined);
  assert.ok(data.at instanceof Date);
});

test('rejects invalid project, provider and response data', () => {
  assert.throws(() => normalizeEvent('../wrong', { provider: 'groq', status: 200 }), TypeError);
  assert.throws(() => normalizeEvent('translator', { provider: '$bad', status: 200 }), TypeError);
  assert.throws(() => normalizeEvent('translator', { provider: 'groq', status: 0 }), TypeError);
  assert.throws(() => normalizeEvent('translator', { provider: 'groq', status: 200, latencyMs: -1 }), TypeError);
  assert.throws(() => normalizeEvent('translator', { provider: 'groq', status: 200, costUsd: NaN }), TypeError);
  assert.throws(() => normalizeEvent('translator', { provider: 'groq', status: 200, tokens: 2.5 }), TypeError);
});

test('quota distinguishes unknown values from zero', () => {
  const unknown = normalizeQuota('translator', {
    provider: 'openai', metric: 'org_cost_recent', unit: 'usd',
    source: 'provider', used: 2.1
  });
  assert.equal(unknown.remaining, null);
  assert.equal(unknown.limit, null);
  assert.equal(unknown.used, 2.1);
  const exhausted = normalizeQuota('blog', {
    provider: 'deepl', metric: 'characters', unit: 'characters',
    source: 'reported', limit: 1000, remaining: 0
  });
  assert.equal(exhausted.remaining, 0);
});

test('quota rejects invalid units and negative limits', () => {
  assert.throws(() => normalizeQuota('translator', {
    provider: 'deepl', metric: 'characters', unit: 'password',
    source: 'reported', remaining: 10
  }), TypeError);
  assert.throws(() => normalizeQuota('translator', {
    provider: 'deepl', metric: 'characters', unit: 'characters',
    source: 'reported', remaining: -1
  }), TypeError);
});

test('admin dashboard is protected and ingestion uses independent project secrets', () => {
  const root = path.join(__dirname, '..');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const route = fs.readFileSync(path.join(root, 'api-monitoring/router.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'views/api-monitoring.html'), 'utf8');
  assert.match(server, /app\.get\('\/admin\/monitoring', requireRole\('admin'\)/);
  assert.match(route, /router\.get\('\/admin\/summary', adminOnly/);
  assert.match(route, /router\.post\('\/ingest', authenticateProject/);
  assert.match(route, /timingSafeEqual/);
  assert.doesNotMatch(html, /OPENAI_API_KEYS|DEEPL_API_KEY|MONITOR_INGEST_KEYS/);
});
