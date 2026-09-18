const loginForm = document.getElementById('loginForm');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const loginBtn = document.getElementById('loginBtn');
const loginError = document.getElementById('loginError');

loginForm.addEventListener('submit', async (event) => {
    console.log('LOGIN SUBMIT');
  event.preventDefault();

  loginError.textContent = '';
  loginBtn.disabled = true;
  loginBtn.textContent = 'Đang đăng nhập...';

  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: usernameInput.value.trim(),
        password: passwordInput.value
      })
    });

    console.log('LOGIN STATUS:', response.status);

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(
        data.message || 'Đăng nhập thất bại'
      );
    }

    window.location.href = '/';

  } catch (error) {
    loginError.textContent = error.message;
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Đăng nhập';
  }
});