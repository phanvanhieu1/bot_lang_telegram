/* Personal confirmed glossary. Render all supplied strings using textContent. */
(() => {
  const byId=id=>document.getElementById(id);
  const launch=byId('termAddBtn'), panel=byId('termEditor'),
    form=byId('termForm'), list=byId('termList'), feedback=byId('termFeedback');
  if(!launch||!panel||!form)return;
  const source=byId('termSource'),meaning=byId('termMeaning'),
    domain=byId('termDomain'),notes=byId('termNotes');
  const cancel=byId('termCancel'),title=byId('termEditorTitle');
  let editingId=null,records=[];
  function status(value,error=false) {
    feedback.textContent=value||'';
    feedback.style.color=error?'#b91c1c':'';
  }
  async function request(url,options={}) {
    const response=await fetch('/api/terminology'+url,{
      credentials:'same-origin',cache:'no-store',...options,
      headers:{...(options.body?{'content-type':'application/json'}:{}),...(options.headers||{})}
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok||!data.success)throw Error(data.message||'Không thực hiện được');
    return data;
  }
  function make(tag,text,cls,parent) {
    const node=document.createElement(tag);
    if(text!==undefined)node.textContent=text;
    if(cls)node.className=cls;
    if(parent)parent.appendChild(node);
    return node;
  }
  function reset() {
    editingId=null;form.reset();domain.value='work';
    title.textContent='Thêm thuật ngữ chuyên ngành';
  }
  function open(term='',translation='',category='work',id=null) {
    reset();panel.hidden=false;
    source.value=term;meaning.value=translation;
    domain.value=['work','it','daily','any'].includes(category)?category:'work';
    editingId=id;
    title.textContent=id?'Sửa thuật ngữ':'Thêm thuật ngữ chuyên ngành';
    status('');
    source.focus();
    void reload();
  }
  function close(){panel.hidden=true;reset();status('');}
  async function reload() {
    try {
      const data=await request('/');
      records=data.items||[];
      list.replaceChildren();
      if(!records.length)make('p','Chưa có thuật ngữ chuyên ngành nào.','term-empty',list);
      for(const entry of records) {
        const item=make('div',undefined,'term-list-item',list);
        const info=make('div',undefined,'term-list-info',item);
        make('strong',entry.source+' → '+entry.translation,undefined,info);
        make('small',entry.domain+' · đã xác nhận',undefined,info);
        const edit=make('button','Sửa','term-small',item);edit.type='button';
        edit.addEventListener('click',()=>{
          open(entry.source,entry.translation,entry.domain,entry.id);
          notes.value=entry.notes||'';
        });
        const remove=make('button','Xóa','term-small',item);remove.type='button';
        remove.addEventListener('click',async()=>{
          if(!confirm('Xóa thuật ngữ '+entry.source+'?'))return;
          try {await request('/'+encodeURIComponent(entry.id),{method:'DELETE'});
            status('Đã xóa');await reload();}
          catch(e){status(e.message,true);}
        });
      }
    }catch(error){status(error.message,true);}
  }
  launch.addEventListener('click',()=>{if(panel.hidden)open();else close();});
  cancel.addEventListener('click',close);
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    const data={source:source.value.trim(),translation:meaning.value.trim(),
      domain:domain.value,notes:notes.value.trim(),sourceLang:'zh',targetLang:'vi'};
    const submit=byId('termSave');submit.disabled=true;
    try {
      await request(editingId?'/'+encodeURIComponent(editingId):'/',{
        method:editingId?'PATCH':'POST',body:JSON.stringify(data)
      });
      status('Đã lưu! Bản dịch tiếp theo sẽ áp dụng nghĩa đã xác nhận.');
      await reload();reset();window.dispatchEvent(new Event('terminology-updated'));
    }catch(e){status(e.message,true);}
    finally{submit.disabled=false;}
  });
  window.openTerminologyEditor=open;
  function highlight(target,entries) {
    const original=target.textContent;
    if(!original||!Array.isArray(entries)||!entries.length)return;
    const ordered=[...entries].sort((a,b)=>a.start-b.start);
    let cursor=0;const fragment=document.createDocumentFragment();
    for(const e of ordered) {
      const start=Number(e.start),end=Number(e.end);
      if(!Number.isInteger(start)||!Number.isInteger(end)||start<cursor||end>original.length||end<=start)continue;
      if(original.slice(start,end)!==e.translation)continue;
      fragment.appendChild(document.createTextNode(original.slice(cursor,start)));
      const mark=document.createElement('mark');
      mark.className='term-highlight';
      mark.textContent=original.slice(start,end);
      mark.title=(e.source||'')+' → '+(e.translation||'')+' · Thuật ngữ đã xác nhận';
      fragment.appendChild(mark);
      cursor=end;
    }
    fragment.appendChild(document.createTextNode(original.slice(cursor)));
    target.replaceChildren(fragment);
  }
  window.renderTermHighlights=(entries)=>{
    const result=byId('translation');
    if(result)highlight(result,entries);
  };
  window.displayTermWarning=(warnings)=>{
    const note=byId('termTranslationWarning');
    if(!note)return;
    note.hidden=!Array.isArray(warnings)||!warnings.length;
    note.textContent=note.hidden?'':'⚠ Chưa áp dụng đúng thuật ngữ: '+warnings.join(', ')+'. Hãy kiểm tra trước khi sử dụng.';
  };
})();
