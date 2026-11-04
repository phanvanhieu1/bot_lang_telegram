'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');

class Node {
  constructor(tag='div'){
    this.tag=tag;this.children=[];this.dataset={};
    this.hidden=false;this.textContent='';this.className='';
    this.id='';this.attributes={};
    this.classList={
      add:name=>{if(name==='hidden')this.isHiddenClass=true;},
      remove:name=>{if(name==='hidden')this.isHiddenClass=false;}
    };
  }
  appendChild(child){this.children.push(child);return child;}
  replaceChildren(...values){this.children=[...values];}
  setAttribute(key,value){this.attributes[key]=value;}
  addEventListener(){}
}
function setup(){
  const roots={
    vocabularyCards:new Node(),vocabulary:new Node(),
    vocabularyWrapper:new Node(),v2ClaudeVocabulary:new Node()
  };
  const window={addEventListener(){}};
  const document={
    getElementById:name=>roots[name]||null,
    createElement:tag=>new Node(tag)
  };
  const source=fs.readFileSync(path.join(__dirname,
    '../public/translation-vocab.js'),'utf8');
  vm.runInNewContext(source,{window,document,setTimeout:()=>{}});
  return {window,roots};
}
const find=(node,predicate)=>
  (predicate(node)?[node]:[]).concat(node.children.flatMap(n=>find(n,predicate)));

test('V2 Chinese input reuses Mongo-backed V1 vocabulary cards with Pinyin and counts',()=>{
  const {window,roots}=setup();
  const db=[{text:'超市',key:'超市',type:'word',meaning:'siêu thị',
    pinyin:'chāo shì',encounterCount:4,isNew:false,category:'daily_life'}];
  window.renderTranslationVocabulary(db,'','zh');
  window.renderV2ClaudeTerms([{source:'超市',meaning:'Claude dự đoán'}],'zh',true);
  assert.equal(roots.vocabularyCards.hidden,false);
  assert.equal(roots.v2ClaudeVocabulary.hidden,true);
  assert.equal(roots.vocabularyWrapper.isHiddenClass,false);
  const text=find(roots.vocabularyCards,node=>node.className==='translation-vocab-meaning')
    .map(n=>n.textContent);
  assert.ok(text.includes('siêu thị'));
  assert.ok(!text.includes('Claude dự đoán'));
  const pinyin=find(roots.vocabularyCards,node=>node.className==='translation-vocab-pinyin');
  assert.equal(pinyin[0].textContent,'chāo shì');
  const counts=find(roots.vocabularyCards,node=>node.className==='translation-vocab-count');
  assert.equal(counts[0].textContent,'4 lần gặp');
});

test('V2 Vietnamese input displays Claude analysis without false study counters or storage',()=>{
  const {window,roots}=setup();
  window.renderTranslationVocabulary([],'','zh');
  window.renderV2ClaudeTerms([{source:'mua rau',meaning:'đi mua đồ ăn'}],'vi',false);
  assert.equal(roots.v2ClaudeVocabulary.hidden,false);
  assert.equal(roots.vocabularyWrapper.isHiddenClass,false);
  const headings=find(roots.v2ClaudeVocabulary,node=>
    node.className==='translation-vocab-section-heading');
  assert.equal(headings.length,1);
  const terms=find(roots.v2ClaudeVocabulary,node=>
    node.className==='translation-vocab-term');
  assert.equal(terms[0].textContent,'mua rau');
  assert.equal(find(roots.v2ClaudeVocabulary,node=>
    node.className==='translation-vocab-count').length,0);
  assert.equal(find(roots.v2ClaudeVocabulary,node=>
    node.className==='term-vocab-add').length,0);
  window.renderV2ClaudeTerms([]);
  assert.equal(roots.v2ClaudeVocabulary.hidden,true);
});

test('V2 Chinese Mongo unavailable falls back to unpersisted Claude suggestions',()=>{
  const {window,roots}=setup();
  window.renderTranslationVocabulary([],'Kho từ vựng đang tạm thời không khả dụng','zh');
  window.renderV2ClaudeTerms([{source:'超市',meaning:'siêu thị'}],'zh',false);
  assert.equal(roots.v2ClaudeVocabulary.hidden,false);
  assert.ok(find(roots.v2ClaudeVocabulary,node=>
    node.className==='translation-vocab-term').some(n=>n.textContent==='超市'));
});
