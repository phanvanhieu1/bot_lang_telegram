
const textInput = document.getElementById('text');
const targetLang = document.getElementById('targetLang');
const translateBtn = document.getElementById('translateBtn');
const translateText = document.getElementById('translateText');
const status = document.getElementById('status');
const languageSelector = document.getElementById('languageSelector');
const translationResult = document.getElementById('translationResult');
const backTranslationWrapper =
  document.getElementById('backTranslationWrapper');

const backTranslation =
  document.getElementById('backTranslation');

const todayCost = document.getElementById('todayCost');
const todayStats = document.getElementById('todayStats');
const totalCost = document.getElementById('totalCost');
const totalStats = document.getElementById('totalStats');

const historyBtn = document.getElementById('historyBtn');
const historySidebar = document.getElementById('historySidebar');
const historyOverlay = document.getElementById('historyOverlay');
const closeHistoryBtn = document.getElementById('closeHistoryBtn');
const historySearch = document.getElementById('historySearch');
const historyList = document.getElementById('historyList');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');
const logoutBtn = document.getElementById('logoutBtn');

let historyData = [];

const translation = document.getElementById('translation');
const pronunciation = document.getElementById('pronunciation');
const vocabulary = document.getElementById('vocabulary');

const copyBtn = document.getElementById('copyBtn');
const translateModeBtn = document.getElementById('translateModeBtn');
const practiceModeBtn = document.getElementById('practiceModeBtn');
const practiceResult = document.getElementById('practiceResult');

const practiceScore = document.getElementById('practiceScore');
const grammarScore = document.getElementById('grammarScore');
const vocabularyScore = document.getElementById('vocabularyScore');
const naturalScore = document.getElementById('naturalScore');

const originalText = document.getElementById('originalText');
const originalPinyin = document.getElementById('originalPinyin');
const originalTranslation = document.getElementById('originalTranslation');

const naturalText = document.getElementById('naturalText');
const naturalPinyin = document.getElementById('naturalPinyin');
const naturalTranslation = document.getElementById('naturalTranslation');


const practiceFeedback = document.getElementById('practiceFeedback');
const practiceExplanation = document.getElementById('practiceExplanation');

let currentMode = 'translate';


async function evaluateChinesePractice() {
  const text = textInput.value.trim();

  if (!text) {
    status.textContent = 'Vui lòng nhập nội dung tiếng Trung';
    status.className = 'status error';
    textInput.focus();
    return;
  }

  translateBtn.disabled = true;
  translateBtn.classList.add('loading');

  status.textContent = 'Đang chấm bài...';
  status.className = '';

  practiceResult.classList.add('hidden');

  try {
    const response = await fetch('/api/practice/chinese', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ text })
    });

    const data = await response.json();

    if (response.status === 401) {
      window.location.href = '/login';
      return;
    }

    if (!response.ok || !data.success) {
      throw new Error(
        data.message || 'Không thể chấm bài'
      );
    }

    parsePracticeResult(data.result);

    practiceResult.classList.remove('hidden');

    status.textContent = '✓ Chấm bài hoàn tất';
    status.className = 'status success';

    loadUsage();

  } catch (error) {
    console.error(error);

    status.textContent =
      error.message || 'Không thể chấm bài';

    status.className = 'status error';

  } finally {
    translateBtn.disabled = false;
    translateBtn.classList.remove('loading');
  }
}

function parsePracticeResult(result) {
  const getValue = (label, nextLabels = []) => {
    const next = nextLabels.length
      ? `(?=\\n(?:${nextLabels.join('|')}):|$)`
      : '$';

    const regex = new RegExp(
      `${label}:\\s*([\\s\\S]*?)${next}`,
      'i'
    );

    const match = result.match(regex);

    return match ? match[1].trim() : '';
  };

  practiceScore.textContent =
  `${getValue('SCORE', ['GRAMMAR']) || '-'}/10`;

grammarScore.textContent =
  `${getValue('GRAMMAR', ['VOCABULARY']) || '-'}/10`;

vocabularyScore.textContent =
  `${getValue('VOCABULARY', ['NATURALNESS']) || '-'}/10`;

naturalScore.textContent =
  `${getValue('NATURALNESS', ['ORIGINAL']) || '-'}/10`;

originalText.textContent =
  getValue('ORIGINAL', ['ORIGINAL_PINYIN']);

originalPinyin.textContent =
  getValue('ORIGINAL_PINYIN', ['ORIGINAL_TRANSLATION']);

originalTranslation.textContent =
  getValue('ORIGINAL_TRANSLATION', ['NATURAL']);

naturalText.textContent =
  getValue('NATURAL', ['NATURAL_PINYIN']);

naturalPinyin.textContent =
  getValue('NATURAL_PINYIN', ['NATURAL_TRANSLATION']);

naturalTranslation.textContent =
  getValue('NATURAL_TRANSLATION', ['FEEDBACK']);

practiceFeedback.textContent =
  getValue('FEEDBACK', ['EXPLANATION']);

practiceExplanation.textContent =
  getValue('EXPLANATION');
}


