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
  const voiceSelect = byId('ttsVoice');
  const speedSelect = byId('ttsSpeed');
  const validVoices = ['ByhETIclHirOlWnWKhHc', 'D9bZgM9Er0PhIxuW9Jqa', '2I36mEahS1u7ZnTKUoaB', 'BqljjWyTnrioXPCNkCd4'];
  const validSpeeds = ['0.8', '0.9', '1', '1.1', '1.2'];
  try {
    const savedVoice = localStorage.getItem('ttsVoice');
    const savedSpeed = localStorage.getItem('ttsSpeed');
    if (validVoices.includes(savedVoice)) voiceSelect.value = savedVoice;
    if (validSpeeds.includes(savedSpeed)) speedSelect.value = savedSpeed;
  } catch (error) { console.warn('Cannot load speech settings:', error); }
  voiceSelect.addEventListener('change', () => {
    stopSpeech();
    try { localStorage.setItem('ttsVoice', voiceSelect.value); } catch (error) { console.warn(error); }
  });
  speedSelect.addEventListener('change', () => {
    stopSpeech();
    try { localStorage.setItem('ttsSpeed', speedSelect.value); } catch (error) { console.warn(error); }
  });

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
  let currentAudio = null;
  let audioUrl = null;
  let requestController = null;
  let playbackId = 0;
  let lastSourceLanguage = null;

  function resetSpeechButton() {
    activeSpeechButton?.classList.remove('is-speaking');
    activeSpeechButton = null;
  }

  function stopSpeech() {
    playbackId++;
    requestController?.abort();
    requestController = null;
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.src = '';
      currentAudio = null;
    }
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      audioUrl = null;
    }
    window.speechSynthesis?.cancel();
    resetSpeechButton();
  }

  function browserSpeak(text, button, voiceLanguage = null) {
    if (!hasSpeech) {
      console.warn('Trình duyệt không hỗ trợ đọc văn bản');
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = voiceLanguage || (/[㐀-鿿]/u.test(text) ? 'zh-CN' : 'vi-VN');
    utterance.rate = Number(speedSelect.value);
    utterance.onend = resetSpeechButton;
    utterance.onerror = resetSpeechButton;
    activeSpeechButton = button;
    button.classList.add('is-speaking');
    window.speechSynthesis.speak(utterance);
  }

  function showSpeechError(message) {
    const status = byId('status');
    if (status) {
      status.textContent = message;
      status.className = 'status error';
    }
  }

  async function speak(content, button) {
    const text = content.trim();
    if (!text) return;
    if (activeSpeechButton === button) {
      stopSpeech();
      return;
    }
    stopSpeech();
    const id = playbackId;
    let speechLanguage;
    if (window.languageUI.get() === 'en') {
      const source = lastSourceLanguage || window.languageUI.guessSource(input.value);
      speechLanguage = button === outputSpeaker ? (source === 'en' ? 'vi' : 'en') : source;
    } else {
      speechLanguage = /[\u3400-\u9FFF]/u.test(text) ? 'zh' : 'vi';
    }
    if (speechLanguage === 'en') {
      browserSpeak(text, button, 'en-US');
      return;
    }
    button.classList.add('is-speaking');
    activeSpeechButton = button;
    requestController = new AbortController();
    try {
      const endpoint = speechLanguage === 'vi' ? '/api/tts/vietnamese' : '/api/tts/chinese';
      const payload = { text, speed: Number(speedSelect.value) };
      if (speechLanguage === 'zh') payload.voiceId = voiceSelect.value;
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: requestController.signal
      });
      // FREE web users retain device TTS; the fixed Vietnamese ElevenLabs
      // voice is reserved for logged-in PRO accounts.
      if (response.status === 403 && speechLanguage === 'vi') {
        stopSpeech();
        browserSpeak(text, button, 'vi-VN');
        return;
      }
      if (!response.ok) {
        let message = 'Không thể tạo âm thanh ElevenLabs';
        try {
          const data = await response.json();
          if (data?.message) message = data.message;
        } catch (_) {}
        throw new Error(`${message} (HTTP ${response.status})`);
      }
      console.info('ElevenLabs audio cache:', response.headers.get('X-Audio-Cache') || 'unknown');
      const blob = await response.blob();
      if (id !== playbackId) return;
      audioUrl = URL.createObjectURL(blob);
      currentAudio = new Audio(audioUrl);
      currentAudio.onended = () => { if (id === playbackId) stopSpeech(); };
      currentAudio.onerror = () => {
        if (id !== playbackId) return;
        stopSpeech();
        showSpeechError('Không thể phát file MP3 từ ElevenLabs.');
      };
      await currentAudio.play();
    } catch (error) {
      if (id !== playbackId || error.name === 'AbortError') return;
      console.error('ElevenLabs TTS error:', error);
      stopSpeech();
      showSpeechError(error.message || 'Không thể tạo giọng đọc lúc này.');
    }
  }

  if (!hasSpeech) {
    sourceSpeaker.title = outputSpeaker.title = 'Đọc tiếng Trung bằng ElevenLabs';
  }
  sourceSpeaker.addEventListener('click', () => speak(input.value, sourceSpeaker));
  outputSpeaker.addEventListener('click', () => speak(translation.textContent, outputSpeaker));

  function updateSourceControls() {
    const content = input.value.trim();
    const hasInput = Boolean(content);
    clearBtn.hidden = !hasInput;
    sourceMic.hidden = hasInput;
    sourceSpeaker.hidden = !hasInput;
    let destination = '';
    if (hasInput) {
      if (window.languageUI.get() === 'en') {
        const source = lastSourceLanguage || window.languageUI.guessSource(content);
        destination = source === 'vi' ? 'Anh' : 'Việt';
      } else {
        destination = /[\u3400-\u9FFF]/u.test(content) ? 'Việt' : 'Trung';
      }
    }
    targetLabel.textContent = hasInput ? 'Bản dịch · Tiếng ' + destination : 'Bản dịch';
  }

  input.addEventListener('input', () => { lastSourceLanguage = null; updateSourceControls(); });
  window.addEventListener('translation-finished', (event) => {
    if (window.languageUI.get() === 'en' && ['vi', 'en'].includes(event.detail?.sourceLanguage)) {
      lastSourceLanguage = event.detail.sourceLanguage;
      updateSourceControls();
    }
  });
  window.addEventListener('learning-language-change', () => {
    lastSourceLanguage = null;
    stopSpeech();
    updateSourceControls();
  });
  clearBtn.addEventListener('click', () => {
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();

    stopSpeech();
    translation.textContent = '';
    outputSpeaker.hidden = true;
    copyBtn.hidden = true;
    byId('backTranslation').textContent = '';
    byId('backTranslationWrapper').classList.add('hidden');
    byId('pronunciationWrapper').classList.add('hidden');
    byId('vocabularyWrapper').classList.add('hidden');
    window.renderTranslationVocabulary?.([], '', window.languageUI?.get?.() || 'zh');
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

    // Pinyin only applies when Chinese is the active learning language.
    if (window.languageUI.get() !== 'zh' || !/[\u3400-\u9FFF]/u.test(text) || text.length > 1000) {
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
