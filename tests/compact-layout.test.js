// Offline UI regression guards for the compact translator layout.
// Run as part of: node --test tests/*.test.js
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=filename=>fs.readFileSync(path.resolve(__dirname,'../public',filename),'utf8');

test('compact CSS is loaded after legacy translator styles',()=>{
  const html=read('index.html');
  const order=[
    '/style.css','/translator.css','/google-style.css',
    '/translation-vocab.css','/compact-layout.css'
  ].map(file=>{
    const bare=html.indexOf('href="'+file+'"');
    return bare>=0?bare:html.indexOf('href="'+file+'?');
  });
  assert.ok(order.every(index=>index>=0), 'All stylesheets are present');
  assert.deepEqual(order,[...order].sort((a,b)=>a-b),
    'Compact style must come last to override hardcoded pane heights');
});

test('practice entry is a floating accessible button connected to the existing modal',()=>{
  const html=read('index.html');
  const css=read('compact-layout.css');
  assert.match(html,/id="practiceLauncher"[\s\S]{0,450}id="openPracticeBtn"/);
  assert.match(html,/id="openPracticeBtn"[^>]+aria-haspopup="dialog"/);
  assert.match(html,/id="openPracticeBtn"[^>]+aria-controls="practiceModal"/);
  assert.match(html,/id="practiceLauncherTitle"/);
  assert.match(css,/#practiceLauncher"\s*\{|#practiceLauncher\s*\{/);
  assert.match(css,/position:fixed!important/);
  assert.match(css,/#openPracticeBtn svg/);
  assert.doesNotMatch(html,/Mở luyện tập ↗/);
});

test('translation panels share one content-driven height with reasonable limits',()=>{
  const css=read('compact-layout.css');
  const js=read('compact-layout.js');
  assert.match(css,/--compact-pane-height:\s*190px/);
  assert.match(css,/height:var\(--compact-pane-height\)!important/);
  assert.match(js,/MIN_PANE_HEIGHT\s*=\s*172/);
  assert.match(js,/MAX_PANE_HEIGHT\s*=\s*660/);
  assert.match(js,/input\.addEventListener\('input',\s*schedule\)/);
  assert.match(js,/new MutationObserver\(schedule\)/);
  assert.match(js,/window\.requestAnimationFrame\(calculate\)/);
  assert.match(js,/getComputedStyle/);
  assert.match(js,/mirror\.scrollHeight/);
});

test('translation details have no nested heavy panels and are grouped compactly',()=>{
  const css=read('compact-layout.css');
  const script=read('translation-vocab.js');
  const html=read('index.html');
  assert.match(css,/\.translation-details\s*\{[\s\S]*?border:0!important/);
  assert.match(css,/\.translation-vocab-cards\s*\{[\s\S]*?repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(script,/PREVIEW_LIMIT=3/);
  assert.match(script,/['"]Xem thêm \(/);
  assert.match(script,/expandedTypes=new Set\(\)/);
  assert.match(script,/for\(const type of \['word','phrase','pattern'\]\)/);
  assert.doesNotMatch(script,/Màu viền theo tần suất gặp/);
  assert.doesNotMatch(html,/Từ vựng · Kiểm tra bản dịch/);
});

test('the full library and grammar classifier remain independent from visual resizing',()=>{
  const js=read('compact-layout.js');
  assert.doesNotMatch(js,/fetch\(|\/api\//);
  assert.doesNotMatch(js,/localStorage|mongoose|VocabularyEntry/);
  assert.match(read('translation-vocab.js'),/\/api\/vocabulary\/lookup/);
  assert.match(read('index.html'),/<script src="\/app\.js(?:\?[^"]*)?"><\/script>/);
  assert.match(read('index.html'),/<script src="\/compact-layout\.js"><\/script>/);
});


test('dynamic pane heights grow, cap, and shrink with text; launcher label follows language',()=>{
  const vm=require('node:vm');
  const callbacks=new Map();
  const subscribe=(id,type,fn)=>{
    const key=id+':'+type;
    if(!callbacks.has(key))callbacks.set(key,[]);
    callbacks.get(key).push(fn);
  };
  const element=id=>({
    id,hidden:false,value:'',textContent:'',scrollHeight:24,
    classList:{contains:()=>false},style:{},
    setAttribute(name,value){this[name]=value;},
    getBoundingClientRect:()=>({width:500}),
    getClientRects:()=>[1],
    addEventListener(type,fn){subscribe(id,type,fn);},
    querySelector:()=>null
  });
  const ids={
    text:element('text'),translation:element('translation'),
    translationResult:element('translationResult'),
    realtimePinyin:element('realtimePinyin'),
    backTranslationWrapper:element('backTranslationWrapper'),
    pronunciationWrapper:element('pronunciationWrapper'),
    practiceLauncherTitle:element('practiceLauncherTitle'),
    openPracticeBtn:element('openPracticeBtn')
  };
  ids.practiceLauncherTitle.textContent='Luyện tiếng Trung';
  const workspace=element('workspace');
  workspace.style.setProperty=(_name,value)=>{workspace.paneHeight=parseInt(value,10);};
  const mirror={
    style:{},textContent:'',setAttribute(){},
    get scrollHeight(){
      const width=parseInt(this.style.width||'500',10);
      const perLine=Math.max(10,Math.floor(width/18));
      const rows=this.textContent.split('\n').reduce(
        (sum,line)=>sum+Math.max(1,Math.ceil(line.length/perLine)),0);
      return Math.ceil(rows*27+24);
    }
  };
  const document={
    querySelector:()=>workspace,
    getElementById:id=>ids[id],
    createElement:()=>mirror,
    body:{appendChild(){}}
  };
  const frames=[];
  const window={
    getComputedStyle:()=>({
      padding:'15px',fontFamily:'Arial',fontSize:'19px',fontWeight:'400',
      fontStyle:'normal',letterSpacing:'normal',lineHeight:'27px',
      textTransform:'none',display:'block'
    }),
    requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},
    addEventListener:(type,fn)=>subscribe('window',type,fn)
  };
  class MutationObserver{observe(){}}
  class ResizeObserver{observe(){}}
  vm.runInNewContext(read('compact-layout.js'),{window,document,MutationObserver,ResizeObserver});
  const flush=()=>{
    for(let i=0;i<30&&frames.length;i++)frames.shift()();
    assert.equal(frames.length,0);
  };
  const trigger=(id,type)=>{
    for(const fn of callbacks.get(id+':'+type)||[])fn();
    flush();
  };
  flush();
  assert.equal(workspace.paneHeight,172);
  ids.text.value='Một câu ngắn';
  trigger('text','input');
  const short=workspace.paneHeight;
  ids.text.value='Đây là một đoạn văn dài để kiểm tra chiều cao. '.repeat(120);
  trigger('text','input');
  assert.ok(workspace.paneHeight>short);
  assert.equal(workspace.paneHeight,660);
  ids.text.value='Xin chào';
  trigger('text','input');
  assert.equal(workspace.paneHeight,172);
  ids.practiceLauncherTitle.textContent='Luyện tiếng Anh';
  trigger('window','learning-language-change');
  assert.equal(ids.openPracticeBtn['aria-label'],'Mở luyện tiếng anh');
});
