// 在上游页面中执行。只接管自主空闲入口，用户点播、宿主睡眠和文件任务保持高优先级。
module.exports = function lifePulse(createLife, env, saved, walk) {
  if (typeof sprites === 'undefined' || !sprites[0]) return null;
  const s = sprites[0];
  // 旧 tick 即使携带 busy:false，也不能释放尚未完成的任务占用。
  if(s.fishTaskGuard?.tokens.size)env={...env,busy:true};
  // 与上游使用同一套缩放和虚拟桌面原点，多屏负坐标不能直接拿来 sendBounds。
  if(env.area) {
    const scale=typeof CONFIG==='undefined'?1:CONFIG.scale;
    env.area={x:env.area.x/scale-VIEW.x,y:env.area.y/scale-VIEW.y,
      width:env.area.width/scale,height:env.area.height/scale};
  }
  if (!s.fishLife) {
    const brain = createLife(saved[s.pet.id] || {});
    const originalIdle = s.playIdle, originalSwitch = s.switchTo, originalEnd = s.handleEnded;
    const names = new Set();
    const collect = value => {
      if (typeof value === 'string') names.add(value);
      else if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === 'object') Object.entries(value).forEach(([k,v]) => { if(k!=='id') collect(v); });
    };
    collect(s.animations);
    if(s.assetRoot==='main')collect(env.availableClips);
    const pick = list => list.find(n => names.has(n));
    const sleep = s.animations.sleep?.[0];
    const clips = {
      quiet: s.animations.idle[0], rest: s.animations.idle[0],
      observe: pick(['东张西望','轻快记录']), stretch: pick(['超大伸懒腰','哈欠连天']),
      play: pick(['原地专心玩魔方','原地蹲下玩玩具汽车','悠闲哼歌']),
      nap: sleep && sleep.start?.[0] && sleep.loop?.[0] && sleep.end?.[0] ? sleep : null,
      // 自定义送件步态只用于默认素材根；其它宠物不借用大肥鱼的身体。
      stroll: env.defaultAssets && s.assetRoot==='main' ? walk.clip : null,
    };
    const life = s.fishLife = {brain, enabled:true, held:false, internal:false, owns:false,
      activity:null, phase:null, raf:null, generation:0, externalUntil:0, env, lastInput:0,
      homePending:false, stable:0, previousPos:null, clips, walk};
    life.session=Date.now()+'-'+Math.random().toString(36).slice(2);life.seq=0;life.events=[];
    life.fact=(type,details={})=>{
      const fact={id:life.session+':'+(++life.seq),session:life.session,seq:life.seq,petId:s.pet.id,type,details,at:Date.now()};
      life.events.push(fact);
      // preload 转发使用户操作及时落盘；tick 的带确认重传覆盖暂时未接入 preload 的情况。
      window.postMessage?.({type:'fish-life-fact',fact},'*');
    };
    const finish=(status,reason='',decision='重新安排')=>{
      if(!life.run || !['preparing','running','paused'].includes(life.run.status))return;
      life.run.status=status;life.run.endedAt=Date.now();
      const details={runId:life.run.id,episodeId:life.run.episodeId,clip:life.run.clip,activity:life.run.activity,phase:life.run.phase,reason,decision,source:life.run.source};
      if(status==='interrupted' && !['quiet','external'].includes(life.run.activity))life.previous={...details,at:Date.now()};
      life.fact('activity.'+status,details);
    };
    life.finish=finish;
    const request=(activity,clip,phase='',source='local')=>{
      const reason=source==='host'?'宿主或用户任务请求动作':life.planReason || '本地行为安排';
      const episodeId=source==='host'?s.fishDesktopEpisodeId:undefined;
      life.run={id:life.session+':run:'+(life.seq+1),activity,clip,phase,status:'preparing',requestedAt:Date.now(),source,reason,episodeId};
      life.fact('activity.requested',{runId:life.run.id,episodeId,clip,activity,phase,source,reason});
    };
    const home=brain.state.home, area=env.area;
    if(home && area && env.enabled && !env.busy && !s.dragState.active && !s.frozen && !s.sleeping && s.moveRef===null) {
      const x=Math.max(area.x,Math.min(area.x+area.width-s.size,home.rx*VIEW.w-s.halfW));
      const y=Math.max(area.y,Math.min(area.y+area.height-s.winH,home.ry*VIEW.h-s.halfH));
      s.sendBounds(x,y); s.customPos={rx:(x+s.halfW)/VIEW.w,ry:(y+s.halfH)/VIEW.h};
    }
    const own = fn => { life.internal=true; try { return fn(); } finally { life.internal=false; } };
    const show = (name, once=false) => own(() => originalSwitch.call(s, name, once));
    const stop = (reason='情境变化',decision='重新安排',outcome='interrupted') => {
      finish(outcome,reason,decision);
      life.generation++;
      if(life.raf!==null) cancelAnimationFrame(life.raf);
      life.raf=null;
      if(life.owns) s.stopMove();
      life.owns=false; life.activity=null; life.phase=null;
    };
    const blocked = () => life.held || life.env.suspended || s.frozen || s.sleeping ||
      s.dragState.active || s.menuOpen || s.chatOpen || s.todoOpen || s.whisperOn || s.playback ||
      s.moveRef!=null || s.throwRef!=null || s.posFollow!=null ||
      (s.pet.workStatusEnabled !== false && s.workState && !['success','error'].includes(s.workState));
    function quiet() { life.activity='quiet'; life.phase=null; life.owns=true;request('quiet',clips.quiet);show(clips.quiet); }
    function boundary() {
      if(!life.enabled) return originalIdle.call(s);
      if(blocked()) return;
      if(life.phase==='sleep-start') {
        life.phase='sleep-loop';life.run.phase='等待睡眠循环';life.run.clip=clips.nap.loop[0];
        show(clips.nap.loop[0]);return;
      }
      if(life.phase==='wake') { quiet(); return; }
      quiet();
    }
    // 一套空闲入口：禁止上游随机链与新生活引擎同时决定下一条动作。
    s.playIdle = function() { return life.enabled ? boundary() : originalIdle.call(this); };
    s.switchTo = function(...args) {
      if(!life.internal) {
        if(s.sleeping && args[0]==='睡觉-循环' && life.run?.activity==='nap') {
          life.run.clip=args[0];life.run.phase='等待睡眠循环';return originalSwitch.apply(this,args);
        }
        stop('宿主或任务切换了动作');
        if(life.enabled)brain.interrupt(Date.now());
        const taskClips={'啊呜吞件':'receive','螃蟹走路-送件循环':'walk','轻轻丢文件-交接':'place','小小魔法-开合':'magic','收好啦等夸':'celebrate',
          '发现有文件':'discover_file','普通小跑-桌面靠近循环':'approach_file',
          '偷偷看文件':'peek_file','一脸嫌弃':'disdain_file',
          '待机呼吸休闲':'quiet','睡觉-开始':'nap','睡觉-循环':'nap','睡觉-起来':'wake'};
        const activity=s.fishDesktopVisitToken && args[0]===walk.clip?'approach_file':taskClips[args[0]] || 'external';
        // 待机与持锁的桌面观察是程序自己的动作，不应触发用户操作的等待时间。
        const desktopAction=s.fishDesktopVisitToken && ['discover_file','approach_file','peek_file','disdain_file'].includes(activity);
        const pointerMotion=life.pointer || s.dragState.active || s.throwRef!=null || s.posFollow!=null;
        if(activity!=='quiet' && args[0]!==clips.quiet && !desktopAction && !pointerMotion)life.externalUntil=Date.now()+20000;
        request(activity,args[0],activity==='approach_file'?'靠近新增文件':taskClips[args[0]]?'宿主播放':String(args[0]).slice(0,80),'host');
      }
      return originalSwitch.apply(this,args);
    };
    const currentVideo=video=>life.run && video===(s.front===0?s.videoA:s.videoB) && s.anim===life.run.clip &&
      (!video.src || video.src.endsWith(encodeURIComponent(life.run.clip)+'.webm'));
    const playing=event=>{
      if(currentVideo(event.target) && !s.pending && (life.phase==='sleep-loop' || (s.sleeping && s.sleepPhase==='loop')) && life.run.phase!=='持续睡眠') {
        life.run.phase='持续睡眠';life.fact('activity.phase',{runId:life.run.id,activity:'nap',phase:'持续睡眠'});
      }
      if(currentVideo(event.target) && !s.pending && ['preparing','paused'].includes(life.run.status)) {
        life.run.status='running';life.run.startedAt=Date.now();
        life.fact('activity.started',{runId:life.run.id,episodeId:life.run.episodeId,clip:life.run.clip,activity:life.run.activity,phase:life.run.phase,source:life.run.source});
      }
    };
    const ended=event=>{
      if(!currentVideo(event.target) || !event.target.ended || !['running','paused'].includes(life.run.status))return;
      // 入睡片段结束只是进入循环，不能宣称整次打盹已完成。
      if(life.phase!=='sleep-start' && !(life.run.activity==='nap' && s.sleeping && s.sleepPhase==='start'))finish('completed','视频真实播放结束');
    };
    const failed=event=>{
      if(life.run && s.anim===life.run.clip && event.target.src?.endsWith(encodeURIComponent(life.run.clip)+'.webm') &&
        ['preparing','running','paused'].includes(life.run.status))finish('failed','动画加载或解码失败');
    };
    const paused=event=>{
      if(currentVideo(event.target) && !event.target.ended && life.run.status==='running') {
        life.run.status='paused';life.fact('activity.paused',{runId:life.run.id,activity:life.run.activity,
          phase:life.run.phase,reason:event.type==='pause'?'播放暂停':'等待媒体数据'});
      }
    };
    for(const video of [s.videoA,s.videoB]) {
      video?.addEventListener?.('playing',playing,true);video?.addEventListener?.('ended',ended,true);video?.addEventListener?.('error',failed,true);
      for(const type of ['pause','waiting','stalled'])video?.addEventListener?.(type,paused,true);
    }
    s.handleEnded = function(...args) {
      if(life.enabled && life.owns && !blocked()) return boundary();
      return originalEnd.apply(this,args);
    };
    function stroll() {
      const p=life.env.area, from={...s.pos}, width=s.size;
      const center=from.x+s.halfW;
      const left=p.x, right=p.x+p.width;
      let dx=(center>(left+right)/2?-1:1)*Math.min(110,width*.65);
      if(from.x+dx<left+12 || from.x+dx+width>right-12) { finish('failed','散步落脚空间不足');quiet();return; }
      own(()=>{s.stopMove();s.stopThrow();}); s.facing=dx>0?'right':'left';
      show(walk.clip); const gen=++life.generation;
      let last=null,progress=0,lastMotion=performance.now();
      const stride=Math.min(width*walk.strideRatio,walk.pixelsPerSecond*(walk.phase.length-1)/24);
      const phase=t=>{ const n=Math.min(walk.phase.length-1,Math.max(0,t*24)),i=Math.floor(n);
        return walk.phase[i]+(n-i)*((walk.phase[i+1]??1)-walk.phase[i]); };
      function frame() {
        life.raf=null;
        if(gen!==life.generation)return;
        if(!life.enabled || blocked() || !life.owns || s.anim!==walk.clip) { stop('散步被操作或任务中断','放弃旧路线'); return; }
        const video=s.front===0?s.videoA:s.videoB;
        if(performance.now()-lastMotion>3500) { finish('failed','步行动画未推进');stop();quiet();return; }
        if(!s.pending && video.readyState>=2 && !video.paused) {
          const current=phase(video.currentTime);
          if(last!==null) {
            const delta=current>=last?current-last:1-last+current;
            if(delta>0) { lastMotion=performance.now(); progress=Math.min(Math.abs(dx),progress+stride*delta); }
            s.sendBounds(from.x+Math.sign(dx)*progress,from.y);
          }
          last=current;
        }
        if(progress>=Math.abs(dx)) {
          s.customPos={rx:(s.pos.x+s.halfW)/VIEW.w,ry:(s.pos.y+s.halfH)/VIEW.h};
          finish('completed','已到达本次散步落点');
          quiet(); return;
        }
        life.raf=requestAnimationFrame(frame);
      }
      life.raf=requestAnimationFrame(frame);
    }
    life.stop=stop;
    life.acceptPlan = plan => {
      if(!life.enabled || blocked() || life.env.quietMode || life.env.suspended || life.env.fullscreen ||
        life.env.aiEnabled===false || !life.env.visible)return false;
      return brain.offerPlan(plan,Date.now(),plan.revision);
    };
    life.hold=(reason='用户任务接管身体') => {
      const owned=life.owns;if(owned)stop(reason,'先完成用户任务');life.held=true;brain.interrupt(Date.now());
      if(owned) show(clips.quiet);
    };
    life.start = (id,source='local') => {
      if(blocked()) return;
      const wasNap=life.phase==='sleep-loop' || life.phase==='sleep-start';
      stop('活动阶段结束','重新安排',['quiet','rest','nap'].includes(life.run?.activity)&&life.run?.status==='running'?'completed':'interrupted');
      life.owns=true;life.activity=id;
      if(wasNap && id!=='nap') { life.phase='wake';request('wake',clips.nap.end[0],'起床',source);show(clips.nap.end[0],true);return; }
      if(id==='nap') { life.phase='sleep-start';request(id,clips.nap.start[0],'入睡',source);show(clips.nap.start[0],true); }
      else if(id==='stroll') {request(id,walk.clip,'步行',source);stroll();}
      else {const clip=clips[id] || clips.quiet;request(id,clip,'',source);show(clip,!['quiet','rest'].includes(id));}
    };
    const input = event => {
      if(!event.isTrusted || !event.target.closest?.('.pet-hit')) return;
      if(s.fishDesktopVisitToken){s.fishDesktopVisitToken=null;s.fishDesktopEpisodeId=null;s.stopMove();}
      life.lastInput=Date.now();
      if(event.type==='pointerdown'){life.homePending={...s.pos};life.pointer={...s.pos};life.fact('user.pointer_down');}
      else life.fact('user.file_hover');
      const owned=life.owns;stop(event.type==='pointerdown'?'你按下了桌宠':'文件拖入桌宠上方','等待本次操作结束再安排');brain.interrupt(Date.now());life.externalUntil=Date.now()+25000;
      // 只取消生活层的位移，用户的拖拽/抛掷由上游接手。
      if(owned) show(clips.quiet);
    };
    window.addEventListener('pointerdown', input, true);
    window.addEventListener('dragenter', input, true);
    const pointerUp=event=>{
      if(!event.isTrusted || !life.pointer)return;
      const moved=s.dragState.dragging || Math.hypot(s.pos.x-life.pointer.x,s.pos.y-life.pointer.y)>8;
      const direction=s.pos.x-life.pointer.x<-8?'向左':s.pos.x-life.pointer.x>8?'向右':s.pos.y-life.pointer.y<-8?'向上':s.pos.y-life.pointer.y>8?'向下':'';
      life.fact(moved?'user.dragged':'user.clicked',moved?{direction}:{});
      if(moved){
        // 拖动结束后只留一小段稳定时间，实际抛掷或拖动仍由实时状态保护。
        life.externalUntil=Date.now()+350;
        if(life.previous)life.previous.decision='留在用户选择的位置，放弃旧路线';
      }
      life.pointer=null;
    };
    window.addEventListener('pointerup',pointerUp,true);
    life.resumePrevious=()=>{
      const previous=life.previous;
      if(!previous || Date.now()-previous.at>600000 || blocked() || !life.enabled || life.env.quietMode ||
        life.env.fullscreen || !life.env.visible ||
        !['observe','stretch','play','rest'].includes(previous.activity) || !clips[previous.activity])return false;
      brain.resume(previous.activity,Date.now());life.externalUntil=0;life.fact('user.requested_resume');
      life.lastPlan=null;return true;
    };
    window.addEventListener('beforeunload', stop, {once:true});
    life.dispose = () => {
      stop(); window.removeEventListener('pointerdown',input,true); window.removeEventListener('dragenter',input,true);
      window.removeEventListener('pointerup',pointerUp,true);
      for(const video of [s.videoA,s.videoB]){video?.removeEventListener?.('playing',playing,true);video?.removeEventListener?.('ended',ended,true);video?.removeEventListener?.('error',failed,true);}
      for(const video of [s.videoA,s.videoB])for(const type of ['pause','waiting','stalled'])video?.removeEventListener?.(type,paused,true);
      s.playIdle=originalIdle; s.switchTo=originalSwitch; s.handleEnded=originalEnd; delete s.fishLife;
    };
  }
  const life=s.fishLife, now=env.now;
  if(env.ack?.session===life.session)life.events=life.events.filter(e=>e.seq>env.ack.seq);
  for(const [key,type] of [['menuOpen','user.opened_menu'],['chatOpen','user.opened_chat'],['todoOpen','user.opened_todo']]) {
    if(s[key] && !life['seen_'+key])life.fact(type);life['seen_'+key]=!!s[key];
  }
  const wasHeld=life.held, wasEnabled=life.enabled;
  life.env=env; life.enabled=env.enabled;
  if(env.busy && !wasHeld) life.hold();
  life.held=env.busy;
  if(wasHeld && !env.busy) { life.brain.interrupt(now); life.externalUntil=now+3000; }
  if(wasEnabled && !env.enabled) {
    const owned=life.owns; life.stop();
    if(owned && !s.frozen && !s.sleeping && !s.dragState.active) s.playIdle();
  }
  if(!wasEnabled && env.enabled) { life.externalUntil=now+3000; life.brain.interrupt(now); }
  const interacting=s.dragState.active || s.menuOpen || s.chatOpen || s.todoOpen;
  const working=!!(s.pet.workStatusEnabled!==false && s.workState && !['success','error'].includes(s.workState));
  const physical=s.frozen || s.sleeping || s.whisperOn || !!s.playback ||
    s.moveRef!=null || s.throwRef!=null || s.posFollow!=null;
  const external=physical || working || now<life.externalUntil;
  // 用户拖动结束且位置稳定后记录；送件/生活移动绝不修改这个偏好。
  if(life.homePending && !interacting && !life.held && s.throwRef===null && s.moveRef===null && s.posFollow===null) {
    const p=s.pos, previous=life.previousPos;
    life.stable=previous && Math.hypot(p.x-previous.x,p.y-previous.y)<1 ? life.stable+1 : 0;
    life.previousPos={...p};
    if(life.stable>=2) {
      if(Math.hypot(p.x-life.homePending.x,p.y-life.homePending.y)>8)
        {life.brain.rememberHome({rx:(p.x+s.halfW)/VIEW.w,ry:(p.y+s.halfH)/VIEW.h},now);life.fact('user.position_settled');}
      life.homePending=false; life.stable=0;
    }
  }
  const area=env.area;
  const edge=area && (s.pos.y+s.winH>area.y+area.height-150 || s.pos.x<area.x+120 || s.pos.x+s.size>area.x+area.width-120);
  const plan=life.brain.tick({...env, busy:env.busy, interacting, external,
    suspended:env.suspended || !env.visible, quietMode:env.quietMode || !life.enabled,
    canStroll:!!edge && !s.pet.fixedEnabled && !env.foregroundOverlap,
    available:Object.keys(life.clips).filter(k=>life.clips[k])});
  const protectedNow=env.busy || interacting || external || env.suspended || !env.visible;
  if(protectedNow && life.owns) {
    if(env.busy)life.hold();else life.stop(s.chatOpen?'聊天面板打开':s.menuOpen?'菜单打开':env.suspended?'系统休眠或锁屏':'用户或宿主正在操作');
  }
  if(life.enabled && !protectedNow && (life.lastPlan!==plan.until || !life.owns)) {
    life.lastPlan=plan.until;life.planReason=plan.reason;life.start(plan.activity,plan.source);
  }
  if(life.owns && (life.run?.status==='failed' || (life.run?.status==='preparing' && Date.now()-life.run.requestedAt>12000))) {
    life.finish('failed','未收到真实播放回执');life.stop();
    if(!protectedNow)life.start('quiet');
  }
  // 关闭生活层时不改宿主状态；保存数据不包含动画句柄、锁或积压任务。
  return {id:s.pet.id, ...plan, enabled:life.enabled, held:env.busy,
    phase:life.phase,clip:s.anim,home:life.brain.state.home,self:life.run || null,previous:life.previous || null,
    session:life.session,seq:life.seq,events:life.events.slice(),working,
    stationaryReady:working && !env.busy && !interacting && !physical && !env.fullscreen &&
      !env.quietMode && !env.suspended && env.visible && now-life.lastInput>2000,
    backgroundReady:plan.planning.ready && !s.pet.fixedEnabled};
};
