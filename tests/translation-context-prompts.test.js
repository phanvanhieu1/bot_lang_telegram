'use strict';
// No API traffic: validate the existing V1 prompt builders and backward-compatible
// response schemas after introducing conditional workplace/daily/IT instructions.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildFreePrompt, buildBackTranslationPrompt } = require('../ai/prompts/free.prompt');
const { buildProPrompt } = require('../ai/prompts/pro.prompt');
const contextRules = require('../ai/prompts/context.rules');
const { createPrompt: buildImagePrompt } = require('../web-image-translate');

const example = '审核的时候发现还有会员能投注体育的说下';
function loadIsolated(relative, mock) {
  const filename = path.join(__dirname, '..', relative);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module,
    exports: module.exports,
    require(name) {
      if (name.endsWith('context.rules')) return contextRules;
      return mock(name);
    }
  }, { filename });
  return module.exports;
}


test('shared V1 instructions stay compact but retain all semantic guardrails', () => {
  const rules = contextRules.DOMAIN_CONTEXT_RULES;
  assert.ok(rules.length <= 1250, `Domain rules grew to ${rules.length} characters`);
  assert.match(rules, /KHÔNG mặc định mọi câu là việc công ty/);
  assert.match(rules, /điều kiện → hành động/);
  assert.match(rules, /KHÔNG bỏ vế cuối/);
  assert.match(rules, /说下\/说一下/);
  assert.match(rules, /提现/);
  assert.match(rules, /cache/);
  assert.match(rules, /tự nhiên, ngắn gọn, đủ ý/);
  assert.match(rules, /Giữ rõ loại giao dịch/);
  assert.match(rules, /khẩu ngữ thân mật/);
  assert.match(rules, /KHÔNG hy sinh sắc thái\/thuật ngữ/);
  for (const profile of ['auto', 'friend', 'colleague', 'superior']) {
    assert.ok(contextRules.audienceGuidance(profile).length < 150);
  }
});

test('FREE Chinese and Vietnamese prompts preserve abbreviations, game operations, friends and output schema', () => {
  const zh = buildFreePrompt(example);
  assert.match(zh, /说下\/说一下/);
  assert.match(zh, /投注\/下注/);
  assert.match(zh, /bạn bè/);
  assert.match(zh, /IT\/backend\/dev/);
  assert.match(zh, /Không biến câu yêu cầu thành câu tường thuật/);
  assert.match(zh, /TRANSLATION: <bản dịch tiếng Việt>/);
  const vi = buildFreePrompt('Lúc duyệt thấy hội viên còn cược được thì báo lại một tiếng.');
  assert.match(vi, /TRANSLATION: <bản dịch tiếng Trung giản thể>/);
  assert.match(vi, /BACK_TRANSLATION: <dịch ngược sang tiếng Việt/);
  const reverse = buildBackTranslationPrompt('有问题说下');
  assert.match(reverse, /说下\/说一下/);
  assert.doesNotMatch(reverse, /BACK_TRANSLATION:/);
});

test('PRO FAST retains single-field reply while applying same semantic guidance', () => {
  const prompt = buildProPrompt(example, 'zh', true, { context: 'friend' });
  assert.match(prompt, /Bạn bè/);
  assert.match(prompt, /说下\/说一下/);
  assert.match(prompt, /TRANSLATION: nội dung bản dịch/);
  assert.doesNotMatch(prompt, /^BACK_TRANSLATION:/m);
  assert.doesNotMatch(prompt, /^VOCABULARY:/m);
});

