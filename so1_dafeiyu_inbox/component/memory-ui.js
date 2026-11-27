'use strict';
const $=id=>document.getElementById(id);
const time=new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'});
const el=(tag,text='',className='')=>{
  const node=document.createElement(tag);
  node.textContent=text;
  if(className)node.className=className;
  return node;
};
const button=(title,run,className='')=>{
  const node=el('button',title,className);node.type='button';node.onclick=run;return node;
};
const status={active:'生效中',suggested:'待确认',superseded:'历史版本'};
const decisions={observe_in_place:'按偏好在原地观察',approach:'小跑靠近文件',skip_dialogue:'按安静时段跳过桌面台词',skip_disdain:'按动作偏好略过嫌弃脸'};
const source={chat:'你在对话中要求记住',panel:'你在记忆舱设置',model:'DeepSeek 提炼建议'};
let data=null,tab='graph',selected='',currentStep=0,busy=false;
const graphPageSize=48,zoomLevels=[100,125,160,200];
let graphFocus='',graphPage=0,graphZoom=0;
let manageLimit=100;
let starYaw=0,starPitch=0,resetStarCamera=()=>{};
const regions={
  memory:{label:'行为偏好',x:-239,y:-89,z:10},
  chat:{label:'沟通记忆',x:170,y:-113,z:-20},
  episode:{label:'共同经历',x:82,y:116,z:24},
  file:{label:'仓库文件',x:-216,y:100,z:-24},
  action:{label:'动作档案',x:248,y:23,z:43}
};
let lastGraphDecisions=null,liveDecisionIds=new Set(),graphFingerprint='';

