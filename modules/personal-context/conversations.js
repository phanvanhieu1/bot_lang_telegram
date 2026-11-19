const { isObjectIdOrHexString } = require('mongoose');
const { ConversationSession } = require('./models');
const { LANGUAGES, fail } = require('./validation');

const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_TURNS = 100;
const MAX_TEXT = 8000;
const expiry = (now) => new Date(now.getTime() + TTL_MS);

function createConversationService(model = ConversationSession) {
  function filterSession(userId, sessionId, channel) {
    if (!isObjectIdOrHexString(sessionId)) fail(400, 'Mã phiên không hợp lệ.');
    return {
      _id: sessionId,
      userId,
      ...(channel ? { channel } : {}),
      expiresAt: { $gt: new Date() }
    };
  }

  async function startSession(userId, channel) {
    const now = new Date();
    // Expired active records can briefly remain before MongoDB TTL cleanup.
    await model.updateMany(
      { userId, channel, status: 'active' },
      { $set: { status: 'ended', endedAt: now } }
    );
    try {
      const { id, startedAt, expiresAt, status } = await model.create({
        userId,
        channel,
        status: 'active',
        startedAt: now,
        expiresAt: expiry(now)
      });
      return {
        sessionId: id,
        channel,
        status,
        startedAt,
        expiresAt,
        turnCount: 0
      };
    } catch (error) {
      if (error.code === 11000)
        fail(409, 'Một phiên mới vừa được mở. Hãy tải lại.');
      throw error;
    }
  }

  async function listSessions(userId, channel) {
    const rows = await model
      .find({ userId, channel, expiresAt: { $gt: new Date() } })
      .sort({ startedAt: -1, _id: -1 })
      .limit(50)
      .select('-turns -userId')
      .lean();
    return rows.map(({ _id, ...session }) => ({
      ...session,
      sessionId: String(_id)
    }));
  }

  async function activeSession(userId, channel) {
    return model
      .findOne({
        userId,
        channel,
        status: 'active',
        expiresAt: { $gt: new Date() }
      })
      .select('_id')
      .lean();
  }

  async function endSession(userId, sessionId, channel) {
    const result = await model.updateOne(
      { ...filterSession(userId, sessionId, channel), status: 'active' },
      { $set: { status: 'ended', endedAt: new Date() } }
    );
    return result.matchedCount === 1;
  }

  async function deleteSession(userId, sessionId, channel) {
    return (
      (await model.deleteOne(filterSession(userId, sessionId, channel)))
        .deletedCount === 1
    );
  }

  async function getConversationContext(userId, sessionId, limit = 3, channel) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 3)
      fail(400, 'Chỉ hỗ trợ lấy từ 1 đến 3 lượt.');
    const row = await model
      .findOne(filterSession(userId, sessionId, channel), {
        userId: 0,
        turns: { $slice: -limit }
      })
      .lean();
    if (!row) return null;
    const { _id, ...session } = row;
    return { sessionId: String(_id), ...session };
  }

  async function appendTurn({
    userId,
    sessionId,
    channel,
    source,
    translation,
    sourceLanguage,
    targetLanguage
  }) {
    if (
      ![sourceLanguage, targetLanguage].every(
        (language) => LANGUAGES.includes(language) || language === 'und'
      ) ||
      (sourceLanguage === targetLanguage && sourceLanguage !== 'und') ||
      ![source, translation].every(
        (value) => typeof value === 'string' && value.trim()
      )
    )
      return false;
    const now = new Date();
    const turn = {
      source: source.slice(0, MAX_TEXT),
      translation: translation.slice(0, MAX_TEXT),
      sourceLanguage,
      targetLanguage,
      truncated: source.length > MAX_TEXT || translation.length > MAX_TEXT,
      at: now
    };
    // One document update allocates sequence and appends atomically across workers.
    const sequence = { $add: ['$turnCount', 1] };
    const result = await model.updateOne(
      {
        ...filterSession(userId, sessionId, channel),
        status: 'active'
      },
      [
        {
          $set: {
            turnCount: sequence,
            expiresAt: expiry(now),
            turns: {
              $slice: [
                {
                  $concatArrays: [
                    '$turns',
                    [{ $mergeObjects: [{ $literal: turn }, { sequence }] }]
                  ]
                },
                -MAX_TURNS
              ]
            }
          }
        }
      ],
      { updatePipeline: true }
    );
    return result.matchedCount === 1;
  }

  return {
    startSession,
    listSessions,
    activeSession,
    endSession,
    deleteSession,
    getConversationContext,
    appendTurn
  };
}

async function captureWebTurn(req, res, turn) {
  const sessionId = req.get('x-conversation-session');
  if (!sessionId) return;
  let saved = false;
  try {
    saved = await service.appendTurn({
      ...turn,
      channel: 'web',
      userId: req.user._id,
      sessionId
    });
  } catch {
    // Conversation storage availability must not discard a completed translation.
  }
  res.set('X-Conversation-Turn', saved ? 'saved' : 'not-saved');
}

const service = createConversationService();
module.exports = { ...service, createConversationService, captureWebTurn };
