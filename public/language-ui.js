// Shared language selection for the translation workspace and practice dialog.
(() => {
  const select = document.getElementById('activeLanguageSelect');
  const el = (id) => document.getElementById(id);
  const NAMES = { zh: 'Trung', en: 'Anh' };
  let language = 'zh';
  try {
    if (localStorage.getItem('activeLearningLanguage') === 'en') language = 'en';
  } catch (_) {}

  const viDiacritics = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
  const viWords = /\b(tôi|toi|không|khong|của|cua|hôm|hom|được|duoc|với|voi|mình|minh|chúng|chung|chào|chao|cảm|muốn|muon|đã|đang|dang|các|cac|những|nhung|người|nguoi)\b/i;
  function guessSource(text) {
    const value = String(text || '').trim();
    if (language === 'zh') return /[\u3400-\u9FFF]/u.test(value) ? 'zh' : 'vi';
    if (viDiacritics.test(value) || viWords.test(value)) return 'vi';
    return 'en'; // An educated hint for audio only; AI decides the actual direction.
  }
  function updateLabels() {
    select.value = language;
    el('targetLang').value = language;
    el('practiceLauncherTitle').textContent = 'Luyện tiếng ' + NAMES[language];
    el('practiceModeBtn').textContent = 'Luyện tiếng ' + NAMES[language];
    el('practiceModalTitle').textContent = '📚 Luyện tiếng ' + NAMES[language];
    el('practiceModalDescription').textContent = 'Viết câu tiếng ' + NAMES[language] + ' và nhận đánh giá từ AI';
    el('practiceInputLabel').textContent = 'Câu tiếng ' + NAMES[language] + ' của bạn';
    el('practiceInput').placeholder = language === 'zh' ? 'Ví dụ: 我今天早上七点起床。' : 'Ví dụ: I go to work at eight.';
    el('practiceAudioLanguageLabel').textContent = 'Âm thanh luyện tiếng ' + NAMES[language];
    el('mainTtsLanguageLabel').textContent = 'Giọng đọc tiếng ' + NAMES[language];
    const en = language === 'en';
    for (const id of ['ttsVoice', 'practiceTtsVoice']) {
      el(id).hidden = en;
      const label = document.querySelector('label[for="' + id + '"]');
      if (label) label.hidden = en;
    }
    el('ttsEnglishNote').hidden = !en;
    el('practiceTtsEnglishNote').hidden = !en;
    el('originalPinyin').hidden = en;
    el('naturalPinyin').hidden = en;
    el('realtimePinyin').hidden = en || el('realtimePinyin').hidden;
    const badge = document.querySelector('.language-fixed');
    if (badge) badge.setAttribute('aria-label', 'Dịch tự động Việt - ' + NAMES[language]);
    const target = el('targetLabel');
    target.textContent = 'Bản dịch';
    document.title = 'Dịch Việt · ' + NAMES[language];
  }
  window.languageUI = {
    get: () => language,
    foreignName: () => NAMES[language],
    guessSource,
    getOutputLanguage: (source) => source === 'vi' ? language : 'vi'
  };
  select.addEventListener('change', () => {
    const next = select.value === 'en' ? 'en' : 'zh';
    if (next === language) return;
    language = next;
    try { localStorage.setItem('activeLearningLanguage', language); } catch (_) {}
    updateLabels();
    window.dispatchEvent(new CustomEvent('learning-language-change', { detail: { language } }));
  });
  updateLabels();
})();
