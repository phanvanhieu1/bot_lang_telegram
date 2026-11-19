const assert = require('node:assert/strict');
const test = require('node:test');
const {
  translationDebug,
  debugResponse,
  observeProvider,
  omitArchivedInspection
} = require('../ai/debug/inspector');
const { lookupUserTerms, resolveTerms } = require('../ai/terminology/resolver');
const { createProviders } = require('../ai/v2/providers');
const { deepTranslate } = require('../ai/v2/engine');
const sdk = require('../ai/providers/openai.provider');

const source = '请确认结算。';
const term = {
  source: '结算',
  translation: 'đối soát',
  domain: 'work',
  status: 'approved',
  sourceLang: 'zh',
  targetLang: 'vi'
};
const sessionId = '684000000000000000000003';
const scope = {
  context: 'colleague',
  sourceLang: 'zh',
  targetLang: 'vi',
  v1AutoCandidates: true
};

function handle(engine, options, action) {
  const {
    role = 'admin',
    inspectAI = true,
    session = null,
    saved = false,
    userId = 'fixture-owner'
  } = options;
  const req = {
    user: { role, _id: userId },
    body: { inspectAI },
    get: () => session
  };
  const headers = new Map(saved ? [['X-Conversation-Turn', 'saved']] : []);
  const res = {
    get: (key) => headers.get(key),
    set: (key, value) => headers.set(key, value)
  };
  return translationDebug(engine)(req, res, () =>
    Promise.resolve(action(req, res)).then((extra) => {
      assert.equal(res.get('Cache-Control'), 'private, no-store');
      return debugResponse(req, res, extra);
    })
  );
}

function ownedGlossary(owner, rows) {
  return {
    find(filter) {
      assert.equal(filter.owner, owner);
      assert.equal(filter.status, 'approved');
      return {
        limit() {
          return this;
        },
        async lean() {
          return rows;
        }
      };
    }
  };
}

