const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const { once } = require('node:events');
const { createInspectorRouter } = require('../ai/translation-inspector/routes');
const {
  createTraceStore,
  traceStore
} = require('../ai/translation-inspector/trace-store');
const {
  processingSummary
} = require('../ai/translation-inspector/summary-builder');
const {
  translationDebug,
  recordPipeline,
  markContextSent,
  observeProvider,
  glossaryObserver
} = require('../ai/debug/inspector');
const { preprocess } = require('../ai/pipeline/preprocess');

test('summary and on-demand trace share actual provider activity; only owner may read and only admin may see raw', async (t) => {
  const req = {
    user: { _id: 'owner-a', role: 'admin' },
    body: { inspectAI: true },
    get: () => null
  };
  const res = { set() {}, get: () => undefined };
  let providerCalls = 0;
  const summary = await translationDebug('v1')(req, res, async () => {
    const prepared = preprocess('请审核订单 {{id}}');
    const { resolveCandidates } = require('../ai/pipeline/resolver');
    const contexts = [
      { name: 'Gaming Operations', keywords: ['审核', '订单'] }
    ];
    const decision = resolveCandidates(prepared.evidenceText, contexts);
    recordPipeline(
      prepared,
      { ...decision, metadata: { setupStatus: 'configured' }, contexts },
      { topic: 'Gaming Operations' },
      false
    );
    const term = { source: '审核', meaning: 'kiểm duyệt', domain: 'work' };
    glossaryObserver()({ candidates: [term], selected: [term], rejected: [] });
    markContextSent();
    await observeProvider(
      {
        role: 'translator',
        provider: 'openai',
        body: { model: 'gpt-4o-mini', instructions: 'fixture instructions' }
      },
      async () => {
        providerCalls++;
        return 'Hãy kiểm duyệt.';
      },
      (output) => ({ output })
    );
    return processingSummary(req, res, {
      sourceLanguage: 'zh',
      targetLanguage: 'vi',
      translation: 'Hãy kiểm duyệt.',
      glossaryUsage: 'sent',
      requestUsage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 }
    });
  });
  assert.equal(summary.resolver.contextName, 'Gaming Operations');
  assert.equal(summary.resolver.applied, true);
  assert.equal(summary.glossary.appliedCount, 1);
  assert.equal(summary.performance.tokens, 5);
  assert(!JSON.stringify(summary).includes('fixture instructions'));
  assert.equal(summary.ai.calls, 1);
  const app = express();
  app.use(
    createInspectorRouter({
      store: traceStore,
      auth(req, res, next) {
        req.user = {
          _id: req.get('Fixture-Owner'),
          role: req.get('Fixture-Role')
        };
        next();
      }
    })
  );
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await once(server, 'listening');
  const url =
    'http://127.0.0.1:' + server.address().port + '/' + summary.traceId;
  const get = (owner, role) =>
    fetch(url, { headers: { 'Fixture-Owner': owner, 'Fixture-Role': role } });
  const admin = await get('owner-a', 'admin');
  assert.match(admin.headers.get('cache-control'), /no-store/);
  assert.equal(
    (await admin.json()).trace.providers[0].request.instructions,
    'fixture instructions'
  );
  const pro = await get('owner-a', 'pro');
  assert.equal((await pro.json()).trace.providers[0].request, undefined);
  assert.equal((await get('owner-b', 'admin')).status, 404);
  assert.equal(providerCalls, 1);
  if (process.env.SHOW_INSPECTOR_SUMMARY === '1')
    console.log('SUMMARY_FIXTURE', JSON.stringify(summary));
});

test('trace TTL and record size are enforced and missing traces return no metadata', () => {
  let now = 100;
  const store = createTraceStore(() => now);
  const trace = { sample: true };
  const id = store.save('a', trace);
  assert.deepEqual(store.read('a', id), trace);
  assert.equal(store.read('b', id), null);
  assert.equal(store.save('a', { value: 'x'.repeat(170000) }), null);
  now += 300_000;
  assert.equal(store.read('a', id), null);
});

test('Vietnamese inspector renders a summary without fetching, then fetches JSON only on click', async () => {
  const { runInNewContext } = require('node:vm');
  const { readFileSync } = require('node:fs');
  class Node {
    children = [];
    isConnected = true;
    append(child) {
      this.children.push(child);
    }
    replaceChildren() {
      this.children = [];
    }
    setAttribute() {}
    remove() {}
  }
  const nodes = Object.fromEntries(
    [
      'translationInspector',
      'translationInspectorTabs',
      'translationInspectorContent'
    ].map((id) => [id, new Node()])
  );
  let requests = 0;
  const window = {};
  runInNewContext(
    readFileSync(require.resolve('../public/translation-inspector.js'), 'utf8'),
    {
      window,
      document: {
        getElementById: (id) => nodes[id],
        createElement: () => new Node()
      },
      fetch: async () => {
        requests++;
        return { ok: false, status: 404 };
      }
    }
  );
  window.renderTranslationInspector({
    traceId: 'fixture',
    resolver: {
      enabled: true,
      status: 'unknown',
      reason: 'no_active_contexts',
      evidence: []
    },
    conversation: { used: 0 },
    glossary: { matchedCount: 0, terms: [] },
    preprocessing: {},
    ai: { calls: 0, stages: [] },
    cache: { hit: true },
    performance: {}
  });
  assert.equal(requests, 0);
  assert.equal(nodes.translationInspectorTabs.children.length, 5);
  nodes.translationInspectorTabs.children[1].onclick();
  const [empty, button] = nodes.translationInspectorContent.children;
  assert.equal(empty.textContent, 'Không có thuật ngữ đặc biệt');
  assert.equal(requests, 0);
  await button.onclick();
  assert.equal(requests, 1);
  assert.match(
    nodes.translationInspectorContent.children.at(-1).textContent,
    /hết hạn/
  );
});
