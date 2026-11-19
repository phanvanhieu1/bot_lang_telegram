const profileForm = document.getElementById('profileForm');
const contextForm = document.getElementById('contextForm');
const dialog = document.getElementById('contextDialog');
const statusText = document.getElementById('personalStatus');
const languages = {
  vi: 'Tiếng Việt',
  zh: 'Tiếng Trung',
  en: 'Tiếng Anh',
  ja: 'Tiếng Nhật',
  ko: 'Tiếng Hàn'
};
const sourceNames = {
  ai_generated: 'AI tạo',
  user_customized: 'Đã chỉnh sửa',
  user_created: 'Tự tạo'
};
const lists = ['situations', 'keywords', 'exampleUtterances'];
let revision;
let editingId;
let pending = false;

async function api(path, method = 'GET', body) {
  const response = await fetch('/api/personal' + path, {
    method,
    ...(body
      ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        }
      : {})
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message);
  return data;
}

function element(tag, text) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  return node;
}

function button(text, action) {
  const node = element('button', text);
  node.type = 'button';
  node.onclick = action;
  return node;
}

function lines(value) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function fillProfile({ profile, topics, languages: options }) {
  revision = profile.revision;
  for (const key of ['occupation', 'style', 'addressTerms'])
    profileForm.elements[key].value = profile[key];
  document.getElementById('presetTopics').replaceChildren(
    ...topics.map((topic) => {
      const input = element('input');
      input.type = 'checkbox';
      input.name = 'topics';
      input.value = topic;
      input.checked = profile.translationTopics.includes(topic);
      const label = element('label');
      label.append(input, document.createTextNode(topic));
      return label;
    })
  );
  profileForm.elements.customTopics.value = profile.translationTopics
    .filter((topic) => !topics.includes(topic))
    .join('\n');
  ['sourceLanguage', 'targetLanguage'].forEach((name, i) => {
    const select = profileForm.elements[name];
    select.replaceChildren(
      new Option('Không đặt', ''),
      ...options.map((code) => new Option(languages[code], code))
    );
    select.value = profile.preferredLanguages[i] || '';
  });
}

function edit(context = {}) {
  editingId = context.contextId;
  document.getElementById('contextTitle').textContent = editingId
    ? 'Sửa ngữ cảnh'
    : 'Thêm ngữ cảnh';
  document.getElementById('contextError').textContent = '';
  for (const field of ['name', 'domain', 'description', 'scope', ...lists]) {
    const value = context[field];
    contextForm.elements[field].value = Array.isArray(value)
      ? value.join('\n')
      : value || '';
  }
  dialog.showModal();
}

function renderContexts(contexts) {
  document.getElementById('contextList').replaceChildren(
    ...contexts.map((context) => {
      const card = element('article');
      const state = context.status === 'active' ? 'Đang bật' : 'Đã tắt';
      const origin =
        context.generationMethod === 'fallback' &&
        context.source === 'ai_generated'
          ? 'Mẫu dự phòng'
          : sourceNames[context.source];
      card.append(
        element('h3', context.name),
        element('p', origin + ' · ' + state),
        element(
          'p',
          [context.domain, context.description, context.scope]
            .filter(Boolean)
            .join('\n')
        )
      );
      for (const [field, title] of [
        ['situations', 'Tình huống'],
        ['keywords', 'Từ khóa'],
        ['exampleUtterances', 'Ví dụ']
      ]) {
        if (!context[field].length) continue;
        const group = element('ul');
        group.append(...context[field].map((value) => element('li', value)));
        card.append(element('strong', title), group);
      }
      const base = '/contexts/' + context.contextId;
      const actions = element('div');
      actions.className = 'actions';
      actions.append(
        button('Sửa', () => edit(context)),
        button(context.status === 'active' ? 'Tắt' : 'Bật', () =>
          run(() =>
            api(base + '/status', 'PATCH', {
              revision,
              status: context.status === 'active' ? 'inactive' : 'active'
            })
          )
        ),
        button('Tạo lại bằng AI', () => {
          const replaceCustom = context.source !== 'ai_generated';
          if (
            replaceCustom &&
            !confirm('Thay nội dung tự chỉnh sửa bằng nội dung AI mới?')
          )
            return;
          return run(() =>
            api(base + '/regenerate', 'POST', { revision, replaceCustom })
          );
        }),
        button('Xóa', () => {
          if (confirm('Xóa ngữ cảnh này và bỏ chọn chủ đề tương ứng nếu có?')) {
            return run(() => api(base, 'DELETE', { revision }));
          }
        })
      );
      card.append(actions);
      return card;
    })
  );
}

