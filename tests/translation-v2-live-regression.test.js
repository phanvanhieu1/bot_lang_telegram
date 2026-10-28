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
// Replay of owner-supplied G03-G08 paid-provider outputs, without billable calls.
// These fixtures test term priority and semantic guardrails, not new model quality.
const liveFixtureCases=require('../benchmarks/v2-glossary-fixtures.json').cases;
const liveSnapshots=[
  {id:'G03',domain:'work',expectedTerms:['刷子'],
    translation:'Mấy hội viên này có phải là đường dây bào khuyến mãi không? Đối chiếu bản ghi hoạt động trước đã.'},
  {id:'G04',domain:'daily',expectedTerms:[],
    translation:'Đây có phải là bàn chải không?'},
  {id:'G05',domain:'it',expectedTerms:[],
    translation:'API trả về 403, không phải 401.'},
  {id:'G06',domain:'work',expectedTerms:['这笔出款'],
    translation:'Tạm thời đừng xử lý khoản chi tiền này.'},
  {id:'G07',domain:'it',expectedTerms:['刷子'],
    translation:'Gửi cho tôi log của module Brush.'},
  {id:'G08',domain:'work',expectedTerms:['刷子'],
    translation:'Đây có phải là đường dây bào khuyến mãi không?'}
];
test('G03-G08 paid responses replay with matching context and terminology',async()=>{
  for(const snapshot of liveSnapshots){
    const c=liveFixtureCases.find(x=>x.id===snapshot.id);
    assert.ok(c,snapshot.id);
    const approvals=c.dictionary.map((t,index)=>({
      ...t,_id:String(index+1).padStart(24,'0'),
      status:'approved',sourceLang:'zh',targetLang:'vi',priority:100,version:1
    }));
    const calls=[];
    const providers={
      claude:async()=>{
        calls.push('claude');
        return {text:JSON.stringify({domain:snapshot.domain,
          intent:'Replay bản phân tích đã kiểm tra',tone:'neutral',
          facts:[],terms:[],ambiguities:[]}),
          model:'claude-replay',usage:{input:1,output:1}};
      },
      openai:async()=>{
        calls.push('openai');
        return {text:JSON.stringify({translation:snapshot.translation,
          semanticReviewRequired:false,uncertainties:[]}),
          model:'openai-replay',usage:{input:1,output:1}};
      }
    };
    const result=await deepTranslate({text:c.source,context:c.context,
      loadGlossary:(source,opts)=>Promise.resolve(resolveTerms(source,approvals,opts))
    },providers);
    assert.equal(result.status,'PASS',snapshot.id+': '+JSON.stringify(result.issues));
    assert.deepEqual(result.issues,[],snapshot.id);
    assert.equal(result.analysis.resolvedDomain,snapshot.domain,snapshot.id);
    assert.deepEqual(result.appliedTerms.map(t=>t.source),snapshot.expectedTerms,snapshot.id);
    assert.deepEqual(calls,['claude','openai'],snapshot.id);
  }
});

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

test('G01 real failure: Claude says daily but explicit colleague and confirmed DB term win',async()=>{
  const calls=[];
  const providers={
    claude:async()=>({text:JSON.stringify({
      domain:'daily',
      intent:'Nhờ đồng nghiệp xem đây có phải là 刷子 không.',
      tone:'colleague',facts:[],
      terms:[{source:'刷子',meaning:'bàn chải'}],ambiguities:[]
    }),model:'claude-sonnet-5-5',usage:{input:546,output:586}}),
    openai:async(_system,input)=>{
      calls.push(JSON.parse(input));
      return {text:JSON.stringify({
        translation:'Xem giúp mình với, đây có phải là đường dây bào khuyến mãi không?',
        semanticReviewRequired:false,uncertainties:[]
      }),model:'gpt-6.1-sol',usage:{input:455,output:93}};
    }
  };
  const result=await deepTranslate({text:'帮忙看下，这是刷子吗？',context:'colleague',
    loadGlossary:(source,opts)=>Promise.resolve(resolveTerms(source,[term],opts))
  },providers);
  assert.equal(result.status,'PASS');
  assert.equal(result.analysis.domain,'daily','Preserve what Claude actually said for diagnosis');
  assert.equal(result.analysis.resolvedDomain,'work','Confirmed glossary work domain wins');
  assert.equal(result.appliedTerms[0].source,'刷子');
  assert.equal(calls.length,1);
  assert.equal(calls[0].analysis.domain,'work');
  assert.deepEqual(calls[0].analysis.terms,[],
    'Do not let unapproved brush guess compete with confirmed DB terminology');
  assert.equal(calls[0].approvedTerminology[0].meaning,'đường dây bào khuyến mãi');
});

// C01-C05 owner-supplied paid-provider snapshots from unseen holdout.
// Replaying outputs verifies integration and domain telemetry only;
// it does NOT convert historical text into a deterministic quality score.
const holdoutCases=require('../benchmarks/v2-holdout.json').cases;
const holdoutSnapshots=[
  {id:'C01',analysisDomain:'work',resolvedDomain:'work',
    translation:'Khi duyệt yêu cầu rút tiền, nếu phát hiện cùng một hội viên gửi nhiều yêu cầu trong thời gian ngắn, hãy đối chiếu lịch sử trước, xác nhận xong rồi mới xử lý.'},
  {id:'C02',analysisDomain:'work',resolvedDomain:'work',
    // Original paid result is semantically correct but contains awkward tense stacking.
    translation:'Đừng thao tác lại khoản chi vừa rồi, bên tài chính đã đang theo dõi xử lý rồi.'},
  {id:'C03',analysisDomain:'mixed',resolvedDomain:'mixed',
    translation:'Tối nay, mục thể thao sẽ được bảo trì, cổng đặt cược tạm thời đóng, các trò chơi khác không bị ảnh hưởng.'},
  {id:'C04',analysisDomain:'work',resolvedDomain:'work',
    translation:'Đối chiếu xong danh sách người trúng thưởng thì gửi cho tôi một bản nhé. Không gấp, trước sáng mai là được.'},
  {id:'C05',analysisDomain:'it',resolvedDomain:'it',
    translation:'Hội viên này đã nạp tiền thành công nhưng số dư vẫn chưa được ghi có. Kiểm tra xem có phải do callback bị chậm không.'}
];
test('C01-C05 original paid outputs replay safely with resolved domains',async()=>{
  for(const snapshot of holdoutSnapshots){
    const fixture=holdoutCases.find(x=>x.id===snapshot.id);
    assert.ok(fixture,snapshot.id);
    const calls=[];
    const result=await deepTranslate({text:fixture.source,context:'auto',
      loadGlossary:async()=>[]},{
      claude:async()=>{
        calls.push('claude');
        return {text:JSON.stringify({
          domain:snapshot.analysisDomain,intent:'replay',tone:'neutral',
          facts:[],terms:[],ambiguities:[]}),
          model:'claude-replay',usage:{input:1,output:1}};
      },
      openai:async()=>{
        calls.push('openai');
        return {text:JSON.stringify({translation:snapshot.translation,
          semanticReviewRequired:false,uncertainties:[]}),
          model:'openai-replay',usage:{input:1,output:1}};
      }
    });
    assert.equal(result.status,'PASS',snapshot.id+': '+result.issues.join(';'));
    assert.equal(result.analysis.resolvedDomain,snapshot.resolvedDomain,snapshot.id);
    assert.deepEqual(calls,['claude','openai'],snapshot.id);
  }
});
