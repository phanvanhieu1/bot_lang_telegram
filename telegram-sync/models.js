'use strict';
const mongoose = require('mongoose');
const schemaOptions = { timestamps: true, versionKey: false };
const codeSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  codeHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true }
}, schemaOptions);
codeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const accountSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  telegramId: { type: String, required: true, unique: true, match: /^\d{5,20}$/ },
  connectedAt: { type: Date, default: Date.now }
}, schemaOptions);
const model = (name, schema) => mongoose.models[name] || mongoose.model(name, schema);
module.exports = {
  TelegramLinkCode: model('TelegramLinkCode', codeSchema),
  TelegramAccount: model('TelegramAccount', accountSchema)
};
