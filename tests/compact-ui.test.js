// node --test tests/compact-ui.test.js
// Browser-independent interaction tests; no network, DOM packages, or API keys.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const publicFile = name => fs.readFileSync(
  path.join(__dirname, '..', 'public', name), 'utf8'
);

class MockElement {
  constructor(tag = 'div') {
    this.tag = tag;
    this.children = [];
    this.className = '';
    this.dataset = {};
    this.hidden = false;
    this.attributes = {};
    this.handlers = {};
    this._text = '';
    this.focused = false;
    this.classList = {
      add: name => { this.className += ' ' + name; },
      remove: name => { this.className = this.className.replace(' ' + name, ''); },
      contains: name => this.className.split(/\s+/).includes(name)
    };
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(x => x.textContent).join(''); }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(key, callback) { this.handlers[key] = callback; }
  focus() { this.focused = true; }
  querySelector(selector) {
    if (!selector.startsWith('#')) return null;
    const wanted = selector.slice(1);
    return flatten(this).find(node => node.id === wanted) || null;
  }
}
function flatten(node) {
  const seen = [node];
  for (let i=0; i<seen.length; i++) seen.push(...seen[i].children);
  return seen;
}
function setupCards() {
  const elements = Object.fromEntries(
    ['vocabularyCards','vocabulary','vocabularyWrapper']
      .map(id => [id,new MockElement()])
  );
  const events = {};
  const window = {addEventListener: (name, callback) => { events[name] = callback; }};
  const document = {
    getElementById: id => elements[id],
    createElement: tag => new MockElement(tag)
  };
  vm.runInNewContext(publicFile('translation-vocab.js'), {
    document, window, setTimeout: () => 1
  });
  return { elements, events, render:window.renderTranslationVocabulary };
}

test('compact details render three groups with only three preview items each', () => {
  const {elements,render} = setupCards();
  const items = Array.from({length:6},(_,i) => ({
    key:'word'+i,type:'word',text:'词'+i,meaning:'nghĩa '+i,
    category:'work',encounterCount:i+1,isNew:i===0
  }));
  items.push({key:'phrase1',type:'phrase',text:'下班以后',meaning:'Sau khi tan làm',
    category:'daily_life',encounterCount:3,isNew:false});
  render(items,'','zh');
  const root = elements.vocabularyCards;
  const nodes = flatten(root);
  assert.equal(nodes.filter(n => n.className === 'translation-vocab-section').length,3);
  assert.equal(nodes.filter(n => n.className === 'translation-vocab-card').length,4);
  assert.equal(nodes.filter(n => n.className === 'translation-vocab-more').length,1);
  assert.equal(nodes.filter(n => n.className.includes('translation-vocab-note')).length,0);
  assert.match(root.textContent,/Mới/);
  assert.match(root.textContent,/Đã có/);
  assert.match(root.textContent,/3 lần gặp/);
});

test('expand and collapse leave the remaining details accessible', () => {
  const {elements,render} = setupCards();
  const entries=Array.from({length:5},(_,i) => ({
    key:'term'+i,type:'word',meaning:'nghĩa',category:'work',
    encounterCount:2,text:'词'+i,isNew:false
  }));
  render(entries,'','zh');
  const root=elements.vocabularyCards;
  let button=root.querySelector('#translation-vocab-more-word');
  assert.equal(button.attributes['aria-expanded'],'false');
  button.handlers.click();
  assert.equal(flatten(root).filter(n=>n.className==='translation-vocab-card').length,5);
  button=root.querySelector('#translation-vocab-more-word');
  assert.equal(button.attributes['aria-expanded'],'true');
  button.handlers.click();
  assert.equal(flatten(root).filter(n=>n.className==='translation-vocab-card').length,3);
  render([],'','zh');
  assert.equal(root.hidden,true);
});

test('text and translation panes grow on long input and shrink when cleared', () => {
  class Element {
    constructor(width=500) {
      this.width=width;this.value='';this.textContent='';this.hidden=false;
      this.handlers={};this.classList={contains:()=>false};
      this.style={values:{},setProperty(key,value){this.values[key]=value;}};
    }
    getBoundingClientRect(){return{width:this.width};}
    getClientRects(){return [{}];}
    addEventListener(event,fn){this.handlers[event]=fn;}
  }
  const input=new Element(),output=new Element(),result=new Element();
  const workspace=new Element(1030);
  output.textContent='Bản dịch';
  const mirror={
    style:{},textContent:'',setAttribute(){},
    get scrollHeight(){
      const width=Number.parseFloat(this.style.width)||500;
      return Math.ceil(this.textContent.length / Math.max(1,Math.floor(width/10)))*27+24;
    }
  };
  const elements={text:input,translation:output,translationResult:result};
  const document={
    getElementById:id=>elements[id]||null,
    querySelector:query=>query==='.translation-workspace'?workspace:null,
    createElement:()=>mirror,body:{appendChild(){}}
  };
  const listeners={},frames=[];
  const window={
    addEventListener:(name,fn)=>{listeners[name]=fn;},
    requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},
    getComputedStyle:()=>({
      display:'block',padding:'14px 16px',fontFamily:'Arial',
      fontSize:'19px',fontWeight:'400',fontStyle:'normal',
      letterSpacing:'normal',lineHeight:'27px',textTransform:'none'
    })
  };
  class Observer { observe(){} }
  vm.runInNewContext(publicFile('compact-layout.js'),{
    document,window,MutationObserver:Observer,ResizeObserver:Observer
  });
  function flush(){
    let safety=0;
    while(frames.length && safety++<10)frames.shift()();
  }
  flush();
  const getHeight=()=>parseInt(workspace.style.values['--compact-pane-height'],10);
  const first=getHeight();
  input.value='这是一段很长的中文'.repeat(60);
  input.handlers.input();flush();
  const grown=getHeight();
  input.value='你好';input.handlers.input();flush();
  const shrunk=getHeight();
  output.textContent='Bản dịch dài hơn bình thường. '.repeat(70);
  listeners.resize();flush();
  const grownByTranslation=getHeight();
  assert.equal(first,172);
  assert.ok(grown>first && grown<=660);
  assert.equal(shrunk,172);
  assert.ok(grownByTranslation>shrunk && grownByTranslation<=660);
});
