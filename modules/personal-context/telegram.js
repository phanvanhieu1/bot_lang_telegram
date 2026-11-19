const conversations = require('./conversations');
const { findLinkedUser } = require('../../telegram-sync/link');
const { splitLongText } = require('../../telegram-utils');
const { sourceLanguage } = require('../../ai/utils/translation-language');

const channel = 'telegram';

const vietnamese = /[ĂÂĐÊÔƠƯăâđêôơưẠ-ỹ]/u;
const scripts = { ja: /[ぁ-ヿ]/u, ko: /[가-힣]/u };

function translationDirection(source, translation, learningLanguage) {
  if (learningLanguage === 'zh') {
    const from = sourceLanguage(source);
    return [from, from === 'zh' ? 'vi' : 'zh'];
  }
  const script = scripts[learningLanguage];
  if (script?.test(source)) return [learningLanguage, 'vi'];
  if (script?.test(translation))
    return [vietnamese.test(source) ? 'vi' : 'und', learningLanguage];
  if (learningLanguage === 'en') {
    const sourceIsVietnamese = vietnamese.test(source);
    const outputIsVietnamese = vietnamese.test(translation);
    if (sourceIsVietnamese !== outputIsVietnamese) {
      return sourceIsVietnamese ? ['vi', 'en'] : ['en', 'vi'];
    }
  }
  return ['und', 'und'];
}

function createTelegramConversations({
  store = conversations,
  linkedUser = findLinkedUser,
  ready,
  testMode = false
}) {
  async function owner(ctx) {
    if (testMode || ctx.chat?.type !== 'private' || !ready()) return null;
    return linkedUser(ctx.from.id);
  }

  function register(bot) {
    const command = (name, handler) =>
      bot.command(name, async (ctx) => {
        const userId = await owner(ctx);
        if (!userId)
          return ctx.reply(
            'Hãy dùng bot chính trong tin nhắn riêng và liên kết tài khoản web PRO.'
          );
        const [, id, extra] = ctx.message.text.trim().split(/\s+/);
        if (extra || (id && !/^[a-f0-9]{24}$/i.test(id)))
          return ctx.reply('Mã phiên không hợp lệ.');
        await handler(ctx, userId, id);
      });

    command('conversation', async (ctx, userId) => {
      await store.startSession(userId, channel);
      await ctx.reply(
        'Đã mở phiên hội thoại mới. Các lượt dịch tin nhắn và giọng nói từ đây sẽ được lưu. /endconversation để kết thúc.'
      );
    });
    command('endconversation', async (ctx, userId) => {
      const current = await store.activeSession(userId, channel);
      const ended =
        current &&
        (await store.endSession(userId, String(current._id), channel));
      await ctx.reply(
        ended ? 'Đã kết thúc phiên hội thoại.' : 'Chưa có phiên đang hoạt động.'
      );
    });
    command('recentconversation', async (ctx, userId, id) => {
      const [latest] = id ? [] : await store.listSessions(userId, channel);
      const sessionId = id || latest?.sessionId;
      const session =
        sessionId &&
        (await store.getConversationContext(userId, sessionId, 3, channel));
      if (!session?.turns.length)
        return ctx.reply('Phiên chưa có lượt dịch hoặc không còn tồn tại.');
      const message = session.turns
        .map(
          (turn) =>
            '#' + turn.sequence + '\n' + turn.source + '\n→ ' + turn.translation
        )
        .join('\n\n');
      for (const chunk of splitLongText(message)) await ctx.reply(chunk);
    });
    command('conversations', async (ctx, userId) => {
      const sessions = await store.listSessions(userId, channel);
      const message = sessions
        .map(
          (session) =>
            session.sessionId +
            ' · ' +
            new Date(session.startedAt)
              .toISOString()
              .slice(0, 16)
              .replace('T', ' ') +
            ' UTC · ' +
            (session.status === 'active' ? 'Đang mở' : 'Đã kết thúc')
        )
        .join('\n');
      for (const chunk of splitLongText(message || 'Chưa có phiên hội thoại.'))
        await ctx.reply(chunk);
    });
    command('clearconversation', async (ctx, userId, id) => {
      if (!id)
        return ctx.reply(
          'Dùng /conversations để lấy mã phiên, sau đó nhập /clearconversation <mã phiên>.'
        );
      const deleted = await store.deleteSession(userId, id, channel);
      await ctx.reply(
        deleted ? 'Đã xóa phiên hội thoại.' : 'Không tìm thấy phiên hội thoại.'
      );
    });
  }

  async function current(ctx) {
    try {
      const userId = await owner(ctx);
      if (!userId) return null;
      const session = await store.activeSession(userId, channel);
      return session ? { userId, sessionId: String(session._id) } : null;
    } catch {
      return null;
    }
  }

  async function capture(ctx, session, source, translation, learningLanguage) {
    if (!session) return;
    const [sourceLanguage, targetLanguage] = translationDirection(
      source,
      translation,
      learningLanguage
    );
    try {
      const userId = await owner(ctx);
      if (String(userId) !== String(session.userId)) return;
      await store.appendTurn({
        ...session,
        channel,
        source,
        translation,
        sourceLanguage,
        targetLanguage
      });
    } catch {
      // Existing translation delivery remains available during storage errors.
    }
  }

  return { register, current, capture };
}

module.exports = { createTelegramConversations };
