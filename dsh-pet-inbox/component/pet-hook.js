// Installed inside the upstream sandboxed preload. File paths come only from trusted OS drops.
{
  const {ipcRenderer: courier, webUtils} = require('electron');
  let parcel;
  let timer;
  function badge(message) {
    clearTimeout(timer);
    if (!parcel) {
      parcel = document.createElement('div');
      Object.assign(parcel.style, {position:'fixed',zIndex:'2147483647',pointerEvents:'none',
        color:'white',background:'#164539',borderRadius:'12px',padding:'3px 9px',font:'12px sans-serif'});
      document.body.append(parcel);
    }
    const bounds = document.querySelector('.pet-hit')?.getBoundingClientRect();
    parcel.style.left = Math.max(0,Math.min(innerWidth-118,bounds?.left || 0))+'px';
    parcel.style.top = Math.max(0,(bounds?.top || 25)-23)+'px';
    parcel.hidden=false;
    parcel.textContent=message;
    parcel.style.maxWidth='260px';
    timer=setTimeout(()=>{parcel.hidden=true;},message.length>45?8500:3500);
  }
  // 只接管宠物身体上的系统文件投放；按住 Shift 时保留上游的图片聊天。
  function isFileDrag(e) {
    return e.isTrusted && !e.shiftKey && e.target.closest?.('.pet-hit') && Array.from(e.dataTransfer.types).includes('Files');
  }
  let hovering=false, lastDrop=null, buttons;
  const mouth=()=>{const r=document.querySelector('.pet-hit').getBoundingClientRect();return {x:r.left+r.width*.49,y:r.top+r.height*.55};};
  function pose(stage){
    courier.send('inbox:mouth-pose',stage);
  }
  function leave(){
    if(!hovering)return;
    hovering=false;pose('leave');
    if(parcel)parcel.hidden=true;
  }
  function paper(label,from,to,reverse=false){
    const card=document.createElement('div');
    card.dataset.inboxBite='true';card.textContent=label;
    Object.assign(card.style,{position:'fixed',left:from.x+'px',top:from.y+'px',zIndex:2147483646,pointerEvents:'none',
      background:'#fff5d9',color:'#3b4032',border:'1px solid #b69c69',boxShadow:'0 3px 8px #20362738',borderRadius:'3px 8px 4px 4px',
      maxWidth:'125px',overflow:'hidden',whiteSpace:'nowrap',textOverflow:'ellipsis',padding:'4px 8px',font:'12px Microsoft YaHei UI,sans-serif'});
    document.body.append(card);
    const dx=to.x-from.x,dy=to.y-from.y;
    const frame=(x,y,scale,angle,opacity)=>({transform:'translate(-50%,-50%) translate('+x+'px,'+y+'px) rotate('+angle+'deg) scale('+scale+')',opacity});
    const motion=card.animate(reverse?[frame(0,0,.1,0,0),frame(dx*.65,dy*.65-9,.85,-5,1),frame(dx,dy,1,0,1)]:
      [frame(0,0,1,-6,1),frame(dx*.52,dy*.52-9,.87,4,1),frame(dx,dy,.035,0,0)],{duration:reverse?480:740,easing:'ease-in-out',fill:'forwards'});
    motion.onfinish=()=>setTimeout(()=>card.remove(),reverse?550:0);
  }
  function controls(message,items){
    buttons?.remove();badge(message);
    const hit=document.querySelector('.pet-hit').getBoundingClientRect();
    const bar=document.createElement('div');buttons=bar;
    Object.assign(bar.style,{position:'fixed',left:hit.left+'px',top:(hit.top+hit.height*.7)+'px',zIndex:2147483647,display:'flex',
      flexWrap:'wrap',gap:'2px',maxWidth:hit.width+'px',pointerEvents:'auto'});
    for(const [label,action] of items){
      const b=document.createElement('button');b.textContent=label;
      Object.assign(b.style,{font:'11px Microsoft YaHei UI',background:'#fff8e7',color:'#164539',border:'1px solid #aaae92',borderRadius:'5px',padding:'3px',cursor:'pointer'});
      for(const type of ['pointerdown','pointerup','mousedown','mouseup','dblclick'])b.addEventListener(type,e=>e.stopPropagation());
      b.onclick=e=>{e.stopPropagation();bar.remove();courier.send('inbox:receipt-action',action);};bar.append(b);
    }
    document.body.append(bar);setTimeout(()=>bar.remove(),items[0][1]==='retry'?10000:3000);
  }
  courier.on('inbox:arrived',(_,msg)=>controls(msg,[['打开','open'],['改放位置','adjust']]));
  courier.on('inbox:returned',(_,msg)=>{
    if(lastDrop)paper(msg.label,mouth(),lastDrop,true);
    controls(msg.message,[['重试','retry']]);
  });
  window.addEventListener('dragleave',e=>{if(!e.relatedTarget || !e.relatedTarget.closest?.('.pet-hit'))leave();},true);
  window.addEventListener('dragover',e=>{
    if(!isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect='copy';
    if(e.altKey){leave();badge('松手选择搬运方式');}
    else if(!hovering){hovering=true;pose('ready');badge('松手收进大肥鱼仓库');}
  },true);
  window.addEventListener('drop',e=>{
    if(!isFileDrag(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const files=Array.from(e.dataTransfer.files, f=>webUtils.getPathForFile(f)).filter(Boolean);
    hovering=false;
    if(!files.length)return;
    if(e.altKey){pose('leave');courier.send('inbox:carry',files);return;}
    lastDrop={x:e.clientX,y:e.clientY};
    const label=files.length===1?e.dataTransfer.files[0].name:files.length+' 份文件';
    paper(label,lastDrop,mouth());
    pose('bite');badge('收到 '+files.length+' 份');
    courier.send('inbox:auto',files);
  },true);
  window.addEventListener('dblclick',e=>{
    if(e.isTrusted && e.target.closest?.('.pet-hit')) courier.send('inbox:library');
  },true);
  courier.on('inbox:parcel',(_,state)=>{
    badge(state.message);
    if(state.delivered && !state.reduced) {
      const chip=document.createElement('span');
      const target=document.createElement('span');
      chip.textContent='📦';
      target.textContent=state.bin?'🗑️':'📁';
      const box=parcel.getBoundingClientRect();
      for(const [el,offset] of [[chip,0],[target,42]]) {
        Object.assign(el.style,{position:'fixed',pointerEvents:'none',zIndex:'2147483647',
          left:Math.max(0,Math.min(innerWidth-72,box.left))+offset+'px',
          top:Math.max(0,Math.min(innerHeight-26,box.bottom))+'px',fontSize:'20px'});
        document.body.append(el);
      }
      const motion=chip.animate([{transform:'translate(0,0)'},
        {transform:state.bin?'translate(22px,-14px) rotate(15deg)':'translate(22px,0)'},
        {transform:'translate(42px,2px) scale(.5)',opacity:0}],{duration:560,easing:'ease-out'});
      motion.onfinish=()=>{chip.remove();target.remove();};
    }
  });
}
