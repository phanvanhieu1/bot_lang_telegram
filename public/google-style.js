// Header and translation-pane interactions. API permissions are enforced server-side.
(() => {
  const byId = (id) => document.getElementById(id);
  const hamburger = byId('adminHamburger');
  const legacyAdminToggle = byId('adminMenuToggle');
  const adminMenuPanel = byId('adminMenuPanel');
  const input = byId('text');
  const clearBtn = byId('clearSourceBtn');
  const sourceMic = byId('sourceMicBtn');
  const sourceSpeaker = byId('sourceSpeakBtn');
  const outputSpeaker = byId('outputSpeakBtn');
  const copyBtn = byId('copyBtn');
  const translation = byId('translation');
  const targetLabel = byId('targetLabel');
  const themeButton = byId('themeToggle');
  const settingsButton = byId('settingsBtn');
  const settingsPanel = byId('settingsPanel');
  const settingsAnchor = byId('settingsAnchor');
  const profileButton = byId('profileBtn');
  const profilePanel = byId('profilePanel');
  const profileAnchor = byId('profileAnchor');

  function closeSettings() {
    settingsPanel.hidden = true;
    settingsButton.setAttribute('aria-expanded', 'false');
  }

  function closeProfile() {
    profilePanel.hidden = true;
    profileButton.setAttribute('aria-expanded', 'false');
  }

  settingsButton.addEventListener('click', () => {
    if (settingsButton.disabled) return;
    const opening = settingsPanel.hidden;
    closeProfile();
    settingsPanel.hidden = !opening;
    settingsButton.setAttribute('aria-expanded', String(opening));
  });

  profileButton.addEventListener('click', () => {
    const opening = profilePanel.hidden;
    closeSettings();
    profilePanel.hidden = !opening;
    profileButton.setAttribute('aria-expanded', String(opening));
  });

  hamburger.addEventListener('click', (event) => {
    event.stopPropagation();
    if (hamburger.hidden) return;
    closeSettings();
    closeProfile();
    legacyAdminToggle.click();
  });

  document.addEventListener('click', (event) => {
    if (!settingsAnchor.contains(event.target)) closeSettings();
    if (!profileAnchor.contains(event.target)) closeProfile();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeSettings();
      closeProfile();
    }
  });

  // Sync the hamburger's expanded state with the existing admin menu.
  const observer = new MutationObserver(() => {
    hamburger.setAttribute('aria-expanded', String(!adminMenuPanel.hidden));
  });
  observer.observe(adminMenuPanel, { attributes: true, attributeFilter: ['hidden'] });

  function applyTheme(theme) {
    const dark = theme === 'dark';
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    themeButton.setAttribute('aria-pressed', String(dark));
    themeButton.setAttribute('aria-label', dark ? 'Bật giao diện sáng' : 'Bật giao diện tối');
    themeButton.title = dark ? 'Bật giao diện sáng' : 'Bật giao diện tối';
    try {
      localStorage.setItem('translatorTheme', dark ? 'dark' : 'light');
    } catch (error) {
      console.warn('Cannot save theme preference:', error);
    }
  }

  let savedTheme = 'light';
  try {
    savedTheme = localStorage.getItem('translatorTheme') === 'dark' ? 'dark' : 'light';
  } catch (error) {
    console.warn('Cannot read theme preference:', error);
  }
  applyTheme(savedTheme);
  themeButton.addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });

  const hasSpeech = typeof window.speechSynthesis !== 'undefined' &&
    typeof window.SpeechSynthesisUtterance === 'function';
  let activeSpeechButton = null;

  function resetSpeechButton() {
    activeSpeechButton?.classList.remove('is-speaking');
    activeSpeechButton = null;
  }

  function speak(content, button) {
    const text = content.trim();
    if (!hasSpeech || !text) return;
    // Clicking the same speaker again stops playback.
    if (activeSpeechButton === button) {
      window.speechSynthesis.cancel();
      resetSpeechButton();
      return;
    }

    window.speechSynthesis.cancel();
    resetSpeechButton();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = /[\u3400-\u9FFF]/u.test(text) ? 'zh-CN' : 'vi-VN';
    utterance.rate = 1;
    utterance.onend = resetSpeechButton;
    utterance.onerror = resetSpeechButton;

    activeSpeechButton = button;
    button.classList.add('is-speaking');
    window.speechSynthesis.speak(utterance);
  }

  if (!hasSpeech) {
    sourceSpeaker.disabled = true;
    outputSpeaker.disabled = true;
    sourceSpeaker.title = outputSpeaker.title = 'Trình duyệt chưa hỗ trợ đọc văn bản';
  }
  sourceSpeaker.addEventListener('click', () => speak(input.value, sourceSpeaker));
  outputSpeaker.addEventListener('click', () => speak(translation.textContent, outputSpeaker));

  function updateSourceControls() {
    const content = input.value.trim();
    const hasInput = Boolean(content);
    clearBtn.hidden = !hasInput;
    sourceMic.hidden = hasInput;
    sourceSpeaker.hidden = !hasInput;
    targetLabel.textContent = !hasInput
      ? 'Bản dịch'
      : /[\u3400-\u9FFF]/u.test(content)
        ? 'Bản dịch · Tiếng Việt'
        : 'Bản dịch · Tiếng Trung';
  }

  input.addEventListener('input', updateSourceControls);
  clearBtn.addEventListener('click', () => {
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();

    window.speechSynthesis?.cancel();
    resetSpeechButton();
    translation.textContent = '';
    outputSpeaker.hidden = true;
    copyBtn.hidden = true;
    byId('backTranslation').textContent = '';
    byId('backTranslationWrapper').classList.add('hidden');
    byId('pronunciationWrapper').classList.add('hidden');
    byId('vocabularyWrapper').classList.add('hidden');
    byId('verificationWrapper').classList.add('hidden');
    byId('status').textContent = '';
  });
  updateSourceControls();
})();

// Realtime Pinyin
(() => {
  const input = document.getElementById('text');
  const wrapper = document.getElementById('realtimePinyin');
  const output = document.getElementById('realtimePinyinText');

  if (!input || !wrapper || !output) return;

  let debounceTimer;
  let controller;
  let requestId = 0;

  async function updatePinyin() {
    const text = input.value.trim();
    const currentRequest = ++requestId;

    clearTimeout(debounceTimer);
    controller?.abort();

    // Chỉ hiển thị khi có chữ Trung
    if (!/[\u3400-\u9FFF]/u.test(text) || text.length > 1000) {
      wrapper.hidden = true;
      output.textContent = '';
      return;
    }

    // Ẩn kết quả cũ trong lúc chờ cập nhật
    wrapper.hidden = true;
    output.textContent = '';

    debounceTimer = setTimeout(async () => {
      controller = new AbortController();

      try {
        const response = await fetch(
          `/api/pinyin?text=${encodeURIComponent(text)}`,
          {
            credentials: 'same-origin',
            signal: controller.signal
          }
        );

        if (!response.ok) {
          throw new Error(`Pinyin API: ${response.status}`);
        }

        const data = await response.json();

        // Bỏ qua phản hồi cũ nếu người dùng đã nhập nội dung mới
        if (currentRequest !== requestId) return;

        output.textContent = data.pinyin || '';
        wrapper.hidden = !data.pinyin;
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.error('Realtime Pinyin error:', error);
        }
      }
    }, 200);
  }

  input.addEventListener('input', updatePinyin);

  // Hỗ trợ trường hợp ô nhập đã có sẵn nội dung
  updatePinyin();
})();
