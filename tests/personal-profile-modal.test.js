const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { runInNewContext } = require('node:vm');
const test = require('node:test');

const source = readFileSync(
  path.join(__dirname, '../public/profile-setup.js'),
  'utf8'
);
const profile = {
  setupStatus: 'pending',
  revision: 0,
  occupation: '',
  translationTopics: [],
  preferredLanguages: ['vi', 'zh'],
  style: 'Trang trọng',
  addressTerms: 'Anh chị'
};
const fixture = (overrides) => ({
  success: true,
  profile,
  topics: ['Daily Conversation'],
  reminderKey: 'login-1',
  reminderDismissed: false,
  ...overrides
});
const reply = (data, status = 200) => ({
  ok: status === 200,
  status,
  json: async () => data
});

function mount(request, storage = new Map()) {
  let document;
  class Element {
    value = '';
    checked = false;
    children = [];
    events = new Map();
    open = false;
    setAttribute() {}
    removeAttribute() {}
    focus() {
      document.activeElement = this;
    }
    append(...nodes) {
      this.children.push(...nodes);
    }
    replaceChildren(...nodes) {
      this.children = nodes;
    }
    addEventListener(name, handler) {
      this.events.set(name, handler);
    }
    emit(name, event = {}) {
      return this.events.get(name)?.({ preventDefault() {}, ...event });
    }
    querySelectorAll() {
      return this.children.map((label) => label.children[0]);
    }
    showModal() {
      this.open = true;
    }
    close() {
      this.open = false;
      this.emit('close');
    }
  }
  const ids = new Map();
  const get = (id) => {
    if (!ids.has(id)) ids.set(id, new Element());
    return ids.get(id);
  };
  document = {
    getElementById: get,
    body: get('body'),
    activeElement: get('body'),
    createElement: () => new Element()
  };
  const window = {};
  runInNewContext(source, {
    window,
    document,
    fetch: request,
    sessionStorage: {
      getItem: (key) => storage.get(key),
      setItem: (key, value) => storage.set(key, value)
    }
  });
  return {
    get,
    initialize: window.translationProfileSetup.initialize,
    dialog: get('translationProfileDialog')
  };
}

test('modal waits for authenticated profile, only prompts pending or previously skipped profiles and never assumes API failure is pending', async () => {
  let resolve;
  let calls = 0;
  const app = mount(() => {
    calls++;
    return new Promise((done) => {
      resolve = done;
    });
  });
  assert.equal(calls, 0);
  const loading = app.initialize();
  assert.equal(app.dialog.open, false);
  resolve(reply(fixture()));
  await loading;
  assert.equal(app.dialog.open, true);
  app.initialize();
  assert.equal(calls, 1);

  for (const status of ['configured', 'skipped']) {
    const current = mount(async () =>
      reply(fixture({ profile: { ...profile, setupStatus: status } }))
    );
    await current.initialize();
    assert.equal(current.dialog.open, status === 'skipped');
  }
  const failed = mount(async () => reply({ success: false }, 500));
  await failed.initialize();
  assert.equal(failed.dialog.open, false);
  await failed.get('openTranslationProfile').emit('click');
  assert.match(failed.get('profileMenuStatus').textContent, /Chưa tải/);
});

test('skip and Escape dismiss the current login only, while settings can manually reopen the modal', async () => {
  const storage = new Map();
  const dismissals = [];
  const fetch = (data) => async (url, options) => {
    if (options.method === 'POST') dismissals.push(url);
    return reply(data);
  };
  const app = mount(fetch(fixture()), storage);
  await app.initialize();
  app.dialog.emit('cancel');
  assert.equal(app.dialog.open, false);
  assert.equal(dismissals.length, 1);
  const reload = mount(fetch(fixture()), storage);
  await reload.initialize();
  assert.equal(reload.dialog.open, false);
  await reload.get('openTranslationProfile').emit('click');
  assert.equal(reload.dialog.open, true);
  assert.equal(reload.get('profileManageLink').hidden, false);
  reload.get('profileSkipSetup').emit('click');
  assert.equal(dismissals.length, 1);

  const otherTab = mount(fetch(fixture({ reminderDismissed: true })));
  await otherTab.initialize();
  assert.equal(otherTab.dialog.open, false);
  const newLogin = mount(fetch(fixture({ reminderKey: 'login-2' })), storage);
  await newLogin.initialize();
  assert.equal(newLogin.dialog.open, true);
});

test('save keeps modal open during submission and API failure, preserves settings and closes after retry succeeds', async () => {
  let resolve;
  const saves = [];
  const app = mount(async (_, options) => {
    if (options.method !== 'PUT') return reply(fixture());
    saves.push(JSON.parse(options.body));
    return new Promise((done) => {
      resolve = done;
    });
  });
  await app.initialize();
  app.get('profileOccupation').value = 'Kỹ sư';
  const custom = app.get('profileCustomTopic');
  custom.value = 'Chủ đề riêng';
  custom.emit('keydown', { key: 'Enter' });
  const form = app.get('translationProfileForm');
  const pending = form.emit('submit');
  form.emit('submit');
  app.dialog.emit('cancel');
  assert.equal(app.dialog.open, true);
  assert.equal(app.get('profileSaveSetup').disabled, true);
  assert.equal(saves.length, 1);
  assert.deepEqual(saves[0], {
    revision: 0,
    occupation: 'Kỹ sư',
    translationTopics: ['Chủ đề riêng'],
    preferredLanguages: ['vi', 'zh'],
    style: 'Trang trọng',
    addressTerms: 'Anh chị'
  });
  resolve(reply({ success: false, message: 'Lỗi khi lưu' }, 500));
  await pending;
  assert.equal(app.dialog.open, true);
  assert.equal(app.get('profileSetupError').textContent, 'Lỗi khi lưu');
  assert.equal(app.get('profileSaveSetup').disabled, false);
  const retry = form.emit('submit');
  assert.deepEqual(saves[1], saves[0]);
  resolve(
    reply(fixture({ profile: { ...profile, setupStatus: 'configured' } }))
  );
  await retry;
  assert.equal(app.dialog.open, false);
});
