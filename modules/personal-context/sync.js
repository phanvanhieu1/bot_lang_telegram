const { randomUUID } = require('node:crypto');
const { generateContexts, hasBilingualRecognition } = require('./generator');
const { fail, topicId } = require('./validation');

const MAX_CONTEXTS = 60;

function revise(context, changes, now = new Date()) {
  return {
    ...context,
    ...changes,
    version: context.version + 1,
    updatedAt: now
  };
}

async function syncContexts(previous, next, generate = generateContexts) {
  const selected = new Map(
    next.translationTopics.map((name) => [topicId(name), name])
  );
  const existing = new Map(
    previous.contexts
      .filter((context) => context.topicId)
      .map((context) => [context.topicId, context])
  );
  const generation = [];
  for (const [id, name] of selected) {
    const context = existing.get(id);
    if (
      !context ||
      (context.topicSelected &&
        context.status === 'active' &&
        context.source === 'ai_generated' &&
        (previous.occupation !== next.occupation ||
          !hasBilingualRecognition(context)))
    )
      generation.push({ topicId: id, name });
  }
  if (
    previous.contexts.length +
      generation.filter((topic) => !existing.has(topic.topicId)).length >
    MAX_CONTEXTS
  ) {
    fail(409, 'Đã đạt giới hạn ngữ cảnh. Hãy xóa mục không còn cần dùng.');
  }
  const generated = await generate(next.occupation, generation);
  const now = new Date();
  const contexts = previous.contexts.map((context) => {
    if (!context.topicId) return context;
    if (!selected.has(context.topicId)) {
      if (!context.topicSelected) return context;
      return revise(
        context,
        {
          topicSelected: false,
          status: 'inactive',
          disabledBy: context.disabledBy === 'user' ? 'user' : 'profile'
        },
        now
      );
    }
    if (!context.topicSelected) {
      return revise(
        context,
        {
          topicSelected: true,
          ...(context.disabledBy === 'profile'
            ? { status: 'active', disabledBy: null }
            : {})
        },
        now
      );
    }
    const refresh = generated.get(context.topicId);
    if (refresh?.generationMethod === 'ai') {
      return revise(
        context,
        {
          ...(previous.occupation !== next.occupation
            ? refresh
            : {
                situations: refresh.situations,
                keywords: refresh.keywords,
                exampleUtterances: refresh.exampleUtterances,
                generationMethod: refresh.generationMethod
              }),
          generationVersion: context.generationVersion + 1
        },
        now
      );
    }
    return context;
  });
  for (const [id] of selected) {
    if (existing.has(id)) continue;
    contexts.push({
      ...generated.get(id),
      contextId: randomUUID(),
      topicId: id,
      topicSelected: true,
      status: 'active',
      source: 'ai_generated',
      generationVersion: 1,
      version: 1,
      updatedAt: now
    });
  }
  return contexts;
}

module.exports = { MAX_CONTEXTS, revise, syncContexts };
