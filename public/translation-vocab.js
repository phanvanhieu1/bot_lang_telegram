// Render authoritative MongoDB cards, never untrusted AI text as HTML.
(() => {
  const root=document.getElementById('vocabularyCards');
  const raw=document.getElementById('vocabulary');
  const wrapper=document.getElementById('vocabularyWrapper');
  if(!root||!raw||!wrapper)return;

  const typeNames={word:'Từ vựng',phrase:'Cụm từ',pattern:'Mẫu câu'};
  const topicNames={
    work:'Công việc',daily_life:'Đời sống',
    both:'Cả hai',unclassified:'Chưa phân loại'
  };
  let version=0, activeRefresh=null;
  function node(parent,tag,className,text) {
    const item=document.createElement(tag);
    if(className)item.className=className;
    if(text!==undefined)item.textContent=String(text);
    parent.appendChild(item);
    return item;
  }
  function level(count) {
    if(count>=30)return 'very-frequent';
    if(count>=10)return 'frequent';
    if(count>=3)return 'light';
    return 'fresh';
  }
  function createCard(parent,item) {
    const card=node(parent,'article','translation-vocab-card');
    const count=Math.max(0,Number(item.encounterCount)||0);
    card.dataset.level=level(count);
    const header=node(card,'div','translation-vocab-card-top');
    const status=node(header,'span','translation-vocab-status'+(item.isNew?' is-new':''),
      item.isNew?'Mới':'Đã có');
    status.title=item.isNew?'Mục vừa được thêm vào từ điển':'Mục đã tồn tại trong từ điển';
    node(header,'span','translation-vocab-count',count+' lần gặp');
    node(card,'div','translation-vocab-term',item.text || item.key);
    if(item.pinyin)node(card,'div','translation-vocab-pinyin',item.pinyin);
    node(card,'div','translation-vocab-meaning',item.meaning||'Chưa có nghĩa');
    const pending=item.category==='unclassified';
    node(card,'div','translation-vocab-topic'+(pending?' is-pending':''),
      'Chủ đề: '+(topicNames[item.category]||topicNames.unclassified)+
      (pending?' · Đang phân loại':''));
  }
  function paint(items,message) {
    root.replaceChildren();
    const all=Array.isArray(items)?items:[];
    if(!all.length&&!message) {
      root.hidden=true;
      raw.hidden=true;
      wrapper.classList.add('hidden');
      return;
    }
    raw.hidden=true;
    root.hidden=false;
    wrapper.classList.remove('hidden');
    if(message)node(root,'div','translation-vocab-error',message);
    for(const type of ['word','phrase','pattern']) {
      const values=all.filter(item=>item.type===type);
      if(!values.length)continue;
      const section=node(root,'section','translation-vocab-section');
      const heading=node(section,'div','translation-vocab-section-heading');
      node(heading,'span','',typeNames[type]);
      node(heading,'small','',values.length+' mục');
      const grid=node(section,'div','translation-vocab-grid');
      values.forEach(item=>createCard(grid,item));
    }
    if(all.length)node(root,'p','translation-vocab-note',
      'Màu viền theo tần suất gặp: xanh lá 1–2 · xanh dương 3–9 · vàng 10–29 · tím 30+.');
  }

  function render(items,error='',language='zh') {
    version++;
    activeRefresh=null;
    const currentVersion=version;
    if(!Array.isArray(items)) {
      root.replaceChildren();root.hidden=true;raw.hidden=false;
      return; // compatibility with a legacy server response
    }
    let current=items.map(item=>({...item}));
    paint(current,error);
    if(!current.length)return;
    // AI2 runs independently after the translation; refresh category ONLY.
    // This endpoint never records additional encounters.
    const refresh=async()=>{
      if(currentVersion!==version||!current.length)return;
      try {
        const res=await fetch('/api/vocabulary/lookup',{
          method:'POST',credentials:'same-origin',cache:'no-store',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({
            language,items:current.map(item=>({key:item.key,type:item.type}))
          })
        });
        if(!res.ok)return;
        const data=await res.json();
        if(currentVersion!==version||!data.success||!Array.isArray(data.items))return;
        const map=new Map(data.items.map(item=>[item.type+':'+item.key,item]));
        current=current.filter(item=>map.has(item.type+':'+item.key))
          .map(item=>{
            const updated=map.get(item.type+':'+item.key);
            return {...item,...updated,isNew:item.isNew};
          });
        paint(current,error);
      }catch(_){}
    };
    activeRefresh=refresh;
    if(current.some(item=>item.category==='unclassified')&&!error){
      setTimeout(()=>void refresh(),18000);
      setTimeout(()=>void refresh(),45000);
    }
  }
  // Edit/delete in the study library refreshes the currently visible cards.
  window.addEventListener('vocabulary-library-updated',()=>{
    if(activeRefresh)void activeRefresh();
  });
  window.renderTranslationVocabulary=render;
})();
