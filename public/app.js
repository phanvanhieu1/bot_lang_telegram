
const textInput = document.getElementById('text');
const targetLang = document.getElementById('targetLang');
const translateBtn = document.getElementById('translateBtn');
const translateText = document.getElementById('translateText');
const status = document.getElementById('status');

const todayCost = document.getElementById('todayCost');
const todayStats = document.getElementById('todayStats');
const totalCost = document.getElementById('totalCost');
const totalStats = document.getElementById('totalStats');

const translation = document.getElementById('translation');
const pronunciation = document.getElementById('pronunciation');
const vocabulary = document.getElementById('vocabulary');

const copyBtn = document.getElementById('copyBtn');


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
    /TRANSLATION:\s*([\s\S]*?)(?=\nPRONUNCIATION:|$)/i
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


// =========================
// INITIAL LOAD
// =========================

loadUsage();
