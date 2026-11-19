const User = require('../users/user.model');
const { createHash } = require('node:crypto');
const express = require('express');
const { requireAuth } = require('../users/user.middleware');
const profiles = require('./service');
const conversations = require('./conversations');
const { LANGUAGES, TOPICS, fail } = require('./validation');

function createPersonalRouter({
  auth = requireAuth,
  profile = profiles,
  conversation = conversations
} = {}) {
  const router = express.Router();
  router.use(auth, (req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    const origin = req.get('origin');
    const site = req.get('sec-fetch-site');
    if (
      !['GET', 'HEAD'].includes(req.method) &&
      ((origin && origin !== req.protocol + '://' + req.get('host')) ||
        (site && !['same-origin', 'none'].includes(site)))
    ) {
      return res
        .status(403)
        .json({ success: false, message: 'Yêu cầu không cùng nguồn gốc.' });
    }
    next();
  });

  function endpoint(handler) {
    return async (req, res) => {
      try {
        const body = req.body ?? {};
        if (typeof body !== 'object' || Array.isArray(body))
          fail(400, 'Nội dung yêu cầu không hợp lệ.');
        const payload = await handler(
          req.user._id,
          req.params,
          body,
          req.query,
          req
        );
        return res.json({ success: true, ...payload });
      } catch (error) {
        const known = [400, 404, 409, 503].includes(error.status);
        if (!known) console.error('Personal context operation failed');
        return res.status(known ? error.status : 500).json({
          success: false,
          message: known
            ? error.message
            : 'Không thể xử lý dữ liệu cá nhân lúc này.'
        });
      }
    };
  }

  router.patch(
    '/translation-preferences',
    endpoint(async (id, params, body) => {
      if (typeof body.hybridContextEnabled !== 'boolean')
        fail(400, 'Tùy chọn Resolver phải là boolean.');
      await User.updateOne(
        { _id: id },
        { $set: { hybridContextEnabled: body.hybridContextEnabled } }
      );
      return { hybridContextEnabled: body.hybridContextEnabled };
    })
  );
  router.get(
    '/profile',
    endpoint(async (userId, params, body, query, req) => ({
      profile: await profile.getUserMetadata(userId),
      topics: TOPICS,
      languages: LANGUAGES,
      reminderDismissed: req.session.translationSetupDismissed === true,
      reminderKey: req.sessionID
        ? createHash('sha256')
            .update('translation-profile:' + req.sessionID)
            .digest('hex')
        : null
    }))
  );
  router.post(
    '/profile/dismiss',
    endpoint(async (id, params, body, query, { session }) => {
      session.translationSetupDismissed = true;
      await new Promise((resolve, reject) =>
        session.save((error) => (error ? reject(error) : resolve()))
      );
      return {};
    })
  );
  router.put(
    '/profile',
    endpoint(async (id, params, body) => ({
      profile: await profile.putProfile(id, body)
    }))
  );
  router.get(
    '/contexts',
    endpoint((id) => profile.listContexts(id))
  );
  router.get(
    '/contexts/:id',
    endpoint(async (id, params) => {
      const context = await profile.getContextById(id, params.id);
      if (!context) fail(404, 'Không tìm thấy ngữ cảnh.');
      return { context };
    })
  );
  router.post(
    '/contexts',
    endpoint((id, params, body) =>
      profile.mutateContext(id, null, body, 'create')
    )
  );
  router.put(
    '/contexts/:id',
    endpoint((id, params, body) =>
      profile.mutateContext(id, params.id, body, 'edit')
    )
  );
  router.patch(
    '/contexts/:id/status',
    endpoint((id, params, body) =>
      profile.mutateContext(id, params.id, body, 'status')
    )
  );
  router.post(
    '/contexts/:id/regenerate',
    endpoint((id, params, body) =>
      profile.mutateContext(id, params.id, body, 'regenerate')
    )
  );
  router.delete(
    '/contexts/:id',
    endpoint((id, params, body) =>
      profile.mutateContext(id, params.id, body, 'delete')
    )
  );

  router.get(
    '/conversations',
    endpoint(async (id) => ({
      sessions: await conversation.listSessions(id, 'web')
    }))
  );
  router.post(
    '/conversations',
    endpoint(async (id) => ({
      session: await conversation.startSession(id, 'web')
    }))
  );
  router.get(
    '/conversations/:id',
    endpoint(async (id, params, body, query) => {
      const limit = query.limit === undefined ? 3 : Number(query.limit);
      const session = await conversation.getConversationContext(
        id,
        params.id,
        limit,
        'web'
      );
      if (!session) fail(404, 'Không tìm thấy phiên hội thoại.');
      return { session };
    })
  );
  router.post(
    '/conversations/:id/end',
    endpoint(async (id, params) => {
      if (!(await conversation.endSession(id, params.id, 'web')))
        fail(404, 'Không tìm thấy phiên đang hoạt động.');
      return {};
    })
  );
  router.delete(
    '/conversations/:id',
    endpoint(async (id, params) => {
      if (!(await conversation.deleteSession(id, params.id, 'web')))
        fail(404, 'Không tìm thấy phiên hội thoại.');
      return {};
    })
  );
  return router;
}

module.exports = { createPersonalRouter };
