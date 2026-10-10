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
