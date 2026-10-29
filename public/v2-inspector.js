// Optional V2-only API payload inspector. No data is logged, cached in browser,
// or rendered as HTML: every provider-returned string uses textContent.
(() => {
  const panel=document.getElementById('v2InspectPanel');
  const notice=document.getElementById('v2InspectNotice');
  const stagesRoot=document.getElementById('v2InspectStages');
  const rerun=document.getElementById('v2InspectRerun');
  if(!panel||!notice||!stagesRoot||!rerun)return;
  const el=(tag,className,text,parent)=>{
    const node=document.createElement(tag);
    if(className)node.className=className;
    if(text!==undefined)node.textContent=String(text);
    if(parent)parent.appendChild(node);
    return node;
  };
  function pretty(raw){
    if(typeof raw!=='string')return '';
    try{return JSON.stringify(JSON.parse(raw),null,2);}
    catch(_){return raw;}
  }
  function field(parent,title,value){
    const box=el('div','v2-inspect-field',undefined,parent);
    const header=el('div','v2-inspect-field-header',undefined,box);
    el('strong','',title,header);
    const copy=el('button','v2-inspect-copy','Sao chép',header);
    copy.type='button';
    copy.addEventListener('click',async()=>{
      try{
        await navigator.clipboard.writeText(value);
        copy.textContent='Đã sao chép';
      }catch(_){copy.textContent='Không thể sao chép';}
    });
    const pre=el('pre','v2-inspect-code',value,box);
    pre.setAttribute('tabindex','0');
  }
  function render(data=null){
    stagesRoot.replaceChildren();
    panel.hidden=!data;
    rerun.hidden=true;
    if(!data)return;
    const hit=data.cacheHit===true;
    notice.textContent=String(data.notice||'');
    if(hit){
      rerun.hidden=false;
      return;
    }
    const list=Array.isArray(data.stages)?data.stages:[];
    if(!list.length){
      notice.textContent='Không có dữ liệu trao đổi AI của lượt này.';
      return;
    }
    for(const item of list){
      const details=el('details','v2-inspect-stage',undefined,stagesRoot);
      details.open=true;
      const name=item.role==='analyzer'?'Claude · Phân tích':
        item.role==='analyzer-retry'?'Claude · Phân tích lại':
        item.role==='translator'?'GPT · Dịch':
        item.role==='repair'?'GPT · Sửa lỗi':
        item.role==='verification'?'GPT · Kiểm chứng':
        String(item.role||'Gọi AI');
      const usage=item.usage||{};
      const input=Number(usage.input)||0,output=Number(usage.output)||0;
      const ms=Number.isFinite(item.ms)?' · '+(item.ms/1000).toFixed(2)+' giây':'';
      el('summary','',name+' · '+String(item.model||item.provider||'')+
        ' · '+input+' in / '+output+' out'+ms,details);
      const content=el('div','v2-inspect-body',undefined,details);
      field(content,'1. System prompt gửi tới AI',String(item.system||''));
      field(content,'2. Nội dung gửi tới AI',pretty(item.input));
      field(content,'3. Phản hồi do AI trả về',pretty(item.rawOutput));
    }
  }
  rerun.addEventListener('click',()=>{
    // Explicit action: running the paid request is never triggered by an effect.
    window.requestV2LiveTrace?.();
  });
  window.renderV2Inspection=render;
})();
