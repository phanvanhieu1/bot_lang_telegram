'use strict';

const express=require('express');
const {requireAuth,requireRole}=require('../../modules/users/user.middleware');
const {addUsage}=require('../../usage');
const {addHistory}=require('../../history');
const {verifyTranslation}=require('../services/verification.service');
const {deepTranslate,ENGINE_VERSION}=require('./engine');
const {estimateUsage}=require('./accounting');
const {summarizeV2Usage,cachedV2Usage}=require('./request-usage');
const {pronounceChinese,formatV1Details,verificationUsage}=require('./details');
const {lookupUserTerms}=require('../terminology/resolver');
const {resolveTranslationVocabulary}=require('../../web-vocabulary/resolver');
const {toStudyVocabulary}=require('./vocabulary');
const v2Cache=require('./cache');

function createV2Router({translate=deepTranslate,env=process.env,cache=v2Cache,
  recordUsage=addUsage,resolveVocabulary=resolveTranslationVocabulary,
  verify=verifyTranslation,recordHistory=addHistory}={}){
  const router=express.Router(),active=new Set();
  const enabled=()=>env.V2_ENABLED === 'true';
  const available=()=>Boolean(
    ((env.OPENAI_API_KEYS||'').trim()||env.OPENAI_API_KEY||env.OPENAI_API)&&
    (env.CLAUDE_API_KEY||env.ANTHROPIC_API_KEY||env.CLAUDE_API)
  );

  async function studyDetails(userId,source,translated,enabled){
    if(!enabled)return {vocabularyItems:[],vocabularyError:null,vocabulary:''};
    const chineseText=translated.sourceLanguage==='zh'?source:translated.translation;
    // Chinese source: Claude word/phrase/pattern hypotheses.
    // Vietnamese source: GPT-4o outputs Chinese learning items in its single
    // normal translation call, exactly as V1 does.
    const vocabulary=translated.sourceLanguage==='zh'
      ? toStudyVocabulary(translated.analysisTerms||[],chineseText,'zh',
          translated.analysisPatterns||[])
      : String(translated.studyVocabulary||'').slice(0,3500);
    if(!vocabulary)return {vocabularyItems:[],vocabularyError:null,vocabulary:''};
    try{
      const items=await resolveVocabulary({userId,language:'zh',
        foreignText:chineseText,vocabulary});
      return {vocabularyItems:items,vocabularyError:null,vocabulary};
    }catch(_){
      console.warn('[V2] vocabulary resolution unavailable');
      return {vocabularyItems:[],vocabularyError:'Kho từ vựng đang tạm thời không khả dụng',vocabulary};
    }
  }

  router.get('/status',requireAuth,(req,res)=>{
    res.set('Cache-Control','private, no-store');
    return res.json({enabled:enabled()&&available()&&
      ['pro','admin'].includes(req.user.role)&&
      !(req.user.role==='pro'&&req.user.proExpiresAt&&req.user.proExpiresAt<=new Date()),
      engine:ENGINE_VERSION});
  });

  router.post('/',requireRole('pro','admin'),async(req,res)=>{
    res.set('Cache-Control','private, no-store');
    if(!enabled()||!available())return res.status(503).json({
      success:false,code:'V2_DISABLED',message:'Dịch V2 chưa được bật trên máy chủ.'
    });
    const {text,context='auto',targetLang='zh',vocabulary=true,
      backTranslation=true,pronunciation=true,verification=false}=req.body||{};
    if(targetLang!=='zh'||typeof text!=='string'||!text.trim()||text.length>2000||
       [vocabulary,backTranslation,pronunciation,verification]
         .some(flag=>typeof flag!=='boolean')||
       !['auto','friend','colleague','superior'].includes(context)){
      return res.status(400).json({success:false,code:'V2_INVALID_INPUT',
        message:'V2 hiện hỗ trợ Trung–Việt, tối đa 2.000 ký tự.'});
    }
    const owner=req.user._id,id=String(owner),original=text.trim();
    if(active.has(id))return res.status(429).json({
      success:false,code:'V2_ALREADY_RUNNING',message:'Một lượt dịch V2 đang xử lý.'
    });
    const startedAt=Date.now();active.add(id);
    try{
      // Cache read cannot bypass the user's current approved glossary.
      const signature=await cache.signatureForOwner(owner);
      const key=cache.keyForRequest({owner:id,text:original,context,signature,env,
        backTranslation,vocabulary});
      let hit=null;
      try{hit=await cache.getCached({owner,key});}
      catch(_){console.warn('[V2] cache read unavailable');}

      const translationCached=Boolean(hit);
      const translated=hit?hit.value:await translate({text:original,context,
        backTranslation,vocabulary,
        loadGlossary:(source,opts)=>lookupUserTerms(req.user._id,source,opts)});

      // Miss: preserve only validated PASS content in owner-isolated cache.
      const estimate=translationCached?null:estimateUsage(translated.usage);
      const usage=translationCached
        ?cachedV2Usage(translated.originalUsage||null)
        :summarizeV2Usage(translated.usage,estimate);
      const responseUsage=translationCached
        ?{stages:[],totalInputTokens:0,totalOutputTokens:0,providers:[]}
        :{...translated.usage,...estimate};

      let verified=translated.verification||null;
      let verificationError=null;
      if(verification&&!verified){
        // Same independent verifier as V1, but only when its checkbox is ON.
        // This optional check is a THIRD paid call, never hidden as free.
        const start=Date.now();
        try{
          const checked=await verify(original,translated.translation,context);
          const value=checked?.verification||{};
          if(!['PASS','WARNING','FAIL'].includes(value.status))throw Error('Invalid verification');
          verified={translation:translated.translation,
            status:value.status,
            confidence:Number.isFinite(Number(value.confidence))
              ?Math.max(0,Math.min(100,Math.round(Number(value.confidence)))):null,
            issues:Array.isArray(value.issues)?value.issues.slice(0,8).map(x=>String(x).slice(0,240)):[],
            message:String(value.message||'').slice(0,600)};
          const checkUsage=verificationUsage(checked);
          checkUsage.stages[0].ms=Date.now()-start;
          usage.cached=false; // a new billable API call took place
          usage.translationCached=translationCached;
          usage.inputTokens+=checkUsage.inputTokens;
          usage.outputTokens+=checkUsage.outputTokens;
          usage.totalTokens+=checkUsage.totalTokens;
          usage.estimatedCostUsd=Number(((usage.estimatedCostUsd||0)+
            checkUsage.estimatedCostUsd).toFixed(7));
          usage.stages.push(...checkUsage.stages);
          responseUsage.stages.push({role:'verification',provider:'openai',model:'gpt-4o',
            ms:checkUsage.stages[0].ms,
            usage:{input:checkUsage.inputTokens,output:checkUsage.outputTokens}});
          responseUsage.totalInputTokens=(responseUsage.totalInputTokens||0)+checkUsage.inputTokens;
          responseUsage.totalOutputTokens=(responseUsage.totalOutputTokens||0)+checkUsage.outputTokens;
        }catch(_){
          console.warn('[V2] optional verification unavailable');
          verificationError='Chưa thể kiểm chứng độc lập bản dịch V2.';
        }
      }
      // Preserve the original bill in the cache, not the optional verifier cost.
      const cachedValue={
        translation:translated.translation,status:translated.status,
        needsReview:translated.needsReview,issues:translated.issues,
        analysis:translated.analysis,analysisTerms:translated.analysisTerms||[],
        analysisPatterns:translated.analysisPatterns||[],
        translationNotes:translated.translationNotes||[],
        appliedTerms:translated.appliedTerms||[],
        backTranslation:translated.backTranslation||'',
        studyVocabulary:translated.studyVocabulary||'',
        verification:verified,
        sourceLanguage:translated.sourceLanguage,targetLanguage:translated.targetLanguage,
        originalUsage:translated.originalUsage||(translationCached?null:
          summarizeV2Usage(translated.usage,estimate))
      };
      if(translated.status==='PASS'&&(!translationCached||verified&&!hit.value.verification)){
        try{
          const current=await cache.signatureForOwner(owner);
          if(current===signature)await cache.storeCached({owner,key,value:cachedValue});
        }catch(_){console.warn('[V2] cache write unavailable');}
      }

      const details=await studyDetails(owner,original,translated,vocabulary);
      const spoken=pronounceChinese(original,translated.translation,pronunciation);
      const back=backTranslation&&translated.sourceLanguage==='vi'
        ?translated.backTranslation||'':'';
      const result=formatV1Details({
        translation:translated.translation,backTranslation:back,
        pronunciation:spoken,vocabulary:details.vocabulary,
        verification:verification?verified:null
      });
      try{
        await recordHistory({userId:owner,text:original,targetLang,
          learningLang:'zh',result});
      }catch(_){console.warn('[V2] translation history unavailable');}

      if(usage.totalTokens>0){
        try{await recordUsage({userId:owner,totalTokens:usage.totalTokens,
          cost:usage.estimatedCostUsd});}
        catch(_){console.error('V2 usage write failed');}
      }
      usage.elapsedMs=Date.now()-startedAt;
      return res.json({
        success:true,engine:ENGINE_VERSION,result,
        translation:translated.translation,backTranslation:back,
        pronunciation:spoken,verification:verification?verified:null,
        verificationError,
        ...details,
        status:translated.status,needsReview:translated.needsReview,
        issues:translated.issues||[],analysis:translated.analysis,
        analysisTerms:translated.analysisTerms||[],
        translationNotes:translated.translationNotes||[],
        appliedTerms:translated.appliedTerms||[],
        sourceLanguage:translated.sourceLanguage,targetLanguage:translated.targetLanguage,
        cached:translationCached,usage:responseUsage,requestUsage:usage
      });
    }catch(error){
      const code=String(error?.code||'V2_UNAVAILABLE');
      console.warn('[V2] translation unavailable:',code);
      const status=code==='V2_INVALID_INPUT'?400:
        code.includes('REQUIRES_')||code.includes('AUDIT_UNAVAILABLE')?503:502;
      return res.status(status).json({success:false,code,
        message:'Dịch V2 chưa hoàn thành; vui lòng thử lại.'});
    }finally{active.delete(id);}
  });
  return router;
}
module.exports={createV2Router};
