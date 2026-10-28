'use strict';
const express=require('express');
const {requireAuth}=require('../../modules/users/user.middleware');
const Glossary=require('./model');
const router=express.Router();
router.use(requireAuth);
router.use((req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
const domains=new Set(['work','it','daily','any']);
function valid(payload) {
  if(!payload||typeof payload!=='object')return null;
  const source=String(payload.source||'').trim();
  const translation=String(payload.translation||'').trim();
  const notes=String(payload.notes||'').trim();
  const domain=payload.domain||'work';
  const sourceLang=payload.sourceLang||'zh',targetLang=payload.targetLang||'vi';
  const bidirectional=payload.bidirectional===true;
  if(payload.bidirectional!==undefined&&typeof payload.bidirectional!=='boolean')return null;
  if(!source||source.length>100||!translation||translation.length>240||
    notes.length>350||!domains.has(domain)||
    !(['zh','vi'].includes(sourceLang)&&['zh','vi'].includes(targetLang))||
    sourceLang===targetLang)return null;
  return {source,translation,notes,domain,sourceLang,targetLang,bidirectional,status:'approved'};
}
router.get('/',async(req,res)=>{
  try{
    const items=await Glossary.find({owner:req.user._id}).sort({updatedAt:-1}).limit(250).lean();
    res.json({success:true,items:items.map(x=>({
      id:String(x._id),source:x.source,translation:x.translation,
      domain:x.domain,sourceLang:x.sourceLang,targetLang:x.targetLang,
      bidirectional:x.bidirectional===true,
      notes:x.notes||'',version:x.version
    }))});
  }catch(_){res.status(503).json({success:false,message:'Không thể tải thuật ngữ'});}
});
router.post('/',async(req,res)=>{
  const data=valid(req.body);
  if(!data)return res.status(400).json({success:false,message:'Thuật ngữ không hợp lệ'});
  try{
    const doc=await Glossary.create({owner:req.user._id,...data});
    return res.status(201).json({success:true,item:{id:String(doc._id),...data}});
  }catch(e){
    if(e.code===11000)return res.status(409).json({success:false,message:'Thuật ngữ đã tồn tại trong lĩnh vực này'});
    return res.status(503).json({success:false,message:'Không lưu được thuật ngữ'});
  }
});
router.patch('/:id',async(req,res)=>{
  if(!/^[a-f0-9]{24}$/i.test(req.params.id))return res.sendStatus(400);
  const data=valid(req.body);
  if(!data)return res.status(400).json({success:false,message:'Thuật ngữ không hợp lệ'});
  try{
    const doc=await Glossary.findOneAndUpdate({_id:req.params.id,owner:req.user._id},
      {$set:data,$inc:{version:1}},{new:true,runValidators:true});
    if(!doc)return res.sendStatus(404);
    return res.json({success:true,item:{id:String(doc._id),source:doc.source,
      translation:doc.translation,domain:doc.domain,
      sourceLang:doc.sourceLang,targetLang:doc.targetLang,
      bidirectional:doc.bidirectional===true,version:doc.version}});
  }catch(e){
    return res.status(e.code===11000?409:503).json({success:false,message:'Không sửa được thuật ngữ'});
  }
});
router.delete('/:id',async(req,res)=>{
  if(!/^[a-f0-9]{24}$/i.test(req.params.id))return res.sendStatus(400);
  try{
    const result=await Glossary.deleteOne({_id:req.params.id,owner:req.user._id});
    return result.deletedCount?res.json({success:true}):res.sendStatus(404);
  }catch(_){return res.status(503).json({success:false,message:'Không xóa được thuật ngữ'});}
});
module.exports=router;
