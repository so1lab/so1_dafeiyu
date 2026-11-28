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
let graphFocus='',graphBranch='',graphPage=0,graphZoom=0;
let manageLimit=100;
let starYaw=0,starPitch=0,resetStarCamera=()=>{};
const regions={
  memory:{label:'行为偏好',x:-238,y:-82,z:16},
  chat:{label:'沟通记忆',x:-98,y:-137,z:-22},
  episode:{label:'共同经历',x:90,y:116,z:24},
  file:{label:'仓库文件',x:-207,y:92,z:-24},
  action:{label:'动作档案',x:227,y:-9,z:43},
  knowledge:{label:'知识库',x:127,y:-111,z:12}
};
const graphRegion=node=>node.region || (node.kind==='memory' && node.row.key==='note'?'chat':node.kind);
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
  const knowledge=(data.knowledge || []).map(row=>({id:'knowledge:'+row.id,kind:'knowledge',title:row.label,row}));
  return [...memories,...events,...files,...actions,...knowledge];
}
function graphTree(episodes){
  const records=graphNodes(episodes),byId=new Map(),children=new Map();
  function add(node,parent){
    if(byId.has(node.id))return;
    byId.set(node.id,{...node,parent});
    if(!children.has(parent))children.set(parent,[]);
    children.get(parent).push(byId.get(node.id));
  }
  for(const [region,{label}] of Object.entries(regions))add({id:'region:'+region,kind:'region',region,title:label,row:{}},'');
  for(const node of records){
    const region=graphRegion(node);
    let parent='region:'+region;
    if(node.kind==='file'){
      const folders=String(node.row.folder || node.row.path || '').split('/');
      if(!node.row.folder)folders.pop();
      const prefixes=[];
      for(const folder of folders.filter(name=>name && name!=='.')){
        prefixes.push(folder);
        const relative=prefixes.join('/'),id='folder:'+relative;
        add({id,kind:'folder',region,title:folder,row:{path:relative}},parent);
        parent=id;
      }
    }
    add(node,parent);
    if(node.kind==='knowledge'){
      for(const document of node.row.documents){
        const id=node.id+'/doc/'+document;
        const title=document.replace(/\/$/u,'').split('/').at(-1);
        const sections=node.row.sections?.[document]||[];
        add({id,kind:'document',region,title,row:{path:document,library:node.title,version:node.row.version}},node.id);
        sections.forEach((section,index)=>add({id:id+'/section/'+index,kind:'section',region,title:section.title,
          row:{...section,path:document,library:node.title,version:node.row.version}},id));
      }
    }
    if(node.kind==='episode')node.row.events.forEach((event,index)=>add({id:'event:'+event.id,kind:'event',region,
      title:event.details.line || event.text,at:event.at,row:{event,episode:node.row.id,index}},node.id));
  }
  return {records,byId,children};
}
function filteredStars(nodes){
  const query=$('graphSearch').value.trim().normalize('NFKC').toLocaleLowerCase();
  const kind=$('graphKind').value;
  return nodes.filter(node=>(kind==='all' || kind===graphRegion(node)) && (!query ||
    [node.title,node.at?time.format(node.at):'',node.row.label,node.row.evidence,source[node.row.source],
      node.row.path,node.row.format,node.row.scene,node.row.version,...(node.row.correctedFrom || []),
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
function drawGraph(episodes,animateBranch=false){
  const view=$('constellation'),details=$('graphDetail');
  const focusedStar=view.contains(document.activeElement)?document.activeElement.dataset.star:'';
  const {records,byId,children}=graphTree(episodes);
  if(graphBranch && !children.has(graphBranch))graphBranch=graphFocus='';
  const branch=byId.get(graphBranch);
  const query=$('graphSearch').value.trim();
  const activeRegion=$('graphKind').value;
  const showCore=!branch && activeRegion==='all' && !query;
  const hubs=(children.get('')||[]).filter(hub=>children.has(hub.id));
  const groups=hubs.map(hub=>children.get(hub.id));
  const overviewNodes=[];
  for(let i=0;i<Math.max(0,...groups.map(group=>group.length));i++)for(const group of groups)if(group[i])overviewNodes.push(group[i]);
  const filtered=branch?children.get(branch.id):query?filteredStars([...byId.values()]):filteredStars(overviewNodes);
  const pageSize=branch?20:graphPageSize;
  const anchors=branch?[branch]:showCore?hubs:[];
  document.querySelectorAll('[data-region]').forEach(control=>{
    const id='region:'+control.dataset.region;
    control.setAttribute('aria-pressed',String(control.dataset.region===(branch?.region || activeRegion)));
    control.disabled=!children.has(id);
    control.onclick=()=>openBranch(graphBranch===id?'':id);
  });
  const pages=Math.max(1,Math.ceil(filtered.length/pageSize));
  graphPage=Math.min(graphPage,pages-1);
  const visible=filtered.slice(graphPage*pageSize,(graphPage+1)*pageSize);
  if(graphFocus!=='core' && ![...visible,...anchors].some(node=>node.id===graphFocus))graphFocus=branch?.id || '';
  const empty=$('graphEmpty');
  empty.hidden=visible.length>0;
  empty.textContent=records.length?'没有匹配的星星':'大肥鱼还没有记录到记忆或经历';
  $('graphCount').textContent=filtered.length+' 颗星'+(pages>1?' · '+(graphPage+1)+' / '+pages:'');
  $('graphPrev').disabled=graphPage===0;
  $('graphNext').disabled=graphPage>=pages-1;

  function openBranch(id,focus=id){
    const index=(children.get(id)||[]).findIndex(node=>node.id===focus);
    graphBranch=id;graphFocus=focus;graphPage=Math.floor(Math.max(0,index)/20);graphZoom=0;
    $('graphSearch').value='';$('graphKind').value='all';
    starYaw=starPitch=0;
    drawGraph(episodes,Boolean(id));
    const focusId=focus || 'core';
    view.querySelectorAll('[data-star]').forEach(star=>{
      if(star.dataset.star===focusId)star.focus({preventScroll:true});
    });
  }
  const trail=$('graphTrail'),parents=[];
  for(let item=branch;item;item=byId.get(item.parent))parents.unshift(item);
  trail.hidden=!branch;
  trail.replaceChildren();
  if(branch){
    trail.append(button('全图',()=>openBranch('')));
    parents.forEach(item=>{
      trail.append(el('span','›','trail-divider'),item.id===branch.id?el('strong',item.title):button(item.title,()=>openBranch(item.id)));
    });
  }

  const svg=(tag,attrs={})=>{
    const node=document.createElementNS('http://www.w3.org/2000/svg',tag);
    for(const [key,value] of Object.entries(attrs))node.setAttribute(key,value);
    return node;
  };
  const map=svg('svg',{viewBox:'0 0 900 470',role:'group','aria-label':'大肥鱼的全局记忆星图'});
  if(animateBranch)map.classList.add('branch-enter');
  // Keep the background fixed while the actual nodes rotate or filter.
  const guides=svg('g',{class:'sky-guides','aria-hidden':'true'});
  for(const [rx,ry] of [[96,52],[182,101],[275,150],[359,195]])guides.append(svg('ellipse',{cx:450,cy:218,rx,ry}));
  guides.append(svg('path',{d:'M 32 218 H 868 M 450 18 V 435'}));
  map.append(guides);
  const dust=svg('g',{class:'sky-dust','aria-hidden':'true'});
  let seed=2841;
  const random=()=>{seed=(seed*16807)%2147483647;return seed/2147483647;};
  for(let i=0;i<98;i++){
    dust.append(svg('circle',{cx:(random()*900).toFixed(1),cy:(random()*470).toFixed(1),
      r:(.25+random()*.8).toFixed(1),opacity:(.12+random()*.39).toFixed(2)}));
  }
  map.append(dust);
  const positions=new Map();
  if(branch){
    positions.set(branch.id,[0,0,0]);
    visible.forEach((node,i)=>{
      const inside=visible.length>11 && i<7;
      const index=visible.length>11 && !inside?i-7:i;
      const count=visible.length<=11?visible.length:inside?7:visible.length-7;
      const angle=-Math.PI/2+2*Math.PI*index/count+(inside?.15:0);
      const radius=visible.length===1?127:inside?132:Math.min(268,148+visible.length*7);
      positions.set(node.id,[Math.cos(angle)*radius,Math.sin(angle)*radius*.57,Math.cos(i*2)*30]);
    });
  }else for(const [kind,{x,y,z}] of Object.entries(regions)){
    const cluster=visible.filter(node=>graphRegion(node)===kind);
    const cx=activeRegion===kind?0:x,cy=activeRegion===kind?0:y;
    if(showCore && anchors.some(node=>node.region===kind))positions.set('region:'+kind,[x,y,z]);
    cluster.forEach((node,i)=>{
      const angle=i*2.39996+.6;
      const spread=activeRegion===kind?55+Math.sqrt(i)*23:34+Math.sqrt(i)*Math.min(15,78/Math.sqrt(cluster.length));
      positions.set(node.id,[cx+Math.cos(angle)*spread*1.32,cy+Math.sin(angle)*spread*.68,z+Math.sin(i*2.02)*50]);
    });
  }
  if(showCore)positions.set('core',[0,-12,0]);
  // 归属线和有实际回执的关联分别绘制，详情只列出可核对的关联。
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
  function branchLink(from,to){
    if(!positions.has(from) || !positions.has(to))return;
    const path=svg('path',{class:branch?'branch-link expanded':'branch-link','data-tone':graphRegion(byId.get(to))});
    paths.push({from,to,path,branch:true});edges.append(path);
  }
  if(branch)visible.forEach(node=>branchLink(branch.id,node.id));
  if(showCore){
    for(const hub of anchors)branchLink('core',hub.id);
    for(const node of visible)branchLink(node.parent,node.id);
  }
  for(const {from,to,live} of links.values()){
    if(!positions.has(from) || !positions.has(to))continue;
    const path=svg('path',{class:live?'star-link recent-hit':'star-link'});
    paths.push({from,to,path});edges.append(path);
  }
  map.append(edges);
  const stars=new Map(),layer=svg('g');
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
    for(const {from,to,path,branch:membership} of paths){
      const a=projected.get(from),b=projected.get(to);
      const midX=(a.x+b.x)/2,midY=membership?(a.y+b.y)/2-7:Math.min(a.y,b.y)-35;
      path.setAttribute('d',`M ${a.x} ${a.y} Q ${midX} ${midY} ${b.x} ${b.y}`);
    }
  }
  function jumpTo(id){
    const node=byId.get(id);
    if(!node)return;
    if(children.has(id)){openBranch(id);return;}
    const index=filtered.indexOf(node);
    if(index<0){
      openBranch(node.parent,id);return;
    }
    graphFocus=id;
    graphPage=Math.floor(index/pageSize);
    drawGraph(episodes);
    [...view.querySelectorAll('[role="button"]')].find(node=>node.dataset.star===id)?.focus();
  }
  function overview(){
    const grid=el('div','','map-summary');
    for(const [key,{label}] of Object.entries(regions)){
      const count=records.filter(node=>graphRegion(node)===key).length;
      const item=button(label,()=>openBranch('region:'+key),'summary-row');
      item.dataset.tone=key;
      item.disabled=count===0;
      item.append(el('span',String(count)));
      grid.append(item);
    }
    details.append(el('h2','记忆总览'),grid);
  }
  function show(id){
    graphFocus=id;
    const node=byId.get(id),related=references.get(id);
    const subitems=children.get(id)||[];
    const focused=document.activeElement;
    for(const [key,star] of stars){
      star.setAttribute('aria-pressed',String(key===id));
      star.classList.toggle('related',Boolean(related?.has(key)));
      const directFamily=key===node?.parent || byId.get(key)?.parent===id;
      star.classList.toggle('dimmed',Boolean(id && key && key!==id && !related?.has(key) && !directFamily));
    }
    for(const link of paths)link.path.classList.toggle('highlight',id===link.from || id===link.to);
    project();
    if(focused?.matches('.star') && focused.isConnected)focused.focus({preventScroll:true});
    details.replaceChildren();
    if(!id){
      overview();
      if(data.warehouseFiles===null)details.append(el('p','暂时无法读取仓库台账。','hint'));
      const recent=data.decisions.filter(row=>byId.has('episode:'+row.episode)).slice(0,8);
      if(recent.length)details.append(el('h3','最近关联','related-title'));
      for(const row of recent){
        const target='episode:'+row.episode;
        const item=button(decisions[row.action] || row.action,()=>jumpTo(target),'related-star');
        item.append(el('small',time.format(row.at)+' · '+byId.get(target).title));
        details.append(item);
      }
      return;
    }
    const close=button('×',()=>{
      if(branch?.id===id){openBranch(branch.parent,branch.parent);return;}
      show(branch?.id || '');stars.get(id)?.focus({preventScroll:true});
    },'drawer-close');
    close.setAttribute('aria-label','收起星图详情');
    details.append(close);
    if(!node){
      overview();
      return;
    }
    const labels={memory:'长期记忆',episode:'共同经历',file:'仓库文件',action:'动作档案',knowledge:'本地知识库',
      region:'分类',folder:'仓库目录',document:'来源文档',section:'文档章节',event:'经历节点'};
    details.append(el('p',labels[node.kind],'graph-meta'));
    if(node.kind==='region' || node.kind==='folder'){
      details.append(el('h2',node.title));
      if(node.row.path)details.append(el('p',node.row.path,'hint'));
    }
    if(node.kind==='knowledge'){
      const {version,documents,passages}=node.row;
      details.append(el('h2',node.title),el('p',version+' · '+documents.length+' 项来源 · '+passages+' 段','hint'));
    }
    if(node.kind==='document' || node.kind==='section'){
      const {library,path,version,passages}=node.row;
      details.append(el('h2',node.title),el('p',library+' · '+version,'hint'),el('p',path,'hint'));
      if(passages)details.append(el('p',passages+' 个已索引片段','hint'));
    }
    if(node.kind==='event'){
      details.append(el('h2',node.title),el('p',time.format(node.at),'hint'));
      if(node.row.event.details.clip)details.append(el('p','动作 · '+node.row.event.details.clip,'hint'));
      details.append(button('回放到这一步',()=>{
        selected=node.row.episode;currentStep=node.row.index;$('onlyToday').checked=false;switchTab('today');
      }));
    }
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
      if(correctedFrom?.length)details.append(el('p','曾从 '+correctedFrom.join('、')+' 调整到当前目录。','decision'));
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
    if(subitems.length){
      details.append(el('h3','子项 · '+subitems.length,'related-title'));
      const pageItems=branch?.id===id?visible:subitems.slice(0,20);
      for(const item of pageItems)details.append(button(item.title,()=>jumpTo(item.id),'related-star branch-item'));
    }
    if(related?.size){
      details.append(el('h3','关联记录','related-title'));
      for(const [target,actions] of related){
        const link=button(byId.get(target).title,()=>jumpTo(target),'related-star');
        link.append(el('small',[...actions].join(' · ')));details.append(link);
      }
    }
    details.scrollTop=0;
  }
  function makeStar(id,label,kind,index){
    const star=svg('g',{class:'star star-'+kind,tabindex:'0',role:'button','aria-label':label,'data-star':id});
    const core=kind==='core',hub=anchors.some(node=>node.id===id),hasChildren=children.has(id);
    const radius=core?13:hub?10:hasChildren?7:Math.max(3,5.4-index*.04);
    if(hub || branch && visible.length<=10)star.classList.add('star-caption');
    if(hasChildren){
      star.classList.add('star-parent');
      star.setAttribute('aria-expanded',String(branch?.id===id));
      star.setAttribute('aria-label',label+'，'+children.get(id).length+' 个子项');
    }
    if(paths.some(link=>(link.from===id || link.to===id) && link.path.classList.contains('recent-hit')))star.classList.add('recent-hit');
    const title=svg('title');title.textContent=label;
    star.append(title,svg('circle',{class:'star-hit',r:core?28:14}),
      svg('circle',{class:'star-halo',r:radius+(core?10:5)}),svg('circle',{class:'star-disk',r:radius}));
    if(core || hasChildren)star.append(svg('path',{class:'core-mark',d:branch?.id===id?'M -3 0 H 3':'M -3 0 H 3 M 0 -3 V 3'}));
    const letters=Array.from(label),limit=hub?13:10;
    const caption=svg('text',{y:radius+17});
    caption.textContent=letters.length>limit?letters.slice(0,limit).join('')+'…':label;
    star.append(caption);
    const activate=()=>{if(hasChildren && branch?.id!==id)openBranch(id);else show(id);};
    star.onclick=()=>{if(!ignoreClick)activate();};
    star.onkeydown=e=>{if(e.key==='Enter' || e.key===' '){e.preventDefault();activate();}};
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
  resetStarCamera=()=>{starYaw=starPitch=0;show(branch?.id || '');setGraphZoom(0);view.scrollTo(0,0);};
  details.onkeydown=e=>{if(e.key==='Escape' && graphFocus)details.querySelector('.drawer-close')?.click();};
  map.onkeydown=details.onkeydown;
  if(showCore)makeStar('core','记忆总览','core',0);
  anchors.forEach(node=>makeStar(node.id,node.title,graphRegion(node),0));
  visible.forEach((node,i)=>makeStar(node.id,node.title,graphRegion(node),i));
  view.replaceChildren(map);
  setGraphZoom(graphZoom);
  show(graphFocus);
  if(focusedStar)stars.get(focusedStar)?.focus({preventScroll:true});
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
  const fingerprint=JSON.stringify([next?.id,next?.available,next?.timeline,next?.memories,next?.decisions,next?.actions,next?.warehouseFiles,next?.knowledge]);
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
  document.body.classList.toggle('graph-view',tab==='graph');
  document.querySelectorAll('[data-tab]').forEach(x=>x.setAttribute('aria-pressed',String(x.dataset.tab===tab)));
  for(const id of ['today','graph','manage'])$(id).hidden=tab!==id;
  if(tab!=='today')$('episode').replaceChildren();
  render();
}
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
window.fishNotebook.onFocusGraph?.(()=>{if(tab!=='graph')switchTab('graph');});
$('refresh').onclick=()=>load(data?.id);
$('pets').onchange=()=>{selected='';currentStep=0;graphFocus=graphBranch='';graphPage=0;manageLimit=100;lastGraphDecisions=null;void load($('pets').value);};
$('graphSearch').oninput=$('graphKind').onchange=()=>{graphPage=0;graphFocus=graphBranch='';render();};
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
