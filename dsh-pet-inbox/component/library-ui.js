const input=document.querySelector('#query'),feedback=document.querySelector('#feedback'),tree=null;
let entries=[];
document.querySelector('#root').onclick=()=>library.openRoot();
function mediaForOld(name){
  const ext=name.split('.').pop().toLowerCase();
  if('jpg jpeg png gif bmp webp heic heif tif tiff avif dng raw cr2 nef svg'.split(' ').includes(ext))return '图片';
  if('mp4 mov mkv avi flv m4v wmv webm mpg mpeg mts'.split(' ').includes(ext))return '视频';
  if('mp3 wav m4a flac aac amr ogg opus aiff wma'.split(' ').includes(ext))return '音频';
  return '';
}
function rank(row,query){
  const q=query.toLowerCase().replace(/请问|大肥鱼|帮我|找一下|找找|上次|那个|那份|写了|关于|文件在哪[里儿]?|文件|在哪里|在哪|有没有|的|[？?，。]/g,' ').trim();
  const text=[row.name,row.category,row.summary,row.search_text,...row.tags,row.path].join(' ').toLowerCase();
  let score=0;
  for(const part of q.split(/\s+/).filter(Boolean)){
    if(text.includes(part)) score+=10+part.length;
    for(let i=0;i<part.length-1;i++)if(/[\u3400-\u9fff]{2}/.test(part.slice(i,i+2)) && text.includes(part.slice(i,i+2))) score++;
  }
  return score;
}

