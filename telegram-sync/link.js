'use strict';
const crypto = require('node:crypto');
const { TelegramLinkCode, TelegramAccount } = require('./models');
const User = require('../modules/users/user.model');

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const validTelegramId = value => /^\d{5,20}$/.test(String(value || ''));
const eligible = user => user?.isActive && (
  user.role === 'admin' || (user.role === 'pro' &&
  (!user.proExpiresAt || user.proExpiresAt > new Date()))
);

async function issueLinkCode(userId) {
  // Invalidate older, unused codes before issuing a new one.
  await TelegramLinkCode.deleteMany({ userId });
  const code = crypto.randomBytes(12).toString('hex');
  await TelegramLinkCode.create({
    userId,
    codeHash: hash(code),
    expiresAt: new Date(Date.now() + 10 * 60_000)
  });
  return { code, expiresInSeconds: 600 };
}

async function connectTelegram(telegramId, code) {
  if (!validTelegramId(telegramId) || typeof code !== 'string' || !/^[a-f0-9]{24}$/.test(code)) {
    return { ok: false, reason: 'invalid' };
  }
  // Atomically consume the code; two different Telegram users cannot redeem it twice.
  const token = await TelegramLinkCode.findOneAndDelete({
    codeHash: hash(code), expiresAt: { $gt: new Date() }
  });
  if (!token) return { ok: false, reason: 'expired' };
  const user = await User.findById(token.userId).select('isActive role proExpiresAt').lean();
  if (!eligible(user)) return { ok: false, reason: 'not_eligible' };
  // A Telegram account can be linked to one web account only, and vice versa.
  // Prevent silent takeover; user must unlink in web before switching accounts.
  const [byTg, byWeb] = await Promise.all([
    TelegramAccount.findOne({ telegramId: String(telegramId) }).lean(),
    TelegramAccount.findOne({ userId: token.userId }).lean()
  ]);
  if ((byTg && String(byTg.userId) !== String(token.userId)) ||
      (byWeb && byWeb.telegramId !== String(telegramId))) {
    return { ok: false, reason: 'already_linked' };
  }
  try {
    await TelegramAccount.updateOne(
      { userId: token.userId, telegramId: String(telegramId) },
      { $setOnInsert: { connectedAt: new Date() } },
      { upsert: true }
    );
    return { ok: true };
  } catch (error) {
    if (error?.code === 11000) return { ok: false, reason: 'already_linked' };
    throw error;
  }
}

async function findLinkedUser(telegramId) {
  if (!validTelegramId(telegramId)) return null;
  const link = await TelegramAccount.findOne({ telegramId: String(telegramId) }).lean();
  if (!link) return null;
  const user = await User.findById(link.userId).select('isActive role proExpiresAt').lean();
  return eligible(user) ? link.userId : null;
}

async function unlinkWebUser(userId) {
  await Promise.all([
    TelegramAccount.deleteOne({ userId }),
    TelegramLinkCode.deleteMany({ userId })
  ]);
}
module.exports = { issueLinkCode, connectTelegram, findLinkedUser, unlinkWebUser, eligible };
