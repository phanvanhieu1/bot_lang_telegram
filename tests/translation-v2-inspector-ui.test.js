'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
class Node{
  constructor(tag='div'){
    this.tagName=tag;this.hidden=false;this.children=[];this.open=false;
    this.textContent='';this.listeners={};this.attributes={};this.checked=false;
    this.className='';
  }
  addEventListener(name,callback){this.listeners[name]=callback;}
  appendChild(node){this.children.push(node);return node;}
  replaceChildren(...items){this.children=items;}
  setAttribute(name,value){this.attributes[name]=value;}
  trigger(name,event={}){return this.listeners[name]?.(event);}
}
function setup(){
  const keys=['v2InspectPanel','v2InspectNotice','v2InspectStages',
    'v2InspectRerun','v2InspectToggle'];
  const refs=Object.fromEntries(keys.map(key=>[key,new Node(key)]));
  const window={};
  const document={
    getElementById:name=>refs[name]||null,
    createElement:name=>new Node(name)
  };
  let copied='';
  const navigator={clipboard:{writeText:async value=>{copied=value;}}};
  const js=fs.readFileSync(path.join(__dirname,'../public/v2-inspector.js'),'utf8');
  vm.runInNewContext(js,{document,window,navigator,JSON,Number});
  return {window,refs,copied:()=>copied};
}
test('visible V2 transcript includes raw prompt, formatted JSON and no executable HTML',async()=>{
  const {window,refs,copied}=setup();
  const payload=JSON.stringify({original:'你好',analysis:{domain:'daily'}});
  const returned=JSON.stringify({translation:'Xin chào'});
  window.renderV2Inspection({cacheHit:false,notice:'not internal reasoning',stages:[
    {role:'translator',provider:'openai',model:'gpt-4o',ms:20,
      usage:{input:80,output:30},system:'Translate <script>alert(1)</script>',
      input:payload,rawOutput:returned}
  ]});
  assert.equal(refs.v2InspectPanel.hidden,false);
  assert.equal(refs.v2InspectRerun.hidden,true);
  const item=refs.v2InspectStages.children[0];
  assert.equal(item.tagName,'details');
  assert.equal(item.open,true);
  assert.match(item.children[0].textContent,/GPT · Dịch/);
  const body=item.children[1], fields=body.children;
  assert.equal(fields.length,3);
  assert.equal(fields[0].children[1].textContent,'Translate <script>alert(1)</script>');
  assert.equal(fields[1].children[1].textContent,JSON.stringify(JSON.parse(payload),null,2));
  assert.equal(fields[2].children[1].textContent,JSON.stringify(JSON.parse(returned),null,2));
  await fields[2].children[0].children[1].trigger('click');
  assert.equal(copied(),JSON.stringify(JSON.parse(returned),null,2));
});
test('cache HIT shows no invented AI calls; chargeable rerun requires user click',()=>{
  const {window,refs}=setup();
  let requests=0;
  window.requestV2LiveTrace=()=>requests++;
  window.renderV2Inspection({cacheHit:true,
    notice:'Cached; run new to inspect (billable)',stages:[]});
  assert.equal(refs.v2InspectPanel.hidden,false);
  assert.equal(refs.v2InspectRerun.hidden,false);
  assert.equal(refs.v2InspectStages.children.length,0);
  assert.equal(requests,0);
  refs.v2InspectRerun.trigger('click');
  assert.equal(requests,1);
  window.renderV2Inspection(null);
  assert.equal(refs.v2InspectPanel.hidden,true);
});
test('unchecking inspector clears potentially sensitive transcript immediately',()=>{
  const {window,refs}=setup();
  window.renderV2Inspection({cacheHit:false,stages:[
    {role:'analyzer',system:'private',input:'private',rawOutput:'private'}
  ]});
  refs.v2InspectToggle.trigger('change',{target:{checked:false}});
  assert.equal(refs.v2InspectPanel.hidden,true);
  assert.equal(refs.v2InspectStages.children.length,0);
});
