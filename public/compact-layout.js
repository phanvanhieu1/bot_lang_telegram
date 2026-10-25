// Presentation-only resizing: no network calls or changes to translation APIs.
// The text panes start compact and grow together with the longest visible text.
// Extremely long text is capped to avoid unbounded page height; the panes scroll.
(() => {
  'use strict';

  const workspace = document.querySelector('.translation-workspace');
  const input = document.getElementById('text');
  const output = document.getElementById('translation');
  const result = document.getElementById('translationResult');
  const realtime = document.getElementById('realtimePinyin');
  const backTranslation = document.getElementById('backTranslationWrapper');
  const pronunciation = document.getElementById('pronunciationWrapper');
  const launcherTitle = document.getElementById('practiceLauncherTitle');
  const launcher = document.getElementById('openPracticeBtn');

  if (launcher && launcherTitle) {
    const updateLabel = () => {
      const label = 'Mở ' + launcherTitle.textContent.trim().toLowerCase();
      launcher.setAttribute('aria-label', label);
      launcher.title = label;
    };
    updateLabel();
    window.addEventListener('learning-language-change', updateLabel);
  }
  if (!workspace || !input || !output || !result) return;

  const MIN_PANE_HEIGHT = 172;
  const MAX_PANE_HEIGHT = 660;
  const ACTION_HEIGHT = 40;
  const mirror = document.createElement('div');
  mirror.setAttribute('aria-hidden', 'true');
  mirror.style.position = 'fixed';
  mirror.style.visibility = 'hidden';
  mirror.style.pointerEvents = 'none';
  mirror.style.left = '-100000px';
  mirror.style.top = '0';
  mirror.style.zIndex = '-1';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflowWrap = 'anywhere';
  mirror.style.wordBreak = 'break-word';
  mirror.style.boxSizing = 'border-box';
  document.body.appendChild(mirror);

  function textHeight(el, value) {
    const width = Math.ceil(el.getBoundingClientRect().width);
    if (width < 40) return 0; // Hidden image tab, collapsed/hidden page.
    const s = window.getComputedStyle(el);
    mirror.style.width = width + 'px';
    mirror.style.padding = s.padding;
    mirror.style.fontFamily = s.fontFamily;
    mirror.style.fontSize = s.fontSize;
    mirror.style.fontWeight = s.fontWeight;
    mirror.style.fontStyle = s.fontStyle;
    mirror.style.letterSpacing = s.letterSpacing;
    mirror.style.lineHeight = s.lineHeight;
    mirror.style.textTransform = s.textTransform;
    mirror.textContent = (value && value.length ? value : ' ') + '\u200b';
    return Math.ceil(mirror.scrollHeight);
  }

  function visibleBlockHeight(el) {
    if (!el || el.hidden || el.classList.contains('hidden') ||
        window.getComputedStyle(el).display === 'none') return 0;

    const content = el.querySelector('.realtime-pinyin-text, #backTranslation, #pronunciation');
    const height = content ? textHeight(content, content.textContent || '') : 0;
    // Preserve room for secondary pronunciation/back-translation, but do not
    // allow them to dominate the main panes: they scroll independently.
    return Math.min(130, Math.max(el.scrollHeight, height + 10) + 5);
  }

  let frame = 0;
  let lastHeight = 0;
  function calculate() {
    frame = 0;
    if (!workspace.getClientRects().length || input.getBoundingClientRect().width < 40) return;

    const sourceText = textHeight(input, input.value);
    const outputText = textHeight(output, output.textContent || 'Bản dịch');
    const sourceExtras = visibleBlockHeight(realtime) + visibleBlockHeight(backTranslation);
    const resultExtras = visibleBlockHeight(pronunciation);
    const next = Math.round(Math.min(MAX_PANE_HEIGHT, Math.max(
      MIN_PANE_HEIGHT,
      sourceText + sourceExtras + ACTION_HEIGHT + 14,
      outputText + resultExtras + ACTION_HEIGHT + 18
    )));
    if (lastHeight !== next) {
      lastHeight = next;
      workspace.style.setProperty('--compact-pane-height', next + 'px');
    }
  }
  function schedule() {
    if (!frame) frame = window.requestAnimationFrame(calculate);
  }

  input.addEventListener('input', schedule);
  window.addEventListener('resize', schedule, { passive:true });
  window.addEventListener('learning-language-change', () => {
    lastHeight = 0;
    schedule();
  });
  window.addEventListener('translation-finished', schedule);

  // Translation result, Pinyin and back-translation update asynchronously.
  // Observe only text and visibility classes; do not watch CSS height.
  const observer = new MutationObserver(schedule);
  for (const element of [result, realtime, backTranslation, pronunciation]) {
    if (!element) continue;
    observer.observe(element, {
      subtree:true, childList:true, characterData:true,
      attributes:true, attributeFilter:['hidden', 'class']
    });
  }

  // The panes' heights themselves change while resizing. Observing their
  // heights would feed back into ResizeObserver and can generate continuous
  // resize warnings. Only react when the available text width changes.
  if (typeof ResizeObserver === 'function') {
    let lastInputWidth = 0;
    let lastOutputWidth = 0;
    const resizeObserver = new ResizeObserver(() => {
      const inputWidth = Math.round(input.getBoundingClientRect().width);
      const outputWidth = Math.round(output.getBoundingClientRect().width);
      if (inputWidth === lastInputWidth && outputWidth === lastOutputWidth) return;
      lastInputWidth = inputWidth;
      lastOutputWidth = outputWidth;
      schedule();
    });
    resizeObserver.observe(input);
    resizeObserver.observe(output);
  }
  // Respect late-loaded fonts: their glyph metrics affect text wrapping.
  if (document.fonts?.ready) document.fonts.ready.then(schedule).catch(() => {});
  schedule();
  window.addEventListener('load', schedule, { once:true });
})();