// =========================
// TRANSLATE
// =========================

async function translate() {
  if (currentMode === 'practice') {
  return evaluateChinesePractice();
}
  const text = textInput.value.trim();
  const selectedLang = targetLang.value;

  if (!text) {
    status.textContent = 'Vui lòng nhập nội dung cần dịch';
    status.className = 'status error';
    textInput.focus();
    return;
  }

  translateBtn.disabled = true;
  translateBtn.classList.add('loading');

  status.textContent = 'Đang dịch...';
  status.className = 'status';

  translation.textContent = '';
  pronunciation.textContent = '';
  vocabulary.textContent = '';

  try {
    const response = await fetch('/api/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text,
        targetLang: selectedLang,
        fastMode: false
      })
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.message || 'Dịch thất bại');
    }

    parseResult(data.result);

    status.textContent = '✓ Dịch thành công';
    status.className = 'status success';

    // Cập nhật thống kê sau khi dịch
    loadUsage();

  } catch (error) {
    console.error(error);

    status.textContent = error.message || 'Dịch thất bại';
    status.className = 'status error';

  } finally {
    translateBtn.disabled = false;
    translateBtn.classList.remove('loading');
  }
}


// =========================
// ENTER TO TRANSLATE
// =========================

textInput.addEventListener('keydown', (event) => {

  // Ctrl + Enter = xuống dòng
  if (event.key === 'Enter' && event.ctrlKey) {
    event.preventDefault();

    const start = textInput.selectionStart;
    const end = textInput.selectionEnd;

    textInput.value =
      textInput.value.substring(0, start) +
      '\n' +
      textInput.value.substring(end);

    textInput.selectionStart = textInput.selectionEnd = start + 1;

    return;
  }

  // Enter = dịch
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    translate();
  }

});


// =========================
// TRANSLATE BUTTON
// =========================

translateBtn.addEventListener('click', translate);


// =========================
// PARSE RESULT
// =========================

function parseResult(result) {

  const translationMatch = result.match(
  /TRANSLATION:\s*([\s\S]*?)(?=\nBACK_TRANSLATION:|\nPRONUNCIATION:|$)/i
);

const backTranslationMatch = result.match(
  /BACK_TRANSLATION:\s*([\s\S]*?)(?=\nPRONUNCIATION:|$)/i
);

  const pronunciationMatch = result.match(
    /PRONUNCIATION:\s*([\s\S]*?)(?=\nVOCABULARY:|$)/i
  );

  const vocabularyMatch = result.match(
    /VOCABULARY:\s*([\s\S]*)$/i
  );

  translation.textContent =
    translationMatch
      ? translationMatch[1].trim()
      : '';

  const backText = backTranslationMatch
  ? backTranslationMatch[1].trim()
  : '';

backTranslation.textContent = backText;

if (backText) {
  backTranslationWrapper.classList.remove('hidden');
} else {
  backTranslationWrapper.classList.add('hidden');
}

  pronunciation.textContent =
    pronunciationMatch
      ? pronunciationMatch[1].trim()
      : '';

  vocabulary.textContent =
    vocabularyMatch
      ? vocabularyMatch[1].trim()
      : '';
}


// =========================
// COPY TRANSLATION
// =========================

copyBtn.addEventListener('click', async () => {

  const text = translation.textContent.trim();

  if (!text) {
    status.textContent = 'Chưa có bản dịch để copy';
    status.className = 'status error';
    return;
  }

  try {

    await navigator.clipboard.writeText(text);

    const originalText = copyBtn.textContent;

    copyBtn.textContent = '✓ Đã copy';

    status.textContent = 'Đã copy bản dịch';
    status.className = 'status success';

    setTimeout(() => {
      copyBtn.textContent = originalText;
    }, 1500);

  } catch (error) {

    console.error(error);

    status.textContent = 'Không thể copy';
    status.className = 'status error';

  }

});


