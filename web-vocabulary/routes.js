const express = require('express');
const mongoose = require('mongoose');
const { requireRole } = require('../modules/users/user.middleware');
const { VocabularyEntry, VocabularyMuted } = require('./models');
const { normalize, isSafeTerm } = require('./extractor');
const { serializeEntry } = require('./resolver');

const router = express.Router();
router.use(requireRole('pro','admin'));
router.use((req,res,next)=>{ res.set('Cache-Control','private, no-store'); next(); });
router.use((req,res,next)=>{
  if (!['POST','PUT','PATCH','DELETE'].includes(req.method)) return next();
  const origin=req.get('origin'), expected=req.protocol+'://'+req.get('host');
  if ((origin && origin!==expected) ||
      (req.get('sec-fetch-site') && !['same-origin','none'].includes(req.get('sec-fetch-site')))) {
    return res.status(403).json({success:false,message:'Yêu cầu không cùng nguồn gốc'});
  }
  next();
});

router.get('/stats',async(req,res)=>{
  const language=req.query.language||'zh';
  if(!['zh','en'].includes(language)) return res.status(400).json({success:false,message:'Ngôn ngữ không hợp lệ'});
  try {
    const userId=req.user._id;
    const [totals,top]=await Promise.all([
      VocabularyEntry.aggregate([
        {$match:{userId:new mongoose.Types.ObjectId(String(userId)),language}},
        {$group:{_id:null,entries:{$sum:1},encounters:{$sum:'$encounterCount'},
          words:{$sum:{$cond:[{$eq:['$type','word']},1,0]}},
          phrases:{$sum:{$cond:[{$eq:['$type','phrase']},1,0]}},
          patterns:{$sum:{$cond:[{$eq:['$type','pattern']},1,0]}},
          pending:{$sum:{$cond:[{$eq:['$classificationSource','pending']},1,0]}}
        }}
      ]),
      VocabularyEntry.find({userId,language}).sort({encounterCount:-1,lastSeenAt:-1})
        .limit(5).select('text type meaning encounterCount category').lean()
    ]);
    res.json({success:true,stats:{
      entries:totals[0]?.entries||0,encounters:totals[0]?.encounters||0,
      words:totals[0]?.words||0,phrases:totals[0]?.phrases||0,
      patterns:totals[0]?.patterns||0,pending:totals[0]?.pending||0,
      pendingJobs:0,top
    }});
  } catch(error) {
    console.error('Vocabulary stats:',error.message);
    res.status(500).json({success:false,message:'Không thể tải thống kê'});
  }
});


// Read-only polling endpoint for already-rendered vocabulary cards.
// A lookup never creates entries, charges AI usage, or increments counters.
router.post('/lookup',async(req,res)=>{
  const {language,items}=req.body||{};
  if(!['zh','en'].includes(language) || !Array.isArray(items) ||
     !items.length || items.length>24)
    return res.status(400).json({success:false,message:'Danh sách tra cứu không hợp lệ'});
  const wanted=[];
  for(const item of items) {
    if(!item || !['word','phrase','pattern'].includes(item.type) ||
       typeof item.key!=='string') {
      return res.status(400).json({success:false,message:'Mục tra cứu không hợp lệ'});
    }
    const key=normalize(item.key,language,item.type);
    if(!isSafeTerm(key,language,item.type))
      return res.status(400).json({success:false,message:'Từ vựng không hợp lệ'});
    wanted.push({type:item.type,key});
  }
  try {
    const rows=await VocabularyEntry.find({
      userId:req.user._id,language,$or:wanted
    }).lean();
    res.json({success:true,items:rows.map(row=>serializeEntry(row))});
  } catch(error) {
    console.error('Vocabulary read-only lookup:',error.message);
    res.status(500).json({success:false,message:'Không thể tra cứu kho học tập'});
  }
});