let folders=[],rootPath='';
const expanded=new Set(['']), searchClosed=new Set();
const detail=document.querySelector('#detail');
function element(tag,text,cls){
  const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;
}
function showDetails(row){
  detail.replaceChildren();
  if(!row){detail.append(element('h2','文件详情'),element('p','展开左侧文件夹，选择文件即可查看说明和位置。'));return;}
  detail.append(element('h2',row.name),element('p',row.summary),element('small',row.tags.join(' · ')),element('small',row.path),element('small',[row.status,row.added].filter(Boolean).join(' · ')));
  if(row.why){const reason=element('details');reason.append(element('summary','归档依据'),element('p',row.why));detail.append(reason);}
  const actions=element('div'),b=element('button','显示位置');b.disabled=!row.available;b.onclick=async()=>{if(!await library.locate(row.id))await refresh();};
  const open=element('button','打开文件');open.disabled=!row.available;open.onclick=()=>openFile(row);
  actions.append(open,b);
  if(!row.available){const link=element('button','重新定位');link.onclick=()=>library.relink(row.id);actions.append(link);}
  detail.append(element('small','最近索引：'+(row.indexed||'未知')));detail.append(actions);
    if(row.available && row.status==='已收纳' && row.category==='待确认' && row.proposed){
      const create=document.createElement('button');create.textContent='新建项目：'+row.proposed;
      create.onclick=()=>library.newProject(row.id);actions.append(create);
    }
    if(row.available && row.status==='已收纳' && row.suggestion && row.category==='待确认'){
      const accept=document.createElement('button');accept.textContent='归入 '+row.suggestion;
      accept.onclick=()=>library.confirm(row.id);actions.append(accept);
    }
    if(row.available && row.status==='已收纳' && !['待确认','待分类'].includes(row.category)){
      const form=document.createElement('details'),title=document.createElement('summary');
      title.textContent='记住项目别名';const term=document.createElement('input');term.placeholder='如：青禾秋展';term.maxLength=40;
      const save=document.createElement('button');save.textContent='关联到此目录';
      save.onclick=async()=>{if(await library.alias(row.id,term.value))feedback.textContent='已记住别名：'+term.value;};
      form.append(title,term,save);actions.append(form);
    }
    if(row.available && ["已收纳","已同步"].includes(row.status)){const edit=document.createElement("button");edit.textContent="调整分类";edit.onclick=()=>modal(false);actions.append(edit);}

}
async function openFile(row){
  const error=await library.open(row.id);if(error)feedback.textContent=error;
}
function conditions(query){
  let text=query;
  const dates=text.match(/上周|上星期|本周|这周|昨天|今天/);
  let from=null,to=null;
  if(dates){
    from=new Date();from.setHours(0,0,0,0);
    const week=/周|星期/.test(dates[0]);
    if(week)from.setDate(from.getDate()-(from.getDay()+6)%7-(dates[0].startsWith('上')?7:0));
    else if(dates[0]==='昨天')from.setDate(from.getDate()-1);
    to=new Date(from);to.setDate(to.getDate()+(week?7:1));text=text.replace(dates[0],'');
  }
  const types=text.match(/视频|照片|图片|录音|音频/);
  if(types)text=text.replace(types[0],'');
  text=text.replace(/帮我找|找一下|请问|的|文件|在哪[里儿]?|[？?]/g,' ').trim();
  return {text,from,to,dateLabel:dates?.[0],media:types?({照片:'图片',录音:'音频'}[types[0]]||types[0]):''};
}
function filtered(){
  const query=input.value.trim(),media=document.querySelector('#media').value,pending=document.querySelector('#pending').checked;
  const parsed=conditions(query),type=media||parsed.media;
  const project=folders.filter(f=>f.split(/[\\/]/).length>1).map(f=>f.split(/[\\/]/).pop())
    .filter(n=>n.length>=2 && parsed.text.includes(n)).sort((a,b)=>b.length-a.length)[0];
  if(project)parsed.text=parsed.text.replace(project,'').trim();
  const filter=Boolean(query||type||pending);
  const pool=entries.filter(r=>{
    const modified=r.modified?new Date(r.modified*1000):new Date(r.added);
    return (!project||r.path.split(/[\\/]/).includes(project)) && (!parsed.from||(modified>=parsed.from&&modified<parsed.to)) &&
      (!type||r.tags.includes(type)||mediaForOld(r.name)===type) && (!pending||r.category==='待确认'&&r.status==='已收纳');
  });
  const rows=parsed.text?pool.map(row=>({row,score:rank(row,parsed.text)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).map(x=>x.row):pool;
  return rows;
}
const $=id=>document.getElementById(id);
const saved=(key,otherwise)=>{try{return JSON.parse(localStorage.getItem(key))??otherwise;}catch{return otherwise;}};
let current=saved('desk-location',''),pins=saved('desk-pins',[]),tiles=saved('desk-tiles',false);
let historyRows=[],examples=[];
let chosen=new Set(),anchor=null,visible=[],moves=[],busy=false,dragIds=null,pendingRefresh=false,version=0,lastDest='';
const parent=p=>p.split('/').slice(0,-1).join('/');
const leaf=p=>p.split('/').pop();
const category=r=>r.path.toLowerCase().startsWith(rootPath.toLowerCase()+'\\')?parent(r.path.slice(rootPath.length+1).replaceAll('\\','/')):r.category;
const selectText=()=>input.value.trim()||$('media').value||$('pending').checked;
function btn(text,fn,cls){const b=element('button',text,cls);b.onclick=fn;return b;}
function clearDetail(){chosen.clear();anchor=null;detail.replaceChildren();}
let quickMode="";
function navigate(path){
  quickMode="";
  current=path;localStorage.setItem('desk-location',JSON.stringify(path));input.value='';$('media').value='';$('pending').checked=false;
  clearDetail();render();$('files').scrollTop=0;
}
function droppable(b,path){
  b.ondragover=e=>{if(!dragIds||busy)return;e.preventDefault();e.dataTransfer.dropEffect='move';b.classList.add('over');feedback.textContent='移入  /  '+path;};
  b.ondragleave=()=>b.classList.remove('over');
  b.ondrop=e=>{e.preventDefault();const ids=dragIds;dragIds=null;b.classList.remove('over');if(ids)transfer(ids,path);};
  return b;
}
function folderButton(p,label){const b=btn(label||leaf(p),()=>navigate(p),'folder'+(p===current?' active':''));b.title=p;return droppable(b,p);}
function receipts(){
  const last=moves[0];$('receipt').replaceChildren();
  if(lastDest && folders.includes(lastDest))$('receipt').append(btn('查看位置',()=>navigate(lastDest)));
  if(last)$('receipt').append(btn('撤销最近调整',()=>transfer(null,null,last.batch)));
}
async function transfer(ids,path,batch){
  if(busy)return;busy=true;$('picker').close();feedback.textContent='正在更新文件位置…';
  try{
    const r=batch?await library.undo(batch):await library.move(ids,path);
    feedback.textContent=(batch?'已撤销 '+r.done+' 项':'已移入 '+path+' · '+r.done+' 项')+(r.errors.length?'；'+r.errors.length+' 项未完成：'+r.errors[0]:'');
    if(!batch&&r.done)lastDest=path;
    clearDetail();
  }catch(e){feedback.textContent='移动未完成：'+e.message;}
  finally{busy=false;await refresh();}
}
function paintSelection(){
  for(const b of $('files').children)b.classList.toggle('sel',chosen.has(Number(b.dataset.id)));
  $('to').disabled=!chosen.size||busy;
  $('selection').hidden=!chosen.size;$('selectedCount').textContent='已选 '+chosen.size+' 份';
  document.querySelector('footer').hidden=!chosen.size&&!feedback.textContent;
}
function selectRow(row,e){
  if(e.detail>1)return;
  if(e.shiftKey && anchor!==null){
    const a=visible.findIndex(r=>r.id===anchor),b=visible.indexOf(row);
    if(!e.ctrlKey)chosen.clear();
    if(a>=0)for(const r of visible.slice(Math.min(a,b),Math.max(a,b)+1))if(r.available)chosen.add(r.id);
  }else{
    if(!e.ctrlKey)chosen.clear();
    if(e.ctrlKey&&chosen.has(row.id))chosen.delete(row.id);else if(row.available)chosen.add(row.id);
    anchor=row.id;
  }
  paintSelection();renderDock();
}
async function previewRow(row){
  showDetails(row);$('preview').showModal();
  if(row.available && mediaForOld(row.name)==='图片'){
    const img=element('img');img.className='largePreview';detail.prepend(img);
    const url=await library.thumb(row.path,true).catch(()=>'');if(url)img.src=url;else img.remove();
  }
}
$('dismiss').onclick=()=>$('preview').close();
$('clear').onclick=()=>{clearDetail();paintSelection();renderDock();};
const thumbs=new Map();
const thumbObserver=new IntersectionObserver(items=>{for(const {target,isIntersecting} of items){if(!isIntersecting)continue;
  thumbObserver.unobserve(target);const path=target.dataset.path;
  (async()=>{const url=thumbs.get(path)||await library.thumb(path);if(url){if(thumbs.size>150)thumbs.clear();thumbs.set(path,url);target.src=url;target.hidden=false;}})().catch(()=>{});
}});
function renderDock(){
  const dock=$('dock');dock.replaceChildren();
  const recent=[...new Set(moves.map(m=>m.folder))].filter(p=>folders.includes(p)&&!pins.includes(p));
  for(const p of pins.filter(p=>folders.includes(p)))dock.append(folderButton(p,'★ '+p));
  for(const p of recent.slice(0,3))dock.append(folderButton(p,'最近 · '+p));
  const row=chosen.size===1 && entries.find(r=>chosen.has(r.id));
  if(row){
    const tokens=name=>new Set((name.toLowerCase().match(/[a-z0-9]{2,}|[一-龥]+/g)||[]).flatMap(t=>
      /[一-龥]/.test(t)?Array.from({length:Math.max(0,t.length-1)},(_,i)=>t.slice(i,i+2)): [t]));
    const query=tokens(row.name.replace(/\.[^.]+$/,''));
    const hit=examples.filter(([name,p])=>p!==category(row)&&folders.includes(p))
      .map(([name,p])=>({name,p,score:[...tokens(name)].filter(t=>query.has(t)).length}))
      .sort((a,b)=>b.score-a.score)[0];
    if(hit?.score){
      const b=droppable(btn('建议 · '+hit.p,()=>transfer([...chosen],hit.p)),hit.p);
      b.title='你曾将「'+hit.name+'」移入这个目录';dock.append(b);
    }
  }
  if(!dock.children.length)for(const p of folders.filter(p=>!p.includes('/')).slice(0,4))dock.append(folderButton(p));
}
function render(){
  $('quick').replaceChildren(...[['全部文件',''],['最近加入','recent'],['图片与视频','visual']].map(([label,mode])=>btn(label,()=>{navigate('');quickMode=mode;render();},'folder'+(!current&&quickMode===mode?' active':''))));
  $('places').replaceChildren(...folders.filter(p=>!p.includes('/')).map(p=>folderButton(p)));
  const kids=folders.filter(p=>parent(p)===current);
  $('subcol').hidden=!current||!kids.length||!!selectText();
  $('subs').replaceChildren(...(current?kids:[]).map(p=>folderButton(p)));
  if(!$('subs').children.length)$('subs').append(element('small',current?'当前已是末级目录':'选择左侧位置以浏览子目录'));
  $('crumb').replaceChildren(btn('仓库',()=>navigate('')));
  let prefix='';for(const part of current.split('/').filter(Boolean)){prefix+=(prefix?'/':'')+part;const dest=prefix;$('crumb').append(btn(part,()=>navigate(dest)));}
  const global=selectText();visible=filtered().filter(r=>global||!current||category(r)===current);
  if(quickMode==='visual')visible=visible.filter(r=>['图片','视频'].includes(mediaForOld(r.name)));
  if(quickMode==='recent')visible=visible.filter(r=>r.added).sort((a,b)=>b.added.localeCompare(a.added)).slice(0,50);
  $('title').textContent=global?'搜索结果':leaf(current)||({recent:'最近加入',visual:'图片与视频'}[quickMode]||'全部文件');
  $('pin').hidden=!current;$('labels').hidden=tiles;
  $('count').textContent=visible.length+' 个文件';$('pin').disabled=!current;$('pin').textContent=pins.includes(current)?'取消固定':'固定此处';
  $('view').textContent=tiles?'列表':'缩略图';$('pendingLabel').hidden=!entries.some(r=>r.category==='待确认');
  const files=$('files');const scroll=files.scrollTop;thumbObserver.disconnect();files.replaceChildren();files.classList.toggle('tiles',tiles);
  if(!visible.length)files.append(element('p',kids.length&&!global?'选择子文件夹查看内容':'这里没有匹配的文件','empty'));
  for(const row of visible){
    const b=element('div',undefined,'row');b.tabIndex=0;b.dataset.id=row.id;b.draggable=row.available&&['已收纳','已同步'].includes(row.status);
    const name=element('div',undefined,'nameCell'),icon=btn('',e=>{e.stopPropagation();previewRow(row);},'fileIcon');
    const ext=row.name.includes('.')?row.name.split('.').pop().toUpperCase():'文件';
    icon.textContent=ext.slice(0,5);icon.title='预览 '+row.name;icon.dataset.kind=/XLS|CSV/.test(ext)?'sheet':ext==='PDF'?'pdf':'other';
    if(row.available&&mediaForOld(row.name)==='图片'){const im=element('img');im.alt='';im.dataset.path=row.path;im.hidden=true;icon.append(im);thumbObserver.observe(im);}
    const title=element('b',row.name);title.title=row.name;name.append(icon,title);
    const pos=category(row)||'仓库根目录';
    const location=btn(leaf(pos)+' ▾',e=>{
      e.stopPropagation();chosen=new Set([row.id]);paintSelection();modal(false);
      const r=location.getBoundingClientRect(),menu=$('picker');menu.classList.add('inlinePicker');
      menu.style.left=Math.max(6,Math.min(r.left,innerWidth-menu.offsetWidth-8))+'px';
      menu.style.top=Math.max(6,Math.min(r.bottom+3,innerHeight-menu.offsetHeight-8))+'px';
    },'location');location.disabled=!b.draggable;location.title=pos;
    b.append(name,location,element('time',(row.added||'').slice(0,10)));
    b.onclick=e=>selectRow(row,e);b.ondblclick=e=>{if(!e.target.closest('button')&&row.available)openFile(row);};
    b.onkeydown=e=>{if(e.target!==b)return;if(e.key===' '){e.preventDefault();previewRow(row);}else if(e.key==='Enter'&&row.available)openFile(row);};
    b.ondragstart=e=>{if(!chosen.has(row.id)){chosen.clear();chosen.add(row.id);paintSelection();}
      dragIds=[...chosen];e.dataTransfer.setData('text/plain',row.name);e.dataTransfer.effectAllowed='move';feedback.textContent='拖入目录或底部投放栏 · '+dragIds.length+' 项';};
    b.ondragend=()=>{dragIds=null;document.querySelectorAll('.over').forEach(x=>x.classList.remove('over'));if(!busy){feedback.textContent='';if(pendingRefresh)refresh();}};
    files.append(b);
  }
  files.scrollTop=scroll;paintSelection();renderDock();receipts();
}
function modal(history){
  if($('preview').open)$('preview').close();$('picker').classList.remove('inlinePicker');$('picker').style.left='';$('picker').style.top='';$('picker').showModal();$('modalTitle').textContent=history?'移动历史':'移动到';$('find').hidden=history;$('find').value='';
  function list(){
    const parts=$('find').value.toLowerCase().trim().split(/\s+/);
    $('choices').replaceChildren();
    if(history){
      for(const m of historyRows){
        const entry=btn('',()=>{if(folders.includes(m.folder)){navigate(m.folder);$('picker').close();}});
        entry.append(element('b',m.name),element('small',(m.source==='.'?'仓库':m.source)+' → '+m.folder+(m.undone?' · 已撤销':'')));
        $('choices').append(entry);
      }
      if(!historyRows.length)$('choices').append(element('p','还没有手动移动记录。'));
    }
    else for(const p of folders.filter(p=>parts.every(q=>p.toLowerCase().includes(q))))$('choices').append(btn(p,()=>transfer([...chosen],p)));
  }
  $('find').oninput=list;$('find').onkeydown=e=>{if(e.key==='Enter')$('choices').firstElementChild?.click();};list();if(!history)$('find').focus();
}
$('pin').onclick=()=>{pins=pins.includes(current)?pins.filter(p=>p!==current):[...pins,current];localStorage.setItem('desk-pins',JSON.stringify(pins));render();};
$('to').onclick=()=>modal(false);$('recent').onclick=()=>modal(true);$('close').onclick=()=>$('picker').close();
$('view').onclick=()=>{tiles=!tiles;localStorage.setItem('desk-tiles',JSON.stringify(tiles));render();};
for(const control of [input,$('media'),$('pending')])control.oninput=()=>{clearDetail();render();};
async function refresh(){
  if(dragIds||busy){pendingRefresh=true;return;}
  pendingRefresh=false;const id=++version;
  try{const data=await library.read();if(id!==version)return;if(dragIds||busy){pendingRefresh=true;return;}
    entries=data.entries;folders=data.folders;rootPath=data.root;historyRows=data.history||[];moves=data.moves||[];examples=data.examples||[];
    if(current&&!folders.includes(current))current='';
    render();
  }catch(e){feedback.textContent='读取仓库失败：'+e.message;}
}
library.onChange(refresh);window.addEventListener('focus',refresh);refresh();