// =========================
// LOAD USAGE
// =========================

async function loadUsage() {

  try {

    const response = await fetch('/api/usage');

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error('Không thể lấy usage');
    }

    todayCost.textContent =
      `$${Number(data.today.cost).toFixed(6)}`;

    todayStats.textContent =
      `${data.today.requests} request · ${data.today.tokens.toLocaleString()} tokens`;

    totalCost.textContent =
      `$${Number(data.total.cost).toFixed(6)}`;

    totalStats.textContent =
      `${data.total.requests} request · ${data.total.tokens.toLocaleString()} tokens`;

  } catch (error) {

    console.error('Usage error:', error);

  }

}

function openHistory() {
  historySidebar.classList.add('active');
  historyOverlay.classList.add('active');

  loadHistory();
}

function closeHistory() {
  historySidebar.classList.remove('active');
  historyOverlay.classList.remove('active');
}

historyBtn.addEventListener('click', openHistory);
closeHistoryBtn.addEventListener('click', closeHistory);
historyOverlay.addEventListener('click', closeHistory);

async function loadHistory() {
  try {
    const response = await fetch('/api/history');
    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error('Không thể tải lịch sử');
    }

    historyData = data.history;

    renderHistory(historyData);

  } catch (error) {
    console.error('History error:', error);

    historyList.innerHTML =
      '<div class="history-empty">Không thể tải lịch sử</div>';
  }
}

function renderHistory(items) {
  historyList.innerHTML = '';

  if (!items.length) {
    historyList.innerHTML =
      '<div class="history-empty">Chưa có lịch sử dịch</div>';
    return;
  }

  items.forEach(item => {
    const element = document.createElement('div');
    element.className = 'history-item';

    const date = new Date(item.time);

    const time = date.toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit'
    });

    const translationMatch = item.result.match(
      /TRANSLATION:\s*([\s\S]*?)(?=\nPRONUNCIATION:|$)/i
    );

    const translatedText = translationMatch
      ? translationMatch[1].trim()
      : '';

    const langNames = {
      zh: '🇨🇳 Trung',
      en: '🇺🇸 Anh',
      ja: '🇯🇵 Nhật',
      ko: '🇰🇷 Hàn'
    };

    element.innerHTML = `
      <div class="history-item-top">
        <span class="history-item-lang">
          ${langNames[item.targetLang] || item.targetLang}
        </span>

        <span class="history-item-time">
          ${time}
        </span>
      </div>

      <div class="history-item-source"></div>
      <div class="history-item-result"></div>
    `;

    element.querySelector('.history-item-source').textContent = item.text;
    element.querySelector('.history-item-result').textContent = translatedText;

    historyList.appendChild(element);
  });
}




logoutBtn.addEventListener('click', async () => {
  try {
    const response = await fetch('/api/logout', {
      method: 'POST'
    });

    if (!response.ok) {
      throw new Error('Đăng xuất thất bại');
    }

    window.location.href = '/login';

  } catch (error) {
    console.error('Logout error:', error);
  }
});

// =========================
// INITIAL LOAD
// =========================

loadUsage();

translateModeBtn.addEventListener('click', () => {
  currentMode = 'translate';

  translateModeBtn.classList.add('active');
  practiceModeBtn.classList.remove('active');

  languageSelector.classList.remove('hidden');
  translationResult.classList.remove('hidden');
  practiceResult.classList.add('hidden');

  translateText.textContent = 'Dịch';

  textInput.placeholder = 'Nhập nội dung cần dịch...';

  status.textContent = '';
  status.className = 'status';
});

practiceModeBtn.addEventListener('click', () => {
  currentMode = 'practice';

  practiceModeBtn.classList.add('active');
  translateModeBtn.classList.remove('active');

  languageSelector.classList.add('hidden');
  translationResult.classList.add('hidden');
  practiceResult.classList.add('hidden');

  translateText.textContent = 'Chấm bài';

  textInput.placeholder =
    'Nhập câu hoặc đoạn văn tiếng Trung để luyện tập...';

  status.textContent = '';
  status.className = 'status';

  textInput.focus();
});
