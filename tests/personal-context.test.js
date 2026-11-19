const assert = require('node:assert/strict');
const test = require('node:test');
const { fail, topicId } = require('../modules/personal-context/validation');
const { generateContexts } = require('../modules/personal-context/generator');
const { createProfileService } = require('../modules/personal-context/service');
const {
  createTelegramConversations
} = require('../modules/personal-context/telegram');

function memoryProfiles() {
  const rows = new Map();
  return {
    findOne({ userId }) {
      return { lean: async () => structuredClone(rows.get(userId)) };
    },
    async create(record) {
      if (rows.has(record.userId))
        throw Object.assign(new Error(), { code: 11000 });
      rows.set(record.userId, structuredClone(record));
    },
    async updateOne({ userId, revision }, { $set }) {
      if (rows.get(userId)?.revision !== revision) return { matchedCount: 0 };
      rows.set(userId, structuredClone({ userId, ...$set }));
      return { matchedCount: 1 };
    }
  };
}

function aiRow(id) {
  return {
    topicId: id,
    domain: 'engineering',
    description: 'Trao đổi kỹ thuật',
    scope: 'Thảo luận trong nhóm',
    situations: ['Code review'],
    keywords: ['Lập trình', '代码审查', '接口测试', '服务器'],
    exampleUtterances: ['Hãy xem API này', '请检查这个接口的响应。']
  };
}

test('generator validates by topic, discards extra fields and falls back on invalid, duplicate or failed AI output', async () => {
  const topics = ['A', 'B', 'C', 'D', 'E'].map((name) => ({
    name,
    topicId: topicId(name)
  }));
  const result = await generateContexts('', topics, async (_, batch) => {
    if (batch[0].name === 'E') throw new Error('Provider unavailable');
    return {
      contexts: [
        { ...aiRow('0'), glossary: [{ word: 'API' }] },
        { ...aiRow('1'), keywords: 'unexpected' },
        aiRow('2'),
        aiRow('2'),
        aiRow('3'),
        aiRow('99')
      ]
    };
  });
  assert.equal(result.size, 5);
  assert.equal(result.get(topics[0].topicId).generationMethod, 'ai');
  assert.equal(result.get(topics[0].topicId).glossary, undefined);
  for (const topic of topics.slice(1)) {
    assert.equal(result.get(topic.topicId).generationMethod, 'fallback');
  }
});

test('profile sync keeps unchanged, restores disabled, preserves edits and only regenerates affected AI contexts', async () => {
  const batches = [];
  const profiles = createProfileService({
    model: memoryProfiles(),
    generate: (occupation, topics) =>
      generateContexts(occupation, topics, async (_, input) => {
        batches.push(input.map((topic) => topic.name));
        return {
          contexts: input.map((topic) => ({
            ...aiRow(topic.topicId),
            scope: topic.name
          }))
        };
      })
  });
  const read = () => profiles.listContexts('alice');
  assert.equal(
    (await profiles.getUserMetadata('alice')).setupStatus,
    'pending'
  );
  await profiles.putProfile('alice', { revision: 0, skip: true });
  assert.deepEqual(await profiles.getActiveContexts('alice'), []);
  await profiles.putProfile('alice', {
    revision: 1,
    occupation: 'Backend',
    translationTopics: ['Backend', 'Blockchain', 'Daily', ' backend ']
  });
  const initial = (await read()).contexts;
  assert.equal(initial.length, 3);
  const base = initial.find(
    (context) => context.name.toLowerCase() === 'backend'
  );
  const old = initial.find((context) => context.name === 'Blockchain');
  const daily = initial.find((context) => context.name === 'Daily');
  await profiles.mutateContext(
    'alice',
    base.contextId,
    { revision: 2, name: 'Backend riêng' },
    'edit'
  );
  await profiles.putProfile('alice', {
    revision: 3,
    occupation: 'Backend',
    translationTopics: ['Backend', 'Business Chinese', 'Daily']
  });
  assert.deepEqual(
    await profiles.getContextById('alice', daily.contextId),
    daily
  );
  assert.equal(
    (await profiles.getContextById('alice', old.contextId)).status,
    'inactive'
  );
  await profiles.putProfile('alice', {
    revision: 4,
    occupation: 'Security',
    translationTopics: ['Backend', 'Blockchain', 'Daily']
  });
  const restored = await profiles.getContextById('alice', old.contextId);
  assert.equal(restored.status, 'active');
  assert.equal(restored.generationVersion, old.generationVersion);
  assert.equal(
    (await profiles.getContextById('alice', base.contextId)).name,
    'Backend riêng'
  );
  assert.equal(
    (await profiles.getContextById('alice', daily.contextId)).generationVersion,
    2
  );
  assert.deepEqual(
    batches.map((batch) => batch.map((x) => x.toLowerCase())),
    [['backend', 'blockchain', 'daily'], ['business chinese'], ['daily']]
  );
  assert.equal(await profiles.getContextById('bob', base.contextId), null);
  await profiles.putProfile('bob', {
    revision: 0,
    translationTopics: ['Backend']
  });
  assert.notEqual(
    (await profiles.getActiveContexts('bob'))[0].contextId,
    base.contextId
  );
  await profiles.mutateContext(
    'alice',
    old.contextId,
    { revision: 5, status: 'inactive' },
    'status'
  );
  await profiles.putProfile('alice', {
    revision: 6,
    occupation: 'Security',
    translationTopics: []
  });
  await profiles.putProfile('alice', {
    revision: 7,
    occupation: 'Security',
    translationTopics: ['Blockchain']
  });
  assert.equal(
    (await profiles.getContextById('alice', old.contextId)).status,
    'inactive'
  );
  const custom = await profiles.mutateContext(
    'alice',
    null,
    { revision: 8, name: 'Tự tạo' },
    'create'
  );
  assert.equal(custom.context.source, 'user_created');
  await assert.rejects(
    profiles.mutateContext(
      'alice',
      custom.context.contextId,
      { revision: 9 },
      'regenerate'
    ),
    { status: 409 }
  );
  const regenerated = await profiles.mutateContext(
    'alice',
    custom.context.contextId,
    { revision: 9, replaceCustom: true },
    'regenerate'
  );
  assert.equal(regenerated.context.contextId, custom.context.contextId);
  await profiles.mutateContext(
    'alice',
    old.contextId,
    { revision: 10 },
    'delete'
  );
  assert.equal(await profiles.getContextById('alice', old.contextId), null);
  assert.deepEqual(
    (await profiles.getUserMetadata('alice')).translationTopics,
    []
  );
});

