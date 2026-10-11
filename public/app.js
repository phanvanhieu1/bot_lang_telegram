
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

const contextSelect =
  document.getElementById('contextSelect');

const verificationToggle =
  document.getElementById('verificationToggle');

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

const backTranslationToggle =
  document.getElementById('backTranslationToggle');

const pronunciationToggle =
  document.getElementById('pronunciationToggle');

const vocabularyToggle =
  document.getElementById('vocabularyToggle');

  const pronunciationWrapper =
  document.getElementById('pronunciationWrapper');

const vocabularyWrapper =
  document.getElementById('vocabularyWrapper');

  const verificationWrapper =
  document.getElementById('verificationWrapper');

const verificationStatus =
  document.getElementById('verificationStatus');

const verificationConfidence =
  document.getElementById('verificationConfidence');

const verificationMessage =
  document.getElementById('verificationMessage');

const verificationIssues =
  document.getElementById('verificationIssues');

  const freeModeBtn =
  document.getElementById('freeModeBtn');

const proModeBtn =
  document.getElementById('proModeBtn');

const proOptions =
  document.getElementById('proOptions');

  const accountPlanBadge =
  document.getElementById('accountPlanBadge');

  const freeLimitInfo =
  document.getElementById('freeLimitInfo');

const freeRemaining =
  document.getElementById('freeRemaining');

const freeReset =
  document.getElementById('freeReset');

let translatorMode = 'free';
let currentUserRole = null;

function setTranslatorMode(mode) {
  translatorMode = mode;

  const isPro = mode === 'pro';

  proOptions.classList.toggle('hidden', !isPro);
  freeLimitInfo.classList.toggle('hidden', isPro);

  // Không cho người dùng tự chuyển chế độ.
  freeModeBtn.classList.add('hidden');
  proModeBtn.classList.add('hidden');
}


