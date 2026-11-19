// Translation inspector. Provider data is rendered as text and kept in memory,
// or rendered as HTML: every provider-returned string uses textContent.
(() => {
  const panel = document.getElementById('v2InspectPanel');
  const notice = document.getElementById('v2InspectNotice');
  const stagesRoot = document.getElementById('v2InspectStages');
  const rerun = document.getElementById('v2InspectRerun');
  const title = document.getElementById('aiInspectTitle');
  const toggle = document.getElementById('translationDebugToggle');
  const tabs = document.getElementById('translationDebugTabs');
  let currentEngine = 'v2';
  let currentData;
  if (!panel || !notice || !stagesRoot || !rerun) return;
  const el = (tag, className, text, parent) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    if (parent) parent.appendChild(node);
    return node;
  };
  function pretty(raw) {
    if (typeof raw !== 'string') return '';
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch (_) {
      return raw;
    }
  }
  function field(parent, title, value) {
    const box = el('div', 'v2-inspect-field', undefined, parent);
    const header = el('div', 'v2-inspect-field-header', undefined, box);
    el('strong', '', title, header);
    const copy = el('button', 'v2-inspect-copy', 'Sao chép', header);
    copy.type = 'button';
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(value);
        copy.textContent = 'Đã sao chép';
      } catch (_) {
        copy.textContent = 'Không thể sao chép';
      }
    });
    const pre = el('pre', 'v2-inspect-code', value, box);
    pre.setAttribute('tabindex', '0');
  }
  function renderDebug(data) {
    const raw = data.rawAccess === 'enabled';
    const providers = Array.isArray(data.providers) ? data.providers : [];
    const analyzer = providers.filter((stage) => stage.provider === 'claude');
    const rest = providers.filter((stage) => stage.provider !== 'claude');
    const noCall = data.cache.cacheHit
      ? 'no_current_call_cache'
      : 'no_current_call';
    const providerData = (stages) => ({
      status: stages.length ? (raw ? 'captured' : 'metadata_only') : noCall,
      stages
    });
    const groups = [
      [
        'Ngữ cảnh',
        {
          preprocessing: data.preprocessing,
          resolverStatus: data.resolverStatus,
          personalContext: data.personalContext,
          conversationContext: data.conversationContext
        }
      ],
      ['Glossary', data.glossary],
      [
        'Claude Analyzer',
        data.engine === 'v2'
          ? providerData(analyzer)
          : { status: 'not_used', reason: 'engine_has_no_claude_analyzer' }
      ],
      ['GPT Payload', providerData(rest)],
      ['Cache & Performance', { ...data.cache, ...data.performance }]
    ];
    notice.textContent = raw
      ? 'Payload của lượt hiện tại đã che thông tin xác thực.'
      : 'Thông tin xử lý của lượt hiện tại. Payload đầy đủ dành cho quản trị viên.';
    if (data.cache.cacheHit && !providers.length) {
      notice.textContent =
        'Bản dịch lấy từ cache. Lượt này không ghi nhận lời gọi AI.';
    }
    rerun.hidden = !(raw && data.cache.cacheHit && data.engine !== 'free');
    tabs.hidden = false;
    function formattedProviderMessages(stage) {
      const request = stage.request || {};
      const messages = request.messages || request.input || [];
      const contents = messages
        .filter((message) => message.role === 'user')
        .flatMap((message) =>
          Array.isArray(message.content)
            ? message.content.map((part) => part.text)
            : [message.content]
        );
      return contents.flatMap((text) => {
        if (typeof text !== 'string') return [];
        try {
          return [JSON.parse(text)];
        } catch {
          return [];
        }
      });
    }
    const buttons = groups.map(([label], index) => {
      const button = el('button', 'v2-inspect-copy', label, tabs);
      button.type = 'button';
      button.id = 'translation-debug-tab-' + index;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', 'v2InspectStages');
      return button;
    });
    function select(index, focus = false) {
      buttons.forEach((button, i) => {
        button.setAttribute('aria-selected', String(i === index));
        button.tabIndex = i === index ? 0 : -1;
      });
      stagesRoot.replaceChildren();
      stagesRoot.setAttribute('role', 'tabpanel');
      stagesRoot.setAttribute('aria-labelledby', buttons[index].id);
      field(
        stagesRoot,
        groups[index][0],
        JSON.stringify(groups[index][1], null, 2)
      );
      if (raw && [2, 3].includes(index)) {
        for (const stage of groups[index][1].stages || []) {
          const payloads = formattedProviderMessages(stage);
          if (!payloads.length) continue;
          const details = el(
            'details',
            'v2-inspect-stage',
            undefined,
            stagesRoot
          );
          el('summary', '', stage.role + ' · User Payload đã giải mã', details);
          field(
            details,
            'User Payload',
            JSON.stringify(
              payloads.length === 1 ? payloads[0] : payloads,
              null,
              2
            )
          );
        }
      }
      if (focus) buttons[index].focus();
    }
    buttons.forEach((button, index) => {
      button.addEventListener('click', () => select(index));
      button.addEventListener('keydown', (event) => {
        const next = {
          ArrowLeft: (index + groups.length - 1) % groups.length,
          ArrowRight: (index + 1) % groups.length,
          Home: 0,
          End: groups.length - 1
        }[event.key];
        if (next === undefined) return;
        event.preventDefault();
        select(next, true);
      });
    });
    select(0);
  }

  function render(data = null, engine = 'v2') {
    window.renderTranslationInspector?.(null);
    currentData = data;
    currentEngine = engine === 'v1' || engine === 'free' ? engine : 'v2';
    if (title)
      title.textContent = 'Luồng xử lý AI · ' + currentEngine.toUpperCase();
    stagesRoot.replaceChildren();
    panel.hidden = !data;
    rerun.hidden = true;
    if (tabs) {
      tabs.hidden = true;
      tabs.replaceChildren();
      stagesRoot.removeAttribute('role');
      stagesRoot.removeAttribute('aria-labelledby');
    }
    if (toggle) {
      toggle.hidden = !data || data.version !== 1;
      toggle.setAttribute('aria-expanded', 'false');
    }
    if (!data) return;
    if (data.version === 1 && data.cache && tabs && toggle) {
      panel.hidden = true;
      rerun.textContent = 'Chạy lại để xem AI (phát sinh phí API)';
      renderDebug(data);
      return;
    }
    const hit = data.cacheHit === true;
    notice.textContent = String(data.notice || '');
    // Replaying an archive must NEVER offer the chargeable rerun action.
    if (hit && !data.historical) {
      rerun.hidden = false;
      rerun.textContent =
        'Chạy lại ' +
        currentEngine.toUpperCase() +
        ' để xem ' +
        (currentEngine === 'v2' ? 'Claude/GPT' : 'GPT') +
        ' (phát sinh phí API)';
    }
    const list = Array.isArray(data.stages) ? data.stages : [];
    if (hit && !list.length) return;
    if (!list.length) {
      notice.textContent = 'Không có dữ liệu trao đổi AI của lượt này.';
      return;
    }
    for (const item of list) {
      const details = el('details', 'v2-inspect-stage', undefined, stagesRoot);
      details.open = true;
      const name =
        item.role === 'analyzer'
          ? 'Claude · Phân tích'
          : item.role === 'analyzer-retry'
            ? 'Claude · Phân tích lại'
            : item.role === 'translator'
              ? 'GPT · Dịch'
              : item.role === 'supplement'
                ? 'GPT · Bổ sung từ vựng/dịch ngược'
                : item.role === 'repair'
                  ? 'GPT · Sửa lỗi'
                  : item.role === 'verification'
                    ? 'GPT · Kiểm chứng'
                    : String(item.role || 'Gọi AI');
      const usage = item.usage || {};
      const input = Number(usage.input) || 0,
        output = Number(usage.output) || 0;
      const ms = Number.isFinite(item.ms)
        ? ' · ' + (item.ms / 1000).toFixed(2) + ' giây'
        : '';
      el(
        'summary',
        '',
        name +
          ' · ' +
          String(item.model || item.provider || '') +
          ' · ' +
          input +
          ' in / ' +
          output +
          ' out' +
          ms,
        details
      );
      const content = el('div', 'v2-inspect-body', undefined, details);
      field(content, '1. System prompt gửi tới AI', String(item.system || ''));
      field(content, '2. Nội dung gửi tới AI', pretty(item.input));
      field(content, '3. Phản hồi do AI trả về', pretty(item.rawOutput));
    }
  }
  rerun.addEventListener('click', () => {
    // Explicit action: running the paid request is never triggered by an effect.
    if (currentEngine === 'v1') window.requestV1LiveTrace?.();
    else window.requestV2LiveTrace?.();
  });
  toggle?.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
  });
  for (const id of ['v1InspectToggle', 'v2InspectToggle']) {
    document.getElementById(id)?.addEventListener('change', (event) => {
      if (event.target.checked || !currentData) return;
      if (currentData.version !== 1) return render(null, currentEngine);
      const open = !panel.hidden;
      render(
        {
          ...currentData,
          rawAccess: 'restricted_or_disabled',
          providers: currentData.providers.map(
            ({ request, output, ...stage }) => stage
          )
        },
        currentEngine
      );
      if (open) {
        panel.hidden = false;
        toggle.setAttribute('aria-expanded', 'true');
      }
    });
  }
  window.renderV2Inspection = render;
})();
