// Run with: node --test tests/maintenance.test.js
// No MongoDB connection or real user sessions required.
const test = require('node:test');
const assert = require('node:assert/strict');
const User = require('../modules/users/user.model');
const {
  NOTICE, effectiveRole, revokeActiveFreeSessions
} = require('../web-maintenance');

test('maintenance notice and effective role classification', () => {
  const now = new Date('2026-10-16T00:00:00.000Z');
  assert.equal(NOTICE, 'Website đang bảo trì, quay lại sau');
  assert.equal(effectiveRole({ role: 'user', isActive: true }, now), 'user');
  assert.equal(effectiveRole({ role: 'admin', isActive: true }, now), 'admin');
  assert.equal(effectiveRole({ role: 'pro', isActive: true, proExpiresAt: null }, now), 'pro');
  assert.equal(effectiveRole({ role: 'pro', isActive: true, proExpiresAt: new Date('2026-10-20T00:00:00Z') }, now), 'pro');
  assert.equal(effectiveRole({ role: 'pro', isActive: true, proExpiresAt: new Date('2026-10-15T00:00:00Z') }, now), 'user');
  assert.equal(effectiveRole({ role: 'admin', isActive: false }, now), 'user');
});

test('revokes FREE and expired PRO sessions, retaining active PRO/admin/OAuth sessions', async () => {
  const free = '000000000000000000000001';
  const pro = '000000000000000000000002';
  const admin = '000000000000000000000003';
  const expired = '000000000000000000000004';
  const sessions = [
    { _id: 'free-session', session: JSON.stringify({ userId: free, authenticated: true }) },
    { _id: 'pro-session', session: JSON.stringify({ userId: pro, authenticated: true }) },
    { _id: 'admin-session', session: { userId: admin, authenticated: true } },
    { _id: 'expired-session', session: JSON.stringify({ userId: expired, authenticated: true }) },
    { _id: 'oauth-session', session: JSON.stringify({ state: 'login-in-progress' }) },
    { _id: 'bad-session', session: '{not json' }
  ];
  const users = [
    { _id: free, role: 'user', isActive: true },
    { _id: pro, role: 'pro', isActive: true, proExpiresAt: null },
    { _id: admin, role: 'admin', isActive: true },
    { _id: expired, role: 'pro', isActive: true, proExpiresAt: new Date('2024-01-01') }
  ];
  const originalFind = User.find;
  const deleted = [];
  User.find = () => ({ select: () => ({ lean: async () => users }) });
  try {
    const collection = {
      find: () => ({
        async *[Symbol.asyncIterator]() { for (const item of sessions) yield item; }
      }),
      deleteMany: async filter => {
        const ids = filter._id.$in;
        deleted.push(...ids);
        return { deletedCount: ids.length };
      }
    };
    const count = await revokeActiveFreeSessions(collection);
    assert.equal(count, 2);
    assert.deepEqual(deleted.sort(), ['expired-session', 'free-session']);
  } finally {
    User.find = originalFind;
  }
});
