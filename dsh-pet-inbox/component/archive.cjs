const {screen,shell}=require('electron');
const {execFile}=require('node:child_process');
const path=require('node:path');
const actions=require('./actions.json');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function query(folder,pet,options=[]){
  const handle=pet.getNativeWindowHandle().readUInt32LE(0);
  const args=['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'locate-target.ps1'),folder,'-PetHwnd',String(handle),...options];
  return new Promise(resolve=>execFile('powershell.exe',args,{windowsHide:true,timeout:5500},(error,out)=>{
    if(error)return resolve(null);
    try{resolve(JSON.parse(out));}
    catch{resolve(null);}
  }));
}
async function locate(folder,pet,options=[]){
  const r=await query(folder,pet,options);
  return r?{...screen.screenToDipPoint({x:r.x,y:r.y}),kind:r.kind,hwnd:r.hwnd}:null;
}
async function reveal(folder,pet,opened){
  const r=await query(folder,pet,['-OpenAndLocate']);
  if(!r)return null;
  if(r.opened && r.hwnd)opened.add(r.hwnd);
  return {...screen.screenToDipPoint({x:r.x,y:r.y}),kind:r.kind,hwnd:r.hwnd};
}

// 执行脚本全部是组件自身代码。用户文件名只通过 JSON 字符串和 textContent 进入界面。
const evaluate=(pet,fn,...args)=>pet.webContents.executeJavaScript('('+fn.toString()+')('+args.map(a=>JSON.stringify(a)).join(',')+')');
function spriteGeometry(){
  const s=sprites[0],r=s.hit.getBoundingClientRect();
  if(!r.width || s.dragState.active)throw Error('桌宠正在拖动或尚未就绪');
  return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width};
}
async function geometry(pet){
  const r=await evaluate(pet,spriteGeometry),b=pet.getContentBounds(),z=pet.webContents.getZoomFactor();
  return {x:b.x+r.x*z,y:b.y+r.y*z,w:r.w*z,z};
}
function perform(clip,direction){
  const s=sprites[0];s.stopMove();s.stopThrow();
  if(direction) { s.facing=direction; s.switchTo(clip,false); }
  else s.playOnce(clip);
}
// Hold the last smile while Explorer closes, then hand control to the return run.
function celebrate(clip, timeoutMs){
  const s=sprites[0];
  s.stopMove();
  s.stopThrow();
  const video=s.front===0?s.videoB:s.videoA;
  s.playOnce(clip);
  return new Promise(resolve=>{
    const timer=setTimeout(resolve,timeoutMs);
    video.onended=()=>{clearTimeout(timer);resolve();};
  });
}
// Use the clip's playback clock: loading the video must not launch the file early.
function throwCue(clip,releaseMs){
  const s=sprites[0], video=s.front===0?s.videoB:s.videoA;
  s.stopMove();s.stopThrow();s.playOnce(clip);
  video.onended=()=>{}; // Hold the final pose while Explorer closes.
  return new Promise((resolve,reject)=>{
    const deadline=performance.now()+4500;
    function tick(){
      if(performance.now()>deadline)return reject(Error('投放素材未就绪'));
      if(video.classList.contains('is-front') && video.currentTime*1000>=releaseMs){
        const r=video.getBoundingClientRect(),card=document.getElementById('inbox-parcel-card');
        if(card){
          // Match the last painted paper on frame 17, including mirror and letterboxing.
          const width=Math.min(r.width,r.height*16/9),height=width*9/16;
          card.style.width=(width*.093)+'px';
          card.style.height=(height*.074)+'px';
          card.style.left=(r.left+(r.width-width)/2+width*(s.facing==='right'?.66:.34)-width*.0465)+'px';
          card.style.top=(r.top+(r.height-height)/2+height*.57-height*.037)+'px';
          card.style.clipPath=s.facing==='right'?'polygon(100% 0,50% 0,0 75%,35% 100%)':'polygon(0 0,50% 0,100% 75%,65% 100%)';
          card.hidden=false;
        }
        return resolve();
      }
      requestAnimationFrame(tick);
    }
    tick();
  });
}
// Advance from the visible video clock. A stalled frame cannot slide across the desktop.
async function travel(dx,dy,direction,walk,stride){
  const s=sprites[0],distance=Math.hypot(dx,dy);
  if(distance<1)return;
  if(s.dragState.active)throw Error('桌宠正在拖动');
  s.stopMove();s.stopThrow();s.facing=direction;
  s.switchTo(walk.clip,false);
  const token=s.moveToken,from={...s.pos};
  let last=null,progress=0,lastTick=performance.now();
  const phaseAt=t=>{
    const pos=Math.min(walk.phase.length-1,Math.max(0,t*24));
    const i=Math.floor(pos);
    return walk.phase[i]+(pos-i)*((walk.phase[i+1]??1)-walk.phase[i]);
  };
  while(progress<distance){
    await new Promise(requestAnimationFrame);
    if(s.moveToken!==token || s.dragState.active || s.anim!==walk.clip){
      if(s.anim===walk.clip)(s.front===0?s.videoA:s.videoB).pause();
      throw Error('移动被打断');
    }
    if(performance.now()-lastTick>3500)throw Error('步行动画停滞');
    const video=s.front===0?s.videoA:s.videoB;
    if(s.pending || !video.src.endsWith(encodeURIComponent(walk.clip)+'.webm') || video.readyState<2)continue;
    if(video.paused)await video.play();
    const current=phaseAt(video.currentTime);
    if(last!==null){
      const delta=current>=last?current-last:1-last+current;
      if(delta>0){
        lastTick=performance.now();
        progress=Math.min(distance,progress+stride*delta);
        s.sendBounds(from.x+dx*progress/distance,from.y+dy*progress/distance);
      }
    }
    last=current;
    if(progress>=distance){
      video.pause();
      s.customPos={rx:(s.pos.x+s.halfW)/VIEW.w,ry:(s.pos.y+s.halfH)/VIEW.h};
    }
  }
}
function attach(label){
  document.getElementById('inbox-parcel-card')?.remove();
  const card=document.createElement('span');card.id='inbox-parcel-card';card.title=label;
  card.hidden=true;
  Object.assign(card.style,{position:'fixed',zIndex:'10000',pointerEvents:'none',background:'#f7f1eb'});
  document.body.append(card);
}
function strideFor(g){
  return Math.min(g.w*actions.walk.strideRatio,actions.walk.pixelsPerSecond*(actions.walk.phase.length-1)/24);
}
async function release(x,y,duration){
  const card=document.getElementById('inbox-parcel-card');
  if(!card)return;
  card.dataset.release='1';
  const r=card.getBoundingClientRect(),dx=x-r.x-r.width/2,dy=y-r.y-r.height/2;
  await card.animate([{transform:'translate(0,0)'},{transform:'translate('+dx*.45+'px,'+(dy*.45-6)+'px) scale(.85)',offset:.45},
    {transform:'translate('+dx+'px,'+dy+'px) scale(.12)',opacity:0}],{duration,fill:'forwards',easing:'ease-in'}).finished;
  card.remove();
}
async function approach(pet,point,confirm){
  const g=await geometry(pet),area=screen.getDisplayNearestPoint(point).workArea;
  const gap=g.w/2+25;
  let side=g.x<point.x?-1:1;
  if(point.x+side*(gap+g.w/2)<area.x || point.x+side*(gap+g.w/2)>area.x+area.width)side=-side;
  const dx=point.x+side*gap-g.x,dy=point.y-g.w*.09-g.y;
  const stride=strideFor(g);
  const duration=Math.hypot(dx,dy)/stride*(actions.walk.phase.length-1)/24*1000;
  let timer,check;
  if(confirm)timer=setTimeout(()=>{check=confirm();},Math.max(0,duration-550));
  try{
    await evaluate(pet,travel,dx/g.z,dy/g.z,side<0?'right':'left',actions.walk,stride/g.z);
    return confirm ? await (check || confirm()) : null;
  }finally{clearTimeout(timer);}
}
module.exports=async function archive(pet,groups,onArrive,allFiled=true,journey={}){
  if(!pet || pet.isDestroyed() || !pet.isVisible())return;
  const origin=journey.origin || await geometry(pet);
  let allDelivered=allFiled;
  const opened=journey.opened || new Set();
  let lastFolder=groups[0]?.folder;
  try{
  for(const [index,group] of groups.entries()){

    const name=group.count===1?group.name:group.count+' 个文件';
    try{
      pet.webContents.send('inbox:parcel',{message:group.description || ('送到「'+path.basename(group.folder)+'」')});
      let p;
      if(index===0 && journey.first)p=await journey.first;
      else{
        const locator=module.exports.prepareLocator(pet,lastFolder || group.folder);
        p=await locator.locate(group.folder,opened,[...opened][0] || 0);
      }
      lastFolder=group.folder;
      if(!p)throw Error('未找到可见的文件夹图标');
      // Follow one fixed destination; a changed window cancels this delivery.
      const check=await approach(pet,p,()=>locate(group.folder,pet,['-NoGateway']));
      if(!check || Math.hypot(check.x-p.x,check.y-p.y)>=6)
        throw Error('目标文件夹的位置已变化');
      p=check;
      await evaluate(pet,attach,name);
      await evaluate(pet,throwCue,actions.place.clip,actions.place.releaseMs);
      const b=pet.getContentBounds(),z=pet.webContents.getZoomFactor();
      await evaluate(pet,release,(p.x-b.x)/z,(p.y-b.y)/z,actions.place.flightMs);
      const receipt=onArrive?.(pet,group);
      await wait(actions.pauseAfterDeliveryMs);
      if(receipt?.taken)opened.clear();
    }catch(e){
      if(/移动被打断|桌宠正在拖动/.test(e.message))return;
      allDelivered=false;
      if(!pet.isDestroyed())pet.webContents.send('inbox:parcel',{message:'已归档到 '+path.basename(group.folder)+' · 未完成送达动画'});
      console.warn('[inbox] 文件已归档，送达演出中断',e.message);
      break;
    }finally{
      if(!pet.isDestroyed()){
        await evaluate(pet,()=>document.getElementById('inbox-parcel-card')?.remove());
      }
    }
  }
  if(lastFolder)await module.exports.closeOpened(lastFolder,opened);
  if(!pet.isDestroyed() && pet.isVisible()){
    const here=await geometry(pet);
    const dx=origin.x-here.x,dy=origin.y-here.y;
    if(Math.hypot(dx,dy)>3){
      await evaluate(pet,travel,dx/here.z,dy/here.z,dx<0?'left':'right',actions.walk,strideFor(here)/here.z);
    }
    const landed=await geometry(pet);
    if(allDelivered && groups.length && Math.hypot(landed.x-origin.x,landed.y-origin.y)<=4){
      await evaluate(pet,celebrate,actions.celebrate.clip,actions.celebrate.timeoutMs);
    }
    if(!pet.isDestroyed())await evaluate(pet,perform,actions.idle.clip,null);
  }
  }finally{if(lastFolder)await module.exports.closeOpened(lastFolder,opened);}
};