test('a manual edit committed while AI runs wins over the stale profile update', async () => {
  let release;
  let entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  const profiles = createProfileService({
    model: memoryProfiles(),
    generate: async (occupation, topics) => {
      if (occupation === 'new') {
        entered();
        await wait;
      }
      return generateContexts('', topics, async () => {
        fail(503, 'Offline');
      });
    }
  });
  await profiles.putProfile('alice', {
    revision: 0,
    translationTopics: ['Team']
  });
  const [context] = await profiles.getActiveContexts('alice');
  const update = profiles.putProfile('alice', {
    revision: 1,
    occupation: 'new',
    translationTopics: ['Team']
  });
  await started;
  await profiles.mutateContext(
    'alice',
    context.contextId,
    { revision: 1, name: 'Manual' },
    'edit'
  );
  release();
  await assert.rejects(update, { status: 409 });
  assert.equal(
    (await profiles.getContextById('alice', context.contextId)).name,
    'Manual'
  );
});

test('Telegram only captures a private, verified session and does not move a translated turn after relinking', async () => {
  let linked = null;
  const captured = [];
  const store = {
    async activeSession(id, channel) {
      assert.equal(id, 'alice');
      assert.equal(channel, 'telegram');
      return { _id: 'session-original' };
    },
    async appendTurn(turn) {
      captured.push(turn);
    }
  };
  const telegram = createTelegramConversations({
    ready: () => true,
    linkedUser: async () => linked,
    store
  });
  const ctx = { chat: { type: 'private' }, from: { id: 42 } };
  assert.equal(await telegram.current(ctx), null);
  linked = 'alice';
  assert.equal(
    await telegram.current({ ...ctx, chat: { type: 'group' } }),
    null
  );
  assert.equal(
    await createTelegramConversations({
      ready: () => true,
      testMode: true,
      linkedUser: async () => linked,
      store
    }).current(ctx),
    null
  );
  const session = await telegram.current(ctx);
  linked = 'bob';
  await telegram.capture(ctx, session, 'Xin chào', '你好', 'zh');
  assert.deepEqual(captured, []);
  linked = 'alice';
  await telegram.capture(ctx, session, 'Xin chào', '你好', 'zh');
  assert.equal(captured[0].sessionId, 'session-original');
  assert.equal(captured[0].channel, 'telegram');
  assert.equal(captured[0].sourceLanguage, 'vi');
});

test('saving an unchanged profile refreshes stale AI recognition and preserves customized entries and failed refreshes', async () => {
  const { syncContexts } = require('../modules/personal-context/sync');
  const stale = {
    ...aiRow('0'),
    name: 'Kho vận',
    topicId: topicId('Kho vận'),
    version: 1,
    generationVersion: 1,
    topicSelected: true,
    source: 'ai_generated',
    status: 'active',
    keywords: ['Giao hàng'],
    exampleUtterances: ['Hãy kiểm tra đơn giao hàng.']
  };
  const custom = {
    ...stale,
    name: 'Học tập',
    topicId: topicId('Học tập'),
    source: 'user_customized'
  };
  const profile = {
    occupation: 'Điều phối',
    translationTopics: ['Kho vận', 'Học tập'],
    contexts: [stale, custom]
  };
  const failed = await syncContexts(
    profile,
    profile,
    async () => new Map([[stale.topicId, { generationMethod: 'fallback' }]])
  );
  assert.deepEqual(failed, [stale, custom]);
  const next = await syncContexts(profile, profile, async (_, topics) => {
    assert.deepEqual(topics, [{ topicId: stale.topicId, name: stale.name }]);
    return new Map([
      [
        stale.topicId,
        { ...aiRow('0'), topicId: stale.topicId, generationMethod: 'ai' }
      ]
    ]);
  });
  assert.equal(next[0].generationVersion, 2);
  assert.equal(next[1], custom);
});