test('V1 inspector records exact SDK body and glossary decision without consulting stored profiles', async (t) => {
  let actual;
  let calls = 0;
  const modulePath = require.resolve('../ai/services/pro.service');
  t.mock.method(sdk, 'getShuffledOpenAIClients', () => [
    {
      chat: {
        completions: {
          create: async (body) => {
            calls++;
            actual = body;
            return {
              model: body.model,
              choices: [
                {
                  message: {
                    content:
                      '{"translation":"Hãy xác nhận đối soát.","backTranslation":"","vocabulary":""}'
                  }
                }
              ],
              usage: { prompt_tokens: 123, completion_tokens: 19 }
            };
          }
        }
      }
    }
  ]);
  const flags = {
    V1_OPTIMIZED_PROMPTS: process.env.V1_OPTIMIZED_PROMPTS,
    V1_OPTIMIZED_JSON_SCHEMA: process.env.V1_OPTIMIZED_JSON_SCHEMA
  };
  process.env.V1_OPTIMIZED_PROMPTS = process.env.V1_OPTIMIZED_JSON_SCHEMA =
    'true';
  t.after(() => {
    for (const [key, val] of Object.entries(flags)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
    delete require.cache[modulePath];
  });
  delete require.cache[modulePath];
  const { translateFull } = require(modulePath);
  const debug = await handle('v1', {}, async (req) => {
    const glossary = ownedGlossary(req.user._id, [
      term,
      { ...term, translation: 'tính tiền', domain: 'daily' }
    ]);
    const terms = await lookupUserTerms(req.user._id, source, scope, glossary);
    await translateFull(source, 'zh', false, null, [], true, {
      context: scope.context,
      terms,
      translationModel: 'gpt-4o-mini',
      backTranslation: false,
      vocabulary: false
    });
    return {
      context: scope.context,
      translation: 'Hãy xác nhận đối soát.',
      glossaryUsage: 'sent'
    };
  });
  assert.equal(calls, 1);
  assert.deepEqual(debug.providers[0].request, actual);
  assert.equal(debug.providers[0].request.response_format.type, 'json_schema');
  assert.equal(debug.personalContext.status, 'disabled');
  assert.equal(debug.personalContext.userProfile.retrieved, false);
  assert.deepEqual(debug.personalContext.candidates, []);
  assert.equal(debug.conversationContext.mode, 'standalone');
  assert.equal(debug.glossary.selected[0].sent, true);
  assert.equal(debug.glossary.selected[0].outputMatch, true);
  assert.equal(debug.glossary.rejected[0].reason, 'domain_mismatch');
  if (process.env.SHOW_TRANSLATION_DEBUG_FIXTURES === '1')
    console.log('V1 fixture:', JSON.stringify(debug));
});

test('V2 debug compares actual Claude and GPT wire bodies, with repair and verified session metadata', async (t) => {
  const { UserProfile } = require('../modules/personal-context/models');
  const profiles = t.mock.method(UserProfile, 'findOne', ({ userId }) => ({
    async lean() {
      return userId === 'fixture-owner'
        ? {
            userId,
            occupation: 'Kế toán',
            contexts: [{ status: 'active', name: 'Thanh toán' }]
          }
        : null;
    }
  }));
  const wire = [];
  t.mock.method(global, 'fetch', async (url, options) => {
    const body = JSON.parse(options.body);
    wire.push({ body, headers: options.headers });
    const claude = String(url).includes('anthropic');
    const isRepair = body.instructions?.includes('Repair ONLY');
    const content = claude
      ? {
          domain: 'work',
          tone: 'professional',
          intent: 'Confirm settlement',
          facts: [],
          terms: [],
          patterns: [],
          ambiguities: [],
          entities: []
        }
      : {
          translation: isRepair ? 'Hãy xác nhận đối soát.' : 'Hãy xác nhận.',
          backTranslation: '',
          vocabulary: '',
          semanticReviewRequired: false,
          uncertainties: []
        };
    return new Response(
      JSON.stringify(
        claude
          ? {
              content: [
                { type: 'text', text: JSON.stringify(content) },
                { type: 'thinking', thinking: 'excluded reasoning' }
              ],
              stop_reason: 'end_turn'
            }
          : { output_text: JSON.stringify(content), status: 'completed' }
      )
    );
  });
  const env = {
    OPENAI_API_KEY: 'opaque-fake-openai',
    CLAUDE_API_KEY: 'opaque-fake-claude'
  };
  const providers = createProviders(env);
  const debug = await handle(
    'v2',
    { session: sessionId, saved: true },
    async (req) => {
      const model = ownedGlossary(req.user._id, [term]);
      const result = await deepTranslate(
        {
          text: source,
          context: 'colleague',
          backTranslation: false,
          vocabulary: false,
          env,
          loadGlossary: (text, opts) =>
            lookupUserTerms(req.user._id, text, opts, model)
        },
        providers
      );
      assert.equal(result.translation, 'Hãy xác nhận đối soát.');
      return {
        context: 'colleague',
        translation: result.translation,
        glossaryUsage: 'sent'
      };
    }
  );
  assert.equal(wire.length, 3);
  assert.deepEqual(
    debug.providers.map((stage) => stage.role),
    ['analyzer', 'translator', 'repair']
  );
  assert.deepEqual(
    debug.providers.map((stage) => stage.request),
    wire.map((request) => request.body)
  );
  assert.equal(debug.providers[1].request.text.format.type, 'json_schema');
  assert.equal(debug.conversationContext.sessionId, sessionId);
  assert.deepEqual(debug.conversationContext.sentTurns, []);
  assert(!JSON.stringify(debug).includes('opaque-fake'));
  assert(!JSON.stringify(debug).includes('excluded reasoning'));
  const ordinary = await handle(
    'v2',
    { role: 'pro', userId: 'other-owner' },
    async (req) => {
      const model = ownedGlossary(req.user._id, []);
      await deepTranslate(
        {
          text: source,
          context: 'colleague',
          backTranslation: false,
          vocabulary: false,
          env,
          loadGlossary: (text, opts) =>
            lookupUserTerms(req.user._id, text, opts, model)
        },
        providers
      );
      return { context: 'colleague', glossaryUsage: 'sent' };
    }
  );
  assert.deepEqual(
    ordinary.providers.map((stage) => stage.role),
    ['analyzer', 'translator']
  );
  assert(ordinary.providers.every((stage) => !stage.request && !stage.output));
  assert.deepEqual(ordinary.glossary.candidates, []);
  assert.equal(profiles.mock.callCount(), 0);
  assert.deepEqual(debug.personalContext, ordinary.personalContext);
  if (process.env.SHOW_TRANSLATION_DEBUG_FIXTURES === '1')
    console.log('V2 fixture:', JSON.stringify(debug));
});

test('cache excludes hypothetical requests, other-owner session IDs and historical raw traces', async () => {
  const cached = await handle('v2', { session: sessionId }, () => ({
    cacheHit: true
  }));
  assert.equal(cached.cache.cacheHit, true);
  assert.deepEqual(cached.providers, []);
  assert.equal(cached.conversationContext.sessionId, null);
  const item = {
    details: {
      engine: 'v1',
      payload: {
        inspection: { stages: ['old'] },
        requestUsage: { totalTokens: 2 }
      }
    }
  };
  const filtered = omitArchivedInspection(item);
  assert.equal(filtered.details.payload.inspection, undefined);
  assert.equal(filtered.details.payload.requestUsage.totalTokens, 2);
  assert(item.details.payload.inspection);
});

test('inspector redacts credentials embedded in serialized payloads, drops oversized fields and isolates concurrent requests', async () => {
  const body = {
    model: 'gpt-fixture',
    instructions:
      'Cookie: connect.sid=secret-cookie-value; another=secret-cookie-two',
    headers: { Authorization: 'raw-secret-auth' },
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: '{"password":"raw-password","original":"Bearer opaque-token-value"}'
          }
        ]
      }
    ]
  };
  const inspect = (role, userId) =>
    handle('v1', { role, userId }, async () => {
      await observeProvider(
        { provider: 'openai', role: 'translator', body },
        async () => {
          await Promise.resolve();
          return 'sk-credential-example-secret';
        },
        (output) => ({ output })
      );
      await observeProvider(
        {
          provider: 'openai',
          role: 'supplement',
          body: { model: 'gpt-fixture', instructions: 'x'.repeat(49000) }
        },
        async () => 'done',
        (output) => ({ output })
      );
    });
  const [admin, ordinary] = await Promise.all([
    inspect('admin', 'first'),
    inspect('pro', 'second')
  ]);
  const serialized = JSON.stringify(admin);
  for (const secret of [
    'secret-cookie-value',
    'secret-cookie-two',
    'raw-secret-auth',
    'raw-password',
    'opaque-token-value',
    'sk-credential-example-secret'
  ]) {
    assert(!serialized.includes(secret));
  }
  assert.equal(admin.providers[1].requestStatus, 'size_limit');
  assert(ordinary.providers.every((stage) => !stage.request && !stage.output));
  assert.equal(admin.providers.length, 2);
  assert.equal(ordinary.providers.length, 2);
});

test('glossary audit preserves selection and reports conditional and rejected meanings separately', () => {
  const rows = [
    { ...term, source: '确认结算', domain: 'work' },
    term,
    { ...term, domain: 'daily' }
  ];
  let decision;
  const selected = resolveTerms(source, rows, {
    ...scope,
    onDecision: (value) => {
      decision = value;
    }
  });
  assert.deepEqual(selected, resolveTerms(source, rows, scope));
  assert.deepEqual(decision.rejected.map((row) => row.reason).sort(), [
    'domain_mismatch',
    'overlapping_match'
  ]);
  assert.equal(
    resolveTerms(source, [term], { ...scope, context: 'auto' })[0].conditional,
    true
  );
});
