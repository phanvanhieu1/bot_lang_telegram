'use strict';
// Conservative, zero-token routing: only explicit safe everyday messages.
// Complex workplace, names, numbers, finance and ambiguous semantics stay
// on the configured full-quality translator. Disabled by default.
const BLOCKED=/(?:[\dＡ-ＺA-Z]|[%％$¥￥]|账|帳|款|单|單|订单|订單|交易|转账|转帳|支付|充值|提现|提現|退款|余额|餘額|会员|會員|投注|审核|審核|刷子|码|碼|批准|如果|要是|否则|否則|除非|因为|因為|但是|不过|不過|没有|沒有|不是|不能|不可以|不要|别|別|未|已经|已經|如果|若|才|直到|系统|系統|API|数据库|資料庫)/iu;
function isLowRiskEveryday({sourceText,context,frame,glossary,
  protectedNames,direction,backTranslation,learningVocabulary}={}){
  if(!['auto','friend'].includes(context)||frame?.domain!=='daily')return false;
  const text=String(sourceText||'').trim();
  if(!text||Array.from(text).length>24||BLOCKED.test(text))return false;
  if((text.match(/[。！？!?，,；;：:]/g)||[]).length>1)return false;
  if(!frame?.intent||!Array.isArray(frame.facts)||frame.facts.length>2)return false;
  if((frame.ambiguities||[]).length||(frame.entities||[]).length||
    (frame.names||[]).length)return false;
  if((glossary||[]).length||(protectedNames||[]).length)return false;
  if(direction?.source!=='zh'||direction?.target!=='vi')return false;
  if(backTranslation||learningVocabulary)return false;
  return true;
}
function chooseTranslatorTier(options,{tieredRouting=false,simpleOpenaiModel}={}){
  return tieredRouting&&simpleOpenaiModel&&isLowRiskEveryday(options)
    ?{tier:'simple',modelOverride:simpleOpenaiModel}
    :{tier:'standard',modelOverride:null};
}
module.exports={isLowRiskEveryday,chooseTranslatorTier};
