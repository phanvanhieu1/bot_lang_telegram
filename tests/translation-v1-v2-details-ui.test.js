'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {parseAi1Items}=require('../web-vocabulary/ai-items');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

class Node{
  constructor(tag='div'){
    this.tag=tag;this.children=[];this.hidden=false;this.textContent='';
    this.className='';this.dataset={};this.attributes={};
    this.classList={
      add:k=>{if(k==='hidden')this.isHiddenClass=true;},
      remove:k=>{if(k==='hidden')this.isHiddenClass=false;}
    };
  }
  appendChild(child){this.children.push(child);return child;}
  replaceChildren(...children){this.children=children;}
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
    getElementById:id=>roots[id]||null,
    createElement:tag=>new Node(tag)
  };
  vm.runInNewContext(read('public/translation-vocab.js'),{
    window,document,setTimeout:()=>{}
  });
  return {window,roots};
}
function collect(node,pred){
  return [...(pred(node)?[node]:[]),
    ...node.children.flatMap(x=>collect(x,pred))];
}

test('V1 GPT-mini markdown vocabulary is safely normalized into word/phrase/pattern candidates',()=>{
  const source='工资不如去年，工资比较低。';
  const raw='1. **[WORD] 工资 : lương**\n'+
    '- **[PHRASE] 比较低 : khá thấp**\n'+
    '* [PATTERN] A 不如 B : A không bằng B\n'+
    '5. **[WORD] 胡说 : nội dung không có trong câu**';
  const result=parseAi1Items(raw,source,'zh');
  assert.ok(result.some(x=>x.type==='word'&&x.key==='工资'));
  assert.ok(result.some(x=>x.type==='phrase'&&x.key==='比较低'));
  assert.ok(result.some(x=>x.type==='pattern'&&x.key.includes('不如')));
  assert.ok(!result.some(x=>x.key.includes('胡说')),
    'GPT-invented vocabulary absent from the sentence must be rejected');
});

test('V1 and V2 both show the three study groups even when a valid translation has no selected vocabulary',()=>{
  const {window,roots}=setup();
  window.renderTranslationVocabulary([],'','zh',true);
  assert.equal(roots.vocabularyWrapper.isHiddenClass,false);
  assert.equal(roots.vocabularyCards.hidden,false);
  const names=collect(roots.vocabularyCards,
    x=>x.className==='translation-vocab-section-heading')
    .map(x=>x.children[0]?.textContent);
  assert.deepEqual(names,['Từ vựng','Cụm từ','Mẫu câu']);
  assert.ok(collect(roots.vocabularyCards,
    x=>x.className==='translation-vocab-note')
    .some(x=>x.textContent.includes('chưa chọn được')));
  window.renderTranslationVocabulary([],'','zh',false);
  assert.equal(roots.vocabularyCards.hidden,true,
    'disable/reset must not leave empty groups visible');
});

test('V1/V2 web translator uses one vocabulary renderer and one detail layout with meaningful data',()=>{
  const html=read('public/index.html');
  const app=read('public/app.js');
  assert.match(html,/id="translationDetailsSummary"/);
  for(const id of ['detailEngine','detailDirection','detailContext','detailModel'])
    assert.ok(html.includes('id="'+id+'"'));
  assert.match(app,/renderTranslationDetailsSummary\(data,'v1'\)/);
  assert.match(app,/renderTranslationDetailsSummary\(data,'v2'\)/);
  assert.match(app,/renderV2AnalysisDetails\(data\)/);
  assert.match(app,/selectedLang,\s*selectedLang==='zh'\s*\)/);
  assert.match(app,/vocabularyToggle\.checked\s*\);/);
  assert.match(app,/renderTranslationVocabularySnapshot\?\.\(/);
  const backend=read('server.js'),v2=read('ai/v2/routes.js');
  assert.match(backend,/sourceLanguage:inputIsChinese\?'zh':'vi'/);
  assert.match(backend,/targetLanguage:inputIsChinese\?'vi':'zh'/);
  assert.match(v2,/sourceLanguage:translated\.sourceLanguage,targetLanguage:translated\.targetLanguage/);
});

test('V1 and V2 historical translations restore one set of vocabulary cards and detail metadata',()=>{
  const app=read('public/app.js'),vocab=read('public/translation-vocab.js');
  assert.match(app,/historicalEngine==='free'\?null:\{/);
  assert.match(app,/historicalEngine==='v2'\?payload:null/);
  assert.match(app,/payload\.vocabularyItems,payload\.vocabularyError\|\|''/);
  assert.match(vocab,/renderTranslationVocabularySnapshot=\(items,error='',showEmpty=false\)/);
});
