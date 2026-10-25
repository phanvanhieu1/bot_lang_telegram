// Run: node --test tests/vocabulary-v11.test.js
// Offline tests: no database transactions and no paid/free API requests.
const test=require('node:test');
const assert=require('node:assert/strict');
const {parseAi1Items}=require('../web-vocabulary/ai-items');
const {fingerprint,ruleCategory,serializeEntry}=require('../web-vocabulary/resolver');
const {parseCategoryJSON}=require('../web-vocabulary/category-classifier');

const chinese='我一年的工资可能还不如他的起薪。';
const vocabulary=[
  '- [WORD] 工资 : lương',
  '- [WORD] 起薪 : lương khởi điểm',
  '- [PHRASE] 一年的工资 : lương trong một năm',
  '- [PATTERN] A 不如 B : A không bằng B'
].join('\n');

test('AI1 Chinese selections are split into exactly three lexical types',()=>{
  const items=parseAi1Items(vocabulary,chinese,'zh');
  assert.equal(items.length,4);
  assert.deepEqual(items.map(item=>item.type),['word','word','phrase','pattern']);
  assert.equal(items[0].meaning,'lương');
  assert.equal(items[3].key,'A 不如 B');
  assert.equal(items[3].occurrences,1);
});

test('AI1 English vocabulary counts repeated terms inside the source',()=>{
  const items=parseAi1Items(
    '- [WORD] salary : tiền lương\n'+
    '- [PHRASE] starting salary : lương khởi điểm\n'+
    '- [PATTERN] A is not as ... as B : A không bằng B',
    'My salary is not as high as his starting salary.','en');
  assert.equal(items.find(item=>item.key==='salary').occurrences,2);
  assert.ok(items.some(item=>item.type==='phrase'));
  assert.ok(items.some(item=>item.type==='pattern'));
});

test('legacy cached AI1 output is still readable, but not fabricated',()=>{
  const items=parseAi1Items('- 工资 (gōng zī) : tiền lương',chinese,'zh');
  assert.equal(items[0]?.key,'工资');
  assert.equal(items[0]?.meaning,'tiền lương');
  assert.equal(parseAi1Items('- [WORD] 密码 : mật khẩu',chinese,'zh').length,0);
  assert.equal(parseAi1Items('- [WORD] 密码 : mật khẩu','','zh').length,0);
});

test('duplicate items within AI1 output do not result in duplicate entries',()=>{
  const items=parseAi1Items('- [WORD] 工资 : lương\n- [WORD] 工资 : tiền lương',chinese,'zh');
  assert.equal(items.length,1);
});

test('five-minute guard fingerprints normalize spaces and isolate languages',()=>{
  assert.equal(fingerprint('  我一年的  工资','zh'),fingerprint('我一年的 工资','zh'));
  assert.equal(fingerprint('My Salary','en'),fingerprint('my salary','en'));
  assert.notEqual(fingerprint('My Salary','en'),fingerprint('My Salary','zh'));
  assert.equal(fingerprint('My Salary','en').length,64);
});

test('local dictionary assigns categories but never invents a meaning',()=>{
  assert.equal(ruleCategory('zh',{key:'工资',type:'word'}),'work');
  assert.equal(ruleCategory('zh',{key:'吃饭',type:'word'}),'daily_life');
  assert.equal(ruleCategory('zh',{key:'不如',type:'word'}),'unclassified');
  const existing=serializeEntry({
    _id:'existing-id',key:'工资',text:'工资',type:'word',language:'zh',
    meaning:'Nghĩa người dùng đã sửa',encounterCount:18,category:'work'
  });
  assert.equal(existing.meaning,'Nghĩa người dùng đã sửa');
  assert.equal(existing.encounterCount,18);
});

test('AI2 category parser accepts JSON and fences; category model never requests meanings',()=>{
  const response={items:[{key:'工资',type:'word',category:'work',confidence:0.96}]};
  assert.deepEqual(parseCategoryJSON(JSON.stringify(response)),response);
  assert.deepEqual(parseCategoryJSON('\x60\x60\x60json\n'+JSON.stringify(response)+'\n\x60\x60\x60'),response);
  assert.throws(()=>parseCategoryJSON('not json'));
});
