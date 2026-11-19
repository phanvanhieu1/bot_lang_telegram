const assert = require('node:assert/strict');
const test = require('node:test');
const { once } = require('node:events');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const express = require('express');
const mongoose = require('mongoose');
const User = require('../modules/users/user.model');
const { createPersonalRouter } = require('../modules/personal-context/routes');
const { createProfileService } = require('../modules/personal-context/service');
const { generateContexts } = require('../modules/personal-context/generator');
const conversations = require('../modules/personal-context/conversations');
const {
  UserProfile,
  ConversationSession
} = require('../modules/personal-context/models');

const uri = process.env.PERSONAL_CONTEXT_TEST_MONGO;

test(
  'personal APIs use authenticated owner and MongoDB persists isolated sessions and atomic sequences',
  {
    skip:
      !uri &&
      'Set PERSONAL_CONTEXT_TEST_MONGO to an isolated loopback MongoDB server'
  },
  async (t) => {
    assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:\d+\/?$/);
    await mongoose.connect(uri, {
      dbName: 'personal_context_test_' + randomUUID().replaceAll('-', ''),
      serverSelectionTimeoutMS: 5000
    });
    t.after(async () => {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    });
    await Promise.all([
      UserProfile.createIndexes(),
      ConversationSession.createIndexes()
    ]);
    const [alice, bob, inactive] = await User.create(
      ['alice', 'bob', 'inactive'].map((id) => ({
        email: id + '@example.test',
        providers: [{ provider: 'google', providerId: id }],
        isActive: id !== 'inactive'
      }))
    );
    const users = { alice, bob, inactive };
    const service = createProfileService({
      generate: (occupation, topics) =>
        generateContexts(occupation, topics, async () => ({
          contexts: 'invalid'
        }))
    });
    const app = express();
    const sessionStore = new Map();
    app.use(express.json());
    app.use((req, res, next) => {
      const fixtureUser = users[req.get('x-test-session')];
      if (fixtureUser) {
        req.sessionID =
          fixtureUser.id + ':' + (req.get('x-test-login') || 'first');
        req.session = {
          authenticated: true,
          userId: fixtureUser.id,
          ...sessionStore.get(req.sessionID),
          save(callback) {
            sessionStore.set(req.sessionID, {
              translationSetupDismissed: this.translationSetupDismissed
            });
            callback();
          }
        };
      } else req.session = {};
      next();
    });
    app.use('/api/personal', createPersonalRouter({ profile: service }));
    // This endpoint stands in for the translator, with provider output supplied by the fixture.
    app.post(
      '/translate',
      (req, res, next) => {
        req.user = users[req.get('x-test-session')];
        next();
      },
      async (req, res) => {
        const { source } = req.body;
        const translation = '你好 ' + source;
        await conversations.captureWebTurn(req, res, {
          source,
          translation,
          sourceLanguage: 'vi',
          targetLanguage: 'zh'
        });
        res.json({ translation });
      }
    );
    const server = app.listen(0, '127.0.0.1');
    t.after(() => server.close());
    await once(server, 'listening');
    const base = 'http://127.0.0.1:' + server.address().port;

    async function request(
      path,
      { user = 'alice', method = 'GET', body, headers = {} } = {}
    ) {
      const response = await fetch(base + path, {
        method,
        headers: {
          'x-test-session': user,
          'Content-Type': 'application/json',
          ...headers
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      return {
        status: response.status,
        headers: response.headers,
        data: await response.json()
      };
    }
    const api = (path, options) => request('/api/personal' + path, options);
    assert.equal((await api('/profile', { user: 'anonymous' })).status, 401);
    assert.equal((await api('/profile', { user: 'inactive' })).status, 403);
    assert.equal((await api('/profile')).data.profile.setupStatus, 'pending');
    const preferences = '/translation-preferences';
    assert.equal(
      (
        await api(preferences, {
          method: 'PATCH',
          body: { hybridContextEnabled: 'true' }
        })
      ).status,
      400
    );
    assert.equal(
      (
        await api(preferences, {
          method: 'PATCH',
          body: {
            hybridContextEnabled: true,
            userId: bob.id
          }
        })
      ).status,
      200
    );
    assert.equal(
      (await User.findById(alice.id).lean()).hybridContextEnabled,
      true
    );
    assert.equal(
      (await User.findById(bob.id).lean()).hybridContextEnabled,
      false
    );
    const initialProfile = (await api('/profile')).data;
    assert.equal(initialProfile.reminderDismissed, false);
    assert.notEqual(initialProfile.reminderKey, alice.id + ':first');
    assert.equal(
      (
        await api('/profile/dismiss', {
          method: 'POST',
          headers: { origin: 'https://other.example' }
        })
      ).status,
      403
    );
    assert.equal(
      (await api('/profile/dismiss', { method: 'POST' })).status,
      200
    );
    const sameLogin = (await api('/profile')).data;
    assert.equal(sameLogin.reminderDismissed, true);
    assert.equal(sameLogin.reminderKey, initialProfile.reminderKey);
    assert.equal(sameLogin.profile.setupStatus, 'pending');
    assert.equal(sameLogin.profile.revision, 0);
    const newLogin = (
      await api('/profile', { headers: { 'x-test-login': 'second' } })
    ).data;
    assert.equal(newLogin.reminderDismissed, false);
    assert.notEqual(newLogin.reminderKey, initialProfile.reminderKey);

    const save = {
      method: 'PUT',
      body: {
        userId: bob.id,
        revision: 0,
        occupation: 'IT',
        translationTopics: ['Backend']
      }
    };
    assert.equal(
      (
        await api('/profile', {
          ...save,
          headers: { origin: 'https://other.example' }
        })
      ).status,
      403
    );
    assert.equal((await api('/profile', save)).status, 200);
    assert.equal(
      (
        await api('/profile', {
          headers: { 'x-test-login': 'second' }
        })
      ).data.profile.setupStatus,
      'configured'
    );

    assert.equal((await api('/profile', save)).status, 409);
    assert.equal(
      (await api('/profile', { user: 'bob' })).data.profile.setupStatus,
      'pending'
    );
    const [context] = (await api('/contexts')).data.contexts;
    assert.equal(context.generationMethod, 'fallback');
    assert.equal(
      (await api('/contexts/' + context.contextId, { user: 'bob' })).status,
      404
    );
    const edited = await api('/contexts/' + context.contextId, {
      method: 'PUT',
      body: { revision: 1, name: 'Riêng' }
    });
    assert.equal(edited.data.context.source, 'user_customized');
    assert.equal(
      (await api('/contexts/' + context.contextId)).data.context.name,
      'Riêng'
    );

    const makeSession = async () =>
      (await api('/conversations', { method: 'POST' })).data.session;
    const first = await makeSession();
    const telegram = await conversations.startSession(alice.id, 'telegram');
    const ids = { first: first.sessionId, telegram: telegram.sessionId };
    const turn = (sessionId, source, user = 'alice') =>
      request('/translate', {
        user,
        method: 'POST',
        body: { source },
        headers: sessionId ? { 'X-Conversation-Session': sessionId } : {}
      });
    await turn(null, 'independent');
    assert.equal(
      (await turn(ids.first, 'foreign account', 'bob')).headers.get(
        'x-conversation-turn'
      ),
      'not-saved'
    );
    assert.equal(
      (await turn(ids.telegram, 'foreign channel')).headers.get(
        'x-conversation-turn'
      ),
      'not-saved'
    );
    await conversations.appendTurn({
      userId: alice.id,
      channel: 'telegram',
      sessionId: ids.telegram,
      source: 'Telegram',
      translation: '你好',
      sourceLanguage: 'vi',
      targetLanguage: 'zh'
    });
    const parallel = await Promise.all(
      Array.from({ length: 8 }, (_, index) => turn(ids.first, 'web-' + index))
    );
    assert(
      parallel.every(
        (response) => response.headers.get('x-conversation-turn') === 'saved'
      )
    );
    const firstDetail = await api('/conversations/' + ids.first);
    assert.deepEqual(
      firstDetail.data.session.turns.map((item) => item.sequence),
      [6, 7, 8]
    );
    assert(
      firstDetail.data.session.turns.every((item) =>
        item.source.startsWith('web-')
      )
    );
    assert.equal((await api('/conversations/' + ids.telegram)).status, 404);
    assert.equal(
      (await api('/conversations/' + ids.first, { user: 'bob' })).status,
      404
    );
    assert.equal(
      (
        await api('/conversations/' + ids.first + '/end', {
          user: 'bob',
          method: 'POST'
        })
      ).status,
      404
    );
    const second = await makeSession();
    assert.equal(
      (await turn(ids.first, 'late')).headers.get('x-conversation-turn'),
      'not-saved'
    );
    const count = 105;
    for (let i = 0; i < count; i++) {
      await conversations.appendTurn({
        userId: alice.id,
        channel: 'web',
        sessionId: second.sessionId,
        source: '$nguồn ' + i,
        translation: '译文',
        sourceLanguage: 'vi',
        targetLanguage: 'zh'
      });
    }
    const stored = await ConversationSession.findById(second.sessionId).lean();
    assert.equal(stored.turns.length, 100);
    assert.deepEqual(
      stored.turns.slice(0, 1).map((item) => [item.sequence, item.source]),
      [[6, '$nguồn 5']]
    );
    const secondDetail = await api(
      '/conversations/' + second.sessionId + '?limit=2'
    );
    assert.deepEqual(
      secondDetail.data.session.turns.map((item) => item.sequence),
      [104, 105]
    );
    assert.equal(
      (
        await api('/conversations/' + second.sessionId + '/end', {
          method: 'POST'
        })
      ).status,
      200
    );
    assert.equal(
      (await api('/conversations/' + ids.first, { method: 'DELETE' })).status,
      200
    );
    assert.equal(
      await conversations.getConversationContext(alice.id, ids.first),
      null
    );
    assert.equal(
      (await conversations.getConversationContext(alice.id, ids.telegram))
        .turns[0].source,
      'Telegram'
    );
  }
);

test(
  'production web entry point starts and protects the personal page',
  {
    skip:
      !uri &&
      'Set PERSONAL_CONTEXT_TEST_MONGO to an isolated loopback MongoDB server'
  },
  async (t) => {
    assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:\d+\/?$/);
    const database =
      'personal_startup_test_' + randomUUID().replaceAll('-', '');
    const client = new mongoose.mongo.MongoClient(uri);
    t.after(async () => {
      try {
        await client.db(database).dropDatabase();
      } finally {
        await client.close();
      }
    });
    const bootstrap = `
    const assert = require('node:assert/strict');
    const { Server } = require('node:net');
    const listen = Server.prototype.listen;
    Server.prototype.listen = function (port, callback) {
      return listen.call(this, Number(port), '127.0.0.1', async () => {
        callback();
        const response = await fetch('http://127.0.0.1:' + this.address().port + '/personal');
        assert.equal(response.status, 401);
        process.exit(0);
      });
    };
    require('./api-monitoring/quotas').startQuotaPolling = () => {};
    require('./server');
  `;
    await promisify(execFile)(process.execPath, ['-e', bootstrap], {
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        MONGODB_URI: uri.replace(/\/$/, '') + '/' + database,
        WEB_PORT: '0',
        SESSION_SECRET: 'local-startup-test'
      },
      timeout: 20000
    });
  }
);