router.get('/',async(req,res)=>{
  const language=req.query.language||'zh';
  const type=req.query.type||'all',category=req.query.category||'all';
  const sort=req.query.sort||'frequent',seen=req.query.seen||'all',page=Number(req.query.page||1);
  if(!['zh','en'].includes(language)||!['all','word','phrase','pattern'].includes(type)||
     !['all','work','daily_life','both','unclassified'].includes(category)||
     !['frequent','recent','alphabetical'].includes(sort)||!['all','new','seen'].includes(seen)||
     !Number.isInteger(page)||page<1||page>10000){
    return res.status(400).json({success:false,message:'Bộ lọc không hợp lệ'});
  }
  const q=typeof req.query.q==='string'?req.query.q.trim().slice(0,60):'';
  const filter={userId:req.user._id,language};
  if(type!=='all') filter.type=type;
  if(seen==='new') filter.encounterCount={$lte:1};
  if(seen==='seen') filter.encounterCount={$gt:1};
  if(category!=='all') filter.category= ['work','daily_life'].includes(category)
    ? {$in:[category,'both']}:category;
  if(q) {
    const escaped=q.replace(/[^a-zA-Z0-9\u00c0-\u024f\u3400-\u9fff]/g,'\\$&');
    filter.$or=[{text:{$regex:escaped,$options:'i'}},{meaning:{$regex:escaped,$options:'i'}},{pinyin:{$regex:escaped,$options:'i'}}];
  }
  const order=sort==='recent'?{lastSeenAt:-1,_id:-1}
    :sort==='alphabetical'?{text:1,_id:1}
    :{encounterCount:-1,lastSeenAt:-1,_id:-1};
  try {
    const [items,total]=await Promise.all([
      VocabularyEntry.find(filter).sort(order).skip((page-1)*30).limit(30)
        .select('text key type language meaning pinyin category classificationSource encounterCount occurrenceCount workCount dailyCount firstSeenAt lastSeenAt mastery manualOverride')
        .lean(),
      VocabularyEntry.countDocuments(filter)
    ]);
    res.json({success:true,items,total,page,pageSize:30});
  } catch(error) {
    console.error('Vocabulary list:',error.message);
    res.status(500).json({success:false,message:'Không thể tải từ điển'});
  }
});

router.patch('/:entryId',async(req,res)=>{
  if(!mongoose.isValidObjectId(req.params.entryId)) return res.status(400).json({success:false,message:'ID không hợp lệ'});
  const updates={};
  if(Object.hasOwn(req.body||{},'meaning')) {
    if(typeof req.body.meaning!=='string'||!req.body.meaning.trim()||req.body.meaning.trim().length>450)
      return res.status(400).json({success:false,message:'Nghĩa không hợp lệ'});
    updates.meaning=req.body.meaning.trim();
  }
  if(Object.hasOwn(req.body||{},'category')) {
    if(!['work','daily_life','both','unclassified'].includes(req.body.category))
      return res.status(400).json({success:false,message:'Chủ đề không hợp lệ'});
    updates.category=req.body.category;
  }
  if(Object.hasOwn(req.body||{},'mastery')) {
    if(!['new','learning','known'].includes(req.body.mastery))
      return res.status(400).json({success:false,message:'Mức độ học không hợp lệ'});
    updates.mastery=req.body.mastery;
  }
  if(!Object.keys(updates).length) return res.status(400).json({success:false,message:'Không có thay đổi'});
  if(updates.meaning||updates.category) {
    updates.manualOverride=true;
    updates.classificationSource='manual';
  }
  try {
    const item=await VocabularyEntry.findOneAndUpdate(
      {_id:req.params.entryId,userId:req.user._id},
      {$set:updates},{new:true,runValidators:true}).lean();
    if(!item) return res.status(404).json({success:false,message:'Không tìm thấy mục'});
    res.json({success:true,item});
  } catch(error) {
    console.error('Vocabulary edit:',error.message);
    res.status(500).json({success:false,message:'Không thể chỉnh sửa'});
  }
});

router.delete('/:entryId',async(req,res)=>{
  if(!mongoose.isValidObjectId(req.params.entryId)) return res.status(400).json({success:false,message:'ID không hợp lệ'});
  try {
    const item=await VocabularyEntry.findOne({_id:req.params.entryId,userId:req.user._id})
      .select('key type language').lean();
    if(!item) return res.status(404).json({success:false,message:'Không tìm thấy mục'});
    await VocabularyMuted.updateOne(
      {userId:req.user._id,language:item.language,type:item.type,key:item.key},
      {$setOnInsert:{userId:req.user._id,language:item.language,type:item.type,key:item.key}},
      {upsert:true});
    await VocabularyEntry.deleteOne({_id:item._id,userId:req.user._id});
    res.json({success:true,message:'Đã xóa mục, không tự thêm lại'});
  } catch(error) {
    console.error('Vocabulary delete:',error.message);
    res.status(500).json({success:false,message:'Không thể xóa mục'});
  }
});
module.exports=router;
