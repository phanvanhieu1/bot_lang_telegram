function invalidMarkers() {
  return Object.assign(
    new Error('Bản dịch không giữ đúng các thành phần được bảo vệ.'),
    {
      code: 'TRANSLATION_MARKER_MISMATCH',
      status: 422
    }
  );
}

function locationPair(prepared) {
  if (prepared.spans.length !== 2) return null;
  const id = prepared.spans.find((span) => span.kind === 'id');
  const url = prepared.spans.find((span) => span.kind === 'url');
  if (!id || !url) return null;
  const at = (marker) => {
    const index = prepared.input.indexOf(marker);
    return /(?:^|\s)(?:trên|tại|on|at|via)\s*$/iu.test(
      prepared.input.slice(0, index)
    );
  };
  return at(url.token) && !at(id.token) ? { id, url } : null;
}

function isChineseLocation(text, token) {
  return [
    ...text.matchAll(/在\s*(\[\[TX_[^\]\r\n]*\]\])\s*(?:上|下|中|里)/gu)
  ].some((match) => match[1] === token);
}

function restore(text, prepared, { required = true } = {}) {
  if (!prepared.spans.length || typeof text !== 'string') return text;
  const { prefix, spans } = prepared;
  const markers = text.match(/\[\[TX_[^\]\r\n]*\]\]/gu) || [];
  const pair = required && locationPair(prepared);
  const inOrder =
    markers.length === spans.length &&
    markers.every((marker, i) => marker === spans[i].token);
  const validLocationOrder =
    pair &&
    markers.length === 2 &&
    markers.includes(pair.id.token) &&
    markers.includes(pair.url.token) &&
    isChineseLocation(text, pair.url.token);
  // A URL explicitly identified as the location may move before an item ID in Chinese.
  // Reject the opposite binding even if the marker indices themselves are in order.
  if (
    required &&
    ((!inOrder && !validLocationOrder) ||
      (pair && isChineseLocation(text, pair.id.token)))
  ) {
    throw invalidMarkers();
  }
  const values = new Map(spans.map((span) => [span.token, span.value]));
  if (
    markers.some((marker) => !values.has(marker)) ||
    text.split(prefix).length - 1 !== markers.length ||
    text.split('[[TX_').length - 1 !== markers.length
  )
    throw invalidMarkers();
  return text.replace(/\[\[TX_[^\]\r\n]*\]\]/gu, (marker) =>
    values.get(marker)
  );
}

function restoreFields(
  content,
  prepared,
  { supplement = false, strictBack = true } = {}
) {
  if (!prepared.spans.length) return content;
  const sections = [
    ...content.matchAll(
      /^(SOURCE_LANGUAGE|TRANSLATION|BACK_TRANSLATION|PRONUNCIATION|VOCABULARY|VERIFICATION):/gim
    )
  ];
  if (!sections.length)
    return restore(content, prepared, { required: !supplement });
  if (
    !supplement &&
    !sections.some((section) => section[1].toUpperCase() === 'TRANSLATION')
  )
    throw invalidMarkers();
  return (
    content.slice(0, sections[0].index) +
    sections
      .map((section, index) => {
        const field = section[1].toUpperCase();
        const value = content.slice(
          section.index + section[0].length,
          sections[index + 1]?.index
        );
        const required =
          field === 'TRANSLATION' ||
          (strictBack && field === 'BACK_TRANSLATION' && Boolean(value.trim()));
        return section[0] + restore(value, prepared, { required });
      })
      .join('')
  );
}

function maskExisting(text, prepared) {
  if (typeof text !== 'string' || !prepared.spans.length) return text;
  const pair = locationPair(prepared);
  const spans = pair
    ? [...prepared.spans].sort(
        (a, b) => text.indexOf(a.value) - text.indexOf(b.value)
      )
    : prepared.spans;
  let cursor = 0;
  let result = '';
  for (const span of spans) {
    const index = text.indexOf(span.value, cursor);
    if (index < 0) throw invalidMarkers();
    result += text.slice(cursor, index) + span.token;
    cursor = index + span.value.length;
  }
  result += text.slice(cursor);
  if (pair) restore(result, prepared);
  return result;
}

module.exports = { restore, restoreFields, maskExisting, locationPair };