function getEpisodes(){
  if(!data?.timeline)return [];
  const groups=new Map();
  for(const event of [...data.timeline].sort((a,b)=>a.at-b.at)){
    const batch=event.details.batch;
    const id=event.details.episodeId || (batch && 'batch:'+batch) || event.details.runId || event.id;
    if(!groups.has(id))groups.set(id,{id,batch,events:[],at:event.at,title:event.details.name || event.text});
    const group=groups.get(id);
    group.events.push(event);
    if(event.type==='task.filed' && batch)group.title=event.text;
  }
  return [...groups.values()].sort((a,b)=>b.at-a.at);
}
function pickEpisode(list){
  return list.find(e=>e.id===selected) || list[0];
}
function drawList(node,list,active){
  node.replaceChildren(...list.map(group=>{
    const b=button(group.title,()=>{selected=group.id;currentStep=0;render();},'episode-button');
    b.setAttribute('aria-current',String(group.id===active?.id));
    b.append(el('small',time.format(group.at)+' · '+group.events.length+' 条记录'));
    return b;
  }));
  if(!list.length)node.append(el('p','还没有可回看的经历。','hint'));
}
function recordedDecisions(episode){
  return data.decisions.filter(row=>row.episode===episode.id).sort((a,b)=>a.at-b.at);
}
function usedMemory(id){return data.memories.find(row=>row.id===id);}
function clipAt(events,index){
  // 只回放有真实开始回执的动作。素材回放是示意，不是屏幕录像。
  return events.slice(0,index+1).reverse().find(e=>e.type==='activity.started' && e.details.clip)?.details.clip;
}
const clipUrl=clip=>'../../../assets/webm/'+encodeURIComponent(clip)+'.webm';
function drawEpisode(group){
  const box=$('episode');
  box.replaceChildren();
  if(!group){box.append(el('h2','还没有经历'),el('p','发生新的互动后，刷新即可回看。','hint'));return;}
  box.append(el('h2',group.title));
  const preview=el('video','','preview');
  preview.controls=true;preview.muted=true;preview.preload='metadata';
  const caption=el('p','','hint');
  const range=el('input','','scrub');range.type='range';range.min=0;range.max=group.events.length-1;
  range.setAttribute('aria-label','经历进度');
  const list=el('ol','','steps');
  let currentClip;
  const setStep=i=>{
    currentStep=Math.min(i,group.events.length-1);
    range.value=currentStep;
    const event=group.events[currentStep],clip=clipAt(group.events,currentStep);
    if(clip!==currentClip || !preview.hasAttribute('src')){
      currentClip=clip;
      if(typeof clip==='string' && /^[\p{L}\p{N} _·-]{1,80}$/u.test(clip))preview.src=clipUrl(clip);
      else{preview.removeAttribute('src');preview.load();}
    }
    preview.hidden=!preview.hasAttribute('src');
    caption.textContent=time.format(event.at)+' · '+(event.details.line || event.text)+(preview.hidden?'':' · 动作素材示意');
    [...list.children].forEach((item,index)=>item.firstChild.setAttribute('aria-pressed',String(index===currentStep)));
  };
  group.events.forEach((e,i)=>{
    const item=el('li');
    item.append(button(time.format(e.at)+'  '+(e.details.line || e.text),()=>setStep(i)));
    list.append(item);
  });
  range.oninput=()=>setStep(Number(range.value));
  box.append(preview,caption,range);
  for(const row of recordedDecisions(group)){
    const evidence=row.evidence.map(id=>usedMemory(id)?.summary || '已移除或未保留的记忆');
    box.append(el('p',(decisions[row.action] || row.action)+(evidence.length?' · '+evidence.join('、'):''),'decision'));
  }
  box.append(list);setStep(currentStep);
}
function recordCard(row,manage=false){
  const box=el('div','','card');
  box.append(el('h3',row.summary),el('small',row.label+' · '+status[row.status]+' · '+time.format(row.recorded_at)),
    el('p',source[row.source] || row.source));
  if(row.evidence)box.append(el('p',row.evidence));
  if(row.valid_to)box.append(el('small','于 '+time.format(row.valid_to)+' 失效'));
  if(manage && row.status==='suggested')box.append(button('确认记忆',()=>change({op:'confirm',id:row.id})));
  if(manage)box.append(button('忘掉',()=>{
    const note=row.status==='active' && row.key!=='note'?'这条偏好的历史版本也会一并清除。':'';
    if(window.confirm('忘掉「'+row.summary+'」？'+note))void change({op:'forget',id:row.id});
  }));
  return box;
}
function graphNodes(episodes){
  const memories=data.memories.filter(row=>row.status==='active').map(row=>({
    id:'memory:'+row.id,kind:'memory',title:row.summary,at:row.recorded_at,row
  }));
  const events=episodes.map(row=>({id:'episode:'+row.id,kind:'episode',title:row.title,at:row.at,row}));
  const files=(data.warehouseFiles || []).map(row=>({id:'file:'+row.id,kind:'file',title:row.name,row}));
  const actions=[...(data.actions || [])].sort((a,b)=>(b.lastAt || 0)-(a.lastAt || 0) || a.name.localeCompare(b.name,'zh-CN'))
    .map(row=>({id:'action:'+row.name,kind:'action',title:row.name,at:row.lastAt,row}));
  // Round-robin keeps every populated region represented on the opening page.
  const lists=[memories,events,files,actions],nodes=[];
  for(let i=0;i<Math.max(...lists.map(list=>list.length));i++){
    for(const list of lists)if(list[i])nodes.push(list[i]);
  }
  return nodes;
}
function filteredStars(nodes){
  const query=$('graphSearch').value.trim().normalize('NFKC').toLocaleLowerCase();
  const kind=$('graphKind').value;
  return nodes.filter(node=>(kind==='all' || kind===node.kind) && (!query ||
    [node.title,node.at?time.format(node.at):'',node.row.label,node.row.evidence,source[node.row.source],
      node.row.path,node.row.format,node.row.scene,...(node.row.correctedFrom || []),
      ...(node.row.events || []).map(e=>e.details.line || e.text)]
      .some(v=>String(v||'').normalize('NFKC').toLocaleLowerCase().includes(query))));
}
function setGraphZoom(level,center=false){
  graphZoom=level;
  const view=$('constellation'),ratio=zoomLevels[level];
  const x=(view.scrollLeft+view.clientWidth/2)/Math.max(view.scrollWidth,1);
  const y=(view.scrollTop+view.clientHeight/2)/Math.max(view.scrollHeight,1);
  view.dataset.zoom=ratio;
  $('graphZoomOut').disabled=level===0;
  $('graphZoomIn').disabled=level===zoomLevels.length-1;
  $('graphZoomReset').textContent=ratio+'%';
  if(center)view.scrollTo(view.scrollWidth*x-view.clientWidth/2,view.scrollHeight*y-view.clientHeight/2);
}
function drawGraph(episodes){
  const view=$('constellation'),details=$('graphDetail');
  const nodes=graphNodes(episodes),byId=new Map(nodes.map(node=>[node.id,node]));
  const filtered=filteredStars(nodes);
  const pages=Math.max(1,Math.ceil(filtered.length/graphPageSize));
  graphPage=Math.min(graphPage,pages-1);
  const visible=filtered.slice(graphPage*graphPageSize,(graphPage+1)*graphPageSize);
  if(graphFocus!=='core' && !visible.some(node=>node.id===graphFocus))graphFocus='';
  const empty=$('graphEmpty');
  empty.hidden=visible.length>0;
  empty.textContent=nodes.length?'没有匹配的星星':'大肥鱼还没有记录到记忆或经历';
  $('graphCount').textContent=filtered.length+' 颗星'+(pages>1?' · '+(graphPage+1)+' / '+pages:'');
  $('graphPrev').disabled=graphPage===0;
  $('graphNext').disabled=graphPage>=pages-1;

  const svg=(tag,attrs={})=>{
    const node=document.createElementNS('http://www.w3.org/2000/svg',tag);
    for(const [key,value] of Object.entries(attrs))node.setAttribute(key,value);
    return node;
  };
  const map=svg('svg',{viewBox:'0 0 900 470',role:'group','aria-label':'大肥鱼的全局记忆星图'});
  const defs=svg('defs');
  for(const [kind,light,mid,dark] of [
    ['memory','#e8ffff','#62e3e1','#105363'],
    ['chat','#ffedf9','#eb7cb9','#5a2348'],
    ['episode','#fbebff','#a28aed','#332070'],
    ['file','#fff6ce','#edbd62','#53351a'],
    ['action','#e5f2ff','#75baff','#214a74'],
    ['core','#e9feff','#6aaee9','#13284a']
  ]){
    const gradient=svg('radialGradient',{id:'star-'+kind,cx:'34%',cy:'26%',r:'77%'});
    for(const [offset,color] of [['0%',light],['34%',mid],['100%',dark]]){
      gradient.append(svg('stop',{offset,'stop-color':color}));
    }
    defs.append(gradient);
  }
  map.append(defs);
  // A fixed seed keeps the decorative star field from flashing during search and refresh.
  const dust=svg('g',{class:'sky-dust','aria-hidden':'true'});
  let seed=2841;
  const random=()=>{seed=(seed*16807)%2147483647;return seed/2147483647;};
  for(let i=0;i<155;i++){
    dust.append(svg('circle',{cx:(random()*900).toFixed(1),cy:(random()*470).toFixed(1),
      r:(.35+random()*1.25).toFixed(1),opacity:(.15+random()*.64).toFixed(2)}));
  }
  map.append(dust);
  const clusterOf=node=>node.kind==='memory' && node.row.key==='note'?'chat':node.kind;
  const positions=new Map();
  for(const [kind,{x,y,z}] of Object.entries(regions)){
    const cluster=visible.filter(node=>clusterOf(node)===kind);
    const cy=kind==='episode'?y-9:y;
    cluster.forEach((node,i)=>{
      const angle=i*2.39996+.6,spread=14+Math.sqrt(i)*Math.min(14,84/Math.sqrt(cluster.length));
      positions.set(node.id,[x+Math.cos(angle)*spread*1.32,cy+Math.sin(angle)*spread*.53,z+Math.sin(i*2.02)*62]);
    });
  }
  positions.set('core',[0,-12,0]);
  // 只画有决策回执的引用。每一对节点只画一条线，详情仍列出每次动作。
  const links=new Map();
  const references=new Map();
  function connect(from,to,label,live=false){
    if(!byId.has(from) || !byId.has(to))return;
    const key=JSON.stringify([from,to]);
    if(!links.has(key))links.set(key,{from,to,live:false});
    if(live)links.get(key).live=true;
    for(const [a,b] of [[from,to],[to,from]]){
      if(!references.has(a))references.set(a,new Map());
      const related=references.get(a);
      if(!related.has(b))related.set(b,new Set());
      related.get(b).add(label);
    }
  }
  for(const row of data.decisions){
    const episode='episode:'+row.episode;
    for(const id of row.evidence){
      connect(episode,'memory:'+id,decisions[row.action] || row.action,liveDecisionIds.has(row.id));
    }
  }
  for(const episode of episodes){
    for(const event of episode.events){
      if(event.type==='activity.started' && event.details.clip)
        connect('episode:'+episode.id,'action:'+event.details.clip,'有实际播放回执');
    }
  }
  for(const file of data.warehouseFiles || []){
    if(file.batch)connect('episode:batch:'+file.batch,'file:'+file.id,'同一归档批次');
  }
  const edges=svg('g',{'aria-hidden':'true'});
  const paths=[];
  for(const {from,to,live} of links.values()){
    if(!positions.has(from) || !positions.has(to))continue;
    const path=svg('path',{class:live?'star-link recent-hit':'star-link'});
    paths.push({from,to,path});edges.append(path);
  }
  map.append(edges);
  const stars=new Map(),layer=svg('g'),regionLayer=svg('g',{'aria-hidden':'true'});
  const regionMarks=new Map();
  for(const [kind,{label,x,y,z}] of Object.entries(regions)){
    if(!visible.some(node=>clusterOf(node)===kind))continue;
    const mark=svg('g',{class:'region region-'+kind});
    const text=svg('text',{y:-35});text.textContent=label;
    for(let i=0;i<62;i++){
      const angle=random()*Math.PI*2,spread=Math.sqrt(random());
      mark.append(svg('circle',{cx:Math.cos(angle)*spread*119,cy:Math.sin(angle)*spread*50,
        r:.55+random()*1.3,opacity:.15+random()*.38}));
    }
    mark.append(text);regionLayer.append(mark);
    regionMarks.set(mark,[x,y,z]);
  }
  map.insertBefore(regionLayer,edges);
  map.append(layer);
  function project(){
    const cosYaw=Math.cos(starYaw),sinYaw=Math.sin(starYaw);
    const cosPitch=Math.cos(starPitch),sinPitch=Math.sin(starPitch);
    const projected=new Map();
    function position([x,y,z]){
      const across=x*cosYaw-z*sinYaw,depth=x*sinYaw+z*cosYaw;
      const vertical=y*cosPitch-depth*sinPitch;
      const front=y*sinPitch+depth*cosPitch;
      const scale=780/(780-front);
      return {x:450+across*scale,y:218+vertical*scale,z:front,s:scale};
    }
    for(const [mark,coords] of regionMarks){
      const p=position(coords);
      mark.setAttribute('transform',`translate(${p.x} ${p.y}) scale(${p.s})`);
    }
    for(const [id,coords] of positions){
      const p=position(coords),focused=id===graphFocus;
      if(focused)p.s*=1.35;
      projected.set(id,p);
      const star=stars.get(id);
      star.setAttribute('transform',`translate(${p.x} ${p.y}) scale(${p.s})`);
      star.classList.toggle('distant',p.z<-45 && !focused);
    }
    const sorted=[...projected.keys()].sort((a,b)=>projected.get(a).z-projected.get(b).z);
    sorted.forEach((id,index)=>{const star=stars.get(id);if(layer.children[index]!==star)layer.insertBefore(star,layer.children[index] || null);});
    for(const {from,to,path} of paths){
      const a=projected.get(from),b=projected.get(to);
      path.setAttribute('d',`M ${a.x} ${a.y} Q ${(a.x+b.x)/2} ${Math.min(a.y,b.y)-35} ${b.x} ${b.y}`);
    }
  }
  function jumpTo(id){
    let index=filtered.indexOf(byId.get(id));
    if(index<0){
      $('graphSearch').value='';$('graphKind').value='all';
      index=nodes.indexOf(byId.get(id));
    }
    graphFocus=id;
    graphPage=Math.floor(index/graphPageSize);
    drawGraph(episodes);
    [...view.querySelectorAll('[role="button"]')].find(node=>node.dataset.star===id)?.focus();
  }
  function show(id){
    graphFocus=id;
    const node=byId.get(id),related=references.get(id);
    const focused=document.activeElement;
    for(const [key,star] of stars){
      star.setAttribute('aria-pressed',String(key===id));
      star.classList.toggle('related',Boolean(related?.has(key)));
      star.classList.toggle('dimmed',Boolean(id && key && key!==id && !related?.has(key)));
    }
    for(const link of paths)link.path.classList.toggle('highlight',id===link.from || id===link.to);
    project();
    if(focused?.matches('.star') && focused.isConnected)focused.focus({preventScroll:true});
    details.replaceChildren();
    if(!id){
      details.append(el('h2','记忆动态'),el('p','点选星点查看来源和关联。','hint'));
      if(data.warehouseFiles===null)details.append(el('p','暂时无法读取仓库台账。','hint'));
      const recent=data.decisions.filter(row=>byId.has('episode:'+row.episode)).slice(0,8);
      if(!recent.length)details.append(el('p','有新的桌面决策时会在这里显示。','hint'));
      for(const row of recent){
        const target='episode:'+row.episode;
        const item=button(decisions[row.action] || row.action,()=>jumpTo(target),'related-star');
        item.append(el('small',time.format(row.at)+' · '+byId.get(target).title));
        details.append(item);
      }
      return;
    }
    const close=button('×',()=>{show('');stars.get(id)?.focus({preventScroll:true});},'drawer-close');
    close.setAttribute('aria-label','收起星图详情');
    details.append(close);
    if(!node){
      details.append(el('h2','大肥鱼'),el('p',[
        [nodes.filter(node=>node.kind==='memory').length,'条长期记忆'],
        [episodes.length,'段近期经历'],[(data.warehouseFiles || []).length,'份仓库文件'],[(data.actions || []).length,'个动作']
      ].map(([n,label])=>n+' '+label).join(' · '),'graph-meta'));
      return;
    }
    details.append(el('p',({memory:'长期记忆',episode:'共同经历',file:'仓库文件',action:'动作档案'})[node.kind],'graph-meta'));
    if(node.kind==='memory')details.append(recordCard(node.row));
    if(node.kind==='episode'){
      details.append(el('h2',node.title),el('p',time.format(node.at)+' · '+node.row.events.length+' 条记录','hint'));
      details.append(button('打开经历回放',()=>{
        selected=node.row.id;currentStep=0;$('onlyToday').checked=false;switchTab('today');
      }));
    }
    if(node.kind==='file'){
      const {path,format,added,correctedFrom}=node.row;
      details.append(el('h2',node.title),el('p',path,'hint'),el('p',[format,added].filter(Boolean).join(' · '),'hint'));
      if(correctedFrom.length)details.append(el('p','曾从 '+correctedFrom.join('、')+' 调整到当前目录。','decision'));
    }
    if(node.kind==='action'){
      const {scene,runs,lastAt,lastStatus,lastReason,preview}=node.row;
      details.append(el('h2',node.title));
      if(scene)details.append(el('p',scene,'hint'));
      details.append(el('p',runs?'近期有 '+runs+' 次播放回执，最近一次：'+lastStatus+' · '+time.format(lastAt):'近期没有播放回执。','hint'));
      if(lastReason)details.append(el('p',lastReason,'hint'));
      if(preview){
        const video=el('video','','preview');
        video.controls=true;video.muted=true;video.preload='none';video.src=clipUrl(node.title);details.append(video);
      }
    }
    details.append(el('h3','关联记录','related-title'));
    if(!related?.size)details.append(el('p','暂无关联记录。','hint'));
    else for(const [target,actions] of related){
      const link=button(byId.get(target).title,()=>jumpTo(target),'related-star');
      link.append(el('small',[...actions].join(' · ')));details.append(link);
    }
    details.scrollTop=0;
  }
  function makeStar(id,label,kind,index){
    const star=svg('g',{class:'star star-'+kind,tabindex:'0',role:'button','aria-label':label,'data-star':id});
    const core=kind==='core',radius=core?36:Math.max(4.3,9-index*.1);
    if(paths.some(link=>(link.from===id || link.to===id) && link.path.classList.contains('recent-hit')))star.classList.add('recent-hit');
    const title=svg('title');title.textContent=label;
    star.append(title,svg('circle',{class:'star-halo',r:radius+13}),svg('circle',{class:'star-disk',r:radius,fill:`url(#star-${kind})`}));
    if(core)star.append(svg('image',{href:'dafeiyu-default.png',x:-39,y:-39,width:78,height:78}));
    const letters=Array.from(label),limit=11;
    const caption=svg('text',{y:radius+20});
    caption.textContent=letters.length>limit?letters.slice(0,limit).join('')+'…':label;
    star.append(caption);
    star.onclick=()=>{if(!ignoreClick)show(id);};
    star.onkeydown=e=>{if(e.key==='Enter' || e.key===' '){e.preventDefault();show(id);}};
    stars.set(id,star);layer.append(star);
  }
  let drag=null,ignoreClick=false;
  map.onpointerdown=e=>{if(e.button===0)drag={id:e.pointerId,x:e.clientX,y:e.clientY,yaw:starYaw,pitch:starPitch,moved:false};};
  map.onpointermove=e=>{
    if(drag?.id!==e.pointerId)return;
    const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
    if(!drag.moved && Math.hypot(dx,dy)<5)return;
    if(!drag.moved){drag.moved=true;map.setPointerCapture(e.pointerId);}
    starYaw=drag.yaw+dx*.008;
    starPitch=Math.max(-.68,Math.min(.68,drag.pitch+dy*.006));
    project();
  };
  map.onpointerup=map.onpointercancel=e=>{
    if(drag?.id!==e.pointerId)return;
    ignoreClick=drag.moved;
    drag=null;
    if(ignoreClick)setTimeout(()=>{ignoreClick=false;},0);
  };
  map.onpointerleave=()=>{if(drag && !drag.moved)drag=null;};
  map.addEventListener('wheel',e=>{
    e.preventDefault();
    setGraphZoom(Math.max(0,Math.min(zoomLevels.length-1,graphZoom+(e.deltaY<0?1:-1))),true);
  },{passive:false});
  resetStarCamera=()=>{starYaw=starPitch=0;show('');setGraphZoom(0);view.scrollTo(0,0);};
  details.onkeydown=e=>{if(e.key==='Escape' && graphFocus)details.querySelector('.drawer-close')?.click();};
  map.onkeydown=details.onkeydown;
  makeStar('core','大肥鱼','core',0);
  visible.forEach((node,i)=>makeStar(node.id,node.title,clusterOf(node),i));
  view.replaceChildren(map);
  setGraphZoom(graphZoom);
  show(graphFocus);
}
function drawMemories(){
  if(!data?.available)return;
  const query=$('search').value.trim().toLocaleLowerCase(),box=$('memories');
  const list=data.memories.filter(row=>!query ||
    [row.summary,row.label,row.evidence,source[row.source]].some(v=>String(v||'').toLocaleLowerCase().includes(query)));
  box.replaceChildren(...list.slice(0,manageLimit).map(row=>recordCard(row,true)));
  if(list.length>manageLimit)box.append(button('显示更多（'+manageLimit+' / '+list.length+'）',()=>{
    manageLimit+=100;drawMemories();
  }));
  if(!list.length)box.append(el('p',query?'没有匹配的记忆。':'还没有长期记忆，可以先添加一条偏好。','hint'));
}
function render(){
  if(!data?.available)return;
  const list=getEpisodes(),today=new Date(data.now).toDateString();
  const filtered=$('onlyToday').checked?list.filter(g=>new Date(g.at).toDateString()===today):list;
  const group=pickEpisode(tab==='today'?filtered:list);
  if(tab==='today'){drawList($('episodes'),filtered,group);drawEpisode(group);}
  if(tab==='graph')drawGraph(list);
  if(tab==='manage')drawMemories();
}
function drawEditor(){
  const id=$('key').value,initial=data?.memories?.find(m=>m.key===id && m.status==='active')?.value;
  const box=$('editor');box.replaceChildren();
  const field=(label,node)=>{const wrapper=el('label',label);wrapper.append(node);box.append(wrapper);return node;};
  if(id==='quiet_hours'){
    for(const [key,name,def] of [['start','从','22:00'],['end','到','07:00']]){
      const input=el('input');input.id=key;input.type='time';input.required=true;input.value=initial?.[key]||def;field(name,input);
    }
    return;
  }
  if(id==='note'){
    const input=el('textarea');input.id='value';input.maxLength=180;input.rows=3;input.required=true;field('记住这件事',input);return;
  }
  const options={
    work_move:[['true','在原地观察'],['false','允许走动']],
    disdain:[['often','正常使用'],['less','半小时内最多一次'],['off','暂停使用']],
    persona:[['curious','好奇，喜欢观察'],['calm','安静，偏向陪伴'],['playful','活泼，喜欢玩耍']]
  };
  const input=el('select');input.id='value';
  for(const [value,label] of options[id]){const opt=el('option',label);opt.value=value;input.append(opt);}
  if(initial!==undefined)input.value=String(initial);
  field('设置',input);
}
function apply(next,background=false){
  const ids=new Set((next?.decisions || []).map(row=>row.id).filter(Boolean));
  liveDecisionIds=new Set(lastGraphDecisions?[...ids].filter(id=>!lastGraphDecisions.has(id)):[]);
  lastGraphDecisions=ids;
  const fingerprint=JSON.stringify([next?.id,next?.available,next?.timeline,next?.memories,next?.decisions,next?.actions,next?.warehouseFiles]);
  const changed=fingerprint!==graphFingerprint;
  graphFingerprint=fingerprint;
  data=next;
  if(!data?.available){
    for(const id of ['constellation','graphDetail','episodes','episode','memories'])$(id).replaceChildren();
    $('graphCount').textContent='';$('graphEmpty').hidden=false;$('graphEmpty').textContent='记忆库暂不可用，刷新后重试';
    $('graphPrev').disabled=$('graphNext').disabled=true;
    return;
  }
  const pet=$('pets');pet.replaceChildren(...data.ids.map(id=>{const opt=el('option',id);opt.value=id;return opt;}));
  pet.value=data.id;$('petLabel').hidden=data.ids.length<=1;$('suggest').checked=data.suggest;
  if(!background)drawEditor();
  if(!background || changed)render();
}
async function load(id,background=false){
  if(busy)return;
  busy=true;
  try{apply(await window.fishNotebook.view(id),background);if(!background)$('message').textContent='';}
  catch{if(!background)$('message').textContent='暂时无法读取记忆舱。';}
  finally{busy=false;}
}
async function change(request){
  if(busy || !data?.available)return;
  busy=true;
  try{apply(await window.fishNotebook.change(data.id,request));$('message').textContent='记忆已更新。';}
  catch(e){$('message').textContent='保存失败。'+String(e.message).split('Error: ').at(-1);}
  finally{busy=false;}
}
function switchTab(next){
  tab=next;
  document.querySelectorAll('[data-tab]').forEach(x=>x.setAttribute('aria-pressed',String(x.dataset.tab===tab)));
  for(const id of ['today','graph','manage'])$(id).hidden=tab!==id;
  if(tab!=='today')$('episode').replaceChildren();
  render();
}
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
window.fishNotebook.onFocusGraph?.(()=>{if(tab!=='graph')switchTab('graph');});
$('refresh').onclick=()=>load(data?.id);
$('pets').onchange=()=>{selected='';currentStep=0;graphFocus='';graphPage=0;manageLimit=100;lastGraphDecisions=null;void load($('pets').value);};
$('graphSearch').oninput=$('graphKind').onchange=()=>{graphPage=0;graphFocus='';render();};
$('graphPrev').onclick=()=>{graphPage--;graphFocus='';render();};
$('graphNext').onclick=()=>{graphPage++;graphFocus='';render();};
$('graphZoomOut').onclick=()=>setGraphZoom(Math.max(0,graphZoom-1),true);
$('graphZoomIn').onclick=()=>setGraphZoom(Math.min(zoomLevels.length-1,graphZoom+1),true);
$('graphZoomReset').onclick=()=>setGraphZoom(0,true);
$('graphResetView').onclick=()=>resetStarCamera();
$('key').onchange=drawEditor;
$('onlyToday').onchange=render;
$('search').oninput=()=>{manageLimit=100;drawMemories();};
$('suggest').onchange=()=>change({op:'suggestions',value:$('suggest').checked});
$('preference').onsubmit=e=>{
  e.preventDefault();
  const key=$('key').value,value=key==='quiet_hours'?{start:$('start').value,end:$('end').value}:
    key==='work_move'?$('value').value==='true':$('value').value;
  void change({op:'save',key,value});
};
drawEditor();void load();
setInterval(()=>{if(tab==='graph' && !document.hidden)void load(data?.id,true);},4000);
