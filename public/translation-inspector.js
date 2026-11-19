(() => {
  const root = document.getElementById('translationInspector');
  const tabs = document.getElementById('translationInspectorTabs');
  const panel = document.getElementById('translationInspectorContent');
  const statusNames = {
    disabled: 'Đang tắt',
    selected: 'Đã chọn',
    ambiguous: 'Còn mơ hồ',
    unknown: 'Chưa xác định',
    fallback: 'Dùng luồng V1 cơ bản',
    not_implemented: 'Chưa triển khai'
  };
  const reasons = {
    no_active_contexts: 'Hồ sơ chưa có ngữ cảnh cá nhân đang bật.',
    no_candidate_match: 'Không có từ khóa hoặc câu ví dụ khớp.',
    low_evidence: 'Có dấu hiệu khớp nhưng chưa đạt ngưỡng.',
    ambiguous_candidates: 'Nhiều ngữ cảnh có cùng điểm cao nhất.',
    lower_score: 'Điểm thấp hơn ứng viên đứng đầu.',
    resolver_disabled: 'Tùy chọn dịch theo ngữ cảnh đang tắt.',
    insufficient_source_evidence:
      'Câu nguồn chưa đủ bằng chứng để chọn một ngữ cảnh.',
    resolver_data_unavailable: 'Không đọc được dữ liệu ngữ cảnh.',
    no_session_requested: 'Đang dịch độc lập.',
    no_relevant_active_session_turns:
      'Không có lượt liên quan trong phiên đang mở.',
    no_provider_call: 'Không có lời gọi AI cho lượt này.',
    domain_mismatch: 'Không cùng lĩnh vực',
    overlapping_match: 'Trùng phần văn bản',
    duplicate_domain_match: 'Trùng nghĩa cùng lĩnh vực',
    selection_limit: 'Vượt giới hạn lựa chọn'
  };
  const protectedNames = {
    template: 'biến mẫu',
    html: 'thẻ HTML',
    url: 'liên kết',
    email: 'email',
    id: 'mã định danh',
    code: 'mã nguồn',
    literal: 'ký hiệu nguyên văn'
  };
  const langs = {
    zh: 'Tiếng Trung',
    vi: 'Tiếng Việt',
    en: 'Tiếng Anh',
    unknown: 'Chưa xác định'
  };
  const audiences = {
    auto: 'Tự động',
    friend: 'Bạn bè',
    colleague: 'Đồng nghiệp',
    superior: 'Cấp trên'
  };
  const roles = {
    translator: 'Dịch',
    supplement: 'Bổ sung',
    verification: 'Kiểm chứng',
    repair: 'Sửa bản dịch',
    'protection-retry': 'Thử lại để bảo toàn nội dung',
    analyzer: 'Phân tích'
  };
  const unknown = 'Không có dữ liệu';
  const ms = (value) =>
    Number.isFinite(value)
      ? new Intl.NumberFormat('vi-VN').format(value) + ' ms'
      : unknown;
  let generation = 0;

  function node(tag, text, parent) {
    const item = document.createElement(tag);
    if (text != null) item.textContent = text;
    if (parent) parent.append(item);
    return item;
  }
  function rows(items) {
    const list = node('dl', null, panel);
    for (const [label, value] of items) {
      node('dt', label, list);
      node('dd', value ?? unknown, list);
    }
  }
  function glossary(data) {
    if (!data.matchedCount)
      return node('p', 'Không có thuật ngữ đặc biệt', panel);
    rows([
      ['Phát hiện', data.matchedCount],
      ['Đã gửi và xuất hiện trong bản dịch', data.appliedCount]
    ]);
    const list = node('ul', null, panel);
    for (const term of data.terms) {
      node(
        'li',
        term.source +
          ' → ' +
          term.meaning +
          ' · Glossary cá nhân · ' +
          (term.sent
            ? term.conditional
              ? 'Đã gửi như gợi ý'
              : 'Đã gửi AI'
            : 'Không gửi AI'),
        list
      );
    }
    for (const term of data.rejected) {
      node(
        'li',
        term.source +
          ' → ' +
          term.meaning +
          ' · Đã loại · ' +
          (reasons[term.reason] || 'Không có lý do chi tiết'),
        list
      );
    }
  }

  function render(data) {
    const current = ++generation;
    root.hidden = !data;
    root.open = false;
    tabs.replaceChildren();
    panel.replaceChildren();
    if (!data) return;
    const {
      resolver: r,
      conversation: c,
      glossary: g,
      preprocessing: p,
      ai,
      cache,
      performance: perf
    } = data;
    const groups = [
      [
        'Ngữ cảnh',
        () =>
          rows([
            ['Dịch theo ngữ cảnh', r.enabled ? 'Đang bật' : 'Đang tắt'],
            [
              'Hồ sơ cá nhân',
              r.profileRetrieved && r.profileFound === false
                ? 'Đã tra cứu, chưa có hồ sơ'
                : r.profileRetrieved
                  ? 'Đã truy xuất'
                  : 'Không sử dụng'
            ],
            ['Kết quả lựa chọn', r.contextName || statusNames[r.status]],
            [
              'Lý do',
              r.reason ? reasons[r.reason] : r.evidence.join(', ') || unknown
            ],
            [
              'Phương pháp',
              r.method === 'keyword'
                ? 'Khớp từ khóa'
                : r.method === 'rule'
                  ? 'Khớp câu ví dụ'
                  : 'Không sử dụng'
            ],
            ['Số ngữ cảnh đã kiểm tra', r.evaluatedCount ?? unknown],
            ['Ngưỡng lựa chọn', r.threshold ?? unknown],
            ...(r.topCandidates || []).map((item, index) => [
              'Ứng viên ' + (index + 1),
              [
                item.name + ' · ' + item.score + ' điểm',
                item.method === 'rule'
                  ? 'Khớp câu ví dụ'
                  : item.method === 'keyword'
                    ? 'Khớp từ khóa'
                    : null,
                item.evidence.join(', '),
                item.reason ? reasons[item.reason] : 'Được chọn'
              ]
                .filter(Boolean)
                .join(' · ')
            ]),
            ['Ngữ cảnh đã gửi GPT', r.sentContextName || 'Không sử dụng'],
            [
              'Lịch sử đã gửi',
              c.used ? c.used + ' lượt' : reasons[c.reason] || 'Không sử dụng'
            ]
          ]),
        (t) => ({
          personalContext: t.personalContext,
          conversationContext: t.conversationContext
        })
      ],
      ['Thuật ngữ', () => glossary(g), (t) => t.glossary],
      [
        'Phân tích AI',
        () =>
          rows([
            [
              'Tiền xử lý',
              Number.isFinite(p.characters)
                ? p.characters + ' ký tự · ' + p.lines + ' dòng'
                : unknown
            ],
            ['Ngôn ngữ nhận diện', langs[p.sourceLanguage] || unknown],
            [
              'Thành phần bảo vệ',
              p.protected
                ? Object.entries(p.protected)
                    .map(
                      ([kind, n]) => n + ' ' + (protectedNames[kind] || kind)
                    )
                    .join(', ') || 'Không có'
                : unknown
            ],
            ['Resolver', statusNames[r.status]],
            ['AI phân loại', ai.classifier ? 'Đã gọi' : 'Không gọi']
          ]),
        (t) => ({
          preprocessing: t.preprocessing,
          resolverStatus: t.resolverStatus,
          analyzer: t.providers.filter((s) => s.provider === 'claude')
        })
      ],
      [
        'Dữ liệu gửi AI',
        () =>
          rows([
            [
              'Model dịch',
              ai.model || (ai.calls ? unknown : 'Không có lời gọi mới')
            ],
            [
              'Chiều dịch',
              ai.sourceLanguage && ai.targetLanguage
                ? (langs[ai.sourceLanguage] || ai.sourceLanguage) +
                  ' → ' +
                  (langs[ai.targetLanguage] || ai.targetLanguage)
                : unknown
            ],
            ['Đối tượng giao tiếp', audiences[r.audience]],
            ['Ngữ cảnh đã gửi', r.applied ? r.contextName : 'Không sử dụng'],
            [
              'Thuật ngữ đã gửi',
              g.terms
                .filter((term) => term.sent)
                .map((term) => term.source + ' → ' + term.meaning)
                .join(', ') || 'Không có'
            ],
            ['Lịch sử đã gửi', c.used ? c.used + ' lượt' : 'Không sử dụng'],
            [
              'Payload chi tiết',
              data.rawCaptured
                ? 'Có thể xem trong JSON'
                : 'Không có bản ghi payload đầy đủ'
            ]
          ]),
        (t) => ({ languages: t.languages, providers: t.providers })
      ],
      [
        'Cache & Performance',
        () =>
          rows([
            [
              'Bộ nhớ đệm',
              cache.status === 'partial'
                ? 'Dùng lại một phần'
                : cache.status === 'bypass_conversation'
                  ? 'Bỏ qua cho phiên hội thoại'
                  : cache.hit
                    ? 'Lấy từ bộ nhớ đệm (HIT)'
                    : 'Dịch mới (MISS)'
            ],
            ['Tổng thời gian', ms(perf.durationMs)],
            [
              'Token vào / ra',
              [perf.inputTokens ?? '—', perf.outputTokens ?? '—'].join(' / ')
            ],
            [
              'Chi phí ước tính',
              Number.isFinite(perf.costUsd)
                ? new Intl.NumberFormat('vi-VN', {
                    maximumFractionDigits: 8
                  }).format(perf.costUsd) + ' USD'
                : unknown
            ],
            ['Số lần gọi AI', ai.calls],
            ...ai.stages.map((stage) => [
              roles[stage.role] || stage.role,
              ms(stage.elapsedMs)
            ])
          ]),
        (t) => ({ cache: t.cache, performance: t.performance })
      ]
    ];

    const buttons = groups.map(([name], index) => {
      const button = node('button', name, tabs);
      button.type = 'button';
      button.className = 'v2-inspect-copy';
      button.id = 'translationInspectorTab' + index;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', panel.id);
      return button;
    });
    function select(index) {
      buttons.forEach((button, i) => {
        button.setAttribute('aria-selected', String(i === index));
        button.tabIndex = i === index ? 0 : -1;
      });
      panel.replaceChildren();
      panel.setAttribute('aria-labelledby', buttons[index].id);
      groups[index][1]();
      const view = node('button', 'Xem JSON', panel);
      view.type = 'button';
      view.className = 'v2-inspect-copy';
      view.onclick = async () => {
        view.disabled = true;
        const feedback = node('p', 'Đang tải chi tiết…', panel);
        feedback.setAttribute('role', 'status');
        try {
          if (!data.traceId) throw new Error('Chi tiết không còn khả dụng.');
          const response = await fetch(
            '/api/translation-inspector/' + encodeURIComponent(data.traceId),
            { cache: 'no-store' }
          );
          if (!response.ok)
            throw new Error(
              response.status === 404
                ? 'Chi tiết đã hết hạn hoặc không còn khả dụng.'
                : 'Không thể tải chi tiết.'
            );
          const { trace } = await response.json();
          if (current !== generation || !view.isConnected) return;
          const json = JSON.stringify(groups[index][2](trace), null, 2);
          feedback.remove();
          const copy = node('button', 'Sao chép JSON', panel);
          copy.type = 'button';
          copy.className = 'v2-inspect-copy';
          copy.onclick = async () => {
            try {
              await navigator.clipboard.writeText(json);
              copy.textContent = 'Đã sao chép';
            } catch {
              copy.textContent = 'Không thể sao chép';
            }
          };
          node('pre', json, panel).className = 'v2-inspect-code';
        } catch (err) {
          feedback.textContent = err.message;
          view.disabled = false;
        }
      };
    }
    buttons.forEach((button, index) => {
      button.onclick = () => select(index);
      button.onkeydown = (event) => {
        const next = {
          ArrowRight: (index + 1) % buttons.length,
          ArrowLeft: (index + buttons.length - 1) % buttons.length,
          Home: 0,
          End: buttons.length - 1
        }[event.key];
        if (next === undefined) return;
        event.preventDefault();
        select(next);
        buttons[next].focus();
      };
    });
    select(0);
  }
  window.renderTranslationInspector = render;
})();
