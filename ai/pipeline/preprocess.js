const { createHash } = require('node:crypto');
const { sourceLanguage } = require('../utils/translation-language');

const protectedPatterns =
  /(?<literal>\[\[TX_[^\]\r\n]*\]\])|(?<code>```[\s\S]*?```|`[^`\r\n]+`)|(?<template>\$\{[^{}\r\n]+\}|\{\{[^{}\r\n]+\}\}|\{[\p{L}_][\p{L}\p{N}_.-]*\}|%(?:\d+\$)?[sdif])|(?<html><!--[\s\S]*?-->|<\/?[A-Za-z][\w:-]*(?:\s+(?:"[^"]*"|'[^']*'|[^'"<>])*)?\s*\/?>)|(?<url>https?:\/\/[^\s<>"'，。！？、；]+)|(?<email>[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,})|(?<id>(?<![\p{L}\p{N}_])(?:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}|[A-Z][A-Z0-9]{0,15}[-_][A-Z0-9]*\d[A-Z0-9_-]*|\p{Script=Han}{1,6}[-_]\d[\dA-Z_-]*)(?![\p{L}\p{N}_]))/gu;

function urlSpan(value) {
  let clean = value.replace(/[.,!?;:]+$/u, '');
  while (
    clean.endsWith(')') &&
    clean.split(')').length > clean.split('(').length
  )
    clean = clean.slice(0, -1);
  return clean;
}

const COPY_RULE =
  'Copy each [[TX_...]] marker literally, once, in strictly increasing index order, for translation and full back-translation separately. The order constraint overrides natural word order. The final suffix names the kind (ID is an identifier, URL is a web address). Rephrase with separate clauses if needed. Keep each marker attached to its original referent. Do not swap their meanings to satisfy the order. Do not include markers in study vocabulary.';

function preprocess(text = '', learningLanguage = 'zh') {
  const original = String(text);
  const digest = createHash('sha256').update(original).digest('hex');
  let salt = digest.slice(0, 8);
  while (original.includes('[[TX_' + salt + '_')) salt += 'x';
  const prefix = '[[TX_' + salt + '_';
  const spans = [];
  let visible = '';
  let end = 0;
  const input = original.replace(protectedPatterns, (match, ...args) => {
    const groups = args.at(-1);
    const offset = args.at(-3);
    const kind = Object.keys(groups).find((key) => groups[key] !== undefined);
    const fixed = kind === 'url' ? urlSpan(match) : match;
    visible += original.slice(end, offset) + ' ';
    end = offset + fixed.length;
    if (!fixed) return match;
    const token = prefix + spans.length + '_' + kind.toUpperCase() + ']]';
    spans.push({ kind, token, value: fixed });
    return token + match.slice(fixed.length);
  });
  visible += original.slice(end);
  const evidenceText = visible.trim();
  const hasHan = /\p{Script=Han}/u.test(evidenceText);
  const hasVietnamese = /[ăâđêôơư\u1ea0-\u1ef9]/iu.test(evidenceText);
  const language = hasHan
    ? sourceLanguage(evidenceText)
    : hasVietnamese
      ? 'vi'
      : 'unknown';
  const fallback =
    language === 'unknown' && learningLanguage === 'zh' ? 'vi' : null;
  return {
    original,
    input,
    spans,
    prefix,
    evidenceText,
    sourceLanguage: language,
    fallback,
    characters: Array.from(original).length,
    lines: original.split(/\r\n|\r|\n/).length
  };
}

module.exports = { preprocess, COPY_RULE };
