'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fixture = require('../benchmarks/translation-context-v1.json');
const { translationFrom, requestSpec, chosenModel, evaluateVariant, audit, promptFor } = require('../scripts/benchmark-translation');

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
  const pro = requestSpec('pro','openai',prompt,item);
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
  assert.ok(data.cases.every(x=>x.newChars===x.oldChars));
});

test('auditor JSON schema enforces status, missing and reason', async () => {
  let spec;
  const client = {chat:{completions:{create: async arg=>{
    spec = arg;
    return {choices:[{message:{content:JSON.stringify({
      status:'FAIL',missing:['Thiếu yêu cầu cuối câu'],reason:'Thiếu lời nhắc báo lại'
    })}}],usage:{total_tokens:20}};
  }}}};
  const result=await audit(client, fixture.cases[0], {translation:'Phát hiện có hội viên cược thể thao'});
  assert.equal(spec.response_format.type,'json_schema');
  assert.equal(spec.response_format.json_schema.strict,true);
  assert.deepEqual(spec.response_format.json_schema.schema.required,['status','missing','reason']);
  assert.equal(result.status,'FAIL');
  assert.equal(result.missing.length,1);
});

test('preserves translated response when auditor returns malformed output', async () => {
  const record=await evaluateVariant({
    client:{},judge:{},item:fixture.cases[0],prompt:'stub',mode:'pro',provider:'groq',
    translationFn:async()=>({translation:'Báo lại nếu có hội viên cược thể thao được',raw:'TRANSLATION: ...',usage:{total_tokens:120}}),
    auditFn:async()=>{throw new Error('INVALID_AUDIT_FORMAT');}
  });
  assert.equal(record.translation,'Báo lại nếu có hội viên cược thể thao được');
  assert.equal(record.auditError,'INVALID_AUDIT_FORMAT');
  assert.equal(record.errorCode,undefined);
  assert.equal(record.usage.total_tokens,120);
});

test('distinguishes translator failure from auditor failure', async () => {
  const record=await evaluateVariant({
    client:{},judge:{},item:fixture.cases[0],prompt:'stub',mode:'pro',provider:'groq',
    translationFn:async()=>{throw Object.assign(new Error('Provider issue'),{status:429});},
    auditFn:async()=>{throw new Error('should not run');}
  });
  assert.equal(record.errorCode,'429');
  assert.equal(record.auditError,undefined);
  assert.equal(record.translation,undefined);
});

test('PRO benchmark prompts do not request Chinese back translation on web', () => {
  const old={free:()=>'',pro:(source,lang,fast,options)=>JSON.stringify(options)};
  const chinese=JSON.parse(promptFor('baseline','pro',fixture.cases[0],old));
  assert.equal(chinese.backTranslation,false);
  const vietnamese=JSON.parse(promptFor('baseline','pro',fixture.cases.at(-1),old));
  assert.equal(vietnamese.backTranslation,true);
});
