'use strict';
// CSV for Anki/Quizlet: preserve original characters and escape all CSV fields.
function vocabColumns(value) {
  const cleaned = String(value ?? '').replace(/^\s*[-•]\s*/, '').trim();
  if (!cleaned) return null;
  const colon = cleaned.search(/[:：]/);
  if (colon > 0) {
    return [cleaned.slice(0, colon).trim(), cleaned.slice(colon + 1).trim()];
  }
  const dash = cleaned.search(/\s[–—-]\s/);
  if (dash > 0) {
    return [cleaned.slice(0, dash).trim(), cleaned.slice(dash + 3).trim()];
  }
  return [cleaned, ''];
}

function exportAnkiCsv(items) {
  const escape = value => '"' + String(value).replace(/"/g, '""') + '"';
  const rows = [['Front', 'Back']];
  for (const raw of items) {
    const pair = vocabColumns(raw);
    if (pair) rows.push(pair);
  }
  // BOM ensures Chinese/Vietnamese appears correctly in Excel.
  return '\uFEFF' + rows.map(row => row.map(escape).join(',')).join('\r\n') + '\r\n';
}

module.exports = { vocabColumns, exportAnkiCsv };
