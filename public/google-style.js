// Presentation-only handlers. Authorization still comes from /api/auth.
(() => {
  const hamburger = document.getElementById('adminHamburger');
  const legacyToggle = document.getElementById('adminMenuToggle');
  const panel = document.getElementById('adminMenuPanel');
  const clearBtn = document.getElementById('clearSourceBtn');
  const input = document.getElementById('text');
  const label = document.getElementById('regularAccountLabel');
  hamburger?.addEventListener('click', (event) => {
    event.stopPropagation(); // Prevent the document outside-click handler from closing the menu immediately.
    if (hamburger.hidden) return;
    legacyToggle?.click();
  });
  clearBtn?.addEventListener('click', () => {
    if (!input) return;
    input.value = '';
input.dispatchEvent(new Event('input', { bubbles: true }));
input.focus();
clearBtn.hidden = true;
  });
  input?.addEventListener('input', () => { if (clearBtn) clearBtn.hidden = !input.value; });
  if (clearBtn) clearBtn.hidden = !input?.value;
  // Account display is presentation only; server enforces roles.
  fetch('/api/auth', { credentials: 'same-origin', cache: 'no-store' })
    .then(response => response.ok ? response.json() : null)
    .then(data => {
      if (!data?.authenticated) return;
      if (hamburger) hamburger.hidden = data.role !== 'admin';
      if (label) label.textContent = data.name || data.email || 'Tài khoản';
    })
    .catch(error => console.error('Admin menu auth check:', error));
  const observer = new MutationObserver(() => {
    const open = panel && !panel.hidden;
    hamburger?.setAttribute('aria-expanded', String(!!open));
  });
  if (panel) observer.observe(panel, {attributes:true,attributeFilter:['hidden']});
})();

// Realtime Pinyin
(() => {
  const input = document.getElementById('text');
  const wrapper = document.getElementById('realtimePinyin');
  const output = document.getElementById('realtimePinyinText');

  if (!input || !wrapper || !output) return;

  let debounceTimer;
  let controller;
  let requestId = 0;

  async function updatePinyin() {
    const text = input.value.trim();
    const currentRequest = ++requestId;

    clearTimeout(debounceTimer);
    controller?.abort();

    // Chỉ hiển thị khi có chữ Trung
    if (!/[\u3400-\u9FFF]/u.test(text) || text.length > 1000) {
      wrapper.hidden = true;
      output.textContent = '';
      return;
    }

    // Ẩn kết quả cũ trong lúc chờ cập nhật
    wrapper.hidden = true;
    output.textContent = '';

    debounceTimer = setTimeout(async () => {
      controller = new AbortController();

      try {
        const response = await fetch(
          `/api/pinyin?text=${encodeURIComponent(text)}`,
          {
            credentials: 'same-origin',
            signal: controller.signal
          }
        );

        if (!response.ok) {
          throw new Error(`Pinyin API: ${response.status}`);
        }

        const data = await response.json();

        // Bỏ qua phản hồi cũ nếu người dùng đã nhập nội dung mới
        if (currentRequest !== requestId) return;

        output.textContent = data.pinyin || '';
        wrapper.hidden = !data.pinyin;
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.error('Realtime Pinyin error:', error);
        }
      }
    }, 200);
  }

  input.addEventListener('input', updatePinyin);

  // Hỗ trợ trường hợp ô nhập đã có sẵn nội dung
  updatePinyin();
})();
