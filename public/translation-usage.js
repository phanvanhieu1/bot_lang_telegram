/* Per-click usage ledger for V1 FREE, V1 PRO and V2.
   The rows reflect only THIS request, never historical cache-miss usage. */
(() => {
  const panel=document.getElementById('requestUsagePanel');
  if(!panel)return;
  const tbody=document.getElementById('requestUsageRows');
  const state=document.getElementById('requestUsageState');
  const note=document.getElementById('requestUsageNote');
  const num=new Intl.NumberFormat('vi-VN',{maximumFractionDigits:0});
  function token(x){return typeof x==='number'&&Number.isFinite(x)&&x>=0?num.format(x):'—';}
  function usd(x){
    if(typeof x!=='number'||!Number.isFinite(x)||x<0)return '—';
    if(x===0)return '$0';
    return '$'+x.toFixed(x<0.001?7:5).replace(/0+$/,'').replace(/\.$/,'');
  }
  function cell(tr,value){
    const td=document.createElement('td');
    td.textContent=value;tr.appendChild(td);return td;
  }
  window.renderRequestUsage=(summary)=>{
    tbody.replaceChildren();
    if(!summary||typeof summary!=='object'){panel.hidden=true;return;}
    panel.hidden=false;
    const hit=summary.cached===true;
    state.textContent=hit?'CACHE HIT':'CACHE MISS · gọi API';
    const stages=hit?[]:Array.isArray(summary.stages)?summary.stages:[];
    if(hit){
      const tr=document.createElement('tr');
      cell(tr,'Bản dịch từ cache');cell(tr,'0');cell(tr,'0');cell(tr,'$0');
      tbody.appendChild(tr);
    }else if(stages.length){
      for(const stage of stages){
        const tr=document.createElement('tr');
        const provider=String(stage.provider||'AI');
        const name=String(stage.model||provider);
        cell(tr,provider+' · '+name+(stage.role?' ('+stage.role+')':''));
        cell(tr,token(stage.inputTokens));
        cell(tr,token(stage.outputTokens));
        cell(tr,usd(stage.estimatedKnownPaidUsd));
        tbody.appendChild(tr);
      }
    }else{
      const tr=document.createElement('tr');
      cell(tr,'Không có chi tiết từ nhà cung cấp');
      cell(tr,token(summary.inputTokens));
      cell(tr,token(summary.outputTokens));
      cell(tr,usd(summary.estimatedCostUsd));
      tbody.appendChild(tr);
    }
    const total=document.createElement('tr');
    total.className='request-usage-total';
    cell(total,'Tổng lượt này');
    cell(total,token(summary.inputTokens));
    cell(total,token(summary.outputTokens));
    cell(total,usd(summary.estimatedCostUsd));
    tbody.appendChild(total);
    note.textContent=hit
      ?'Lượt này không gọi AI dịch; 0 token và $0 chi phí API mới. Chi phí của lần tạo cache không tính lại.'
      :summary.pricingIncomplete||summary.estimatedCostUsd===null
        ?'Token là số nhà cung cấp trả về (nếu có). Giá chưa đủ dữ liệu để tính chính xác; dấu — không có nghĩa là miễn phí.'
        :'USD là chi phí ước tính theo bảng giá cấu hình, không phải hóa đơn cuối cùng. Chỉ tính các API đã gọi ở lượt này.';
  };
})();
