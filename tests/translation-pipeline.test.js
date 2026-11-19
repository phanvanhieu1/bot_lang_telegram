const assert = require('node:assert/strict');
const test = require('node:test');
const { preprocess } = require('../ai/pipeline/preprocess');
const {
  restore,
  restoreFields,
  maskExisting
} = require('../ai/pipeline/restore');
const { resolveCandidates } = require('../ai/pipeline/resolver');
const { prepareRequest } = require('../ai/pipeline/prepare-request');
const { translationDebug, debugResponse } = require('../ai/debug/inspector');
const { proKey } = require('../web-cache');
const sdk = require('../ai/providers/openai.provider');

const source = '请核对提现订单 TX-347 和付款金额。';
const work = {
  contextId: 'fixture-withdrawal',
  name: '审核提现',
  domain: 'withdrawal_operations',
  description: 'Long description that stays out of the provider request.',
  keywords: ['提现', '订单', '付款金额'],
  exampleUtterances: []
};
const user = { _id: 'fixture-user', hybridContextEnabled: true };
const sessionId = '684000000000000000000003';

test('preprocessing protects Unicode mixed input and rejects missing, reordered, extra or malformed markers', () => {
  const text =
    'Gửi {họ_tên} ${order.id} <b>给</b> QA-92 tại https://example.test/a_(b). Email café@example.test và `变量`. 3 liên hệ.';
  const prepared = preprocess(text);
  assert.equal(prepared.sourceLanguage, 'vi');
  assert.deepEqual(
    prepared.spans.map(({ kind }) => kind),
    ['template', 'template', 'html', 'html', 'id', 'url', 'email', 'code']
  );
  assert.equal(prepared.spans[5].value, 'https://example.test/a_(b)');
  assert.match(prepared.input, /3 liên hệ/);
  assert.equal(restore(prepared.input, prepared), text);
  const [a, b] = prepared.spans;
  const swapped = prepared.input
    .replace(a.token, 'temp_marker')
    .replace(b.token, a.token)
    .replace('temp_marker', b.token);
  for (const bad of [
    prepared.input.replace(a.token, ''),
    prepared.input + a.token,
    prepared.input + ' [[TX_fake',
    swapped
  ]) {
    assert.throws(() => restore(bad, prepared), {
      code: 'TRANSLATION_MARKER_MISMATCH'
    });
  }
  assert.equal(
    restoreFields('TRANSLATION: ' + prepared.input, prepared),
    'TRANSLATION: ' + text
  );
  assert.equal(maskExisting(text, prepared), prepared.input);
  assert.equal(
    preprocess('请处理 <span lang="vi">这笔订单</span>').sourceLanguage,
    'zh'
  );
  assert.equal(preprocess('https://example.test').sourceLanguage, 'unknown');
  assert.equal(preprocess('𠀀').sourceLanguage, 'zh');
});

test('resolver ranks only source evidence, avoids forcing ambiguous terms, and falls back safely', async () => {
  const daily = {
    ...work,
    name: 'Mua sắm',
    contextId: 'other',
    keywords: ['订单', '商品']
  };
  assert.equal(
    resolveCandidates('请看订单', [work, daily]).status,
    'ambiguous'
  );
  assert.equal(resolveCandidates('大家好', [work]).status, 'unknown');
  assert.equal(
    resolveCandidates('确认提现订单', [work, daily]).best.context.contextId,
    work.contextId
  );
  assert.equal(
    resolveCandidates('确认提现订单', [work, { ...work, contextId: 'tie' }])
      .status,
    'ambiguous'
  );
  let profileReads = 0;
  const args = { text: source, targetLang: 'zh', user, sessionId };
  const stores = {
    async getResolverProfile(id) {
      assert.equal(id, user._id);
      profileReads++;
      return {
        metadata: { revision: 3, occupation: 'Private role' },
        contexts: [work]
      };
    },
    async getConversationContext(id, session, limit, channel) {
      assert.deepEqual(
        [id, session, limit, channel],
        [user._id, sessionId, 3, 'web']
      );
      return {
        sessionId,
        status: 'active',
        turns: [
          { sequence: 1, source: '你好', translation: 'Xin chào' },
          {
            sequence: 2,
            source: '确认提现订单',
            translation: 'Xác nhận lệnh rút tiền'
          }
        ]
      };
    }
  };
  const off = await prepareRequest({ ...args, enabled: false }, stores);
  assert.equal(off.prepared.spans.length, 1);
  assert.equal(profileReads, 0);
  assert.equal(off.contextHints, null);
  const on = await prepareRequest(args, stores);
  assert.equal(profileReads, 1);
  assert.equal(on.contextHints.domain, work.domain);
  assert.equal(on.contextHints.recentTurns.length, 1);
  assert.equal(on.bypassCache, true);
  assert(!JSON.stringify(on.contextHints).includes('Private role'));
  assert(!JSON.stringify(on.contextHints).includes(work.description));
  const noProfile = await prepareRequest(
    { ...args, sessionId: null },
    {
      ...stores,
      getResolverProfile: async () => ({
        metadata: { setupStatus: 'pending' },
        contexts: []
      })
    }
  );
  assert.equal(noProfile.contextHints, null);
  const fallback = await prepareRequest(args, {
    ...stores,
    getResolverProfile: async () => {
      throw Error('Unavailable');
    }
  });
  assert.equal(fallback.contextHints, null);
  assert.equal(fallback.prepared.input, off.prepared.input);
});