async function initializeUserRole() {
  // Không cho dịch trước khi xác thực
  translateBtn.disabled = true;

  try {
    const response = await fetch('/api/auth', {
      credentials: 'same-origin',
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error('Không thể xác thực tài khoản');
    }

    const data = await response.json();

    if (!data.authenticated) {
      window.location.replace('/login');
      return;
    }

    if (!['user', 'pro', 'admin'].includes(data.role)) {
      throw new Error('Tài khoản không có role hợp lệ');
    }

    currentUserRole = data.role;

    const adminDropdown = document.getElementById('adminAccountDropdown');
    const regularLogoutBtn = document.getElementById('regularLogoutBtn');
    adminDropdown.style.display = currentUserRole === 'admin' ? 'block' : 'none';
    regularLogoutBtn.style.display = currentUserRole === 'admin' ? 'none' : '';

    // Admin có toàn bộ quyền PRO
    const hasProAccess = ['pro', 'admin'].includes(currentUserRole);

    // =========================
    // GOOGLE ACCOUNT
    // =========================

    const userAvatar = document.getElementById('userAvatar');
    const userName = document.getElementById('userName');
    const userEmail = document.getElementById('userEmail');

    userName.textContent = data.name || 'Người dùng';
    userEmail.textContent = data.email || '';

    if (
      typeof data.avatar === 'string' &&
      data.avatar.startsWith('https://')
    ) {
      userAvatar.src = data.avatar;
      userAvatar.hidden = false;
    } else {
      userAvatar.hidden = true;
    }

    // =========================
    // TRANSLATOR PERMISSIONS
    // =========================

    document.getElementById('practiceLauncher')
      .classList.toggle('hidden', !hasProAccess);

    setTranslatorMode(hasProAccess ? 'pro' : 'free');
    if (currentUserRole === 'admin') updateAdminModeSelection();

    // =========================
    // ACCOUNT BADGE
    // =========================

    accountPlanBadge.textContent =
      currentUserRole === 'admin'
        ? '✦ ADMIN'
        : hasProAccess
          ? '✦ PRO Plan'
          : 'FREE Plan';

    accountPlanBadge.classList.remove(
      'hidden',
      'plan-free',
      'plan-pro'
    );

    accountPlanBadge.classList.add(
      hasProAccess ? 'plan-pro' : 'plan-free'
    );

    // =========================
    // CHINESE PRACTICE
    // =========================

    practiceModeBtn.classList.toggle(
      'hidden',
      !hasProAccess
    );

    translateBtn.disabled = false;

  } catch (error) {
    console.error('Auth error:', error);

    status.textContent =
      'Không thể xác thực tài khoản. Vui lòng tải lại trang.';

    status.className = 'status error';
  }
}


// ADMIN ACCOUNT MENU — only activated after server confirms admin role.
const adminMenuToggle = document.getElementById('adminMenuToggle');
const adminMenuPanel = document.getElementById('adminMenuPanel');
const adminFreeChoice = document.getElementById('adminFreeChoice');
const adminProChoice = document.getElementById('adminProChoice');

function updateAdminModeSelection() {
  adminFreeChoice.classList.toggle('is-selected', translatorMode === 'free');
  adminProChoice.classList.toggle('is-selected', translatorMode === 'pro');
}
function closeAdminMenu() {
  adminMenuPanel.hidden = true;
  adminMenuToggle.setAttribute('aria-expanded', 'false');
}
adminMenuToggle.addEventListener('click', () => {
  if (currentUserRole !== 'admin') return;
  const willOpen = adminMenuPanel.hidden;
  adminMenuPanel.hidden = !willOpen;
  adminMenuToggle.setAttribute('aria-expanded', String(willOpen));
});
adminFreeChoice.addEventListener('click', () => {
  if (currentUserRole !== 'admin') return;
  setTranslatorMode('free');
  updateAdminModeSelection();
  closeAdminMenu();
  status.textContent = 'Đã chuyển sang bản FREE';
  status.className = 'status';
});
adminProChoice.addEventListener('click', () => {
  if (currentUserRole !== 'admin') return;
  setTranslatorMode('pro');
  updateAdminModeSelection();
  closeAdminMenu();
  status.textContent = 'Đã chuyển sang bản PRO';
  status.className = 'status';
});
document.addEventListener('click', (event) => {
  if (!document.getElementById('adminAccountDropdown').contains(event.target)) closeAdminMenu();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeAdminMenu();
});

initializeUserRole();



function loadTranslationContext() {
  const savedContext =
    localStorage.getItem('translationContext');

  if (savedContext) {
    contextSelect.value = savedContext;
  }
}

function saveTranslationContext() {
  localStorage.setItem(
    'translationContext',
    contextSelect.value
  );
}

contextSelect.addEventListener(
  'change',
  saveTranslationContext
);

loadTranslationContext();

function loadTranslationOptions() {
  const saved = localStorage.getItem('translationOptions');

  if (!saved) return;

  try {
    const options = JSON.parse(saved);

    verificationToggle.checked =
  options.verification ?? false;

    backTranslationToggle.checked =
      options.backTranslation ?? true;

    pronunciationToggle.checked =
      options.pronunciation ?? true;

    vocabularyToggle.checked =
      options.vocabulary ?? true;
  } catch (error) {
    console.error('Load translation options error:', error);
  }
}

function saveTranslationOptions() {
  verification:
  verificationToggle.checked
  const options = {
    backTranslation: backTranslationToggle.checked,
    pronunciation: pronunciationToggle.checked,
    vocabulary: vocabularyToggle.checked
  };

  localStorage.setItem(
    'translationOptions',
    JSON.stringify(options)
  );
}

[
  backTranslationToggle,
  pronunciationToggle,
  vocabularyToggle,
  verificationToggle
].forEach(toggle => {
  toggle.addEventListener('change', saveTranslationOptions);
});

loadTranslationOptions();

async function evaluateChinesePractice() {
  if (!['pro', 'admin'].includes(currentUserRole)) return;

  const input = document.getElementById('practiceInput');
  const submitBtn = document.getElementById('submitPracticeBtn');
  const modalStatus = document.getElementById('practiceModalStatus');
  const modalResult = document.getElementById('practiceModalResult');

  const text = input.value.trim();

  if (!text) {
    modalStatus.textContent = 'Vui lòng nhập câu tiếng Trung.';
    input.focus();
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Đang chấm bài...';
  modalStatus.textContent = 'AI đang đánh giá câu của bạn...';
  modalResult.classList.add('hidden');

  try {
    const response = await fetch('/api/practice/chinese', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'same-origin',
      body: JSON.stringify({ text })
    });

    if (response.status === 401) {
      window.location.replace('/login');
      return;
    }

    if (response.status === 403) {
      throw new Error('Tính năng này chỉ dành cho tài khoản PRO.');
    }

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.message || 'Không thể chấm bài.');
    }

    parsePracticeResult(data.result);

    modalResult.classList.remove('hidden');
    modalStatus.textContent = '✓ Chấm bài hoàn tất';

    loadUsage();

  } catch (error) {
    console.error('Practice error:', error);
    modalStatus.textContent =
      error.message || 'Có lỗi xảy ra khi chấm bài.';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Chấm bài →';
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

  translation.innerHTML = `
  <div id="translationPlaceholder" class="translation-placeholder">
    <span class="translation-placeholder-icon">文</span>
    <p>Đang chuẩn bị bản dịch...</p>
  </div>
`;

pronunciation.textContent = '';
vocabulary.textContent = '';

  try {
    const translateEndpoint =
  translatorMode === 'free'
    ? '/api/translate/free'
    : '/api/translate';

    const requestBody =
  translatorMode === 'free'
    ? {
        text,
        targetLang: selectedLang
      }
    : {
        text,
        targetLang: selectedLang,
        fastMode: false,
        backTranslation: backTranslationToggle.checked,
        pronunciation: pronunciationToggle.checked,
        vocabulary: vocabularyToggle.checked,
        verification: verificationToggle.checked,
        context: contextSelect.value,
      };

const response = await fetch(translateEndpoint, {

      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();

    if (
  translatorMode === 'free' &&
  data.rateLimit?.requests
) {
  const requests = data.rateLimit.requests;

  freeRemaining.textContent =
    `Còn ${requests.remaining} / ${requests.limit} lượt`;

  if (requests.reset) {
    startFreeResetCountdown(
      requests.reset
    );
  } else {
    freeReset.textContent = '';
  }
}

    if (!response.ok || !data.success) {
      throw new Error(data.message || 'Dịch thất bại');
    }

    if (translatorMode === 'free') {
  const freeResult = data.result || {};

  parseResult(
    `TRANSLATION: ${freeResult.translation || ''}\n` +
    `BACK_TRANSLATION: ${freeResult.backTranslation || ''}\n` +
    `PRONUNCIATION: ${freeResult.pronunciation || ''}`
  );
} else {
  parseResult(data.result);
}

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

let freeResetTimer = null;

function parseResetDuration(value) {
  if (!value) return 0;

  const hours =
    Number(value.match(/([\d.]+)h/)?.[1] || 0);

  const minutes =
    Number(value.match(/([\d.]+)m/)?.[1] || 0);

  const seconds =
    Number(value.match(/([\d.]+)s/)?.[1] || 0);

  return Math.ceil(
    hours * 3600 +
    minutes * 60 +
    seconds
  );
}

function startFreeResetCountdown(resetValue) {
  if (freeResetTimer) {
    clearInterval(freeResetTimer);
  }

  let remaining =
    parseResetDuration(resetValue);

  function render() {
    if (remaining <= 0) {
      freeReset.textContent =
        'Hạn mức đã được làm mới';

      clearInterval(freeResetTimer);
      freeResetTimer = null;

      return;
    }

    const hours =
      Math.floor(remaining / 3600);

    const minutes =
      Math.floor(
        (remaining % 3600) / 60
      );

    const seconds =
      remaining % 60;

    const parts = [];

    if (hours > 0) {
      parts.push(`${hours}h`);
    }

    if (minutes > 0 || hours > 0) {
      parts.push(`${minutes}m`);
    }

    parts.push(`${seconds}s`);

    freeReset.textContent =
      `Làm mới sau ${parts.join(' ')}`;

    remaining--;
  }

  render();

  freeResetTimer =
    setInterval(render, 1000);
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
  /TRANSLATION:\s*([\s\S]*?)(?=BACK_TRANSLATION:|PRONUNCIATION:|VOCABULARY:|VERIFICATION:|$)/i
);

  const backTranslationMatch = result.match(
  /BACK_TRANSLATION:\s*([\s\S]*?)(?=PRONUNCIATION:|VOCABULARY:|VERIFICATION:|$)/i
);

const pronunciationMatch = result.match(
  /PRONUNCIATION:\s*([\s\S]*?)(?=VOCABULARY:|VERIFICATION:|$)/i
);

const vocabularyMatch = result.match(
  /VOCABULARY:\s*([\s\S]*?)(?=VERIFICATION:|$)/i
);

const verificationMatch = result.match(
  /VERIFICATION:\s*({[\s\S]*})\s*$/i
);

  // Bản dịch chính
  translation.textContent = translationMatch
    ? translationMatch[1].trim()
    : '';

  // Dịch ngược
  const backText = backTranslationMatch
    ? backTranslationMatch[1].trim()
    : '';

  backTranslation.textContent = backText;

  if (backText) {
    backTranslationWrapper.classList.remove('hidden');
  } else {
    backTranslationWrapper.classList.add('hidden');
  }

  // Phát âm
  pronunciation.textContent = pronunciationMatch
    ? pronunciationMatch[1].trim()
    : '';

  // Từ vựng
  vocabulary.textContent = vocabularyMatch
    ? vocabularyMatch[1].trim()
    : '';

    verificationWrapper.classList.add('hidden');

verificationWrapper.classList.remove(
  'verification-pass',
  'verification-warning',
  'verification-fail'
);

verificationStatus.textContent = '';
verificationConfidence.textContent = '';
verificationMessage.textContent = '';
verificationIssues.innerHTML = '';

if (verificationToggle.checked && verificationMatch) {
  try {
    const data = JSON.parse(verificationMatch[1]);

    const status = String(data.status || '').toUpperCase();

    const statusConfig = {
      PASS: {
        text: '✓ Bản dịch chính xác',
        className: 'verification-pass'
      },
      WARNING: {
        text: '⚠ Cần kiểm tra',
        className: 'verification-warning'
      },
      FAIL: {
        text: '✕ Bản dịch có vấn đề',
        className: 'verification-fail'
      }
    };

    const config =
      statusConfig[status] || statusConfig.WARNING;

    verificationStatus.textContent = config.text;

    if (Number.isFinite(Number(data.confidence))) {
      verificationConfidence.textContent =
        `${Number(data.confidence)}%`;
    }

    verificationMessage.textContent =
      data.message || '';

    if (Array.isArray(data.issues)) {
      data.issues.forEach(issue => {
        const li = document.createElement('li');

        li.textContent =
          typeof issue === 'string'
            ? issue
            : JSON.stringify(issue);

        verificationIssues.appendChild(li);
      });
    }

    verificationWrapper.classList.add(
      config.className
    );

    verificationWrapper.classList.remove('hidden');

  } catch (error) {
    console.error(
      'Verification parse error:',
      error
    );
  }
}

  if (
  (translatorMode === 'free' ||
    pronunciationToggle.checked) &&
  !/[\u3400-\u9FFF]/u.test(textInput.value) &&
  pronunciation.textContent.trim()
) {
  pronunciationWrapper.classList.remove('hidden');
} else {
  pronunciationWrapper.classList.add('hidden');
}

if (
  vocabularyToggle.checked &&
  vocabulary.textContent.trim()
) {
  vocabularyWrapper.classList.remove('hidden');
} else {
  vocabularyWrapper.classList.add('hidden');
}
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
  // Usage statistics removed from the translator interface.
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




async function performLogout() {
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
}
logoutBtn.addEventListener('click', performLogout);
document.getElementById('regularLogoutBtn').addEventListener('click', performLogout);

// =========================
// INITIAL LOAD
// =========================

loadUsage();

// ===== PRACTICE MODAL =====

const practiceModal = document.getElementById('practiceModal');
const openPracticeBtn = document.getElementById('openPracticeBtn');
const closePracticeBtn = document.getElementById('closePracticeBtn');

openPracticeBtn.addEventListener('click', () => {
  if (!['pro', 'admin'].includes(currentUserRole)) return;

  practiceModal.showModal();
});

closePracticeBtn.addEventListener('click', () => {
  practiceModal.close();
});

// Đóng khi nhấn vùng nền bên ngoài Modal
practiceModal.addEventListener('click', (event) => {
  if (event.target === practiceModal) {
    practiceModal.close();
  }
});

const submitPracticeBtn =
  document.getElementById('submitPracticeBtn');

submitPracticeBtn.addEventListener(
  'click',
  evaluateChinesePractice
);

const practiceInput = document.getElementById('practiceInput');

practiceInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();

    if (submitPracticeBtn.disabled) return;

    evaluateChinesePractice();
  }
});