test('PRO full retains vocabulary/back fields and respects incoming superior requests', () => {
  const prompt = buildProPrompt(example, 'zh', false, { context: 'superior', telegramMode: true });
  assert.match(prompt, /không làm nhẹ hoặc bỏ yêu cầu/);
  assert.match(prompt, /đặt cược/);
  assert.match(prompt, /^TRANSLATION:/m);
  assert.match(prompt, /^BACK_TRANSLATION:/m);
  assert.match(prompt, /^VOCABULARY:/m);
  assert.match(prompt, /không cần điền đủ số lượng/);
  const supple = buildProPrompt(example, 'zh', false, {
    context: 'colleague', existingTranslation: 'Bản dịch đã lưu',
    backTranslation: true, vocabulary: true
  });
  assert.match(supple, /Không dịch lại và không thay đổi bản dịch trên/);
  assert.doesNotMatch(supple, /^TRANSLATION:/m);
  assert.match(supple, /^BACK_TRANSLATION:/m);
  assert.match(supple, /^VOCABULARY:/m);
  assert.match(supple, /không cố liệt kê đủ số lượng/);
});

test('English FREE and PRO use shared domain/audience rules without changing named fields', () => {
  const { buildEnglishPrompt } = loadIsolated('web-english.js', () => ({}));
  const prompt = buildEnglishPrompt('Please check the withdrawal request.', { context: 'colleague', vocabulary: true });
  assert.match(prompt, /Đồng nghiệp/);
  assert.match(prompt, /online-game|trò chơi trực tuyến/);
  assert.match(prompt, /deploy, staging, production/);
  assert.match(prompt, /SOURCE_LANGUAGE: vi hoặc en/);
  assert.match(prompt, /BACK_TRANSLATION: bản dịch ngược hoặc trống/);
});

test('image translation keeps schema and adds chat context without guessing', () => {
  const prompt = buildImagePrompt('zh');
  assert.match(prompt, /说下\/说一下/);
  assert.match(prompt, /các tin nhắn lân cận/);
  assert.match(prompt, /không đoán chi tiết từ phần ảnh bị che/);
  assert.match(prompt, /"quoteOriginal"/);
  assert.match(prompt, /"uncertain":false/);
});

test('verification highlights omitted instructions in workplace Chinese', async () => {
  let request;
  const mod = loadIsolated('ai/services/verification.service.js', () => ({
    getRandomOpenAIClient: () => ({chat: {completions: {
      create: async opts => {
        request = opts;
        return {choices: [{message: {content: JSON.stringify({
          status: 'FAIL', confidence: 20, issues: ['Bỏ câu yêu cầu'], message: 'Thiếu 说下'
        })}}],usage: {total_tokens: 10}};
      }
    }}})
  }));
  const out = await mod.verifyTranslation(example, 'Phát hiện hội viên còn đặt cược thể thao.', 'colleague');
  assert.equal(out.verification.status, 'FAIL');
  assert.match(request.messages[0].content, /说下, 反馈, 处理下/);
  assert.match(request.messages[0].content, /Đồng nghiệp/);
  assert.match(request.messages[0].content, /STATUS:/);
});

test('Chinese evaluation covers daily-life, workplace and IT without changing grading fields', async () => {
  let request;
  const mod = loadIsolated('ai/services/evaluation.service.js', () => ({
    getRandomOpenAIClient: () => ({ chat: { completions: {
      create: async opts => {
        request = opts;
        return { choices: [{message: {content: 'SCORE: 8'}}], usage: {} };
      }
    }}})
  }));
  await mod.evaluateChinese('帮我看下 API');
  assert.match(request.messages[0].content, /NGỮ CẢNH HỌC TẬP/);
  assert.match(request.messages[0].content, /khẩu ngữ\/rút gọn/);
  assert.match(request.messages[0].content, /ORIGINAL_TRANSLATION:/);
  assert.match(request.messages[0].content, /NATURAL_TRANSLATION:/);
});

test('prompt cache keys are versioned without dropping old MongoDB documents', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'web-cache.js'), 'utf8');
  assert.match(source, /CACHE_KEY_VERSION = 2/);
  assert.match(source, /JSON\.stringify\(\[CACHE_KEY_VERSION, \.\.\.parts\]\)/);
  assert.match(source, /return hashKey\(\[\s*'pro'/m);
});

test('vocabulary category prompt understands game work and software work', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'web-vocabulary/category-classifier.js'), 'utf8');
  assert.match(source, /online-game operations/);
  assert.match(source, /software\/IT development/);
  assert.match(source, /genuinely dual-use terms/);
});
