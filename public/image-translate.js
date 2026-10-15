// PRO screenshot conversation translation UI. No uploaded images persist in browser storage.
(() => {
  const el = (id) => document.getElementById(id);
  const textTab = el('textModeTab');
  const imageTab = el('imageModeTab');
  const workspace = el('imageWorkspace');
  const fileInput = el('chatImageInput');
  const dropzone = el('chatImageDropzone');
  const originalPreview = el('imageOriginalPreview');
  const originalImg = el('imageOriginalImg');
  const replaceBtn = el('imageReplaceBtn');
  const translateBtn = el('imageTranslateBtn');
  const resultImg = el('imageTranslatedPreview');
  const empty = el('imageResultEmpty');
  const actions = el('imageResultActions');
  const saveBtn = el('imageDownloadBtn');
  const copyBtn = el('imageCopyBtn');
  const details = el('imageTranslationDetails');
  const transcript = el('imageChatTranscript');
  const notesBox = el('imageTranslationNotes');
  const status = el('imageTranslateStatus');
  const targetCaption = el('imageTargetLanguage');
  const MAX_BYTES = 5 * 1024 * 1024;
  const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
  let imageMode = false;
  let file = null;
  let originalUrl = null;
  let translatedUrl = null;
  let generatedBlob = null;
  let translatedData = null;
  let controller = null;
  let epoch = 0;

  function canUsePro() {
    const access = window.translatorAccess;
    return access?.role === 'pro' || (access?.role === 'admin' && access?.mode === 'pro');
  }
  function setStatus(message = '', error = false) {
    status.textContent = message;
    status.classList.toggle('error', error);
  }
  function abortWork() {
    epoch++;
    controller?.abort();
    controller = null;
    translateBtn.disabled = !file || !canUsePro();
    translateBtn.textContent = 'Dịch ảnh';
  }
  function clearResult() {
    translatedData = null;
    generatedBlob = null;
    if (translatedUrl) URL.revokeObjectURL(translatedUrl);
    translatedUrl = null;
    resultImg.removeAttribute('src');
    resultImg.hidden = true;
    actions.hidden = true;
    empty.hidden = false;
    details.hidden = true;
    details.open = false;
    transcript.replaceChildren();
    notesBox.replaceChildren();
    notesBox.hidden = true;
    targetCaption.textContent = 'Việt ↔ ' + (window.languageUI.get() === 'en' ? 'Anh' : 'Trung');
  }
  function switchMode(next) {
    if (next === 'image' && !canUsePro()) return;
    imageMode = next === 'image';
    if (!imageMode) abortWork();
    document.body.classList.toggle('image-mode-active', imageMode);
    workspace.hidden = !imageMode;
    textTab.classList.toggle('active', !imageMode);
    imageTab.classList.toggle('active', imageMode);
    if (imageMode) {
      imageTab.setAttribute('aria-current', 'page');
      textTab.removeAttribute('aria-current');
    } else {
      textTab.setAttribute('aria-current', 'page');
      imageTab.removeAttribute('aria-current');
    }
  }
  function refreshPermission() {
    const unlocked = canUsePro();
    imageTab.disabled = !unlocked;
    imageTab.title = unlocked ? 'Dịch ảnh hội thoại bằng AI' : 'Chỉ dành cho tài khoản PRO';
    if (!unlocked && imageMode) switchMode('text');
    translateBtn.disabled = !unlocked || !file;
  }
  textTab.addEventListener('click', () => switchMode('text'));
  imageTab.addEventListener('click', () => switchMode('image'));
  window.addEventListener('translator-access-change', refreshPermission);
  window.addEventListener('learning-language-change', () => {
    abortWork();
    clearResult();
    if (file) setStatus('Đã đổi ngôn ngữ. Nhấn “Dịch ảnh” để dịch lại theo ngôn ngữ mới.');
    else setStatus('');
  });
  refreshPermission();

  function useImage(candidate, autoRun = true) {
    if (!candidate) return;
    if (!ALLOWED_TYPES.includes(candidate.type)) {
      setStatus('Chỉ hỗ trợ ảnh PNG, JPG và WebP.', true);
      return;
    }
    if (candidate.size < 100 || candidate.size > MAX_BYTES) {
      setStatus('Ảnh phải nhỏ hơn 5 MB và không được để trống.', true);
      return;
    }
    abortWork();
    clearResult();
    file = candidate;
    fileInput.value = '';
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    originalUrl = URL.createObjectURL(file);
    originalImg.src = originalUrl;
    originalPreview.hidden = false;
    dropzone.hidden = true;
    translateBtn.disabled = !canUsePro();
    setStatus('Ảnh đã sẵn sàng (' + (candidate.size / 1024 / 1024).toFixed(2) + ' MB).');
    if (autoRun && canUsePro()) void translateImage();
  }
  fileInput.addEventListener('change', () => useImage(fileInput.files?.[0]));
  replaceBtn.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      fileInput.click();
    }
  });
  workspace.addEventListener('dragover', (event) => {
    if (!imageMode || !event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    dropzone.classList.add('dragging');
  });
  workspace.addEventListener('dragleave', (event) => {
    if (!workspace.contains(event.relatedTarget)) dropzone.classList.remove('dragging');
  });
  workspace.addEventListener('drop', (event) => {
    if (!imageMode || !canUsePro()) return;
    event.preventDefault();
    dropzone.classList.remove('dragging');
    const image = [...(event.dataTransfer?.files || [])].find(item => ALLOWED_TYPES.includes(item.type));
    useImage(image);
  });
  document.addEventListener('paste', (event) => {
    if (!canUsePro()) return;
    const item = [...(event.clipboardData?.items || [])].find(part => part.kind === 'file' && part.type.startsWith('image/'));
    if (!item) return;
    const pasted = item.getAsFile();
    if (!pasted) return;
    event.preventDefault();
    if (!imageMode) switchMode('image');
    useImage(pasted);
  });

  function textBlock(parent, tag, className, value) {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = value;
    parent.appendChild(node);
    return node;
  }
  function displayTranscript(data) {
    transcript.replaceChildren();
    data.messages.forEach((entry, index) => {
      const box = document.createElement('article');
      box.className = 'image-message';
      const role = entry.side === 'left' ? 'Bên trái' : entry.side === 'right' ? 'Bên phải' : 'Không xác định';
      textBlock(box, 'div', 'image-message-head', 'TIN NHẮN ' + (index + 1) + ' · ' + role);
      if (entry.quoteOriginal || entry.quoteTranslation) {
        textBlock(box, 'div', 'image-message-quote',
          'Trích dẫn: ' + (entry.quoteOriginal || '') +
          (entry.quoteTranslation ? '\n→ ' + entry.quoteTranslation : ''));
      }
      textBlock(box, 'div', 'image-message-original', entry.original);
      textBlock(box, 'div', 'image-message-translation', entry.translation);
      if (entry.uncertain) textBlock(box, 'div', 'image-message-uncertain', 'Một phần tin nhắn chưa đọc rõ; cần đối chiếu ảnh gốc.');
      transcript.appendChild(box);
    });
    notesBox.replaceChildren();
    if (data.notes.length) {
      textBlock(notesBox, 'strong', '', 'Ghi chú về thuật ngữ và ngữ cảnh');
      const list = document.createElement('ul');
      for (const note of data.notes) textBlock(list, 'li', '', note);
      notesBox.appendChild(list);
      notesBox.hidden = false;
    } else {
      notesBox.hidden = true;
    }
  }

  // Draw a clear translated chat as a PNG, preserving chronological order
  // and left/right sides rather than placing uncertain OCR boxes on the photo.
  function wrapLines(ctx, value, maxWidth, font) {
    ctx.font = font;
    const paragraphs = String(value || '').split('\n');
    const rows = [];
    for (const paragraph of paragraphs) {
      if (!paragraph.trim()) { rows.push(''); continue; }
      const words = paragraph.split(/\s+/);
      let current = '';
      for (const word of words) {
        if (ctx.measureText(word).width > maxWidth) {
          if (current) { rows.push(current); current = ''; }
          let part = '';
          for (const char of Array.from(word)) {
            if (part && ctx.measureText(part + char).width > maxWidth) {
              rows.push(part);
              part = char;
            } else part += char;
          }
          current = part;
          continue;
        }
        const candidate = current ? current + ' ' + word : word;
        if (current && ctx.measureText(candidate).width > maxWidth) {
          rows.push(current);
          current = word;
        } else current = candidate;
      }
      if (current) rows.push(current);
    }
    return rows.length ? rows : [''];
  }
  function roundBox(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
  function createChatCanvas(data) {
    const width = 960;
    const measure = document.createElement('canvas').getContext('2d');
    const bodyFont = '25px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
    const quoteFont = '20px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
    const all = [];
    let y = 150;
    for (let index = 0; index < data.messages.length; index++) {
      const entry = data.messages[index];
      const contentLines = wrapLines(measure, entry.translation, 640, bodyFont);
      const quoteLines = entry.quoteTranslation ? wrapLines(measure, entry.quoteTranslation, 640, quoteFont) : [];
      measure.font = bodyFont;
      const contentWidth = contentLines.reduce((longest, line) => Math.max(longest, measure.measureText(line).width), 0);
      measure.font = quoteFont;
      const quoteWidth = quoteLines.reduce((longest, line) => Math.max(longest, measure.measureText(line).width), 0);
      const bubbleWidth = Math.min(702, Math.max(230, Math.ceil(Math.max(contentWidth, quoteWidth) + 54)));
      const quoteHeight = quoteLines.length ? quoteLines.length * 29 + 21 : 0;
      const bubbleHeight = 44 + contentLines.length * 37 + (quoteHeight ? quoteHeight + 13 : 0);
      if (y + bubbleHeight + 60 > 14500) break;
      all.push({ entry, index, y, bubbleWidth, bubbleHeight, quoteHeight, contentLines, quoteLines });
      y += bubbleHeight + 64;
    }
    const omitted = data.messages.length - all.length;
    const height = Math.max(390, y + (omitted ? 80 : 18));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#101a26';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#eff6ff';
    ctx.font = 'bold 35px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
    ctx.fillText('Hội thoại đã dịch', 36, 58);
    ctx.fillStyle = '#a4b6ca';
    ctx.font = '21px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
    const target = data.targetLanguage === 'vi' ? 'Tiếng Việt' : data.targetLanguage === 'en' ? 'Tiếng Anh' : 'Tiếng Trung';
    ctx.fillText(target + ' · Bản dịch AI · ' + data.messages.length + ' tin nhắn', 37, 96);
    ctx.strokeStyle = '#33495f';
    ctx.beginPath(); ctx.moveTo(35, 120); ctx.lineTo(width - 35, 120); ctx.stroke();

    for (const row of all) {
      const right = row.entry.side === 'right';
      const x = right ? width - 38 - row.bubbleWidth : 38;
      ctx.fillStyle = '#849bb6';
      ctx.font = 'bold 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
      ctx.textAlign = right ? 'right' : 'left';
      ctx.fillText((right ? 'BÊN PHẢI' : row.entry.side === 'left' ? 'BÊN TRÁI' : 'TIN NHẮN') + ' · ' + (row.index + 1),
        right ? width - 39 : 39, row.y);
      ctx.textAlign = 'left';
      const top = row.y + 15;
      roundBox(ctx, x, top, row.bubbleWidth, row.bubbleHeight, 24);
      ctx.fillStyle = right ? '#386aa7' : '#26394b';
      ctx.fill();
      let lineY = top + 33;
      if (row.quoteLines.length) {
        roundBox(ctx, x + 14, top + 13, row.bubbleWidth - 28, row.quoteHeight, 9);
        ctx.fillStyle = right ? '#4f80ba' : '#36506a';
        ctx.fill();
        ctx.fillStyle = '#e9f0fb';
        ctx.font = quoteFont;
        lineY = top + 44;
        for (const line of row.quoteLines) { ctx.fillText(line, x + 28, lineY); lineY += 29; }
        lineY = top + 30 + row.quoteHeight + 14;
      }
      ctx.fillStyle = '#ffffff';
      ctx.font = bodyFont;
      for (const line of row.contentLines) { ctx.fillText(line, x + 26, lineY); lineY += 37; }
    }
    if (omitted) {
      ctx.fillStyle = '#e4b76b';
      ctx.font = '20px Arial, sans-serif';
      ctx.fillText('Còn ' + omitted + ' tin nhắn: xem phần đối chiếu bên dưới.', 38, height - 55);
    }
    ctx.fillStyle = '#7590a9';
    ctx.font = '15px Arial, sans-serif';
    ctx.fillText('Bản dịch hỗ trợ hiểu nội dung, hãy đối chiếu ảnh gốc nếu có thuật ngữ khó.', 38, height - 22);
    return canvas;
  }

  function formatCopy(data) {
    const labels = { left: 'Bên trái', right: 'Bên phải', unknown: 'Không xác định' };
    const lines = [];
    data.messages.forEach((msg, index) => {
      lines.push((index + 1) + '. ' + labels[msg.side]);
      if (msg.quoteTranslation) lines.push('  Trích dẫn: ' + msg.quoteTranslation);
      lines.push('  Gốc: ' + msg.original);
      lines.push('  Dịch: ' + msg.translation);
      if (msg.uncertain) lines.push('  (Có nội dung chưa đọc rõ)');
      lines.push('');
    });
    if (data.notes.length) lines.push('Ghi chú:\n' + data.notes.map(note => '- ' + note).join('\n'));
    return lines.join('\n').trim();
  }
  copyBtn.addEventListener('click', async () => {
    if (!translatedData) return;
    try {
      await navigator.clipboard.writeText(formatCopy(translatedData));
      setStatus('Đã sao chép toàn bộ nội dung hội thoại.');
    } catch (_) {
      setStatus('Không thể sao chép tự động; bạn có thể chọn văn bản trong phần đối chiếu.', true);
    }
  });
  saveBtn.addEventListener('click', () => {
    if (!generatedBlob) return;
    const url = URL.createObjectURL(generatedBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'hoi-thoai-da-dich-' + window.languageUI.get() + '.png';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  async function translateImage() {
    if (!file || !canUsePro() || controller) return;
    const requestedLanguage = window.languageUI.get();
    clearResult();
    setStatus('AI đang đọc hội thoại và dịch. Ảnh dài có thể mất vài chục giây...');
    const id = ++epoch;
    const signalController = new AbortController();
    controller = signalController;
    translateBtn.disabled = true;
    translateBtn.textContent = 'Đang dịch...';
    const timeout = setTimeout(() => signalController.abort(), 90000);
    try {
      const response = await fetch('/api/image/translate', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': file.type,
          'X-Learning-Language': requestedLanguage
        },
        body: file,
        signal: signalController.signal,
        cache: 'no-store'
      });
      if (response.status === 401) {
        window.location.replace('/login');
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (id !== epoch) return;
      if (!response.ok || !data.success) throw new Error(data.message || 'Không thể dịch ảnh');
      if (!Array.isArray(data.messages) || !data.messages.length) throw new Error('Không tìm thấy tin nhắn trong ảnh');
      translatedData = data;
      displayTranscript(data);
      const canvas = createChatCanvas(data);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Không thể dựng ảnh kết quả');
      if (id !== epoch) return;
      generatedBlob = blob;
      translatedUrl = URL.createObjectURL(blob);
      resultImg.src = translatedUrl;
      resultImg.hidden = false;
      empty.hidden = true;
      actions.hidden = false;
      details.hidden = false;
      targetCaption.textContent = 'Tiếng ' + (data.targetLanguage === 'vi' ? 'Việt' : data.targetLanguage === 'en' ? 'Anh' : 'Trung');
      setStatus('✓ Đã dịch ' + data.messages.length + ' tin nhắn. Mở “Đối chiếu” để xem từng câu gốc và ghi chú.');
    } catch (error) {
      if (id !== epoch) return;
      console.error('Image translation error:', error);
      const message = error.name === 'AbortError' ? 'Yêu cầu hết thời gian xử lý, vui lòng thử lại.' : error.message;
      clearResult();
      setStatus(message || 'Không thể dịch ảnh', true);
    } finally {
      clearTimeout(timeout);
      if (id === epoch) {
        controller = null;
        translateBtn.disabled = !file || !canUsePro();
        translateBtn.textContent = 'Dịch lại';
      }
    }
  }
  translateBtn.addEventListener('click', () => void translateImage());
})();
