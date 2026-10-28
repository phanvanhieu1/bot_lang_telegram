'use strict';
const mongoose=require('mongoose');
const schema=new mongoose.Schema({
  owner:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true,index:true},
  source:{type:String,required:true,trim:true,maxlength:100},
  translation:{type:String,required:true,trim:true,maxlength:240},
  sourceLang:{type:String,enum:['zh','vi'],default:'zh'},
  targetLang:{type:String,enum:['vi','zh'],default:'vi'},
  domain:{type:String,enum:['work','it','daily','any'],default:'work'},
  // Opt-in: an explicitly confirmed pair may also be used in reverse.
  // Existing glossary records remain one-way by default.
  bidirectional:{type:Boolean,default:false},
  priority:{type:Number,default:100,min:1,max:100},
  status:{type:String,enum:['approved'],default:'approved'},
  notes:{type:String,default:'',maxlength:350},
  version:{type:Number,default:1,min:1}
},{timestamps:true,versionKey:false});
schema.index({owner:1,sourceLang:1,targetLang:1,status:1});
schema.index({owner:1,sourceLang:1,targetLang:1,source:1,domain:1},{unique:true});
module.exports=mongoose.models.TermGlossary||mongoose.model('TermGlossary',schema,'translation_terminology');
