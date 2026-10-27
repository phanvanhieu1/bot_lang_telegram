'use strict';
const { findLinkedUser } = require('./link');
const { resolveTranslationVocabulary } = require('../web-vocabulary/resolver');
const { VocabularyEntry } = require('../web-vocabulary/models');
const { exportAnkiCsv } = require('../telegram-vocabulary');

async function saveLinkedVocabulary(telegramId, { chineseText, vocabulary } = {}) {
  const userId = await findLinkedUser(telegramId);
  if (!userId) return { linked: false, saved: 0 };
  if (!chineseText || !vocabulary) return { linked: true, saved: 0 };
  // Uses EXACTLY the same parser, deduplication and VocabularyEntry model as web PRO.
  const items = await resolveTranslationVocabulary({
    userId, language: 'zh', foreignText: chineseText, vocabulary
  });
  return { linked: true, saved: items.length, items };
}

async function exportLinkedVocabulary(telegramId) {
  const userId = await findLinkedUser(telegramId);
  if (!userId) return { linked: false };
  const entries = await VocabularyEntry.find({ userId, language: 'zh' })
    .sort({ lastSeenAt: -1 }).limit(5000).select('text meaning').lean();
  return {
    linked: true, count: entries.length,
    csv: exportAnkiCsv(entries.map(x => x.text + ': ' + (x.meaning || '')))
  };
}
module.exports = { saveLinkedVocabulary, exportLinkedVocabulary };
