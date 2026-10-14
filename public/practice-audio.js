// Independent ElevenLabs playback controls for the Chinese practice dialog.
(() => {
  const el = (id) => document.getElementById(id);
  const modal = el('practiceModal');
  const voice = el('practiceTtsVoice');
  const speed = el('practiceTtsSpeed');
  const status = el('practiceAudioStatus');
  const buttons = [el('practiceOriginalSpeak'), el('practiceNaturalSpeak')];
  const voices = ['ByhETIclHirOlWnWKhHc', 'D9bZgM9Er0PhIxuW9Jqa', '2I36mEahS1u7ZnTKUoaB', 'BqljjWyTnrioXPCNkCd4'];
  const speeds = ['0.8', '0.9', '1', '1.1', '1.2'];
  let controller = null;
  let audio = null;
  let url = null;
  let active = null;
  let generation = 0;

  try {
    const v = localStorage.getItem('practiceTtsVoice');
    const s = localStorage.getItem('practiceTtsSpeed');
    if (voices.includes(v)) voice.value = v;
    if (speeds.includes(s)) speed.value = s;
  } catch (_) {}

  function stop() {
    generation++;
    controller?.abort();
    controller = null;
    if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); audio = null; }
    if (url) { URL.revokeObjectURL(url); url = null; }
    if (active) { active.textContent = '🔊 Nghe'; active = null; }
  }

  function changed() {
    stop();
    status.textContent = '';
    try {
      localStorage.setItem('practiceTtsVoice', voice.value);
      localStorage.setItem('practiceTtsSpeed', speed.value);
    } catch (_) {}
  }
  voice.addEventListener('change', changed);
  speed.addEventListener('change', changed);

  async function speak(text, button) {
    if (active === button) { stop(); return; }
    stop();
    status.textContent = '';
    // Mixed identifiers and Latin text should not be sent to Mandarin synthesis.
    const chinese = text.replace(/[A-Za-z0-9_]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!/[\u3400-\u9FFF]/u.test(chinese)) {
      status.textContent = 'Không có nội dung tiếng Trung để đọc.';
      return;
    }
    if (chinese.length > 500) {
      status.textContent = 'Chỉ hỗ trợ đọc tối đa 500 ký tự tiếng Trung.';
      return;
    }
    active = button;
    button.textContent = '■ Dừng';
    const id = generation;
    controller = new AbortController();
    try {
      const response = await fetch('/api/tts/chinese', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: chinese, voiceId: voice.value, speed: Number(speed.value) }),
        signal: controller.signal
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || 'ElevenLabs TTS HTTP ' + response.status);
      }
      console.info('Practice audio cache:', response.headers.get('X-Audio-Cache'));
      const blob = await response.blob();
      if (id !== generation) return;
      url = URL.createObjectURL(blob);
      audio = new Audio(url);
      audio.onended = () => { if (id === generation) stop(); };
      audio.onerror = () => {
        if (id === generation) {
          stop();
          status.textContent = 'Không thể phát MP3 luyện tập.';
        }
      };
      await audio.play();
    } catch (error) {
      if (id !== generation || error.name === 'AbortError') return;
      stop();
      status.textContent = error.message || 'Không thể phát âm thanh.';
      console.error('Practice TTS:', error);
    }
  }

  buttons[0].addEventListener('click', () => speak(el('originalText').textContent, buttons[0]));
  buttons[1].addEventListener('click', () => speak(el('naturalText').textContent, buttons[1]));
  modal.addEventListener('close', stop);
  const observer = new MutationObserver(() => {
    if (el('practiceModalResult').classList.contains('hidden')) stop();
  });
  observer.observe(el('practiceModalResult'), { attributes: true, attributeFilter: ['class'] });
})();
