// Persistent site-wide switch affecting authenticated FREE accounts only.
// Lives in web MongoDB; deliberately independent of the Telegram bot.
const mongoose = require('mongoose');
const User = require('./modules/users/user.model');

const NOTICE = 'Website đang bảo trì, quay lại sau';
const SETTING_ID = 'free_maintenance';

const schema = new mongoose.Schema({
  _id: { type: String, required: true },
  enabled: { type: Boolean, required: true, default: false },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
  updatedAt: { type: Date, default: Date.now }
}, { versionKey: false, collection: 'web_site_settings' });

const SiteSetting = mongoose.models.WebSiteSetting ||
  mongoose.model('WebSiteSetting', schema);

function effectiveRole(user, now = new Date()) {
  if (!user || !user.isActive) return 'user';
  if (user.role === 'admin') return 'admin';
  if (user.role === 'pro' && (!user.proExpiresAt || user.proExpiresAt > now)) return 'pro';
  return 'user';
}

async function freeMaintenanceEnabled() {
  const setting = await SiteSetting.findById(SETTING_ID).select('enabled').lean();
  return setting?.enabled === true;
}

async function updateFreeMaintenance(enabled, adminId) {
  if (typeof enabled !== 'boolean') throw new TypeError('enabled must be boolean');
  const setting = await SiteSetting.findOneAndUpdate(
    { _id: SETTING_ID },
    { $set: { enabled, updatedBy: adminId, updatedAt: new Date() } },
    { upsert: true, new: true, runValidators: true }
  );
  return { enabled: setting.enabled, updatedAt: setting.updatedAt };
}

// Revoke active FREE sessions (not PRO/admin) as soon as maintenance starts.
// connect-mongo stores session as a JSON string by default, but handle object
// form as well for interoperability with other store versions.
async function revokeActiveFreeSessions(sessionCollection) {
  const cursor = sessionCollection.find(
    {},
    { projection: { _id: 1, session: 1 }, batchSize: 100 }
  );
  let revoked = 0;
  let batch = [];

  async function flush() {
    if (!batch.length) return;
    const userIds = [...new Set(batch.map(s => s.userId))];
    const users = await User.find({ _id: { $in: userIds } })
      .select('_id role proExpiresAt isActive')
      .lean();
    const permitted = new Set(users
      .filter(user => effectiveRole(user) !== 'user')
      .map(user => String(user._id)));

    const ids = batch.filter(s => !permitted.has(s.userId)).map(s => s.sid);
    if (ids.length) {
      const result = await sessionCollection.deleteMany({ _id: { $in: ids } });
      revoked += result.deletedCount || 0;
    }
    batch = [];
  }

  for await (const record of cursor) {
    let parsed = record.session;
    if (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed); } catch (_) { continue; }
    }
    // Skip sessions not linked to signed-in users (e.g. OAuth-in-progress).
    const userId = parsed?.userId;
    if (parsed?.authenticated !== true || typeof userId !== 'string' ||
        !mongoose.isValidObjectId(userId)) continue;
    batch.push({ sid: record._id, userId });
    if (batch.length >= 100) await flush();
  }
  await flush();
  return revoked;
}

function clearBrowserSession(res) {
  res.clearCookie('connect.sid', { path: '/' });
}

function destroySession(req, res) {
  return new Promise((resolve, reject) => {
    if (!req.session) return resolve();
    req.session.destroy(error => {
      if (error) return reject(error);
      clearBrowserSession(res);
      resolve();
    });
  });
}

module.exports = {
  NOTICE, effectiveRole, freeMaintenanceEnabled, updateFreeMaintenance,
  revokeActiveFreeSessions, destroySession
};
