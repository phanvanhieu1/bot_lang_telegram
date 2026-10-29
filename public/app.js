
const textInput = document.getElementById('text');
const targetLang = document.getElementById('targetLang');
const translateBtn = document.getElementById('translateBtn');
const translationEnginePicker=document.getElementById('translationEnginePicker');
const engineV1=document.querySelector('input[name="translationEngine"][value="v1"]');
const engineV2=document.querySelector('input[name="translationEngine"][value="v2"]');
const v2InspectLabel = document.getElementById('v2InspectLabel');
const v2InspectToggle = document.getElementById('v2InspectToggle');
const v1InspectLabel = document.getElementById('v1InspectLabel');
const v1InspectToggle = document.getElementById('v1InspectToggle');
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
let historyDetailLoad=0;
let languageRequestVersion = 0;
const historyReplayNotice=document.getElementById('historyReplayNotice');
function clearHistoryReplayNotice(){
  if(historyReplayNotice)historyReplayNotice.hidden=true;
}

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
let v2EnabledForUser = false;
let v2Busy = false;
function v2Eligible(){
  return v2EnabledForUser&&translatorMode==='pro'&&targetLang.value==='zh';
}
function selectedEngine(){
  return v2Eligible()&&engineV2.checked?'v2':'v1';
}
function setEngineControlsBusy(busy){
  contextSelect.disabled=busy;
  engineV1.disabled=busy;engineV2.disabled=busy;
}
let preferredEngine=localStorage.getItem('translationEngine')==='v2'?'v2':'v1';
function refreshV2Button(){
  const eligible=v2Eligible();
  translationEnginePicker.hidden=!eligible;
  // Preserve the preferred engine across temporary FREE/English selection.
  engineV2.checked=eligible&&preferredEngine==='v2';
  engineV1.checked=!engineV2.checked;
  if(v2InspectLabel)v2InspectLabel.hidden=!(eligible&&selectedEngine()==='v2');
  if(v1InspectLabel)v1InspectLabel.hidden=!(translatorMode==='pro'&&selectedEngine()==='v1');
  // FREE mode must not retain any previously visible private GPT prompts.
  if(translatorMode!=='pro')window.renderV2Inspection?.(null);
}
for(const radio of [engineV1,engineV2]){
  radio.addEventListener('change',()=>{
    if(translateBtn.disabled||v2Busy)return;
    preferredEngine=radio.value;
    localStorage.setItem('translationEngine',radio.value);
    window.renderV2Inspection?.(null);
    window.renderRequestUsage?.(null);
    refreshV2Button();
  });
}
async function checkV2Access() {
  try {
    const response = await fetch('/api/translate/v2/status', { credentials:'same-origin',cache:'no-store' });
    const data = response.ok ? await response.json() : {enabled:false};
    v2EnabledForUser = data.enabled === true;
  } catch (_) { v2EnabledForUser = false; }
  refreshV2Button();
}