test('cache separates account, profile revision and OFF', async () => {
  const resolve = (id, revision, enabled) =>
    prepareRequest(
      {
        text: source,
        targetLang: 'zh',
        user: { _id: id, hybridContextEnabled: enabled }
      },
      {
        getResolverProfile: async () => ({
          metadata: { revision },
          contexts: [work]
        })
      }
    );
  const scopes = await Promise.all([
    resolve('A', 1, false),
    resolve('A', 1, true),
    resolve('A', 2, true),
    resolve('B', 1, true)
  ]);
  const keys = scopes.map((input) =>
    proKey(source, 'zh', false, 'auto', 'gpt-4o-mini', input.cacheScope)
  );
  assert.equal(new Set(keys).size, 4);
});

test('both settings dispatch the same V1 GPT endpoint, restore identifiers and report only sent context', async (t) => {
  delete require.cache[require.resolve('../ai/services/pro.service')];
  const exposed = [];
  t.mock.method(sdk, 'getShuffledOpenAIClients', () => [
    {
      chat: {
        completions: {
          create: async (body) => {
            exposed.push(body);
            const raw = body.messages.at(-1).content[0].text;
            const input = raw.startsWith('{') ? JSON.parse(raw).source : raw;
            return {
              choices: [
                {
                  message: {
                    content:
                      'TRANSLATION: Hãy kiểm tra ' +
                      input.match(/\[\[TX_[^\]]+\]\]/u)[0] +
                      '.'
                  }
                }
              ]
            };
          }
        }
      }
    }
  ]);
  const { translateFull } = require('../ai/services/pro.service');
  for (const enabled of [false, true]) {
    const req = {
      user: { role: 'admin' },
      body: { inspectAI: true },
      get: () => null
    };
    const res = { set() {}, get() {} };
    const debug = await translationDebug('v1')(req, res, async () => {
      const pipeline = await prepareRequest(
        { text: source, targetLang: 'zh', user, enabled },
        {
          getResolverProfile: async () => ({ metadata: {}, contexts: [work] })
        }
      );
      const translated = await translateFull(
        source,
        'zh',
        false,
        null,
        [],
        false,
        {
          ...pipeline,
          vocabulary: false,
          backTranslation: false,
          translationModel: 'gpt-4o-mini'
        }
      );
      assert.equal(translated, 'TRANSLATION: Hãy kiểm tra TX-347.');
      return debugResponse(req, res);
    });
    assert.equal(debug.resolverStatus, enabled ? 'selected' : 'disabled');
    assert.equal(debug.preprocessing.protected.id, 1);
    assert.equal(Boolean(debug.personalContext.sent), enabled);
    assert.deepEqual(debug.providers[0].request, exposed.at(-1));
  }
  assert.equal(exposed.length, 2);
  assert.equal(exposed[0].model, exposed[1].model);
});

test('supplement masks the cached translation and restores back-translation in source order', async (t) => {
  const modulePath = require.resolve('../ai/services/pro.service');
  delete require.cache[modulePath];
  t.after(() => delete require.cache[modulePath]);
  const text = 'Kiểm tra mã QA-12 tại https://example.test/ticket.';
  const prepared = preprocess(text);
  const existing = '请在 https://example.test/ticket 查询 QA-12。';
  const validExisting = '请查询 QA-12，网址为 https://example.test/ticket。';
  assert.throws(() => maskExisting(existing, prepared), {
    code: 'TRANSLATION_MARKER_MISMATCH'
  });
  t.mock.method(sdk, 'getShuffledOpenAIClients', () => [
    {
      chat: {
        completions: {
          create: async (body) => {
            const request = JSON.stringify(body);
            assert(!request.includes('QA-12'));
            assert(!request.includes('example.test'));
            assert(request.includes(prepared.spans[0].token));
            const back =
              'Kiểm tra mã ' +
              prepared.spans[0].token +
              ' tại ' +
              prepared.spans[1].token +
              '.';
            const content = body.response_format
              ? JSON.stringify({
                  translation: '',
                  backTranslation: back,
                  vocabulary: ''
                })
              : 'BACK_TRANSLATION: ' + back;
            return { choices: [{ message: { content } }] };
          }
        }
      }
    }
  ]);
  const { translateFull } = require(modulePath);
  assert.equal(
    await translateFull(text, 'zh', false, null, [], false, {
      prepared,
      existingTranslation: validExisting,
      backTranslation: true,
      vocabulary: false
    }),
    'BACK_TRANSLATION: ' + text
  );
});

