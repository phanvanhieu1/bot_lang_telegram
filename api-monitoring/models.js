'use strict';
const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({
  project: { type: String, required: true, index: true },
  provider: { type: String, required: true },
  operation: { type: String, default: 'request' },
  status: { type: Number, required: true },
  latencyMs: { type: Number, default: 0, min: 0 },
  tokens: { type: Number, default: 0, min: 0 },
  costUsd: { type: Number, default: 0, min: 0 },
  at: { type: Date, default: Date.now, expires: 30 * 24 * 3600 }
}, { versionKey: false });
eventSchema.index({ project: 1, provider: 1, at: -1 });

const quotaSchema = new mongoose.Schema({
  project: { type: String, required: true },
  provider: { type: String, required: true },
  metric: { type: String, required: true },
  unit: { type: String, required: true },
  limit: { type: Number, default: null },
  remaining: { type: Number, default: null },
  used: { type: Number, default: null },
  source: { type: String, required: true },
  checkedAt: { type: Date, default: Date.now }
}, { versionKey: false });
quotaSchema.index({ project: 1, provider: 1, metric: 1 }, { unique: true });

module.exports = {
  ApiMonitorEvent: mongoose.models.ApiMonitorEvent ||
    mongoose.model('ApiMonitorEvent', eventSchema),
  ApiMonitorQuota: mongoose.models.ApiMonitorQuota ||
    mongoose.model('ApiMonitorQuota', quotaSchema)
};
