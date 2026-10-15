// Admin-only maintenance control; FREE tabs poll for logout during maintenance.
(() => {
  const button = document.getElementById('adminMaintenanceBtn');
  const state = document.getElementById('adminMaintenanceState');
  const timerMs = 10000;
  let enabled = null;
  let updating = false;
  let checking = false;
  let wasFree = false;

  function isAdmin() {
    return window.translatorAccess?.role === 'admin';
  }

  function renderSwitch() {
    const on = enabled === true;
    button.classList.toggle('maintenance-enabled', on);
    button.setAttribute('aria-pressed', String(on));
    button.disabled = !isAdmin() || enabled === null || updating;
    if (!updating) state.textContent = enabled === null
      ? 'Chưa tải được trạng thái'
      : on ? 'Đang bật · FREE bị chặn' : 'Đang tắt · FREE hoạt động bình thường';
  }

  async function loadAdminSetting() {
    if (!isAdmin()) return;
    try {
      const response = await fetch('/api/admin/maintenance', {
        credentials: 'same-origin', cache: 'no-store'
      });
      const data = await response.json();
      if (!response.ok || !data.success || typeof data.enabled !== 'boolean') {
        throw new Error(data.message || 'Không thể đọc trạng thái bảo trì');
      }
      enabled = data.enabled;
    } catch (error) {
      console.error('Maintenance admin status:', error);
      state.textContent = 'Không thể tải · kiểm tra kết nối';
      enabled = null;
    }
    renderSwitch();
  }

  button.addEventListener('click', async () => {
    if (!isAdmin() || updating || enabled === null) return;
    const next = !enabled;
    const confirmed = window.confirm(next
      ? 'Bật bảo trì? Tất cả tài khoản FREE sẽ bị đăng xuất, PRO và admin vẫn dùng được.'
      : 'Tắt bảo trì? Tài khoản FREE sẽ có thể đăng nhập và sử dụng lại.');
    if (!confirmed) return;
    updating = true;
    button.disabled = true;
    state.textContent = 'Đang cập nhật...';
    try {
      const response = await fetch('/api/admin/maintenance', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next })
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Không thể cập nhật chế độ bảo trì');
      }
      enabled = data.enabled;
      state.textContent = data.message || '';
      if (enabled && data.sessionsRevoked === false) {
        window.alert('Đã bật bảo trì. Việc thu hồi phiên hàng loạt chưa hoàn tất, nhưng FREE đã bị chặn ở backend.');
      }
    } catch (error) {
      console.error('Maintenance switch error:', error);
      window.alert(error.message || 'Không thể thay đổi chế độ bảo trì');
      // The write might have succeeded while response failed.
      enabled = null;
    } finally {
      updating = false;
      if (enabled === null) await loadAdminSetting();
      renderSwitch();
    }
  });

  function redirectToMaintenance() {
    window.location.replace('/login?error=maintenance');
  }

  async function checkFreeSession() {
    if (checking || !wasFree || document.visibilityState === 'hidden') return;
    checking = true;
    try {
      const response = await fetch('/api/auth', {
        credentials: 'same-origin', cache: 'no-store'
      });
      const data = await response.json();
      if (data.maintenance === true &&
          (response.status === 503 || data.authenticated === false || data.role === 'user')) {
        redirectToMaintenance();
        return;
      }
      if (data.authenticated === false) {
        window.location.replace('/login');
        return;
      }
      if (data.authenticated && data.role !== 'user') {
        wasFree = false; // upgraded to PRO/admin
      }
    } catch (error) {
      console.warn('FREE session check:', error);
    } finally {
      checking = false;
    }
  }

  function accessChanged() {
    if (isAdmin()) {
      void loadAdminSetting();
      wasFree = false;
    } else if (window.translatorAccess?.role === 'user') {
      wasFree = true;
    } else {
      wasFree = false;
    }
  }
  window.addEventListener('translator-access-change', accessChanged);
  accessChanged();
  window.setInterval(() => void checkFreeSession(), timerMs);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkFreeSession();
  });
})();
