
const User = require('./user.model');

async function requireAuth(req, res, next) {
  try {
    if (!req.session.authenticated) {
      return res.status(401).json({
        success: false,
        message: 'Chưa đăng nhập'
      });
    }

    // Tạm thời giữ tương thích với đăng nhập cũ
    // trong giai đoạn chuyển đổi.
    if (!req.session.userId) {
      return res.status(401).json({
        success: false,
        message: 'Vui lòng đăng nhập lại bằng Google'
      });
    }

    const user = await User.findById(req.session.userId);

    if (!user || !user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Tài khoản không tồn tại hoặc đã bị khóa'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error.message);

    return res.status(500).json({
      success: false,
      message: 'Không thể xác thực tài khoản'
    });
  }
}

function requireRole(...roles) {
  return [
    requireAuth,
    (req, res, next) => {
      let role = req.user.role;

      // PRO hết hạn sẽ có quyền truy cập như FREE.
      if (
        role === 'pro' &&
        req.user.proExpiresAt &&
        req.user.proExpiresAt <= new Date()
      ) {
        role = 'user';
      }

      if (!roles.includes(role)) {
        return res.status(403).json({
          success: false,
          message: 'Bạn không có quyền sử dụng chức năng này'
        });
      }

      next();
    }
  ];
}

module.exports = {
  requireAuth,
  requireRole
};
