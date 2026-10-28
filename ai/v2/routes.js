'use strict';

const express = require('express');
const { requireAuth, requireRole } = require('../../modules/users/user.middleware');
const { addUsage } = require('../../usage');
const { deepTranslate, ENGINE_VERSION } = require('./engine');
const { estimateUsage } = require('./accounting');
const {summarizeV2Usage,cachedV2Usage}=require('./request-usage');
const {lookupUserTerms}=require('../terminology/resolver');
const v2Cache=require('./cache');

function createV2Router({ translate = deepTranslate, env = process.env, cache = v2Cache, recordUsage = addUsage } = {}) {
  const router = express.Router();
  const active = new Set(); // best-effort per-process concurrency gate
  const enabled = () => env.V2_ENABLED === 'true';
  const available = () => Boolean(
    ((env.OPENAI_API_KEYS||'').trim()||env.OPENAI_API_KEY||env.OPENAI_API) &&
    (env.CLAUDE_API_KEY||env.ANTHROPIC_API_KEY||env.CLAUDE_API)
  );

  // Do not reveal whether key names/secret values are configured.
  router.get('/status',requireAuth,(req,res)=>{
    res.set('Cache-Control','private, no-store');
    return res.json({enabled:enabled() && available() &&
      ['pro','admin'].includes(req.user.role) &&
      !(req.user.role==='pro' && req.user.proExpiresAt && req.user.proExpiresAt<=new Date()),
      engine:ENGINE_VERSION});
  });

  router.post('/', requireRole('pro','admin'), async (req,res)=>{
    res.set('Cache-Control','private, no-store');
    if(!enabled() || !available()) return res.status(503).json({
      success:false,code:'V2_DISABLED',message:'Dịch chuyên sâu chưa được bật trên máy chủ.'
    });
    const {text,context='auto',targetLang='zh'}=req.body || {};
    if(targetLang!=='zh' || typeof text!=='string'||!text.trim()||
       text.length>2000 || !['auto','friend','colleague','superior'].includes(context)){
      return res.status(400).json({success:false,code:'V2_INVALID_INPUT',
        message:'V2 hiện hỗ trợ Trung–Việt, tối đa 2.000 ký tự.'});
    }
    const id=String(req.user._id);
    if(active.has(id)) return res.status(429).json({
      success:false,code:'V2_ALREADY_RUNNING',message:'Một lượt dịch chuyên sâu đang xử lý.'
    });
    active.add(id);
    try {
      // Fail closed if the glossary cannot be read: a stale cache must never
      // bypass the owner's currently confirmed terminology.
      const signature=await cache.signatureForOwner(req.user._id);
      const key=cache.keyForRequest({owner:id,text,context,signature,env});
      let hit=null;
      try{hit=await cache.getCached({owner:req.user._id,key});}
      catch(_){console.warn('[V2] cache read unavailable');}
      if(hit){
        const translated=hit.value;
        const usage={stages:[],totalInputTokens:0,totalOutputTokens:0,
          providers:[],estimatedKnownPaidUsd:0,pricingIncomplete:false};
        return res.json({
          success:true,engine:ENGINE_VERSION,
          result:'TRANSLATION: '+translated.translation,
          ...translated,usage,cached:true,
          requestUsage:cachedV2Usage(translated.originalUsage||null)
        });
      }
      const translated=await translate({text:text.trim(),context,
        loadGlossary:(source,opts)=>lookupUserTerms(req.user._id,source,opts)});
      const estimate=estimateUsage(translated.usage);
      const requestUsage=summarizeV2Usage(translated.usage,estimate);
      // Re-read owner glossary to prevent storing a response that raced with
      // an edit/delete during the expensive LLM calls.
      if(translated.status==='PASS'){
        try{
          const current=await cache.signatureForOwner(req.user._id);
          if(current===signature){
            await cache.storeCached({owner:req.user._id,key,value:{
              translation:translated.translation,status:translated.status,
              needsReview:translated.needsReview,issues:translated.issues,
              analysis:translated.analysis,translationNotes:translated.translationNotes||[],
              appliedTerms:translated.appliedTerms||[],
              sourceLanguage:translated.sourceLanguage,
              targetLanguage:translated.targetLanguage,
              originalUsage:requestUsage
            }});
          }
        }catch(_){console.warn('[V2] cache write unavailable');}
      }
      // Keep existing user stats; estimated cost only covers known paid
      // models. Incomplete estimation is always marked for the client.
      try{
        await recordUsage({userId:req.user._id,
          totalTokens:translated.usage.totalInputTokens+translated.usage.totalOutputTokens,
          cost:estimate.estimatedKnownPaidUsd});
      }catch(_){
        // Translation is still useful if usage DB write fails.
        console.error('V2 usage write failed');
      }
      return res.json({
        success:true,engine:ENGINE_VERSION,
        result:'TRANSLATION: '+translated.translation,
        translation:translated.translation,
        status:translated.status,needsReview:translated.needsReview,
        issues:translated.issues,analysis:translated.analysis,
        translationNotes:translated.translationNotes||[],
        appliedTerms:translated.appliedTerms||[],
        sourceLanguage:translated.sourceLanguage,
        targetLanguage:translated.targetLanguage,
        usage:{...translated.usage,...estimate}, cached:false,
        requestUsage
      });
    }catch(error){
      const code=String(error?.code||'V2_UNAVAILABLE');
      console.warn('[V2] translation unavailable:',code);
      const status=code==='V2_INVALID_INPUT'?400:
        code.includes('REQUIRES_')||code.includes('AUDIT_UNAVAILABLE')?503:502;
      return res.status(status).json({success:false,code,
        message:'Dịch chuyên sâu chưa hoàn thành; chưa có kết quả được kiểm định. Vui lòng thử lại.'});
    }finally{active.delete(id);}
  });
  return router;
}
module.exports={createV2Router};
