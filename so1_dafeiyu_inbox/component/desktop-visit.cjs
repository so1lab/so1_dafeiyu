const {app}=require('electron');
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const archive=require('./archive.cjs'),watch=require('./desktop-watch.cjs');

module.exports=function desktopVisit({pets,life,config,save,dialogue,roots=[app.getPath('desktop')]}) {
  let watcher=null,enabled=false,active=null,checking=false,disposed=false,phase='off',error='',last=null;
  let generation=0;const queue=[];
  const knownRoots=[...new Set(roots.map(p=>path.resolve(p)))].filter(p=>fs.existsSync(p));
  function cancel(reason='观察测试已关闭') {
    const visit=active;if(!visit)return;
    visit.cancelled=true;visit.reason=reason;
    visit.cancelLookup?.();
    visit.pet.webContents.executeJavaScript('('+function(id){
      const s=typeof sprites!=='undefined' && sprites[0];
      if(s?.fishDesktopVisitToken===id){s.fishDesktopVisitToken=null;s.fishDesktopEpisodeId=null;s.stopMove();}
    }.toString()+')('+JSON.stringify(visit.id)+')').catch(()=>{});
  }
  async function pump() {
    if(disposed || !enabled || checking || active || !queue.length)return;
    const now=Date.now();
    for(let i=queue.length-1;i>=0;i--){
      if(now-queue[i].at>120000 || !fs.existsSync(queue[i].path))queue.splice(i,1);
    }
    if(!queue.length){phase='skipped';return;}
    // 发现动作优先于定位。遮挡重试按最早到期排序，避免一个图标挡住后续文件。
    const item=queue.find(row=>!row.reacted && (row.reactAfter || 0)<=now) ||
      queue.filter(row=>row.reacted && (row.locateAfter || 0)<=now)
        .sort((a,b)=>(a.locateAfter || 0)-(b.locateAfter || 0))[0];
    if(!item)return;
    checking=true;const version=generation;
    try {
      const candidate=[...pets.values()].filter(p=>!p.isDestroyed() && p.isVisible())
        .map(pet=>({pet,policy:life.memoryPolicy?.(pet) || {}}))
        .find(({pet,policy})=>life.canBackground(pet,!!policy.stationary));
      const pet=candidate?.pet,stationary=candidate?.policy.stationary;
      if(!pet){phase='waiting-pet';return;}
      const record=(type,details={})=>life.record(pet,type,{episodeId:item.episodeId,name:item.name,path:item.path,...details});
      const decision=(action,...ids)=>life.rememberDecision?.(pet,item.episodeId,action,ids);
      error='';
      const current=()=>!disposed && enabled && generation===version;
      const locate=()=>archive.locate(item.path,pet,['-DesktopOnly']);
      const visible=point=>point?.kind==='desktop' && point.visible!==false;
      const deferLocate=()=>{
        item.locateAfter=Date.now()+2000;
        phase='waiting-desktop';
      };
      let point;
      if(item.reacted && !stationary){
        phase='locating';
        point=await locate();
        if(!current() || !queue.includes(item))return;
        if(point)last={...item,x:point.x,y:point.y,visible:point.visible};
        if(!visible(point)){deferLocate();return;}
      }
      const visit={id:randomUUID(),pet,cancelled:false,reason:''};active=visit;
      const release=life.acquireBackground(pet,()=>cancel('用户任务优先，停止观察'),!!stationary);
      if(!release){active=null;phase='waiting-pet';return;}
      const alive=()=>current() && !visit.cancelled && !pet.isDestroyed() && pet.isVisible();
      let lookupTimer;
      const removeItem=()=>{
        const index=queue.indexOf(item);
        if(index!==-1)queue.splice(index,1);
      };
      try {
        if(!item.reacted){
          phase='reacting';
          // 在四秒动作的后半段并行查询，让起跑用到较新的图标位置。
          // 可见时沿用同一个任务占用，省去释放后再申请的保护等待。
          const lookup=stationary?null:new Promise(resolve=>{
            visit.cancelLookup=()=>resolve(null);
            lookupTimer=setTimeout(()=>{
              if(!alive()){resolve(null);return;}
              locate().then(point=>resolve({point,at:Date.now()}),()=>resolve(null));
            },2700);
          });
          if(stationary)decision('observe_in_place',stationary);
          await archive.reactToFile(pet,{token:visit.id,alive,episodeId:item.episodeId,stationary:!!stationary});
          if(!alive())throw Error(visit.reason || '发现动作已取消');
          item.reacted=true;
          record('desktop.reacted');
          if(stationary){removeItem();phase='observed';record('desktop.stationary');return;}
          phase='locating';
          const result=await lookup;
          if(!alive())throw Error(visit.reason || '靠近已取消');
          point=result && Date.now()-result.at<=1500 ? result.point : await locate();
          if(!alive())throw Error(visit.reason || '靠近已取消');
          if(point)last={...item,x:point.x,y:point.y,visible:point.visible};
          if(!visible(point)){deferLocate();return;}
        }
        if(!alive())throw Error(visit.reason || '靠近已取消');
        if(!queue.includes(item) || !fs.existsSync(item.path)){
          removeItem();phase='skipped';return;
        }
        const policy=life.memoryPolicy?.(pet) || candidate.policy;
        if(policy.stationary || stationary){
          decision('observe_in_place',policy.stationary || stationary);
          removeItem();phase='observed';record('desktop.stationary');return;
        }
        phase='approaching';last={...item,x:point.x,y:point.y};
        record('desktop.target',{x:point.x,y:point.y});
        decision('approach');
        const speak=dialogue && config.desktopPeekAI===true;
        if(speak && policy.quiet)decision('skip_dialogue',policy.quiet);
        const emotion=policy.disdain;
        const skipReaction=emotion && (emotion.mode==='off' || (emotion.mode==='less' && life.recentDisdain?.(pet)));
        if(skipReaction)decision('skip_disdain',emotion.id);
        const landed=await archive.visitFile(pet,item.path,{point,token:visit.id,
          alive,episodeId:item.episodeId,skipReaction,prepareDialogue:speak && !policy.quiet ?
            valid=>dialogue(item,()=>valid() && config.desktopPeekAI===true,
              [...pets.entries()].find(([,window])=>window===pet)?.[0]) : undefined});
        if(!alive())throw Error(visit.reason || '靠近已取消');
        removeItem();
        phase='arrived';last={...item,...landed};
        record('desktop.arrived',landed);
      }catch(e){
        if(!current())return;
        if(!visit.cancelled && e.code==='DESKTOP_TARGET_UNAVAILABLE'){
          deferLocate();
          return;
        }
        if(!item.reacted)item.reactAfter=Date.now()+3000;
        else removeItem();
        phase='cancelled';error=e.message;
        record('desktop.cancelled',{reason:e.message});
      }finally{clearTimeout(lookupTimer);if(active===visit)active=null;release();}
    }catch(e){error=e.message;phase='error';}
    finally{checking=false;}
  }
  function found(rows) {
    if(!enabled || disposed)return;
    for(const row of rows){
      const item={...row,at:Date.now(),episodeId:randomUUID()};last=item;
      const pet=[...pets.values()].find(p=>!p.isDestroyed());
      life.record(pet,'desktop.detected',{episodeId:item.episodeId,name:row.name,path:row.path});
      queue.push(item);
    }
    // 批量出现时限制行程数量；所有发现仍保留事实，不积压长时间自动走位。
    while(queue.length>5)queue.shift();void pump();
  }
  function setEnabled(value) {
    if(disposed || enabled===value)return;
    enabled=value;config.desktopObserve=value;save();generation++;queue.length=0;
    watcher?.stop();watcher=null;cancel();
    if(value){phase='starting';error='';watcher=watch({roots:knownRoots,onFound:found,onError:e=>{error=e.message;phase='error';}});}
    else phase='off';
  }
  const timer=setInterval(()=>void pump(),1500);timer.unref();
  setEnabled(config.desktopObserve===true);
  return {setEnabled,cancel,status:()=>({enabled,phase:phase==='starting'&&watcher?.status().ready?'watching':phase,
    roots:knownRoots,last,error,queued:queue.length,ready:!!watcher?.status().ready,dialogueAI:config.desktopPeekAI===true}),
    dispose(){disposed=true;generation++;cancel();watcher?.stop();clearInterval(timer);queue.length=0;}};
};
