const express = require('express');
const { requireAuth } = require('../../modules/users/user.middleware');
const { traceStore } = require('./trace-store');

function createInspectorRouter({
  auth = requireAuth,
  store = traceStore
} = {}) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    next();
  });
  router.get('/:id', auth, (req, res) => {
    const trace = store.read(req.user._id, req.params.id);
    if (!trace)
      return res
        .status(404)
        .json({ message: 'Chi tiết đã hết hạn hoặc không còn khả dụng.' });
    if (req.user.role !== 'admin') {
      trace.rawAccess = 'restricted_or_disabled';
      trace.providers = trace.providers.map(
        ({ request, output, requestStatus, outputStatus, ...stage }) => stage
      );
    }
    return res.json({ trace });
  });
  return router;
}

module.exports = { createInspectorRouter };
