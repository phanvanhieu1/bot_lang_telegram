
const User = require('./user.model');

async function findOrCreateGoogleUser(googleUser) {
  const { providerId, email, name, avatar } = googleUser;

  if (!providerId || !email) {
    throw new Error('Thông tin Google không hợp lệ');
  }

  // Tìm tài khoản đã liên kết với Google ID này.
  let user = await User.findOne({
    providers: {
      $elemMatch: {
        provider: 'google',
        providerId
      }
    }
  });

  if (user) {
    if (!user.isActive) {
      throw new Error('ACCOUNT_DISABLED');
    }

    user.lastLoginAt = new Date();
    await user.save();

    return user;
  }

  // Không tự động liên kết tài khoản chỉ vì email giống nhau.
  // Việc liên kết provider sẽ được xử lý riêng.
  const existingEmail = await User.findOne({
    email: email.toLowerCase()
  });

  if (existingEmail) {
    throw new Error('EMAIL_ALREADY_LINKED');
  }

  // Tài khoản mới luôn có quyền FREE.
  user = await User.create({
    email: email.toLowerCase(),
    name,
    avatar,
    providers: [
      {
        provider: 'google',
        providerId
      }
    ],
    role: 'user',
    isActive: true,
    lastLoginAt: new Date()
  });

  return user;
}

module.exports = {
  findOrCreateGoogleUser
};
