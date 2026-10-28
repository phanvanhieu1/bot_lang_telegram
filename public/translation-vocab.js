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
  const expandedTypes=new Set();
  const PREVIEW_LIMIT=3;
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
    const name=node(header,'div','translation-vocab-name');
    node(name,'div','translation-vocab-term',item.text || item.key);
    if(item.pinyin)node(name,'div','translation-vocab-pinyin',item.pinyin);
    const meta=node(header,'div','translation-vocab-meta');
    const status=node(meta,'span','translation-vocab-status'+(item.isNew?' is-new':''),
      item.isNew?'Mới':'Đã có');
    status.title=item.isNew?'Mục vừa được thêm vào từ điển':'Mục đã tồn tại trong từ điển';
    node(meta,'span','translation-vocab-count',count+' lần gặp');
    if(item.type!=='pattern' && (item.text||item.key)) {
      const add=node(meta,'button','term-vocab-add','＋');
      add.type='button';add.title='Lưu vào từ điển thuật ngữ chuyên ngành';
      add.setAttribute('aria-label','Thêm thuật ngữ '+(item.text||item.key));
      add.addEventListener('click',()=>window.openTerminologyEditor?.(
        item.text||item.key,item.meaning||'',item.category==='daily_life'?'daily':'work'));
    }
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
      // Keep all three groups visible, even when AI1 supplied no items in one.
      const section=node(root,'section','translation-vocab-section');
      const heading=node(section,'h3','translation-vocab-section-heading');
      node(heading,'span','',typeNames[type]);
      node(heading,'small','',values.length+' mục');
      const grid=node(section,'div','translation-vocab-grid');
      grid.id='translation-vocab-group-'+type;
      const expanded=expandedTypes.has(type);
      const visible=expanded?values:values.slice(0,PREVIEW_LIMIT);
      if(!values.length) {
        node(grid,'p','translation-vocab-empty','Chưa có mục');
      } else {
        visible.forEach(item=>createCard(grid,item));
      }
      if(values.length>PREVIEW_LIMIT) {
        const more=node(section,'button','translation-vocab-more',
          expanded?'Thu gọn':'Xem thêm ('+(values.length-PREVIEW_LIMIT)+')');
        more.type='button';
        more.id='translation-vocab-more-'+type;
        more.setAttribute('aria-expanded',String(expanded));
        more.setAttribute('aria-controls',grid.id);
        more.addEventListener('click',()=>{
          if(expandedTypes.has(type))expandedTypes.delete(type);
          else expandedTypes.add(type);
          paint(items,message);
          root.querySelector('#translation-vocab-more-'+type)?.focus();
        });
      }
    }
  }

  function render(items,error='',language='zh') {
    version++;
    activeRefresh=null;
    expandedTypes.clear();
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
  // V2 source-language suggestions are displayed only when there are no
  // Chinese MongoDB cards, or when the input is Vietnamese. Do not count them
  // as learned vocabulary, do not show false "New" or encounter counters,
  // and never auto-save Vietnamese entries into the Chinese study library.
  const claudeRoot=document.getElementById('v2ClaudeVocabulary');
  function renderClaudeTerms(terms,sourceLanguage='zh',hasStudyCards=false){
    if(!claudeRoot)return;
    claudeRoot.replaceChildren();
    const items=Array.isArray(terms)?terms.filter(item=>
      item&&typeof item.source==='string'&&item.source.trim()&&
      typeof item.meaning==='string'&&item.meaning.trim()
    ).slice(0,8):[];
    const show=items.length>0&&(sourceLanguage==='vi'||!hasStudyCards);
    claudeRoot.hidden=!show;
    if(!show)return;
    wrapper.classList.remove('hidden');
    raw.hidden=true;
    const section=node(claudeRoot,'section','translation-vocab-section');
    const heading=node(section,'h3','translation-vocab-section-heading');
    node(heading,'span','',
      sourceLanguage==='vi'?'Claude nhận diện (tiếng Việt)':'Claude gợi ý từ/cụm từ');
    node(heading,'small','',''+items.length+' mục');
    node(section,'p','translation-vocab-note',
      'Nghĩa do AI phân tích, chỉ để tham khảo; chưa lưu vào kho từ vựng.');
    const grid=node(section,'div','translation-vocab-grid');
    for(const item of items){
      const card=node(grid,'article','translation-vocab-card');
      node(card,'div','translation-vocab-term',item.source);
      node(card,'div','translation-vocab-meaning',item.meaning);
    }
  }

  // Edit/delete in the study library refreshes the currently visible cards.
  window.addEventListener('vocabulary-library-updated',()=>{
    if(activeRefresh)void activeRefresh();
  });
  window.renderTranslationVocabulary=render;
  window.renderV2ClaudeTerms=renderClaudeTerms;
})();