test('GPT retries an invalid marker sequence once and accounts for both calls', async (t) => {
  const modulePath = require.resolve('../ai/services/pro.service');
  delete require.cache[modulePath];
  t.after(() => delete require.cache[modulePath]);
  const text = '检查 QA-12 和 QA-34。';
  const prepared = preprocess(text);
  const [a, b] = prepared.spans.map((span) => span.token);
  let calls = 0;
  t.mock.method(sdk, 'getShuffledOpenAIClients', () => [
    {
      chat: {
        completions: {
          create: async (body) => {
            calls++;
            const translation =
              'Kiểm tra ' +
              (calls === 1 ? b + ' và ' + a : a + ' và ' + b) +
              '.';
            const content = body.response_format
              ? JSON.stringify({
                  translation,
                  backTranslation: '',
                  vocabulary: ''
                })
              : 'TRANSLATION: ' + translation;
            return {
              choices: [{ message: { content } }],
              usage: {
                prompt_tokens: 30,
                completion_tokens: 10,
                total_tokens: 40
              }
            };
          }
        }
      }
    }
  ]);
  const { translateFull } = require(modulePath);
  const req = {
    user: { role: 'admin' },
    body: { inspectAI: true },
    get: () => null
  };
  const res = { set() {}, get() {} };
  const result = await translationDebug('v1')(req, res, async () => {
    const translated = await translateFull(text, 'zh', false, null, [], true, {
      prepared,
      backTranslation: false,
      vocabulary: false
    });
    assert.equal(translated.content, 'TRANSLATION: Kiểm tra QA-12 và QA-34.');
    assert.equal(translated.usage.total_tokens, 80);
    return debugResponse(req, res);
  });
  assert.equal(calls, 2);
  assert.deepEqual(
    result.providers.map((stage) => stage.role),
    ['translator', 'protection-retry']
  );
});

test('Chinese grammar can move a URL location before its item ID without swapping their roles', () => {
  const prepared = preprocess(
    'Nhờ kiểm tra bài 作业-7 trên https://example.test/lop.'
  );
  const [id, url] = prepared.spans.map((span) => span.token);
  const natural = '请检查在' + url + '上提交的作业' + id + '。';
  const restored = '请检查在https://example.test/lop上提交的作业作业-7。';
  assert.equal(restore(natural, prepared), restored);
  assert.equal(maskExisting(restored, prepared), natural);
  assert.throws(
    () => restore('请检查在' + id + '上提交的作业' + url + '。', prepared),
    {
      code: 'TRANSLATION_MARKER_MISMATCH'
    }
  );
});

test('resolver diagnoses no match, weak match and ties without forcing a topic', () => {
  const office = { name: 'Kho vận', keywords: ['仓库', '运单', '发货'] };
  const travel = { name: 'Du lịch', keywords: ['酒店', '预订', '机场'] };
  const personal = { name: 'Sở thích', keywords: ['电影', '晚饭'] };
  const contexts = [office, travel, personal];
  const exact = resolveCandidates('请核实仓库的运单，然后发货。', contexts);
  assert.equal(exact.reason, null);
  assert.equal(exact.threshold, 2);
  assert.equal(exact.best.context, office);
  assert.equal(exact.evaluated.length, 3);
  assert.deepEqual(
    exact.evaluated.map((item) => item.reason),
    [null, 'no_candidate_match', 'no_candidate_match']
  );
  assert.equal(
    resolveCandidates('帮我确认一下。', contexts).reason,
    'no_candidate_match'
  );
  assert.equal(
    resolveCandidates('这个运单怎么回事？', contexts).reason,
    'low_evidence'
  );
  assert.equal(
    resolveCandidates('仓库有运单，酒店也要预订。', contexts).reason,
    'ambiguous_candidates'
  );
  assert.equal(
    resolveCandidates('吃完晚饭一起去看电影吧。', contexts).best.context,
    personal
  );
});
