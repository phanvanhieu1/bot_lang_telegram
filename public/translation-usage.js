/* Per-click billing for V1 and V2; keep cached-origin charges separate. */
(() => {
  const byId=id=>document.getElementById(id);
  const panel=byId('requestUsagePanel');
  if(!panel)return;
  const tbody=byId('requestUsageRows'),state=byId('requestUsageState');
  const note=byId('requestUsageNote');
  const headline=byId('translationCostSnapshot');
  const originPanel=byId('cacheOriginPanel'),originRows=byId('cacheOriginRows');
  const num=new Intl.NumberFormat('vi-VN',{maximumFractionDigits:0});
  const known=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
  function token(x){return known(x)?num.format(x):'—';}
  function usd(x){
    if(!known(x))return '—';
    if(x===0)return '$0';
    return '$'+x.toFixed(x<0.001?7:5).replace(/0+$/,'').replace(/\.$/,'');
  }
  function cell(tr,value){
    const td=document.createElement('td');
    td.textContent=value;
    tr.appendChild(td);
  }
  function rows(tbody,summary,hit){
    tbody.replaceChildren();
    const stages=hit?[]:Array.isArray(summary.stages)?summary.stages:[];
    if(hit){
      const tr=document.createElement('tr');
      cell(tr,'Từ cache (không gọi AI)');cell(tr,'0');cell(tr,'0');cell(tr,'$0');
      tbody.appendChild(tr);
    }else if(stages.length){
      for(const stage of stages){
        const tr=document.createElement('tr');
        const provider=String(stage.provider||'AI');
        cell(tr,provider+' · '+String(stage.model||provider)+(stage.role?' ('+stage.role+')':''));
        cell(tr,token(stage.inputTokens));
        cell(tr,token(stage.outputTokens));
        cell(tr,usd(stage.estimatedKnownPaidUsd));
        tbody.appendChild(tr);
      }
    }else{
      const tr=document.createElement('tr');
      cell(tr,'Tổng hợp từ API');
      cell(tr,token(summary.inputTokens));
      cell(tr,token(summary.outputTokens));
      cell(tr,usd(summary.estimatedCostUsd));
      tbody.appendChild(tr);
    }
    const total=document.createElement('tr');
    total.className='request-usage-total';
    cell(total,'Tổng');cell(total,token(summary.inputTokens));
    cell(total,token(summary.outputTokens));
    cell(total,usd(summary.estimatedCostUsd));
    tbody.appendChild(total);
  }
  window.renderRequestUsage=(summary,engine='v1')=>{
    if(!summary||typeof summary!=='object'){
      panel.hidden=true;
      headline.hidden=true;
      if(originPanel)originPanel.hidden=true;
      tbody.replaceChildren();
      return;
    }
    const hit=summary.cached===true;
    const previous=hit&&summary.originalUsage&&typeof summary.originalUsage==='object'
      ?summary.originalUsage:null;
    const label=engine==='v2'?'Dịch V2':'Dịch V1';
    panel.hidden=false;
    headline.hidden=false;
    state.textContent=hit?'CACHE HIT':'CACHE MISS · gọi API';
    rows(tbody,summary,hit);
    headline.textContent=label+' · '+(hit?'CACHE HIT':'CACHE MISS')+
      ' · '+token(summary.totalTokens)+' token mới · Lượt này '+usd(summary.estimatedCostUsd)+
      (previous?' · Lần tạo cache '+usd(previous.estimatedCostUsd):'');
    if(originPanel&&originRows){
      originPanel.hidden=!previous;
      if(previous)rows(originRows,previous,false);
      else originRows.replaceChildren();
    }
    note.textContent=hit
      ?previous
        ?'Lượt này không gọi API dịch. Bảng thứ hai ghi token và chi phí ước tính của lần tạo cache trước đây, không tính lại vào lượt này.'
        :'Lượt này không gọi API dịch. Cache được lưu từ phiên bản chưa ghi chi phí ban đầu, nên không thể truy xuất chính xác khoản đã trả trước đó.'
      :summary.pricingIncomplete||!known(summary.estimatedCostUsd)
        ?'Token là số nhà cung cấp trả về (nếu có). Giá chưa đủ dữ liệu để tính chính xác; dấu — không có nghĩa là miễn phí.'
        :'USD là chi phí ước tính theo đơn giá cấu hình, không phải hóa đơn cuối cùng. Chỉ tính API được gọi trong lượt này.';
  };
})();
