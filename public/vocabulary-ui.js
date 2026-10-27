// Personal study library. All permissions and user scoping are enforced on the server.
(() => {
  const el = id => document.getElementById(id);
  const openBtn=el('vocabOpenBtn'), dialog=el('vocabDialog'), closeBtn=el('vocabCloseBtn');
  const status=el('vocabStatus'), list=el('vocabItems');
  const category=el('vocabCategory'), type=el('vocabType'), sort=el('vocabSort'), seen=el('vocabSeen');
  const search=el('vocabSearch'), prev=el('vocabPrevious'), next=el('vocabNext');
  const pageLabel=el('vocabPage');
  let page=1,total=0,loading=false,requestVersion=0,lastFocus=null;
  let searchTimer=null;

  const labels = {
    word:'Từ vựng',phrase:'Cụm từ',pattern:'Mẫu câu',
    work:'Công việc',daily_life:'Đời sống',both:'Cả hai',
    unclassified:'Chưa phân loại',
    new:'Mới',learning:'Đang học',known:'Đã thuộc'
  };
  function canOpen() {
    return ['pro','admin'].includes(window.translatorAccess?.role);
  }
  function currentLanguage() {
    return window.languageUI?.get?.() === 'en' ? 'en' : 'zh';
  }
  function setStatus(message='',error=false) {
    status.textContent=message;
    status.classList.toggle('vocab-error',error);
  }
  async function api(path,options={}) {
    const response=await fetch('/api/vocabulary'+path,{
      credentials:'same-origin',cache:'no-store',
      ...options,
      headers:{ ...(options.body?{'Content-Type':'application/json'}:{}), ...options.headers }
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok||!data.success) {
      if(response.status===403||response.status===401) {
        if(!canOpen()) close();
      }
      throw new Error(data.message||'Không thể tải dữ liệu');
    }
    return data;
  }
  function close() {
    dialog.hidden=true;
    openBtn.setAttribute('aria-expanded','false');
    document.body.style.removeProperty('overflow');
    requestVersion++;
    lastFocus?.focus?.();
  }
  async function open() {
    if(!canOpen()) return;
    lastFocus=document.activeElement;
    dialog.hidden=false;
    openBtn.setAttribute('aria-expanded','true');
    document.body.style.overflow='hidden';
    closeBtn.focus();
    page=1;
    setStatus('Đang tải kho từ vựng...');
    await refresh();
  }
  openBtn.addEventListener('click',()=>{if(dialog.hidden)void open();else close();});
  closeBtn.addEventListener('click',close);
  dialog.addEventListener('click',event=>{if(event.target===dialog)close();});
  document.addEventListener('keydown',event=>{
    if(dialog.hidden)return;
    if(event.key==='Escape')close();
    // Keep focus inside this dialog (prevent background interaction).
    if(event.key==='Tab') {
      const targets=[...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)')]
        .filter(node=>node.offsetParent!==null);
      if(!targets.length)return;
      if(event.shiftKey&&document.activeElement===targets[0]) {
        event.preventDefault();targets[targets.length-1].focus();
      } else if(!event.shiftKey&&document.activeElement===targets[targets.length-1]) {
        event.preventDefault();targets[0].focus();
      }
    }
  });

  function updateRole() {
    openBtn.hidden=!canOpen();
    if(!canOpen()&&!dialog.hidden)close();
  }
  window.addEventListener('translator-access-change',updateRole);
  updateRole();
  window.addEventListener('learning-language-change',()=>{
    if(!dialog.hidden){page=1;void refresh();}
  });

  function box(parent,tag,className,textValue) {
    const node=document.createElement(tag);
    if(className)node.className=className;
    if(textValue!==undefined)node.textContent=String(textValue);
    parent.appendChild(node);
    return node;
  }
  function selector(values,value) {
    const select=document.createElement('select');
    for(const [id,name] of values) {
      const option=document.createElement('option');
      option.value=id;option.textContent=name;
      select.appendChild(option);
    }
    select.value=value;
    return select;
  }
  async function modify(entry,changes) {
    try {
      const data=await api('/'+encodeURIComponent(entry._id),{
        method:'PATCH',body:JSON.stringify(changes)
      });
      setStatus('Đã cập nhật: '+data.item.text);
      window.dispatchEvent(new Event('vocabulary-library-updated'));
      await refresh();
    } catch(error) {setStatus(error.message,true);}
  }
  function renderItem(entry) {
    const card=box(list,'article','vocab-entry'+
      (entry.classificationSource==='pending'?' vocab-pending':''));
    const head=box(card,'div','vocab-entry-top');
    const left=box(head,'div','');
    box(left,'div','vocab-entry-word',entry.text);
    if(entry.pinyin)box(left,'div','vocab-entry-pinyin',entry.pinyin);
    const badges=box(head,'div','vocab-entry-badges');
    box(badges,'span','vocab-entry-badge',labels[entry.type]||entry.type);
    // First encounter vs previously encountered is separate from mastery
    // ('Mới' in the mastery dropdown means not yet learned).
    box(badges,'span','vocab-entry-badge '+
      (Number(entry.encounterCount||0)<=1?'vocab-first':'vocab-seen'),
      Number(entry.encounterCount||0)<=1?'Mới gặp':'Đã gặp trước đây');
    box(card,'div','vocab-entry-meaning',
      entry.meaning || 'Chưa xác định được nghĩa · có thể chỉnh sửa thủ công');
    box(card,'div','vocab-entry-detail',
      (labels[entry.category]||'Chưa phân loại')+
      ' · '+Number(entry.encounterCount||0)+' lượt gặp'+
      ' · '+Number(entry.occurrenceCount||0)+' lần xuất hiện'+
      (entry.classificationSource==='pending'?' · Chờ phân tích':'' ));
    const actions=box(card,'div','vocab-entry-actions');
    const cat=selector([
      ['work','Công việc'],['daily_life','Đời sống'],
      ['both','Cả hai'],['unclassified','Chưa phân loại']
    ],entry.category);
    cat.setAttribute('aria-label','Chủ đề của '+entry.text);
    cat.addEventListener('change',()=>void modify(entry,{category:cat.value}));
    actions.appendChild(cat);
    const mastery=selector([
      ['new','Mới'],['learning','Đang học'],['known','Đã thuộc']
    ],entry.mastery);
    mastery.setAttribute('aria-label','Mức độ học của '+entry.text);
    mastery.addEventListener('change',()=>void modify(entry,{mastery:mastery.value}));
    actions.appendChild(mastery);
    const edit=box(actions,'button','','Sửa nghĩa');
    edit.type='button';
    edit.addEventListener('click',()=>{
      const answer=window.prompt('Nghĩa tiếng Việt của '+entry.text,entry.meaning||'');
      if(answer!==null&&answer.trim()&&answer.trim()!==entry.meaning)void modify(entry,{meaning:answer.trim()});
    });
    const remove=box(actions,'button','vocab-remove','Xóa');
    remove.type='button';
    remove.addEventListener('click',async()=>{
      if(!window.confirm('Xóa "'+entry.text+'"? Từ này sẽ không tự động được thêm lại.'))return;
      remove.disabled=true;
      try {
        await api('/'+encodeURIComponent(entry._id),{method:'DELETE'});
        setStatus('Đã xóa '+entry.text);
        window.dispatchEvent(new Event('vocabulary-library-updated'));
        await refresh();
      } catch(error) {setStatus(error.message,true);remove.disabled=false;}
    });
  }
  async function refreshStats() {
    if(dialog.hidden)return;
    try {
      const query='?language='+currentLanguage();
      const data=await api('/stats'+query);
      el('vocabTotal').textContent=data.stats.entries;
      el('vocabEncounters').textContent=data.stats.encounters;
      el('vocabPending').textContent=data.stats.pending+data.stats.pendingJobs;
    } catch(error) {setStatus(error.message,true);}
  }
  async function refresh() {
    if(dialog.hidden)return;
    const version=++requestVersion;
    if(loading) {
      // We allow newer requests; stale responses are ignored by requestVersion.
    }
    loading=true;
    setStatus('Đang tải...');
    const query=new URLSearchParams({
      language:currentLanguage(),category:category.value,type:type.value,
      sort:sort.value,seen:seen.value,page:String(page),q:search.value.trim()
    });
    try {
      const [data]=await Promise.all([api('?'+query.toString()),refreshStats()]);
      if(version!==requestVersion||dialog.hidden)return;
      list.replaceChildren();
      total=data.total;
      data.items.forEach(renderItem);
      if(!data.items.length)box(list,'p','vocab-notice',
        'Chưa có mục phù hợp. Bật Từ vựng trong Cài đặt PRO và thực hiện dịch để lưu.');
      prev.disabled=page<=1;
      next.disabled=page*data.pageSize>=total;
      pageLabel.textContent='Trang '+page+' · '+total+' mục';
      setStatus(data.items.length?'':'Chưa có từ vựng để hiển thị.');
    } catch(error) {
      if(version===requestVersion)setStatus(error.message,true);
    } finally {if(version===requestVersion)loading=false;}
  }
  for(const control of [category,type,sort,seen])control.addEventListener('change',()=>{
    page=1;void refresh();
  });
  search.addEventListener('input',()=>{
    if(searchTimer)clearTimeout(searchTimer);
    searchTimer=setTimeout(()=>{page=1;void refresh();},300);
  });
  prev.addEventListener('click',()=>{if(page>1){page--;void refresh();}});
  next.addEventListener('click',()=>{if(page*30<total){page++;void refresh();}});
})();
