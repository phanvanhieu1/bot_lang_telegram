'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

class Node {
  constructor(tag='div') {
    this.tagName=tag;
    this.hidden=false;
    this.children=[];
    this.textContent='';
    this.className='';
  }
  appendChild(node){this.children.push(node);return node;}
  replaceChildren(...nodes){this.children=[...nodes];}
}
function setup(){
  const names=['requestUsagePanel','requestUsageRows','requestUsageState',
    'requestUsageNote','translationCostSnapshot','cacheOriginPanel','cacheOriginRows'];
  const refs=Object.fromEntries(names.map(name=>[name,new Node(name)]));
  const document={
    getElementById:id=>refs[id]||null,
    createElement:tag=>new Node(tag)
  };
  const window={};
  const src=fs.readFileSync(path.join(__dirname,'../public/translation-usage.js'),'utf8');
  vm.runInNewContext(src,{window,document,Intl});
  return {refs,render:window.renderRequestUsage};
}
function stage(provider,model,input,output,cost){
  return {provider,model,role:'translator',inputTokens:input,
    outputTokens:output,estimatedKnownPaidUsd:cost};
}
test('V2 first call displays detailed token/USD and summary next to buttons',()=>{
  const {refs,render}=setup();
  const one={cached:false,inputTokens:600,outputTokens:500,totalTokens:1100,
    estimatedCostUsd:0.0082,pricingIncomplete:false,stages:[
      stage('claude','claude-sonnet-5-5',300,400,0.0046),
      stage('openai','gpt-6.1-sol',300,100,0.0036)
    ]};
  render(one,'v2');
  assert.equal(refs.requestUsagePanel.hidden,false);
  assert.equal(refs.translationCostSnapshot.hidden,false);
  assert.match(refs.translationCostSnapshot.textContent,/Dịch V2 · CACHE MISS/);
  assert.match(refs.translationCostSnapshot.textContent,/\$0\.0082/);
  assert.equal(refs.cacheOriginPanel.hidden,true);
  assert.equal(refs.requestUsageRows.children.length,3);
  assert.equal(refs.requestUsageRows.children[0].children[0].textContent,
    'claude · claude-sonnet-5-5 (translator)');
  assert.equal(refs.requestUsageRows.children[1].children[0].textContent,
    'openai · gpt-6.1-sol (translator)');
});
test('V2 cache hit shows zero new spend and historical creation cost separately',()=>{
  const {refs,render}=setup();
  const original={cached:false,inputTokens:620,outputTokens:340,totalTokens:960,
    estimatedCostUsd:0.0075,pricingIncomplete:false,
    stages:[stage('claude','sonnet',200,220,0.004),
      stage('openai','sol',420,120,0.0035)]};
  render({cached:true,inputTokens:0,outputTokens:0,totalTokens:0,
    estimatedCostUsd:0,originalUsage:original},'v2');
  assert.match(refs.translationCostSnapshot.textContent,
    /Dịch V2 · CACHE HIT · 0 token mới · Lượt này \$0 · Lần tạo cache \$0\.0075/);
  assert.equal(refs.requestUsageRows.children.length,2);
  assert.equal(refs.requestUsageRows.children[1].children[3].textContent,'$0');
  assert.equal(refs.cacheOriginPanel.hidden,false);
  assert.equal(refs.cacheOriginRows.children.length,3);
  assert.equal(refs.cacheOriginRows.children[2].children[3].textContent,'$0.0075');
});
test('Legacy cache does not fabricate historical price, FREE missing tariff is unknown',()=>{
  const {refs,render}=setup();
  render({cached:true,inputTokens:0,outputTokens:0,totalTokens:0,
    estimatedCostUsd:0,originalUsage:null},'v2');
  assert.equal(refs.cacheOriginPanel.hidden,true);
  assert.match(refs.requestUsageNote.textContent,/chưa ghi chi phí ban đầu/);
  render({cached:false,inputTokens:120,outputTokens:60,totalTokens:180,
    estimatedCostUsd:null,pricingIncomplete:true,
    stages:[stage('groq','groq-free',120,60,null)]},'v1');
  assert.match(refs.translationCostSnapshot.textContent,/Dịch V1/);
  assert.match(refs.translationCostSnapshot.textContent,/Lượt này —/);
  assert.equal(refs.requestUsageRows.children[0].children[3].textContent,'—');
  render(null,'v2');
  assert.equal(refs.translationCostSnapshot.hidden,true);
  assert.equal(refs.requestUsagePanel.hidden,true);
});
test('V2 action is named Dịch V2, and both translation handlers send usage to UI',()=>{
  const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
  const html=read('public/index.html');
  const app=read('public/app.js');
  assert.match(html,/aria-label="Dịch V2">Dịch V2<\/button>/);
  assert.match(html,/id="translationCostSnapshot"/);
  assert.match(html,/id="cacheOriginRows"/);
  assert.match(app,/renderRequestUsage\?\.\(data\.requestUsage\|\|null,'v1'\)/);
  assert.match(app,/renderRequestUsage\?\.\(data\.requestUsage\|\|null,'v2'\)/);
});
