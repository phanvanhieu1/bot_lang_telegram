const { randomUUID } = require('node:crypto');
const { UserProfile } = require('./models');
const { contextFields, fail, profileFields, topicId } = require('./validation');
const { MAX_CONTEXTS, revise, syncContexts } = require('./sync');
const { generateContexts } = require('./generator');

function metadata(profile) {
  return {
    setupStatus: profile.setupStatus,
    occupation: profile.occupation,
    translationTopics: profile.translationTopics,
    preferredLanguages: profile.preferredLanguages,
    style: profile.style,
    addressTerms: profile.addressTerms,
    revision: profile.revision
  };
}

function createProfileService({
  model = UserProfile,
  generate = generateContexts
} = {}) {
  async function read(userId) {
    return (
      (await model.findOne({ userId }).lean()) || {
        ...profileFields({}),
        setupStatus: 'pending',
        revision: 0,
        contexts: []
      }
    );
  }

  async function mutate(userId, revision, change) {
    if (!Number.isSafeInteger(revision) || revision < 0)
      fail(400, 'Thiếu phiên bản hồ sơ hợp lệ.');
    const previous = await read(userId);
    if (previous.revision !== revision)
      fail(409, 'Dữ liệu đã thay đổi. Hãy tải lại trang.');
    const fields = await change(previous);
    const updated = { ...fields, revision: revision + 1 };
    if (revision === 0) {
      try {
        await model.create({ userId, ...updated });
        return updated;
      } catch (error) {
        if (error.code !== 11000) throw error;
      }
    } else {
      const result = await model.updateOne(
        { userId, revision },
        { $set: updated },
        { runValidators: true }
      );
      if (result.matchedCount === 1) return updated;
    }
    fail(409, 'Dữ liệu đã thay đổi. Hãy tải lại trang.');
  }

  async function putProfile(userId, body) {
    const { revision, skip } = body;
    if (skip !== undefined && typeof skip !== 'boolean')
      fail(400, 'Tùy chọn thiết lập không hợp lệ.');
    return metadata(
      await mutate(userId, revision, async (previous) => {
        if (skip) {
          if (previous.setupStatus === 'configured')
            fail(409, 'Hồ sơ đã được thiết lập.');
          return {
            ...metadata(previous),
            setupStatus: 'skipped',
            contexts: previous.contexts
          };
        }
        const next = profileFields(body);
        return {
          ...next,
          setupStatus: 'configured',
          contexts: await syncContexts(previous, next, generate)
        };
      })
    );
  }

  async function mutateContext(userId, contextId, body, action) {
    const profile = await mutate(userId, body.revision, async (previous) => {
      const contexts = previous.contexts.slice();
      if (action === 'create') {
        if (contexts.length >= MAX_CONTEXTS)
          fail(409, 'Đã đạt giới hạn ngữ cảnh.');
        contextId = randomUUID();
        contexts.push({
          ...contextFields(body),
          contextId,
          status: 'active',
          source: 'user_created',
          version: 1,
          generationVersion: 0,
          updatedAt: new Date()
        });
      } else {
        const index = contexts.findIndex(
          (context) => context.contextId === contextId
        );
        if (index < 0) fail(404, 'Không tìm thấy ngữ cảnh.');
        const context = contexts[index];
        if (action === 'delete') {
          contexts.splice(index, 1);
        } else if (action === 'edit') {
          contexts[index] = revise(context, {
            ...contextFields(body),
            source:
              context.source === 'user_created'
                ? 'user_created'
                : 'user_customized'
          });
        } else if (action === 'status') {
          if (!['active', 'inactive'].includes(body.status))
            fail(400, 'Trạng thái không hợp lệ.');
          contexts[index] = revise(context, {
            status: body.status,
            disabledBy: body.status === 'inactive' ? 'user' : null
          });
        } else if (action === 'regenerate') {
          if (
            context.source !== 'ai_generated' &&
            body.replaceCustom !== true
          ) {
            fail(409, 'Cần xác nhận thay thế nội dung tự chỉnh sửa.');
          }
          const id = context.topicId || context.contextId;
          const generated = (
            await generate(previous.occupation, [
              { topicId: id, name: context.name }
            ])
          ).get(id);
          if (generated.generationMethod === 'fallback')
            fail(503, 'AI chưa tạo được ngữ cảnh. Hãy thử lại.');
          contexts[index] = revise(context, {
            ...generated,
            source: 'ai_generated',
            generationVersion: context.generationVersion + 1
          });
        }
      }
      const current = metadata(previous);
      // Deleting a managed context also deselects its topic so unrelated edits cannot resurrect it.
      if (action === 'delete') {
        const deleted = previous.contexts.find(
          (context) => context.contextId === contextId
        );
        if (deleted.topicId) {
          current.translationTopics = current.translationTopics.filter(
            (name) => topicId(name) !== deleted.topicId
          );
        }
      }
      return { ...current, contexts };
    });
    return {
      revision: profile.revision,
      context:
        profile.contexts.find((context) => context.contextId === contextId) ||
        null
    };
  }

  const getResolverProfile = async (userId) => {
    const profile = await read(userId);
    return {
      metadata: metadata(profile),
      contexts: profile.contexts.filter(
        (context) => context.status === 'active'
      )
    };
  };
  const getUserMetadata = async (userId) => metadata(await read(userId));
  const listContexts = async (userId) => {
    const { revision, contexts } = await read(userId);
    return { revision, contexts };
  };
  const getActiveContexts = async (userId) =>
    (await listContexts(userId)).contexts.filter(
      (context) => context.status === 'active'
    );
  const getContextById = async (userId, contextId) =>
    (await listContexts(userId)).contexts.find(
      (context) => context.contextId === contextId
    ) || null;

  return {
    putProfile,
    mutateContext,
    getUserMetadata,
    getResolverProfile,
    listContexts,
    getActiveContexts,
    getContextById
  };
}

module.exports = { ...createProfileService(), createProfileService };