async function renderSessions() {
  const { sessions } = await api('/conversations');
  const detail = document.getElementById('conversationDetail');
  detail.replaceChildren();
  document.getElementById('conversationList').replaceChildren(
    ...(sessions.length
      ? sessions.map((session) => {
          const path = '/conversations/' + session.sessionId;
          const item = element('article');
          item.append(
            element('h3', new Date(session.startedAt).toLocaleString('vi-VN')),
            element(
              'p',
              (session.status === 'active' ? 'Đang mở' : 'Đã kết thúc') +
                ' · ' +
                session.turnCount +
                ' lượt'
            )
          );
          const actions = element('div');
          actions.className = 'actions';
          actions.append(
            button('Xem lượt gần nhất', async () => {
              try {
                const { session: current } = await api(path);
                detail.replaceChildren(
                  element('h3', 'Lượt dịch gần nhất'),
                  ...current.turns.map((turn) =>
                    element(
                      'p',
                      '#' +
                        turn.sequence +
                        ' · ' +
                        turn.sourceLanguage +
                        ' → ' +
                        turn.targetLanguage +
                        '\n' +
                        turn.source +
                        '\n→ ' +
                        turn.translation +
                        (turn.truncated
                          ? '\n[Nội dung đã được rút gọn khi lưu]'
                          : '')
                    )
                  )
                );
                if (!current.turns.length)
                  detail.append(element('p', 'Phiên này chưa có lượt dịch.'));
              } catch (error) {
                statusText.textContent = error.message;
              }
            }),
            button('Xóa phiên', () => {
              if (confirm('Xóa toàn bộ lượt dịch trong phiên này?'))
                return run(() => api(path, 'DELETE'), {
                  refresh: renderSessions
                });
            })
          );
          item.append(actions);
          return item;
        })
      : [element('p', 'Bạn có thể mở phiên mới từ trang dịch.')])
  );
}

async function loadProfile() {
  const [profile, contexts] = await Promise.all([
    api('/profile'),
    api('/contexts')
  ]);
  if (profile.profile.revision !== contexts.revision)
    throw new Error('Hồ sơ đang được cập nhật. Hãy tải lại trang.');
  fillProfile(profile);
  renderContexts(contexts.contexts);
}

async function run(
  action,
  {
    refresh = loadProfile,
    feedback = statusText,
    close = false,
    successMessage = 'Đã cập nhật.'
  } = {}
) {
  if (pending) return;
  pending = true;
  const buttons = [...document.querySelectorAll('button')];
  buttons.forEach((control) => {
    control.disabled = true;
  });
  feedback.textContent = 'Đang xử lý…';
  try {
    await action();
    if (close) dialog.close();
    await refresh();
    statusText.textContent = successMessage;
  } catch (error) {
    (dialog.open ? feedback : statusText).textContent = error.message;
  } finally {
    pending = false;
    buttons.forEach((control) => {
      control.disabled = false;
    });
  }
}

profileForm.onsubmit = (event) => {
  event.preventDefault();
  const data = new FormData(profileForm);
  return run(() =>
    api('/profile', 'PUT', {
      revision,
      occupation: data.get('occupation'),
      style: data.get('style'),
      addressTerms: data.get('addressTerms'),
      translationTopics: [
        ...data.getAll('topics'),
        ...lines(data.get('customTopics'))
      ],
      preferredLanguages: [
        data.get('sourceLanguage'),
        data.get('targetLanguage')
      ].filter(Boolean)
    })
  );
};
document.getElementById('newContext').onclick = () => edit();
document.getElementById('closeContext').onclick = () => dialog.close();
contextForm.onsubmit = (event) => {
  event.preventDefault();
  const fields = Object.fromEntries(new FormData(contextForm));
  for (const field of lists) fields[field] = lines(fields[field]);
  const path = editingId ? '/contexts/' + editingId : '/contexts';
  return run(
    () => api(path, editingId ? 'PUT' : 'POST', { ...fields, revision }),
    {
      feedback: document.getElementById('contextError'),
      close: true
    }
  );
};

run(async () => {}, {
  refresh: () => Promise.all([loadProfile(), renderSessions()]),
  successMessage: ''
});
