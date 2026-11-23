const $=id=>document.getElementById(id);
function el(tag,text,cls){const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;}
function button(text,fn,cls){const n=el('button',text,cls);n.onclick=e=>{e.stopPropagation();fn(e);};return n;}
const base=r=>r.category.replaceAll('\\','/');
const type=r=>r.name.split('.').pop().toUpperCase();
const key=r=>r.batch||'disk';
const tokens=text=>new Set((text.toLowerCase().match(/[a-z0-9]{2,}|[一-龥]+/g)||[]).flatMap(t=>/^[一-龥]/.test(t)?Array.from({length:t.length-1},(_,i)=>t.slice(i,i+2)):[t]));
const overlap=(a,b)=>[...tokens(a)].filter(x=>tokens(b).has(x)).length;
const stem=r=>r.name.replace(/\.[^.]+$/,'');
let data={entries:[],folders:[],moves:[],examples:[]},group=null,rows=[],selection=new Set(),paint='',offer=null,latest='',menuIds=[],drag=false,busy=false,serial=0,deferred=false,box=null;
const live=r=>r.available&&['已收纳','已同步'].includes(r.status);
const thumbs=new Map();
const observer=new IntersectionObserver(items=>{for(const item of items)if(item.isIntersecting){
  const img=item.target;observer.unobserve(img);const file=img.dataset.path;
  (async()=>{const url=thumbs.get(file)||await library.thumb(file);if(url){if(thumbs.size>160)thumbs.clear();thumbs.set(file,url);img.src=url;}else img.remove();})().catch(()=>img.remove());
}});
function closeMenu(){$('menu').hidden=true;}
function lastPaths(ids){
  const names=data.entries.filter(r=>ids.includes(r.id)).map(stem).join(' ');
  return [...data.folders].sort((a,b)=>score(b)-score(a));
  function score(p){return Math.max(0,...(data.examples||[]).filter(x=>x[1]===p).map(x=>overlap(names,x[0])*3))+overlap(names,p)+(data.moves||[]).some(m=>m.folder===p)*.5;}
}
function destinations(ids,x,y,isDrag=false){
  menuIds=[...ids];const ordered=lastPaths(ids);
  const fill=()=>{
    const q=$('filter').value.toLowerCase().trim().split(/\s+/);$('options').replaceChildren();
    const paths=ordered.filter(p=>q.every(t=>p.toLowerCase().includes(t)));
    for(const path of (isDrag?paths.slice(0,3):paths)){
      const b=button(path,()=>change(menuIds,path));b.ondragover=e=>{if(drag){e.preventDefault();b.classList.add('over');}};
      b.ondragleave=()=>b.classList.remove('over');b.ondrop=e=>{e.preventDefault();drag=false;change(menuIds,path);};$('options').append(b);
    }
    if(isDrag){const more=button('其他位置…',()=>destinations(ids,x,y));more.ondragover=e=>e.preventDefault();more.ondrop=e=>{e.preventDefault();drag=false;destinations(ids,x,y);};$('options').append(more);}
    if(!paths.length)$('options').append(el('small','没有匹配的目录'));
  };
  $('filter').hidden=isDrag;$('filter').value='';$('filter').oninput=fill;fill();
  const m=$('menu');m.hidden=false;m.style.left=Math.max(4,Math.min(x+8,innerWidth-m.offsetWidth-8))+'px';m.style.top=Math.max(4,Math.min(y+6,innerHeight-m.offsetHeight-8))+'px';
  if(!isDrag)$('filter').focus();
}
async function change(ids,path,undo=false){
  if(busy)return;busy=true;closeMenu();const source=data.entries.find(r=>ids.includes(r.id));offer=null;
  try{
    const r=undo?await library.undo(data.moves[0].batch):await library.move([...ids],path);
    $('status').textContent=(undo?'已撤销 '+r.done+' 项':'已将 '+r.done+' 份移入 '+path)+(r.errors.length?' · '+r.errors[0]:'');
    selection.clear();paint='';latest=undo?'':path;
    if(!undo&&r.done&&source?.batch&&ids.length===1)offer={source,path};
  }catch(e){$('status').textContent='操作未完成 · '+e.message;}
  finally{busy=false;await refresh();}
}
function syncSelection(){
  for(const c of $('grid').querySelectorAll('.card'))c.classList.toggle('selected',selection.has(Number(c.dataset.id)));
  const t=$('tools');t.replaceChildren();
  if(paint){
    t.append(el('span','继续放到 '+paint),button('移入选中的 '+selection.size+' 份',()=>{if(selection.size)change([...selection],paint);},'primary'),button('退出',()=>{paint='';selection.clear();syncSelection();}));
  }else if(selection.size)t.append(el('span','已选 '+selection.size+' 份'),button('移动到…',e=>destinations([...selection],e.clientX,e.clientY)),button('取消选择',()=>{selection.clear();syncSelection();}));
  else if(latest)t.append(button('继续放到「'+latest+'」',()=>{paint=latest;syncSelection();}));
}
function choose(r,e){if(!live(r))return;const toggle=paint||e.ctrlKey||e.metaKey;if(!toggle)selection.clear();if(toggle&&selection.has(r.id))selection.delete(r.id);else selection.add(r.id);syncSelection();}
function draw(){
  observer.disconnect();const groups=new Map();
  for(const r of data.entries){if(!groups.has(key(r)))groups.set(key(r),[]);groups.get(key(r)).push(r);}
  const order=[...groups.keys()].filter(k=>k!=='disk');if(groups.has('disk'))order.push('disk');
  if(!groups.has(group))group=order[0];
  const q=$('search').value.trim().toLowerCase();
  rows=q?data.entries.filter(r=>[r.name,r.summary,r.category,r.search_text].join(' ').toLowerCase().includes(q)):groups.get(group)||[];
  $('title').textContent=q?'搜索结果':group==='disk'?'从文件夹加入的资料':group===order[0]?'最近收好的文件':'收纳回放';
  $('stamp').textContent=q?'整个仓库':rows[0]?.added?.slice(0,16)||'大肥鱼仓库';
  $('strip').textContent=rows.length+' 份文件';$('grid').replaceChildren();$('older').replaceChildren();
  const suggested=offer && data.entries.filter(r=>live(r)&&key(r)===key(offer.source)&&r.id!==offer.source.id&&base(r)!==offer.path&&type(r)===type(offer.source))
    .map(r=>({r,n:overlap(stem(r),stem(offer.source))})).filter(x=>x.n>0).sort((a,b)=>b.n-a.n)[0]?.r.id;
  for(const r of rows){
    const card=el('article',null,'card');card.dataset.id=r.id;card.tabIndex=0;card.draggable=live(r)&&!paint;
    const prev=el('div',null,'prev');prev.append(el('strong',type(r)),el('span',(r.search_text||r.summary||r.name).slice(0,100)));
    if(/^(PNG|JPE?G|WEBP|GIF|BMP)$/.test(type(r))&&r.available){prev.classList.add('pic');const img=el('img');img.alt=r.name;img.dataset.path=r.path;prev.replaceChildren(img);observer.observe(img);}
    const dest=button(base(r)+' ▾',e=>{if(paint)choose(r,e);else destinations(selection.has(r.id)?[...selection]:[r.id],e.clientX,e.clientY);},'dest');dest.disabled=!live(r);
    const name=el('h3',r.name,'name');name.title=r.name;dest.title=r.path;
    card.append(prev,name,dest);
    if(r.id===suggested){const hint=button('也放入「'+offer.path+'」？',()=>change([r.id],offer.path),'hint');hint.title='同一批、同类型，文件名与「'+offer.source.name+'」含有相同线索';card.append(hint);}
    card.onclick=e=>choose(r,e);card.ondblclick=()=>{if(!paint&&r.available)library.open(r.id);};
    card.onkeydown=e=>{if(e.target!==card)return;if(e.key==='Enter'&&!paint)library.open(r.id);if(e.key===' '){e.preventDefault();choose(r,e);}};
    card.ondragstart=e=>{if(paint){e.preventDefault();return;}drag=true;if(!selection.has(r.id)){selection=new Set([r.id]);syncSelection();}
      e.dataTransfer.setData('text/plain',r.name);e.dataTransfer.effectAllowed='move';destinations([...selection],e.clientX,e.clientY,true);};
    card.ondragend=()=>{if(drag){drag=false;closeMenu();}if(deferred)refresh();};$('grid').append(card);
  }
  if(!rows.length)$('grid').append(el('p',q?'没有找到匹配文件':'把第一份文件交给大肥鱼，它会出现在这里。'));
  if(!q)for(const k of order.filter(k=>k!==group)){const batch=groups.get(k);$('older').append(button((k==='disk'?'从文件夹加入':batch[0].added?.slice(0,16)+' 收好')+'　·　'+batch.length+' 份　　'+batch[0].name,()=>{group=k;selection.clear();paint='';latest='';draw();scrollTo(0,0);},'older'));}
  $('undo').hidden=!data.moves?.length;syncSelection();
}
async function refresh(){
  if(busy||drag||box||!$('menu').hidden){deferred=true;return;}
  deferred=false;const id=++serial;try{const next=await library.read();if(id!==serial)return;if(busy||drag||box||!$('menu').hidden){deferred=true;return;}data=next;draw();}catch(e){$('status').textContent='读取失败 · '+e.message;}
}
$('undo').onclick=()=>change([],null,true);$('search').oninput=()=>{selection.clear();paint='';closeMenu();draw();};
$('filter').onkeydown=e=>{if(e.key==='Enter')$('options').querySelector('button')?.click();};
document.addEventListener('pointerdown',e=>{if(!$('menu').contains(e.target))closeMenu();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeMenu();paint='';selection.clear();draw();}if(e.key==='Enter'&&paint&&selection.size)change([...selection],paint);});
$('grid').onpointerdown=e=>{
  if(e.target!==$('grid')||e.button!==0)return;
  const x=e.clientX,y=e.clientY,prior=e.ctrlKey?new Set(selection):new Set();box=el('div',null,'rubber');document.body.append(box);
  const move=ev=>{const l=Math.min(x,ev.clientX),t=Math.min(y,ev.clientY),r=Math.max(x,ev.clientX),b=Math.max(y,ev.clientY);
    Object.assign(box.style,{left:l+'px',top:t+'px',width:r-l+'px',height:b-t+'px'});selection=new Set(prior);
    for(const c of $('grid').children){const rect=c.getBoundingClientRect();if(c.dataset.id&&rect.right>l&&rect.left<r&&rect.bottom>t&&rect.top<b&&rows.some(f=>f.id===Number(c.dataset.id)&&live(f)))selection.add(Number(c.dataset.id));}syncSelection();};
  const end=()=>{box.remove();box=null;window.removeEventListener('pointermove',move);if(deferred)refresh();};window.addEventListener('pointermove',move);window.addEventListener('pointerup',end,{once:true});e.preventDefault();
};
library.onChange(refresh);refresh();