// The warehouse is a shared waypoint even before the classifier knows the subfolder.
module.exports.locate=locate;
module.exports.startJourney=async function(pet,point){
  const origin=await geometry(pet);
  await approach(pet,point);
  return {origin,gateway:point};
};

// Start a single-use locator while the bite is playing. It cannot open a window
// until this batch supplies its real destination. EOF cancels an unused helper.
module.exports.prepareLocator=function(pet,root){
  const args=['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',
    path.join(__dirname,'locate-target.ps1'),root,'-PetHwnd',String(pet.getNativeWindowHandle().readUInt32LE(0)),'-Prepared'];
  let child,timer,submitted=false;
  const result=new Promise(resolve=>{
    child=execFile('powershell.exe',args,{windowsHide:true},(err,out)=>{
      clearTimeout(timer);
      try{resolve(err?null:JSON.parse(out.trim().split(/\r?\n/).pop()));}catch{resolve(null);}
    });
    child.stdin.on('error',()=>{});
  });
  return {
    cancel(){if(!submitted){submitted=true;child.stdin.end();}},
    async locate(folder,opened,reuseHwnd=0){
      if(submitted)return null;
      submitted=true;
      timer=setTimeout(()=>child.kill(),6500);
      child.stdin.end(Buffer.from(JSON.stringify({folder,reuseHwnd}),'utf8').toString('base64')+'\n');
      const r=await result;
      if(!r)return null;
      if(r.opened && r.hwnd)opened.add(r.hwnd);
      if(pet.isDestroyed())return null;
      return {...screen.screenToDipPoint({x:r.x,y:r.y}),kind:r.kind,hwnd:r.hwnd};
    }
  };
};

module.exports.closeOpened=async function(folder,opened){
  // Closing uses the same ownership and tab checks, even if the pet has gone away.
  const helper={getNativeWindowHandle:()=>Buffer.alloc(8)};
  for(const hwnd of opened)await query(folder,helper,['-CloseHwnd',String(hwnd)]);
  opened.clear();
};