function setTranslatorMode(mode) {
  translatorMode = mode;
  refreshV2Button();

  const isPro = mode === 'pro';

  proOptions.classList.toggle('hidden', !isPro);
  freeLimitInfo.classList.toggle('hidden', isPro);

  const settingsBtn = document.getElementById('settingsBtn');
  const settingsPanel = document.getElementById('settingsPanel');
  if (settingsBtn) {
    settingsBtn.disabled = false;
    settingsBtn.title = 'Cài đặt giọng đọc và bản dịch';
  }
  const proSettingsHeading = document.getElementById('proSettingsHeading');
  if (proSettingsHeading) proSettingsHeading.hidden = !isPro;

  // Không cho người dùng tự chuyển chế độ.
  freeModeBtn.classList.add('hidden');
  proModeBtn.classList.add('hidden');

  // Other website features (such as PRO image translation) observe this state.
  window.translatorAccess = { role: currentUserRole, mode: translatorMode };
  window.dispatchEvent(new CustomEvent('translator-access-change', {
    detail: window.translatorAccess
  }));
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
    adminDropdown.hidden = currentUserRole !== 'admin';
    document.getElementById('adminHamburger').hidden = currentUserRole !== 'admin';

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
    document.getElementById('avatarInitial').textContent =
      (data.name || data.email || '?').trim().charAt(0).toUpperCase();

    if (
      typeof data.avatar === 'string' &&
      data.avatar.startsWith('https://')
    ) {
      userAvatar.src = data.avatar;
      userAvatar.hidden = false;
      document.getElementById('avatarInitial').hidden = true;
    } else {
      userAvatar.hidden = true;
      document.getElementById('avatarInitial').hidden = false;
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
    void checkV2Access();

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
  const options = {
    backTranslation: backTranslationToggle.checked,
    pronunciation: pronunciationToggle.checked,
    vocabulary: vocabularyToggle.checked,
    verification: verificationToggle.checked
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

async function evaluateLanguagePractice() {
  if (!['pro', 'admin'].includes(currentUserRole)) return;

  const input = document.getElementById('practiceInput');
  const submitBtn = document.getElementById('submitPracticeBtn');
  const modalStatus = document.getElementById('practiceModalStatus');
  const modalResult = document.getElementById('practiceModalResult');

  const text = input.value.trim();
  const selectedLanguage = targetLang.value;
  const requestVersion = languageRequestVersion;

  if (!text) {
    modalStatus.textContent = 'Vui lòng nhập câu tiếng ' + (selectedLanguage === 'en' ? 'Anh' : 'Trung') + '.';
    input.focus();
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Đang chấm bài...';
  modalStatus.textContent = 'AI đang đánh giá câu của bạn...';
  modalResult.classList.add('hidden');

  try {
    const response = await fetch(selectedLanguage === 'en' ? '/api/practice/english' : '/api/practice/chinese', {
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
    if (requestVersion !== languageRequestVersion) return;

    if (!response.ok || !data.success) {
      throw new Error(data.message || 'Không thể chấm bài.');
    }

    parsePracticeResult(data.result);

    modalResult.classList.remove('hidden');
    modalStatus.textContent = '✓ Chấm bài hoàn tất';

    loadUsage();

  } catch (error) {
    if (requestVersion !== languageRequestVersion) return;
    console.error('Practice error:', error);
    modalStatus.textContent =
      error.message || 'Có lỗi xảy ra khi chấm bài.';
  } finally {
    if (requestVersion === languageRequestVersion) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Chấm bài →';
    }
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

// A live rerun is allowed only via the explicit button in the inspector.
window.requestV1LiveTrace=()=>{
  if(selectedEngine()!=='v1'||translatorMode!=='pro'||!v1InspectToggle?.checked)return;
  void translate(true);
};
async function translate(forceRefresh=false) {
  if (v2Busy) return;
  clearHistoryReplayNotice();
  // Single visible Dịch button and Enter always dispatch to selected version.
  if (translateBtn.disabled) return;
  if(selectedEngine()==='v2')return translateV2();

  const text = textInput.value.trim();
  const selectedLang = targetLang.value;
  const requestVersion = languageRequestVersion;

  if (!text) {
    status.textContent = 'Vui lòng nhập nội dung cần dịch';
    status.className = 'status error';
    textInput.focus();
    return;
  }

  translateBtn.disabled = true;
  setEngineControlsBusy(true);
  translateBtn.classList.add('loading');

  status.textContent = 'Đang dịch...';
  status.className = 'status';

  translation.innerHTML = `
  <div id="translationPlaceholder" class="translation-placeholder">
    <span class="translation-placeholder-icon">文</span>
    <p>Đang chuẩn bị bản dịch...</p>
  </div>
`;

  copyBtn.hidden = true;
  document.getElementById('outputSpeakBtn').hidden = true;
  window.displayAppliedTerms?.([]);
  window.displayTermWarning?.([]);
  window.renderRequestUsage?.(null);
  window.renderV2Inspection?.(null);
  window.renderV2ClaudeTerms?.([]);
  renderV2AnalysisDetails();
  pronunciation.textContent = '';
vocabulary.textContent = '';
  window.renderTranslationVocabulary?.([], '', selectedLang);

  try {
    const translateEndpoint =
  translatorMode === 'free'
    ? '/api/translate/free'
    : '/api/translate';

    const requestBody =
  translatorMode === 'free'
    ? {
        text,
        targetLang: selectedLang,
        context: contextSelect.value
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
        inspectAI:v1InspectToggle?.checked===true,
        forceRefresh:forceRefresh===true
      };

const response = await fetch(translateEndpoint, {

      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();
    if (requestVersion !== languageRequestVersion) return;

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
  // The cards are database-backed; the raw AI1 list is never rendered
  // when the V1.1 server sends structured vocabularyItems.
  if(vocabularyToggle.checked) {
    window.renderTranslationVocabulary?.(
      data.vocabularyItems,
      data.vocabularyError || '',
      selectedLang
    );
  } else {
    window.renderTranslationVocabulary?.([], '', selectedLang);
  }
}

    window.renderTermHighlights?.(data.appliedTerms || []);
    window.displayAppliedTerms?.(data.appliedTerms || []);
    window.displayTermWarning?.(data.terminologyWarnings || []);
    window.renderRequestUsage?.(data.requestUsage||null,'v1');
    window.renderV2Inspection?.(data.inspection||null,'v1');
    if (selectedLang === 'en') {
      window.dispatchEvent(new CustomEvent('translation-finished', {
        detail: { sourceLanguage: data.sourceLanguage }
      }));
    }
    const glossaryMissing=Array.isArray(data.terminologyWarnings) && data.terminologyWarnings.length;
    status.textContent = glossaryMissing
      ? '⚠ Bản dịch có thuật ngữ chưa khớp từ điển đã lưu'
      : '✓ Dịch thành công';
    status.className = glossaryMissing ? 'status error' : 'status success';

    // Cập nhật thống kê sau khi dịch
    loadUsage();

  } catch (error) {
    if (requestVersion !== languageRequestVersion) return;
    console.error(error);

    status.textContent = error.message || 'Dịch thất bại';
    status.className = 'status error';

  } finally {
    if (requestVersion === languageRequestVersion) {
      translateBtn.disabled = false;
      setEngineControlsBusy(false);
      translateBtn.classList.remove('loading');
    }
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
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    if (!translateBtn.disabled) translate();
  }

});


// =========================
// TRANSLATE BUTTON
// =========================

translateBtn.addEventListener('click', translate);

function renderV2AnalysisDetails(data=null){
  const box=document.getElementById('v2AnalysisDetails');
  if(!box)return;
  box.hidden=!data;
  if(!data)return;
  const analysis=data.analysis||{};
  const domainNames={work:'Công việc',it:'IT',daily:'Đời sống',
    mixed:'Nhiều lĩnh vực',unknown:'Chưa xác định'};
  document.getElementById('v2AnalysisDomain').textContent=
    'Ngữ cảnh: '+(domainNames[analysis.resolvedDomain||analysis.domain]||'Chưa xác định');
  document.getElementById('v2AnalysisIntent').textContent=
    'Ý định: '+(analysis.intent||'Chưa có phân tích ngắn');
  const notes=[...(Array.isArray(analysis.ambiguities)?analysis.ambiguities:[]),
    ...(Array.isArray(data.translationNotes)?data.translationNotes:[])]
    .filter(value=>typeof value==='string'&&value.trim()).slice(0,3);
  const note=document.getElementById('v2AnalysisNotes');
  note.hidden=!notes.length;
  note.textContent=notes.length?'Lưu ý: '+notes.join(' · '):'';
}

// Run a fresh V2 request only after an explicit user click in the inspector.
window.requestV2LiveTrace=()=>{
  if(!v2InspectToggle?.checked||selectedEngine()!=='v2')return;
  void translateV2(true);
};
async function translateV2(forceRefresh=false){
  if(selectedEngine()!=='v2'||v2Busy||translateBtn.disabled)return;
  clearHistoryReplayNotice();
  const text = textInput.value.trim();
  if (!text) { status.textContent = 'Vui lòng nhập nội dung cần dịch'; textInput.focus(); return; }
  const version = languageRequestVersion;
  v2Busy = true;
  translateBtn.disabled = true;
  setEngineControlsBusy(true);
  translateBtn.classList.add('loading');
  status.textContent = 'Đang phân tích và đối chiếu bản dịch chuyên sâu...';
  status.className = 'status';
  window.displayAppliedTerms?.([]);
  window.displayTermWarning?.([]);
  window.renderRequestUsage?.(null);
  window.renderV2Inspection?.(null);
  window.renderV2ClaudeTerms?.([]);
  renderV2AnalysisDetails();
  window.renderTranslationVocabulary?.([], '', 'zh');
  try {
    const response = await fetch('/api/translate/v2', {
      method:'POST', headers:{'Content-Type':'application/json'},credentials:'same-origin',
      body:JSON.stringify({text,targetLang:'zh',context:contextSelect.value,
        backTranslation:backTranslationToggle.checked,
        pronunciation:pronunciationToggle.checked,
        vocabulary:vocabularyToggle.checked,
        verification:verificationToggle.checked,
        inspectAI:v2InspectToggle?.checked===true,
        forceRefresh})
    });
    const data = await response.json();
    if (version !== languageRequestVersion || textInput.value.trim() !== text) return;
    if (!response.ok || !data.success) throw new Error(data.message || 'Dịch chuyên sâu thất bại');
    // V1 and V2 use the same labeled result and exactly the same UI parser,
    // toggles and output containers. Two-stage AI is only a server concern.
    parseResult(data.result);
    window.renderTermHighlights?.(data.appliedTerms || []);
    window.displayAppliedTerms?.(data.appliedTerms || []);
    window.renderRequestUsage?.(data.requestUsage||null,'v2');
    window.renderV2Inspection?.(data.inspection||null,'v2');
    window.displayTermWarning?.((data.issues||[]).filter(x=>x.includes('Thuật ngữ')));
    const cards=vocabularyToggle.checked&&Array.isArray(data.vocabularyItems)
      ? data.vocabularyItems:[];
    window.renderTranslationVocabulary?.(
      cards,vocabularyToggle.checked?(data.vocabularyError||''):'','zh');
    // The legacy V2-only suggestion/analysis panels remain hidden. V2 uses
    // the exact same vocabulary cards and detail sections as V1.
    const direction = data.sourceLanguage === 'vi' && data.targetLanguage === 'zh'
      ? 'Việt → Trung' : data.sourceLanguage === 'zh' && data.targetLanguage === 'vi'
        ? 'Trung → Việt' : 'Trung ↔ Việt';
    const count = Array.isArray(data.appliedTerms) ? data.appliedTerms.length : 0;
    if (data.verificationError && verificationToggle.checked) {
      status.textContent = '⚠ Dịch V2 thành công, nhưng kiểm chứng độc lập chưa hoàn thành';
      status.className = 'status error';
    } else if (data.needsReview) {
      status.textContent = '⚠ Dịch V2 ('+direction+') cần kiểm tra: ' + (data.issues || []).slice(0,2).join('; ');
      status.className = 'status error';
    } else {
      status.textContent = '✓ Dịch V2 '+direction+' · '+count+
        ' thuật ngữ đã xác nhận được áp dụng (chưa kiểm định toàn bộ ngữ nghĩa)';
      status.className = 'status success';
    }
    loadUsage();
  } catch (error) {
    if (version === languageRequestVersion) {
      status.textContent = error.message || 'Dịch chuyên sâu thất bại';
      status.className = 'status error';
    }
  } finally {
    v2Busy = false;
    translateBtn.disabled = false;
    translateBtn.classList.remove('loading');
    setEngineControlsBusy(false);
    refreshV2Button();
  }
}


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

  const hasResult = Boolean(translation.textContent.trim());
  copyBtn.hidden = !hasResult;
  document.getElementById('outputSpeakBtn').hidden = !hasResult;

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

    if (data.confidence !== null && data.confidence !== undefined &&
      Number.isFinite(Number(data.confidence))) {
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
  targetLang.value === 'zh' &&
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

    const originalTitle = copyBtn.title;
    copyBtn.title = 'Đã sao chép';
    copyBtn.setAttribute('aria-label', 'Đã sao chép');

    status.textContent = 'Đã copy bản dịch';
    status.className = 'status success';

    setTimeout(() => {
      copyBtn.title = originalTitle;
      copyBtn.setAttribute('aria-label', 'Sao chép bản dịch');
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

historySearch.addEventListener('input', () => {
  const term = historySearch.value.trim().toLocaleLowerCase('vi-VN');

  renderHistory(
    term
      ? historyData.filter(item =>
          [item.text, item.result, item.targetLang]
            .some(value => String(value || '').toLocaleLowerCase('vi-VN').includes(term))
        )
      : historyData
  );
});

clearHistoryBtn.addEventListener('click', async () => {
  const selectedLanguage = targetLang.value;
  if (!historyData.some(item => (item.learningLang || 'zh') === selectedLanguage)) return;

  if (!window.confirm('Bạn có chắc muốn xóa lịch sử dịch tiếng ' + (selectedLanguage === 'en' ? 'Anh' : 'Trung') + '?')) {
    return;
  }

  clearHistoryBtn.disabled = true;

  try {
    const response = await fetch('/api/history?learningLang=' + encodeURIComponent(selectedLanguage), {
      method: 'DELETE',
      credentials: 'same-origin'
    });
    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.message || 'Không thể xóa lịch sử');
    }

    historyData = historyData.filter(item => (item.learningLang || 'zh') !== selectedLanguage);
    historySearch.value = '';
    renderHistory(historyData);
  } catch (error) {
    console.error('Clear history error:', error);
    window.alert(error.message || 'Không thể xóa lịch sử');
  } finally {
    clearHistoryBtn.disabled = false;
  }
});

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

async function openHistoryDetail(item){
  // A click restores the historical result without a translation API call.
  if(translateBtn.disabled||v2Busy)return;
  const current=++historyDetailLoad;
  try{
    const response=await fetch('/api/history/'+encodeURIComponent(item.id),{
      credentials:'same-origin',cache:'no-store'
    });
    const data=await response.json();
    if(!response.ok||!data.success||!data.item)
      throw new Error(data.message||'Không thể mở lịch sử');
    if(current!==historyDetailLoad)return;
    const saved=data.item;
    const detail=saved.details&&typeof saved.details==='object'?saved.details:null;
    const payload=detail?.payload||{};
    const historicalEngine=detail?.engine||'v1';
    const historicalLang=saved.learningLang||'zh';
    // The current history sidebar is already scoped to the learning language.
    if(historicalLang!==targetLang.value)return;
    const options=detail?.options||null;
    if(options&&translatorMode==='pro'){
      for(const [control,value] of [
        [backTranslationToggle,options.backTranslation],
        [pronunciationToggle,options.pronunciation],
        [vocabularyToggle,options.vocabulary],
        [verificationToggle,options.verification]
      ]){
        if(typeof value==='boolean')control.checked=value;
      }
    }
    if(['auto','friend','colleague','superior'].includes(detail?.context)){
      contextSelect.value=detail.context;
    }
    // The V2 preference is visual only; history replay never invokes V2.
    if(['v1','v2'].includes(historicalEngine)&&v2Eligible()){
      preferredEngine=historicalEngine;
      refreshV2Button();
    }
    textInput.value=saved.text||'';
    textInput.dispatchEvent(new Event('input',{bubbles:true}));
    const archivedResult=typeof saved.result==='string'?saved.result:'';
    parseResult(archivedResult);
    if(detail&&Array.isArray(payload.vocabularyItems)){
      window.renderTranslationVocabularySnapshot?.(
        payload.vocabularyItems,payload.vocabularyError||''
      );
    }else{
      // Legacy rows have only the raw VOCABULARY text. Preserve that.
      window.renderTranslationVocabulary?.(undefined);
    }
    window.displayAppliedTerms?.(payload.appliedTerms||[]);
    window.renderTermHighlights?.(payload.appliedTerms||[]);
    window.displayTermWarning?.(payload.terminologyWarnings||
      (Array.isArray(payload.issues)?payload.issues.filter(x=>
        typeof x==='string'&&x.includes('Thuật ngữ')):[]));
    window.renderV2ClaudeTerms?.([]);
    renderV2AnalysisDetails();
    window.renderRequestUsage?.(payload.requestUsage||null,
      historicalEngine==='v2'?'v2':'v1');
    // Persisted transcript exists only if inspection was explicitly enabled.
    // History playback does not show an action that can silently bill API fees.
    const archivedInspection=payload.inspection?{
      ...payload.inspection,historical:true
    }:{
      historical:true,cacheHit:false,stages:[],
      notice:detail
        ?detail.inspectionUnavailable||
          'Luồng prompt/phản hồi AI không được lưu cho lượt dịch này.'
        :'Bản ghi cũ: chưa lưu thông số token và luồng AI.'
    };
    window.renderV2Inspection?.(archivedInspection,
      historicalEngine==='v2'?'v2':'v1');
    if(historicalLang==='en'){
      window.dispatchEvent(new CustomEvent('translation-finished',{
        detail:{sourceLanguage:payload.sourceLanguage}
      }));
    }
    const stamp=new Date(saved.time).toLocaleString('vi-VN');
    if(historyReplayNotice){
      historyReplayNotice.textContent='Đang xem bản dịch đã lưu · '+stamp+
        ' · '+(historicalEngine==='v2'?'V2':historicalEngine==='free'?'FREE':'V1')+
        (detail?' · Thông số tại thời điểm dịch':
          ' · Bản ghi cũ không có thông số chi tiết')+
        ' · Không gọi lại AI';
      historyReplayNotice.hidden=false;
    }
    status.textContent='✓ Đã mở bản dịch từ lịch sử (không gọi API dịch)';
    status.className='status success';
    closeHistory();
    document.getElementById('translationDetails')?.scrollIntoView?.({
      behavior:'smooth',block:'start'
    });
  }catch(error){
    if(current!==historyDetailLoad)return;
    status.textContent=error.message||'Không thể xem lại bản dịch';
    status.className='status error';
  }
}

function renderHistory(items) {
  items = items.filter(item => (item.learningLang || 'zh') === targetLang.value);
  historyList.innerHTML = '';

  if (!items.length) {
    historyList.innerHTML =
      '<div class="history-empty">Chưa có lịch sử dịch</div>';
    return;
  }

  items.forEach(item => {
    const element = document.createElement('button');
    element.type='button';
    element.className = 'history-item';
    element.title='Mở lại bản dịch và tất cả thông số đã lưu';
    element.setAttribute('aria-label','Xem lại bản dịch: '+String(item.text||'').slice(0,100));
    element.addEventListener('click',()=>openHistoryDetail(item));

    const date = new Date(item.time);

    const time = date.toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit'
    });

    const translationMatch = item.result.match(
      /TRANSLATION:\s*([\s\S]*?)(?=BACK_TRANSLATION:|PRONUNCIATION:|VOCABULARY:|VERIFICATION:|$)/i
    );

    const translatedText = translationMatch
      ? translationMatch[1].trim()
      : '';

    const langNames = {
      zh: '🇨🇳 Trung',
      vi: '🇻🇳 Việt',
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

// The selected language drives both translators and the shared practice popup.
// Ignore late API responses from the previous language; never show stale results.
window.addEventListener('learning-language-change', () => {
  languageRequestVersion++;
  historyDetailLoad++;
  clearHistoryReplayNotice();
  refreshV2Button();
  translateBtn.disabled = false;
  translateBtn.classList.remove('loading');
  setEngineControlsBusy(false);
  status.textContent = '';
  status.className = 'status';
  window.displayTermWarning?.([]);
  window.displayAppliedTerms?.([]);
  window.renderRequestUsage?.(null);
  window.renderV2Inspection?.(null);
  window.renderV2ClaudeTerms?.([]);
  renderV2AnalysisDetails();
  translation.innerHTML = '<div class="translation-placeholder"><span class="translation-placeholder-icon">文</span><p>Bản dịch sẽ xuất hiện tại đây</p></div>';
  copyBtn.hidden = true;
  document.getElementById('outputSpeakBtn').hidden = true;
  pronunciation.textContent = '';
  vocabulary.textContent = '';
  backTranslation.textContent = '';
  backTranslationWrapper.classList.add('hidden');
  pronunciationWrapper.classList.add('hidden');
  vocabularyWrapper.classList.add('hidden');
  window.renderTranslationVocabulary?.([], '', window.languageUI?.get?.() || 'zh');
  verificationWrapper.classList.add('hidden');
  const practiceResultBox = document.getElementById('practiceModalResult');
  practiceResultBox.classList.add('hidden');
  document.getElementById('practiceModalStatus').textContent = '';
  document.getElementById('practiceInput').value = '';
  originalText.textContent = '';
  naturalText.textContent = '';
  document.getElementById('submitPracticeBtn').disabled = false;
  document.getElementById('submitPracticeBtn').textContent = 'Chấm bài →';
  historySearch.value = '';
  renderHistory(historyData);
  document.getElementById('text').dispatchEvent(new Event('input', { bubbles: true }));
});

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
  evaluateLanguagePractice
);

const practiceInput = document.getElementById('practiceInput');

practiceInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();

    if (submitPracticeBtn.disabled) return;

    evaluateLanguagePractice();
  }
});
