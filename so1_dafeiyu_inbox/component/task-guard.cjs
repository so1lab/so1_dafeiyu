// 此函数在桌宠 renderer 执行。占用由真实任务令牌控制，不依赖两秒一次的生活采样。
module.exports=function taskGuard(operation,id) {
  if(typeof sprites==='undefined' || !sprites[0])return false;
  const s=sprites[0];
  if(!s.fishTaskGuard){
    const guard=s.fishTaskGuard={tokens:new Set(),automatic:0};
    const busy=()=>guard.tokens.size>0;
    const wrap=(name,fn)=>{const original=s[name];if(typeof original==='function')s[name]=function(...args){return fn.call(this,original,args);};};
    // 已关闭自主生活时，原版随机链同样必须遵守任务占用。
    wrap('playIdle',function(original,args){if(!busy())return original.apply(this,args);});
    wrap('handleEnded',function(original,args){
      if(!busy() || this.sleeping)return original.apply(this,args);
      // 播放回执仍要提交；只暂停结束后的随机链和事件档位轮换。
      if(this.playback){const done=this.playback;this.playback=null;this.reportPlayback(done,'ended');}
    });
    wrap('resumeWorkStatusAnim',function(original,args){return busy()?false:original.apply(this,args);});
    wrap('onWorkTick',function(original,args){
      if(!busy())return original.apply(this,args);
      const [snapshot,tick]=args;
      if(!this.pet.workStatusEnabled || !tick || tick===this.prevWorkTick)return;
      // 消费最新状态，不积攒过时动画。不能让原方法修改任务视频的 loop/onended。
      this.prevWorkTick=tick;this.workState=snapshot?.state || null;this.prevWorkState=this.workState;
      this.workSessionId=snapshot?.sessionId || null;
    });
    wrap('showWhisper',function(original,args){if(busy())args[4]=false;return original.apply(this,args);});
    // 余额气泡仍可更新，但不能 stopMove 或换动画。
    wrap('showBalanceNow',function(original,args){
      if(!busy())return original.apply(this,args);
      guard.automatic++;try{return original.apply(this,args);}finally{guard.automatic--;}
    });
    for(const name of ['stopMove','stopThrow','switchTo','playOnce'])wrap(name,function(original,args){
      if(busy() && guard.automatic)return;
      return original.apply(this,args);
    });
  }
  const guard=s.fishTaskGuard;
  if(operation==='acquire')guard.tokens.add(id);
  if(operation==='release' && guard.tokens.delete(id) && !guard.tokens.size){
    const video=s.front===0?s.videoA:s.videoB;
    // 任务停在末帧时恢复空闲；仍在播放的收尾动作不提前打断。
    if(video?.ended && !s.pending && !s.frozen && !s.sleeping && !s.dragState.active &&
      !s.menuOpen && !s.chatOpen && !s.todoOpen && !s.playback && s.moveRef==null && s.throwRef==null && s.posFollow==null)s.playIdle();
  }
  return guard.tokens.size;
};
