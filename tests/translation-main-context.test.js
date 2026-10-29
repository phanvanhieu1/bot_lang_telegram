'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {contextPolicy,normalizeContext}=require('../ai/prompts/context-policy');
const {buildProPrompt}=require('../ai/prompts/pro.prompt');
const {buildFreePrompt}=require('../ai/prompts/free.prompt');
const {deepTranslate}=require('../ai/v2/engine');
const {resolveTerms}=require('../ai/terminology/resolver');

const source=path.relative(process.cwd(),__dirname);
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
test('main translation toolbar owns one visible context and one Dịch button',()=>{
  const html=read('public/index.html'),app=read('public/app.js');
  assert.equal((html.match(/id="contextSelect"/g)||[]).length,1);
  assert.match(html,/<div class="translation-main-controls"/);
  assert.ok(html.indexOf('id="contextSelect"')>html.indexOf('class="translation-main-controls"'));
  assert.ok(html.indexOf('id="contextSelect"')<html.indexOf('class="translation-workspace"'));
  assert.equal((html.match(/id="translateBtn"/g)||[]).length,1);
  assert.doesNotMatch(html,/id="translateV2Btn"/);
  assert.match(html,/id="translationEnginePicker"/);
  assert.match(app,/if\(selectedEngine\(\)==='v2'\)return translateV2\(\)/);
  assert.match(app,/localStorage\.setItem\('translationEngine',radio\.value\)/);
  assert.match(app,/const eligible=v2Eligible\(\)/);
  assert.match(app,/translateBtn\.addEventListener\('click', translate\)/);
  assert.match(app,/context: contextSelect\.value/);
  assert.match(app,/context:contextSelect\.value/);
});
test('both engines explicitly honor selected listener; auto alone infers',()=>{
  assert.equal(normalizeContext('unsupported'),'auto');
  const colleague=contextPolicy('colleague');
  assert.match(colleague,/ĐỒNG NGHIỆP/);
  assert.match(colleague,/KHÔNG tự suy đoán hoặc đổi quan hệ/);
  assert.match(contextPolicy('friend'),/BẠN BÈ/);
  assert.match(contextPolicy('superior'),/CẤP TRÊN/);
  assert.match(contextPolicy('auto'),/Chỉ trong chế độ này/);
  for(const context of ['colleague','friend','superior','auto']){
    const msg=contextPolicy(context);
    assert.ok(buildProPrompt('你好','zh',false,{context}).includes(msg));
    assert.ok(buildProPrompt('你好','zh',true,{context}).includes(msg));
    assert.ok(buildProPrompt('你好','zh',false,{
      context,existingTranslation:'Xin chào',vocabulary:true
    }).includes(msg));
    assert.ok(buildFreePrompt('你好',context).includes(msg));
    assert.ok(buildFreePrompt('Tôi đang làm việc',context).includes(msg));
  }
  assert.match(read('ai/services/free.service.js'),/buildFreePrompt\(text,context\)/);
  assert.match(read('server.js'),/context:\['auto','friend','colleague','superior'\]\.includes\(freeContext\)/);
});
test('V2 Claude and GPT share forced manual context and trace actual choices',async()=>{
  const stages=[];
  const providers={
    claude:async(system,input)=>{
      stages.push({role:'claude',system,input:JSON.parse(input)});
      return {model:'haiku',text:JSON.stringify({
        domain:'daily',intent:'kiểm tra tên nền tảng',tone:'neutral',
        facts:[],terms:[{source:'澎湃',meaning:'dâng trào'}],ambiguities:[]
      }),usage:{input:20,output:15}};
    },
    openai:async(system,input)=>{
      stages.push({role:'gpt',system,input:JSON.parse(input)});
      return {model:'gpt-4o',text:JSON.stringify({
        translation:'Cái này có phải của bên PP không? Chỉ giúp tôi với.',
        semanticReviewRequired:false,uncertainties:[]
      }),usage:{input:90,output:35}};
    }
  };
  const approved=[{_id:'684000000000000000000001',
    source:'澎湃',translation:'PP',domain:'work',status:'approved',
    sourceLang:'zh',targetLang:'vi',priority:100}];
  const result=await deepTranslate({text:'是不是澎湃的，教我一下',
    context:'colleague',
    loadGlossary:async(text,opts)=>resolveTerms(text,approved,opts)},providers);
  assert.equal(result.status,'PASS');
  assert.equal(result.analysis.domain,'daily'); // preserve raw Claude diagnostics
  assert.equal(result.analysis.resolvedDomain,'work'); // user choice overrides Claude guess
  assert.equal(stages[0].input.context,'colleague');
  assert.match(stages[0].system,/NGỮ CẢNH DO NGƯỜI DÙNG CHỌN THỦ CÔNG/);
  assert.match(stages[1].system,/NGƯỜI NGHE: ĐỒNG NGHIỆP/);
  assert.equal(stages[1].input.analysis.domain,'work');
  assert.deepEqual(stages[1].input.analysis.terms,[]);
  assert.equal(stages[1].input.approvedTerminology[0].meaning,'PP');
  assert.equal(result.appliedTerms[0].source,'澎湃');
});
test('FREE Chinese cache and old auto output are isolated from manually chosen context',()=>{
  const cache=read('web-cache.js');
  assert.match(cache,/free-context-2/);
  assert.match(cache,/hashKey\(\['free-context-2', normalizedText, String\(context\)\]\)/);
  assert.match(read('ai/services/free.service.js'),/getFreeCachedTranslation\(text,context\)/);
  assert.match(read('ai/services/free.service.js'),/context!=='auto'/);
  const english=read('web-english.js');
  assert.match(english,/contextPolicy\(options.context\|\|'auto'\)/);
  assert.match(english,/prompt\(text, \{ vocabulary: false,context \}\)/);
  assert.match(english,/getFreeCachedText\(text, 'en',context\)/);
  assert.match(read('server.js'),/translateEnglishFree\(text.trim\(\),\{context:freeContext\}\)/);
  assert.match(cache,/pro-context-2/);
});
