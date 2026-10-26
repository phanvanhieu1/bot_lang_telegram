'use strict';
const express = require('express');
const { requireRole } = require('../modules/users/user.middleware');
const { TelegramAccount } = require('./models');
const { issueLinkCode, unlinkWebUser } = require('./link');
const router = express.Router();

router.use(requireRole('pro','admin'));
router.use((req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
router.use((req,res,next)=>{
  if (req.method !== 'POST') return next();
  const origin = req.get('origin');
  const target = req.protocol + '://' + req.get('host');
  if ((origin && origin !== target) ||
      (req.get('sec-fetch-site') && !['same-origin','none'].includes(req.get('sec-fetch-site')))) {
    return res.status(403).json({ success: false, message: 'Yêu cầu không cùng nguồn gốc' });
  }
  next();
});

router.get('/status',async(req,res)=>{
  try {
    const linked = await TelegramAccount.findOne({ userId:req.user._id }).select('telegramId connectedAt').lean();
    return res.json({ success:true, connected:Boolean(linked),
      telegramId:linked?.telegramId || null, connectedAt:linked?.connectedAt || null });
  } catch(error) {
    console.error('Telegram link status:',error.message);
    return res.status(503).json({success:false,message:'Không thể đọc trạng thái liên kết'});
  }
});
router.post('/link-code',async(req,res)=>{
  try {
    const existing = await TelegramAccount.exists({ userId:req.user._id });
    if (existing) return res.status(409).json({success:false,message:'Hãy ngắt liên kết hiện tại trước'});
    return res.json({success:true,...(await issueLinkCode(req.user._id))});
  } catch(error) {
    console.error('Telegram link code:',error.message);
    return res.status(503).json({success:false,message:'Không thể tạo mã liên kết'});
  }
});
router.post('/unlink',async(req,res)=>{
  try {await unlinkWebUser(req.user._id);return res.json({success:true});}
  catch(error){console.error('Telegram unlink:',error.message);return res.status(503).json({success:false});}
});
module.exports=router;
