const { createHash } = require('node:crypto');

const LANGUAGES = ['vi', 'zh', 'en', 'ja', 'ko'];
const TOPICS = [
  'Backend Development',
  'Blockchain & Web3',
  'Workplace Communication',
  'Daily Conversation',
  'Business Chinese',
  'Travel',
  'Education'
];

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

function string(value, limit, required = false) {
  if (
    typeof value !== 'string' ||
    value.length > limit ||
    (required && !value.trim())
  ) {
    fail(400, 'Nội dung thiếu hoặc vượt giới hạn.');
  }
  return value.trim();
}

function list(values, max, itemLimit) {
  if (!Array.isArray(values) || values.length > max)
    fail(400, 'Danh sách không hợp lệ.');
  return values.map((value) => string(value, itemLimit, true));
}

function topicId(name) {
  return createHash('sha256')
    .update(name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase())
    .digest('hex');
}

function profileFields(body) {
  const translationTopics = [
    ...new Map(
      list(body.translationTopics ?? [], 12, 80).map((name) => [
        topicId(name),
        name
      ])
    ).values()
  ];
  const preferredLanguages = body.preferredLanguages ?? [];
  if (
    !Array.isArray(preferredLanguages) ||
    ![0, 2].includes(preferredLanguages.length) ||
    new Set(preferredLanguages).size !== preferredLanguages.length ||
    !preferredLanguages.every((language) => LANGUAGES.includes(language))
  ) {
    fail(400, 'Chọn hai ngôn ngữ ưu tiên khác nhau hoặc để trống cả hai.');
  }
  return {
    occupation: string(body.occupation ?? '', 120),
    translationTopics,
    preferredLanguages,
    style: string(body.style ?? '', 160),
    addressTerms: string(body.addressTerms ?? '', 160)
  };
}

function contextFields(body, { generated = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    fail(400, 'Ngữ cảnh không hợp lệ.');
  return {
    name: string(body.name, 80, true),
    domain: string(body.domain ?? '', 80, generated),
    description: string(body.description ?? '', 500, generated),
    scope: string(body.scope ?? '', 400, generated),
    situations: list(
      generated ? body.situations : (body.situations ?? []),
      6,
      140
    ),
    keywords: list(generated ? body.keywords : (body.keywords ?? []), 10, 60),
    exampleUtterances: list(
      generated ? body.exampleUtterances : (body.exampleUtterances ?? []),
      4,
      180
    )
  };
}

module.exports = {
  LANGUAGES,
  TOPICS,
  fail,
  topicId,
  profileFields,
  contextFields
};
