(() => {
  const byId = (id) => document.getElementById(id);
  const dialog = byId('translationProfileDialog');
  const form = byId('translationProfileForm');
  const fields = byId('profileSetupFields');
  const occupation = byId('profileOccupation');
  const customTopic = byId('profileCustomTopic');
  const chips = byId('profileTopicChips');
  const skip = byId('profileSkipSetup');
  const save = byId('profileSaveSetup');
  const manage = byId('profileManageLink');
  const menu = byId('openTranslationProfile');
  const menuStatus = byId('profileMenuStatus');
  const errorText = byId('profileSetupError');
  const progress = byId('profileSetupProgress');
  const limit = 12;
  let initialized = false;
  let authenticated = false;
  let loading = false;
  let saving = false;
  let automatic = false;
  let profile;
  let reminderKey;
  let returnFocus;

  async function request(path, method = 'GET', body) {
    const response = await fetch('/api/personal/profile' + path, {
      method,
      ...(body
        ? {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          }
        : {})
    }).catch(() => null);
    if (!response) throw new Error('Không thể kết nối. Vui lòng thử lại.');
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success !== true) {
      const error = new Error(
        data.message || 'Không thể tải hồ sơ dịch thuật. Vui lòng thử lại.'
      );
      error.status = response.status;
      throw error;
    }
    return data;
  }

  const topicKey = (value) =>
    value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  const topicInputs = () => [...chips.querySelectorAll('input')];
  const selected = () =>
    topicInputs()
      .filter((input) => input.checked)
      .map((input) => input.value);

  function addChip(name, checked) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    const text = document.createElement('span');
    label.className = 'profile-topic-chip';
    input.type = 'checkbox';
    input.value = name;
    input.checked = checked;
    text.textContent = name;
    label.append(input, text);
    chips.append(label);
  }

  function addCustomTopic() {
    const name = customTopic.value.trim();
    if (!name) return true;
    const existing = topicInputs().find(
      (input) => topicKey(input.value) === topicKey(name)
    );
    if (!existing?.checked && selected().length >= limit) {
      errorText.textContent = 'Bạn có thể chọn tối đa 12 chủ đề.';
      customTopic.focus();
      return false;
    }
    if (existing) existing.checked = true;
    else addChip(name, true);
    customTopic.value = '';
    errorText.textContent = '';
    return true;
  }

  function open(data, auto) {
    profile = data.profile;
    reminderKey = data.reminderKey;
    automatic = auto;
    const chosen = new Map(
      profile.translationTopics.map((name) => [topicKey(name), name])
    );
    const available = new Map(
      data.topics.map((name) => [topicKey(name), name])
    );
    occupation.value = profile.occupation;
    customTopic.value = '';
    chips.replaceChildren();
    for (const [key, name] of available) addChip(name, chosen.has(key));
    for (const [key, name] of chosen) {
      if (!available.has(key)) addChip(name, true);
    }
    const settings = byId('settingsBtn');
    returnFocus =
      auto && document.activeElement !== document.body
        ? document.activeElement
        : settings;
    byId('settingsPanel').hidden = true;
    settings.setAttribute('aria-expanded', 'false');
    manage.hidden = auto;
    skip.textContent = auto ? 'Bỏ qua' : 'Đóng';
    save.textContent = auto ? 'Lưu và tiếp tục' : 'Lưu thay đổi';
    errorText.textContent = '';
    progress.textContent = '';
    dialog.showModal();
  }

  function rememberDismissal() {
    if (reminderKey) {
      try {
        sessionStorage.setItem('translation-setup:' + reminderKey, '1');
      } catch {
        /* The login session can still retain the dismissal. */
      }
    }
    void request('/dismiss', 'POST').catch(() => {});
  }

  function dismiss() {
    if (saving) return;
    if (automatic) rememberDismissal();
    dialog.close();
  }

  function dismissedInTab(key) {
    try {
      return Boolean(key && sessionStorage.getItem('translation-setup:' + key));
    } catch {
      return false;
    }
  }

  async function load(auto) {
    if (!authenticated || loading || dialog.open) return;
    loading = true;
    menu.disabled = true;
    menuStatus.textContent = auto ? '' : 'Đang tải hồ sơ…';
    try {
      const data = await request('');
      const needsSetup = ['pending', 'skipped'].includes(
        data.profile?.setupStatus
      );
      if (
        !auto ||
        (needsSetup &&
          !data.reminderDismissed &&
          !dismissedInTab(data.reminderKey))
      ) {
        open(data, auto);
      }
      menuStatus.textContent = '';
    } catch {
      if (!auto) menuStatus.textContent = 'Chưa tải được hồ sơ. Hãy thử lại.';
    } finally {
      loading = false;
      menu.disabled = false;
    }
  }

  window.translationProfileSetup = {
    initialize() {
      if (initialized) return;
      initialized = authenticated = true;
      return load(true);
    }
  };

  menu.addEventListener('click', () => load(false));
  skip.addEventListener('click', dismiss);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    dismiss();
  });
  dialog.addEventListener('close', () =>
    returnFocus?.focus({ preventScroll: true })
  );
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    if (saving) {
      event.preventDefault();
      return;
    }
    const focusable = [
      ...dialog.querySelectorAll('input, button, a[href]')
    ].filter((control) => !control.hidden && !control.disabled);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  });
  byId('profileAddTopic').addEventListener('click', () => {
    if (addCustomTopic()) customTopic.focus();
  });
  customTopic.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      addCustomTopic();
    }
  });
  chips.addEventListener('change', (event) => {
    if (selected().length > limit) {
      event.target.checked = false;
      errorText.textContent = 'Bạn có thể chọn tối đa 12 chủ đề.';
    } else {
      errorText.textContent = '';
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving || !profile || !addCustomTopic()) return;
    const { revision, preferredLanguages, style, addressTerms } = profile;
    const payload = {
      revision,
      preferredLanguages,
      style,
      addressTerms,
      occupation: occupation.value,
      translationTopics: selected()
    };
    saving = true;
    fields.disabled = skip.disabled = save.disabled = true;
    manage.hidden = true;
    fields.setAttribute('aria-busy', 'true');
    byId('translationProfileTitle').focus();
    errorText.textContent = '';
    progress.textContent = 'Đang lưu hồ sơ và đồng bộ ngữ cảnh…';
    save.textContent = 'Đang lưu…';
    try {
      const data = await request('', 'PUT', payload);
      if (data.profile?.setupStatus !== 'configured')
        throw new Error('Chưa thể xác nhận hồ sơ đã được lưu.');
      dialog.close();
    } catch (error) {
      if (error.status === 409) {
        try {
          profile = (await request('')).profile;
          errorText.textContent =
            'Hồ sơ vừa thay đổi ở nơi khác. Kiểm tra lựa chọn rồi lưu lại.';
        } catch {
          errorText.textContent =
            'Chưa tải được phiên bản hồ sơ mới. Hãy thử lại.';
        }
      } else {
        errorText.textContent =
          error.message || 'Chưa lưu được hồ sơ. Hãy thử lại.';
      }
    } finally {
      saving = false;
      fields.disabled = skip.disabled = save.disabled = false;
      manage.hidden = automatic;
      fields.removeAttribute('aria-busy');
      progress.textContent = '';
      save.textContent = automatic ? 'Lưu và tiếp tục' : 'Lưu thay đổi';
      if (dialog.open) save.focus();
    }
  });
})();
