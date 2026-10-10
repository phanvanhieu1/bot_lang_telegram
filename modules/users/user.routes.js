
const express = require('express');
const User = require('./user.model');
const { requireRole } = require('./user.middleware');

const router = express.Router();

// GET /api/admin/users
// Chỉ Admin được xem danh sách người dùng
router.get(
  '/',
  requireRole('admin'),
  async (req, res) => {
    try {
      const users = await User.find()
        .select(
          'email name avatar role isActive proExpiresAt lastLoginAt createdAt'
        )
        .sort({ createdAt: -1 })
        .lean();

      return res.json({
        success: true,
        total: users.length,
        users
      });
    } catch (error) {
      console.error('Get users error:', error.message);

      return res.status(500).json({
        success: false,
        message: 'Không thể lấy danh sách người dùng'
      });
    }
  }
);


router.patch(
  '/:userId/upgrade',
  requireRole('admin'),
  async (req, res) => {
    try {
      const { userId } = req.params;
      const { days } = req.body;

      // Chỉ chấp nhận số ngày nguyên từ 1 đến 365
      if (
        !Number.isInteger(days) ||
        days < 1 ||
        days > 365
      ) {
        return res.status(400).json({
          success: false,
          message: 'Số ngày PRO phải là số nguyên từ 1 đến 365'
        });
      }

      // Kiểm tra MongoDB ObjectId
      if (!require('mongoose').isValidObjectId(userId)) {
        return res.status(400).json({
          success: false,
          message: 'User ID không hợp lệ'
        });
      }

      const user = await User.findById(userId);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'Không tìm thấy tài khoản'
        });
      }

      if (user.role === 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Không thể thay đổi quyền Admin'
        });
      }

      const now = new Date();

      // Nếu tài khoản đang có PRO chưa hết hạn,
      // cộng thêm số ngày vào thời hạn hiện tại.
      const startDate =
        user.role === 'pro' &&
        user.proExpiresAt &&
        user.proExpiresAt > now
          ? user.proExpiresAt
          : now;

      const expiresAt = new Date(
        startDate.getTime() + days * 24 * 60 * 60 * 1000
      );

      user.role = 'pro';
      user.proExpiresAt = expiresAt;

      await user.save();

      return res.json({
        success: true,
        message: `Đã nâng cấp tài khoản PRO ${days} ngày`,
        user: {
          id: user._id,
          email: user.email,
          role: user.role,
          proExpiresAt: user.proExpiresAt
        }
      });
    } catch (error) {
      console.error('Upgrade user error:', error.message);

      return res.status(500).json({
        success: false,
        message: 'Không thể nâng cấp tài khoản'
      });
    }
  }
);

router.patch(
  '/:userId/downgrade',
  requireRole('admin'),
  async (req, res) => {
    try {
      const { userId } = req.params;

      if (!require('mongoose').isValidObjectId(userId)) {
        return res.status(400).json({
          success: false,
          message: 'User ID không hợp lệ'
        });
      }

      const user = await User.findById(userId);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'Không tìm thấy tài khoản'
        });
      }

      if (user.role === 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Không thể thay đổi quyền Admin'
        });
      }

      user.role = 'user';
      user.proExpiresAt = null;

      await user.save();

      return res.json({
        success: true,
        message: 'Đã hạ cấp tài khoản về FREE',
        user: {
          id: user._id,
          email: user.email,
          role: user.role,
          proExpiresAt: user.proExpiresAt
        }
      });
    } catch (error) {
      console.error('Downgrade user error:', error.message);

      return res.status(500).json({
        success: false,
        message: 'Không thể hạ cấp tài khoản'
      });
    }
  }
);


router.patch(
  '/:userId/status',
  requireRole('admin'),
  async (req, res) => {
    try {
      const { userId } = req.params;
      const { isActive } = req.body;

      if (!require('mongoose').isValidObjectId(userId)) {
        return res.status(400).json({
          success: false,
          message: 'User ID không hợp lệ'
        });
      }

      if (typeof isActive !== 'boolean') {
        return res.status(400).json({
          success: false,
          message: 'isActive phải là true hoặc false'
        });
      }

      const user = await User.findById(userId);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'Không tìm thấy tài khoản'
        });
      }

      // Không cho khóa hoặc thay đổi trạng thái Admin
      if (user.role === 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Không thể thay đổi trạng thái tài khoản Admin'
        });
      }

      user.isActive = isActive;
      await user.save();

      return res.json({
        success: true,
        message: isActive
          ? 'Đã mở khóa tài khoản'
          : 'Đã khóa tài khoản',
        user: {
          id: user._id,
          email: user.email,
          role: user.role,
          isActive: user.isActive
        }
      });
    } catch (error) {
      console.error('Update user status error:', error.message);

      return res.status(500).json({
        success: false,
        message: 'Không thể cập nhật trạng thái tài khoản'
      });
    }
  }
);


module.exports = router;
