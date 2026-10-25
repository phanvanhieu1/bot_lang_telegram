// node --test tests/vocabulary-engine.test.js
// Pure algorithm checks: no MongoDB or OpenAI requests are made.
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractCandidates, normalize, removeSensitiveSegments,
  categoryFromContext } = require('../web-vocabulary/extractor');
const { cleanLabel } = require('../web-vocabulary/classifier');
const { presentation } = require('../web-vocabulary/queue');

function id(item) { return item.type+':'+item.key; }
test('recognizes Mandarin work words and a reusable phrase without AI',()=>{
  const items=extractCandidates({
    foreignText:'麻烦你确认一下，这个问题解决了吗？',
    language:'zh',context:'superior'
  });
  const map=new Map(items.map(item=>[id(item),item]));
  assert.equal(map.get('phrase:确认一下').source,'rule');
  assert.equal(map.get('word:确认').meaning,'Xác nhận');
  assert.equal(map.get('word:解决').topicHint,'work');
  assert.equal(map.has('word:一下'),false);
  assert.equal(map.has('word:这个'),false);
});

test('detects daily Chinese sentence pattern while counting work lexeme in daily context',()=>{
  const items=extractCandidates({
    foreignText:'下班以后，我去超市买菜。',
    language:'zh'
  });
  assert.ok(items.some(item=>item.type==='pattern'&&item.key.includes('以后')));
  assert.equal(items.find(item=>item.key==='下班'&&item.type==='word').topicHint,'daily_life');
  assert.ok(items.some(item=>item.key==='买菜'&&item.type==='word'));
});

test('recognizes English multiword expressions and normalizes morphology',()=>{
  const items=extractCandidates({
    foreignText:'Please confirm payment. Let me check and get back to you.',
    language:'en',context:'colleague'
  });
  assert.ok(items.some(item=>item.type==='phrase'&&item.key==='please confirm'));
  assert.ok(items.some(item=>item.type==='phrase'&&item.key==='get back to you'));
  assert.equal(normalize('Confirmed','en'),'confirm');
});

test('filters private-looking identifiers before tokenization or classification',()=>{
  const foreignText='Please contact alice@company.com at https://example.org and ticket X7U2C or +60123456789';
  const clean=removeSensitiveSegments(foreignText);
  assert.ok(!clean.includes('alice')&&!clean.includes('company')&&!clean.includes('example'));
  assert.ok(!clean.includes('X7U2C')&&!clean.includes('60123456789'));
  const keys=extractCandidates({ foreignText,language:'en' }).map(x=>x.key);
  for(const key of ['alice','company','example','com','x7u2c','60123456789'])
    assert.ok(!keys.includes(key),'private key leaked: '+key);
});

test('invalid languages and inputs cannot generate candidates',()=>{
  assert.deepEqual(extractCandidates({foreignText:'Hello',language:'xx'}),[]);
  assert.deepEqual(extractCandidates({foreignText:'',language:'en'}),[]);
  assert.equal(categoryFromContext('请确认订单','zh'),'work');
  assert.equal(categoryFromContext('我要吃饭','zh'),'daily_life');
});

test('AI fallback accepts only known keys, categories and sufficiently confident Vietnamese meanings',()=>{
  const expected={key:'audit',type:'word'};
  assert.deepEqual(cleanLabel({
    key:'audit',type:'word',valid:true,meaning:'Kiểm toán, kiểm tra',category:'work',confidence:0.98
  },expected),{meaning:'Kiểm toán, kiểm tra',category:'work',source:'ai'});
  assert.equal(cleanLabel({key:'audit',type:'word',valid:true,meaning:'Kiểm tra',
    category:'work',confidence:0.3},expected),null);
  assert.equal(cleanLabel({key:'fake',type:'word',valid:true,meaning:'Bịa',
    category:'work',confidence:0.99},expected),null);
  assert.equal(cleanLabel({key:'audit',type:'word',valid:true,meaning:'Kiểm tra',
    category:'finance',confidence:0.99},expected),null);
});

test('manual, local rules and pending candidate presentation are distinct',()=>{
  const rule={key:'确认',type:'word',source:'rule',meaning:'Xác nhận',category:'work'};
  assert.deepEqual(presentation(rule),{source:'rule',meaning:'Xác nhận',category:'work'});
  assert.deepEqual(presentation({key:'abc',type:'word',source:'pending'}),{
    source:'pending',meaning:'',category:'unclassified'
  });
});

test('uses AI1 vocabulary already supplied by PRO translation without extra classifier',()=>{
  const entries=extractCandidates({
    language:'zh',context:'colleague',foreignText:'经理说：请复核一下。',
    additionalVocabulary:'- 复核 : Rà soát, kiểm tra lại'
  });
  const item=entries.find(entry=>entry.key==='复核');
  assert.ok(item);
  assert.equal(item.source,'translation');
  assert.equal(item.meaning,'Rà soát, kiểm tra lại');
  assert.equal(item.category,'work');
  assert.deepEqual(presentation(item),{
    source:'translation',meaning:'Rà soát, kiểm tra lại',category:'work'
  });
});

test('never imports AI1 vocabulary absent from the source message',()=>{
  const entries=extractCandidates({
    language:'en',foreignText:'Please check the payment',
    additionalVocabulary:'- secret company password : Mật khẩu nội bộ'
  });
  assert.ok(!entries.some(item=>item.key.includes('secret company')));
});
