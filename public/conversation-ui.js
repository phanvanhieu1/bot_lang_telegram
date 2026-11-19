(() => {
  const anchor = document.getElementById('conversationAnchor');
  const toggle = document.getElementById('conversationToggle');
  const panel = document.getElementById('conversationPanel');
  const start = document.getElementById('startConversation');
  const end = document.getElementById('endConversation');
  const status = document.getElementById('conversationStatus');
  let active;

  async function api(path, method = 'GET') {
    const response = await fetch('/api/personal/conversations' + path, {
      method
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message);
    return data;
  }

  function setOpen(open) {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  }

  toggle.onclick = () => setOpen(panel.hidden);
  document.addEventListener('click', (event) => {
    if (!anchor.contains(event.target)) setOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) {
      setOpen(false);
      toggle.focus();
    }
  });

  function show() {
    end.hidden = !active;
    toggle.classList.toggle('is-active', Boolean(active));
    toggle.title = active ? 'Phiên hội thoại đang mở' : 'Phiên hội thoại';
    toggle.setAttribute('aria-label', toggle.title);
    start.textContent = active ? 'Mở phiên mới' : 'Bắt đầu phiên hội thoại';
    status.textContent = active
      ? 'Đang lưu các lượt dịch vào phiên này.'
      : 'Đang dịch độc lập.';
  }

  window.translationConversation = {
    headers() {
      return active ? { 'X-Conversation-Session': active.sessionId } : {};
    },
    acknowledge(response) {
      if (response.headers?.get('X-Conversation-Turn') === 'not-saved') {
        status.textContent = 'Lượt dịch này chưa được lưu vào phiên.';
      } else if (
        response.headers?.get('X-Conversation-Turn') === 'saved' &&
        active
      ) {
        show();
      }
    }
  };

  async function change(action) {
    start.disabled = end.disabled = true;
    try {
      await action();
      show();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      start.disabled = end.disabled = false;
    }
  }

  start.onclick = () =>
    change(async () => {
      const { session } = await api('', 'POST');
      active = session;
    });
  end.onclick = () =>
    change(async () => {
      await api('/' + active.sessionId + '/end', 'POST');
      active = null;
    });
  api('')
    .then(({ sessions }) => {
      active = sessions.find((session) => session.status === 'active');
      anchor.hidden = false;
      show();
    })
    .catch(() => {
      // Keep the translator available when conversation storage is unavailable.
    });
})();
