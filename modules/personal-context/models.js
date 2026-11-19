const mongoose = require('mongoose');

const { Schema } = mongoose;
const embedded = { _id: false };
const owner = { type: Schema.Types.ObjectId, ref: 'User', required: true };

const contextSchema = new Schema(
  {
    contextId: { type: String, required: true },
    topicId: String,
    name: { type: String, required: true },
    domain: String,
    description: String,
    scope: String,
    situations: [String],
    keywords: [String],
    exampleUtterances: [String],
    status: { type: String, enum: ['active', 'inactive'], required: true },
    disabledBy: { type: String, enum: ['profile', 'user'] },
    source: {
      type: String,
      enum: ['ai_generated', 'user_customized', 'user_created'],
      required: true
    },
    generationMethod: { type: String, enum: ['ai', 'fallback'] },
    generationVersion: Number,
    version: { type: Number, required: true },
    topicSelected: Boolean,
    updatedAt: Date
  },
  embedded
);

const profileSchema = new Schema(
  {
    userId: { ...owner, unique: true },
    setupStatus: {
      type: String,
      enum: ['pending', 'skipped', 'configured'],
      required: true
    },
    occupation: String,
    translationTopics: [String],
    preferredLanguages: [String],
    style: String,
    addressTerms: String,
    revision: { type: Number, required: true },
    contexts: [contextSchema]
  },
  { timestamps: true, versionKey: false }
);

const turnSchema = new Schema(
  {
    sequence: Number,
    source: String,
    translation: String,
    sourceLanguage: String,
    targetLanguage: String,
    truncated: Boolean,
    at: Date
  },
  embedded
);

const conversationSchema = new Schema(
  {
    userId: owner,
    channel: { type: String, enum: ['web', 'telegram'], required: true },
    status: { type: String, enum: ['active', 'ended'], required: true },
    startedAt: { type: Date, required: true },
    endedAt: Date,
    expiresAt: { type: Date, required: true },
    turnCount: { type: Number, default: 0 },
    turns: [turnSchema]
  },
  { versionKey: false }
);

conversationSchema.index({ userId: 1, channel: 1, startedAt: -1 });
conversationSchema.index(
  { userId: 1, channel: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'active' }
  }
);
conversationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = {
  UserProfile: mongoose.model('UserProfile', profileSchema),
  ConversationSession: mongoose.model('ConversationSession', conversationSchema)
};
