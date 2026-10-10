
const express = require('express');
const mongoose = require('mongoose');
const { findOrCreateGoogleUser } = require('../users/user.service');
const {
  getGoogleAuthUrl,
  verifyGoogleCallback
} = require('./google.oauth');

const router = express.Router();

// Chuyển người dùng đến Google
router.get('/google', async (req, res) => {
  try {
    const url = await getGoogleAuthUrl(req.session);

    // Lưu state, nonce và PKCE trước khi redirect
    req.session.save((error) => {
      if (error) {
        console.error('OAuth session error:', error);
        return res.status(500).send('Không thể bắt đầu đăng nhập Google');
      }

      res.redirect(url);
    });
  } catch (error) {
    console.error('Google OAuth error:', error);
    res.status(500).send('Không thể kết nối Google');
  }
});

// Google chuyển người dùng về đây

router.get('/google/callback', async (req, res) => {
  try {
    const currentUrl = new URL(
      req.originalUrl,
      process.env.GOOGLE_REDIRECT_URI
    );

    // 1. Xác minh danh tính với Google
    const googleUser = await verifyGoogleCallback(
      currentUrl,
      req.session
    );

    // 2. Kiểm tra kết nối MongoDB
    if (mongoose.connection.readyState !== 1) {
      throw new Error('DATABASE_NOT_CONNECTED');
    }

    // 3. Tìm hoặc tạo tài khoản FREE
    const user = await findOrCreateGoogleUser(googleUser);

    // 4. Tạo session mới để tránh session fixation
    await new Promise((resolve, reject) => {
      req.session.regenerate((error) => {
        if (error) return reject(error);
        resolve();
      });
    });

    // 5. Lưu thông tin đăng nhập vào session
    req.session.authenticated = true;
    req.session.userId = user._id.toString();
    req.session.role = user.role;
    req.session.email = user.email;

    // 6. Lưu session trước khi redirect
    await new Promise((resolve, reject) => {
      req.session.save((error) => {
        if (error) return reject(error);
        resolve();
      });
    });

    return res.redirect('/');
  } catch (error) {
    console.error('Google callback error:', error.message);

    if (error.message === 'ACCOUNT_DISABLED') {
      return res.status(403).send('Tài khoản đã bị khóa');
    }

    if (error.message === 'EMAIL_ALREADY_LINKED') {
      return res.status(409).send(
        'Email đã liên kết với một phương thức đăng nhập khác'
      );
    }

    return res.status(500).send(
      'Đăng nhập Google thất bại'
    );
  }
});


module.exports = router;
