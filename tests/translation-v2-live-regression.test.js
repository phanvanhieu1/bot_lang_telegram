'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {deepTranslate}=require('../ai/v2/engine');
const {resolveTerms}=require('../ai/terminology/resolver');

// Regressions based on real paid API outputs from the 2026-10-28 smoke run.
// The samples exist in TEST CODE only: they are never injected into prompts.
const term={_id:'684000000000000000000001',source:'刷子',
  translation:'đường dây bào khuyến mãi',sourceLang:'zh',targetLang:'vi',
  status:'approved',domain:'work',priority:100};
function providerSample({domain,intent,ambiguities,translation,translationNotes=[]}){
  const calls=[];
  return {calls,
    claude:async(sys,input,meta)=>{
      calls.push({provider:'claude',maxOutputTokens:meta.maxOutputTokens,system:sys});
      return {text:JSON.stringify({domain,intent,tone:'neutral',facts:[],
        terms:[{source:'刷子',meaning:'bàn chải'}],ambiguities}),
        model:'claude-sonnet-5-5',usage:{input:349,output:280}};
    },
    openai:async(sys,input,meta)=>{
      calls.push({provider:'openai',maxOutputTokens:meta.maxOutputTokens,system:sys});
      return {text:JSON.stringify({translation,
        semanticReviewRequired:false,uncertainties:translationNotes}),
        model:'gpt-6.1-sol',usage:{input:714,output:37}};
    }
  };
}
test('G01 paid output: dictionary resolves terminology even if Claude lists harmless ambiguities',async()=>{
  const providers=providerSample({
    domain:'work',
    intent:'Nhờ đồng nghiệp xem giúp và xác nhận một vật/hình ảnh có phải là 刷子 hay không',
    ambiguities:[
      'Không rõ 这 chỉ hình ảnh hay vật nào',
      'Không rõ loại bàn chải',
      'Không rõ lĩnh vực công việc',
      'Có thể còn một nghĩa bóng'
    ],
    translation:'Xem giúp với, đây có phải là đường dây bào khuyến mãi không?'
  });
  const result=await deepTranslate({text:'帮忙看下，这是刷子吗？',context:'colleague',
    loadGlossary:(source,opts)=>Promise.resolve(resolveTerms(source,[term],opts))
  },providers);
  assert.equal(result.status,'PASS');
  assert.equal(result.issues.length,0);
  assert.equal(result.appliedTerms.length,1);
  assert.equal(result.appliedTerms[0].source,'刷子');
  assert.deepEqual(providers.calls.map(x=>x.provider),['claude','openai']);
  assert.ok(providers.calls[0].maxOutputTokens<=900,'short sentence should not allocate excessive Claude output tokens');
});
test('G02 paid output: missing brush subtype or travel time are not translation errors',async()=>{
  const providers=providerSample({
    domain:'daily',intent:'Muốn mua bàn chải ở siêu thị',
    ambiguities:['Không biết loại bàn chải','Không biết lúc nào đi','Có thể đang rủ bạn cùng đi'],
    translation:'Mình muốn đi siêu thị mua một cái bàn chải.',
    translationNotes:['Nguyên văn không nói rõ loại bàn chải hay mục đích sử dụng.']
  });
  const result=await deepTranslate({text:'我想去超市买个刷子',context:'friend',
    loadGlossary:(source,opts)=>Promise.resolve(resolveTerms(source,[term],opts))
  },providers);
  assert.equal(result.status,'PASS');
  assert.equal(result.issues.length,0);
  assert.equal(result.appliedTerms.length,0);
  assert.equal(result.translationNotes.length,1);
  assert.match(result.translation,/bàn chải/);
  assert.ok(providers.calls[0].maxOutputTokens<=900);
});
