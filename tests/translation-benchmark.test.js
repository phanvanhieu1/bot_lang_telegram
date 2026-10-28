'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fixture = require('../benchmarks/translation-context-v1.json');
const { translationFrom, requestSpec, chosenModel } = require('../scripts/benchmark-translation');

test('quality corpus covers workplace action/negation, informal chat and IT without real data', () => {
  assert.equal(fixture.cases.length, 16);
  assert.equal(new Set(fixture.cases.map(x=>x.id)).size, fixture.cases.length);
  assert.ok(fixture.cases.filter(x=>x.category.startsWith('work')).length >= 8);
  assert.ok(fixture.cases.filter(x=>x.category==='friend').length >= 3);
  assert.ok(fixture.cases.filter(x=>x.category==='it').length >= 3);
  for(const item of fixture.cases){
    assert.ok(item.source && item.context && item.required.length && item.critical.length);
    assert.ok(['auto','friend','colleague','superior'].includes(item.context));
  }
});

test('benchmark result extraction ignores unrelated supplemental fields', () => {
  assert.equal(
    translationFrom('TRANSLATION: Lúc duyệt, nếu vẫn còn hội viên cược thể thao được thì báo lại.\nBACK_TRANSLATION: 其他\nVOCABULARY:\n- [WORD] 会员 : hội viên'),
    'Lúc duyệt, nếu vẫn còn hội viên cược thể thao được thì báo lại.'
  );
  assert.equal(translationFrom('TRANSLATION: 请检查 API。'), '请检查 API。');
  assert.throws(()=>translationFrom('BACK_TRANSLATION: không có TRANSLATION'), /INVALID_TRANSLATION_FIELD/);
});

test('benchmark requests preserve original model settings without requiring secrets', () => {
  const item = fixture.cases[0];
  const prompt = 'test prompt';
  const pro = requestSpec('pro','groq',prompt,item);
  assert.equal(pro.model,'gpt-4o');
  assert.equal(pro.temperature,0.3);
  assert.equal(pro.messages[0].role,'system');
  assert.equal(pro.messages[1].content[0].text,item.source);
  const free=requestSpec('free','groq',prompt,item);
  assert.equal(free.model,'qwen/qwen3.8-27b');
  assert.equal(free.temperature,0);
  assert.equal(free.messages[0].role,'user');
  assert.equal(chosenModel('free','openrouter'),'google/gemma-4-31b-it:free');
});

test('offline dry-run compares both prompt generations for the same inputs', () => {
  const result=spawnSync(process.execPath,['scripts/benchmark-translation.js','--mode=pro','--baseline=HEAD','--limit=2','--dry-run'], {
    cwd:path.join(__dirname,'..'),encoding:'utf8',timeout:15000
  });
  assert.equal(result.status,0,result.stderr);
  const data=JSON.parse(result.stdout);
  assert.equal(data.cases.length,2);
  assert.ok(data.cases.every(x=>x.oldChars>0 && x.newChars>0));
  assert.ok(data.cases.every(x=>x.newChars>x.oldChars));
});
