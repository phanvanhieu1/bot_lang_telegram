'use strict';
const express = require('express');
const crypto = require('node:crypto');
const { requireRole } = require('../modules/users/user.middleware');
const { NAME, normalizeEvent, normalizeQuota, recordEvent, recordQuota, summary } = require('./core');
const { pollAll } = require('./quotas');

const router = express.Router();
const adminOnly = requireRole('admin');
const noStore = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };

function keysFromEnv() {
  try {
    const parsed = JSON.parse(process.env.MONITOR_INGEST_KEYS || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function authenticateProject(req, res, next) {
  const project = req.get('x-monitor-project');
  const auth = req.get('authorization') || '';
  if (!project || !NAME.test(project) || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Invalid monitoring credentials' });
  }
  const configured = keysFromEnv()[project];
  const provided = auth.slice(7);
  // A long, independently generated secret per project; never store it in MongoDB.
  if (typeof configured !== 'string' || configured.length < 24 ||
      provided.length !== configured.length || provided.length > 512 ||
      !crypto.timingSafeEqual(Buffer.from(configured), Buffer.from(provided))) {
    return res.status(401).json({ success: false, message: 'Invalid monitoring credentials' });
  }
  req.monitorProject = project;
  next();
}

// External agent endpoint. Never accepts keys, request bodies, prompts, or raw user text.
router.post('/ingest', authenticateProject, async (req, res) => {
  try {
    const kind = req.body?.type || 'event';
    if (kind === 'event') {
      await recordEvent(req.monitorProject, normalizeEvent(req.monitorProject, req.body));
    } else if (kind === 'quota') {
      await recordQuota(req.monitorProject, normalizeQuota(req.monitorProject, req.body));
    } else {
      return res.status(400).json({ success: false, message: 'Unknown monitoring event type' });
    }
    return res.status(202).json({ success: true });
  } catch (error) {
    if (error instanceof TypeError || error?.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: 'Invalid monitoring payload' });
    }
    console.error('Monitor ingest error:', error.message);
    return res.status(503).json({ success: false, message: 'Monitoring store unavailable' });
  }
});

router.get('/admin/summary', adminOnly, noStore, async (req, res) => {
  const hours = Number(req.query.hours || 24);
  const project = req.query.project || null;
  if (![1, 6, 24, 168, 720].includes(hours) ||
      (project !== null && (typeof project !== 'string' || !NAME.test(project)))) {
    return res.status(400).json({ success: false, message: 'Invalid monitoring filter' });
  }
  try {
    return res.json({ success: true, ...(await summary({ project, hours })) });
  } catch (error) {
    console.error('Monitor summary error:', error.message);
    return res.status(503).json({ success: false, message: 'Monitoring data unavailable' });
  }
});

router.post('/admin/refresh-quotas', adminOnly, noStore, async (req, res) => {
  // Reject cross-origin state-changing browser requests.
  const origin = req.get('origin');
  const site = req.protocol + '://' + req.get('host');
  if ((origin && origin !== site) ||
      (req.get('sec-fetch-site') && !['same-origin', 'none'].includes(req.get('sec-fetch-site')))) {
    return res.status(403).json({ success: false });
  }
  try {
    await pollAll();
    return res.json({ success: true });
  } catch (error) {
    console.error('Monitor refresh error:', error.message);
    return res.status(503).json({ success: false });
  }
});

module.exports = router;
