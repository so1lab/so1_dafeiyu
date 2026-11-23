// 在上游页面中执行。只接管自主空闲入口，用户点播、宿主睡眠和文件任务保持高优先级。
module.exports = function lifePulse(createLife, env, saved, walk) {
  if (typeof sprites === 'undefined' || !sprites[0]) return null;
  const s = sprites[0];
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
    const home=brain.state.home, area=env.area;
    if(home && area && env.enabled && !env.busy && !s.dragState.active && !s.frozen && !s.sleeping && s.moveRef===null) {
      const x=Math.max(area.x,Math.min(area.x+area.width-s.size,home.rx*VIEW.w-s.halfW));
      const y=Math.max(area.y,Math.min(area.y+area.height-s.winH,home.ry*VIEW.h-s.halfH));
      s.sendBounds(x,y); s.customPos={rx:(x+s.halfW)/VIEW.w,ry:(y+s.halfH)/VIEW.h};
    }
    const own = fn => { life.internal=true; try { return fn(); } finally { life.internal=false; } };
    const show = (name, once=false) => own(() => originalSwitch.call(s, name, once));
    const stop = () => {
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
    function quiet() { life.activity='quiet'; life.phase=null; life.owns=true; show(clips.quiet); }
    function boundary() {
      if(!life.enabled) return originalIdle.call(s);
      if(blocked()) return;
      if(life.phase==='sleep-start') { life.phase='sleep-loop'; show(clips.nap.loop[0]); return; }
      if(life.phase==='wake') { quiet(); return; }
      quiet();
    }
    // 一套空闲入口：禁止上游随机链与新生活引擎同时决定下一条动作。
    s.playIdle = function() { return life.enabled ? boundary() : originalIdle.call(this); };
    s.switchTo = function(...args) {
      if(!life.internal && life.enabled) {
        stop(); life.externalUntil=Date.now()+20000; brain.interrupt(Date.now());
      }
      return originalSwitch.apply(this,args);
    };
    s.handleEnded = function(...args) {
      if(life.enabled && life.owns && !blocked()) return boundary();
      return originalEnd.apply(this,args);
    };
    function stroll() {
      const p=life.env.area, from={...s.pos}, width=s.size;
      const center=from.x+s.halfW;
      const left=p.x, right=p.x+p.width;
      let dx=(center>(left+right)/2?-1:1)*Math.min(110,width*.65);
      if(from.x+dx<left+12 || from.x+dx+width>right-12) { quiet(); return; }
      own(()=>{s.stopMove();s.stopThrow();}); s.facing=dx>0?'right':'left';
      show(walk.clip); const gen=++life.generation;
      let last=null,progress=0,lastMotion=performance.now();
      const stride=Math.min(width*walk.strideRatio,walk.pixelsPerSecond*(walk.phase.length-1)/24);
      const phase=t=>{ const n=Math.min(walk.phase.length-1,Math.max(0,t*24)),i=Math.floor(n);
        return walk.phase[i]+(n-i)*((walk.phase[i+1]??1)-walk.phase[i]); };
      function frame() {
        life.raf=null;
        if(gen!==life.generation || !life.enabled || blocked() || !life.owns || s.anim!==walk.clip) { stop(); return; }
        const video=s.front===0?s.videoA:s.videoB;
        if(performance.now()-lastMotion>3500) { stop(); quiet(); return; }
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
          quiet(); return;
        }
        life.raf=requestAnimationFrame(frame);
      }
      life.raf=requestAnimationFrame(frame);
    }
    life.stop=stop;
    life.hold=() => {
      const owned=life.owns; stop(); life.held=true; brain.interrupt(Date.now());
      if(owned) show(clips.quiet);
    };
    life.start = id => {
      if(blocked()) return;
      const wasNap=life.phase==='sleep-loop' || life.phase==='sleep-start';
      stop(); life.owns=true; life.activity=id;
      if(wasNap && id!=='nap') { life.phase='wake'; show(clips.nap.end[0],true); return; }
      if(id==='nap') { life.phase='sleep-start'; show(clips.nap.start[0],true); }
      else if(id==='stroll') stroll();
      else show(clips[id] || clips.quiet, !['quiet','rest'].includes(id));
    };
    const input = event => {
      if(!event.isTrusted || !event.target.closest?.('.pet-hit')) return;
      life.lastInput=Date.now();
      if(event.type==='pointerdown')life.homePending={...s.pos};
      const owned=life.owns; stop(); brain.interrupt(Date.now()); life.externalUntil=Date.now()+25000;
      // 只取消生活层的位移，用户的拖拽/抛掷由上游接手。
      if(owned) show(clips.quiet);
    };
    window.addEventListener('pointerdown', input, true);
    window.addEventListener('dragenter', input, true);
    window.addEventListener('beforeunload', stop, {once:true});
    life.dispose = () => {
      stop(); window.removeEventListener('pointerdown',input,true); window.removeEventListener('dragenter',input,true);
      s.playIdle=originalIdle; s.switchTo=originalSwitch; s.handleEnded=originalEnd; delete s.fishLife;
    };
  }
  const life=s.fishLife, now=env.now;
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
  const external=s.frozen || s.sleeping || s.whisperOn || !!s.playback ||
    s.moveRef!=null || s.throwRef!=null || s.posFollow!=null ||
    (s.pet.workStatusEnabled!==false && s.workState && !['success','error'].includes(s.workState)) || now<life.externalUntil;
  // 用户拖动结束且位置稳定后记录；送件/生活移动绝不修改这个偏好。
  if(life.homePending && !interacting && !life.held && s.throwRef===null && s.moveRef===null && s.posFollow===null) {
    const p=s.pos, previous=life.previousPos;
    life.stable=previous && Math.hypot(p.x-previous.x,p.y-previous.y)<1 ? life.stable+1 : 0;
    life.previousPos={...p};
    if(life.stable>=2) {
      if(Math.hypot(p.x-life.homePending.x,p.y-life.homePending.y)>8)
        life.brain.rememberHome({rx:(p.x+s.halfW)/VIEW.w,ry:(p.y+s.halfH)/VIEW.h},now);
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
    if(env.busy)life.hold();else life.stop();
  }
  if(life.enabled && !protectedNow && (life.lastPlan!==plan.until || !life.owns)) {
    life.lastPlan=plan.until; life.start(plan.activity);
  }
  // 关闭生活层时不改宿主状态；保存数据不包含动画句柄、锁或积压任务。
  return {id:s.pet.id, ...plan, enabled:life.enabled, held:env.busy,
    phase:life.phase, clip:s.anim, home:life.brain.state.home};
};
