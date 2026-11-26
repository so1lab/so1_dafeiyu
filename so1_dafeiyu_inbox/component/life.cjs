const {app, screen, powerMonitor} = require('electron');
const fs = require('node:fs'), path = require('node:path');
const {spawn} = require('node:child_process');
const readline = require('node:readline');
const core = require('./life-core.cjs'), pulse = require('./life-renderer.cjs');
const walk = require('./actions.json').walk;
const taskGuard=require('./task-guard.cjs');

module.exports = function startLife({pets, data, config, save, host}) {
  const file=path.join(data,'life-state.json');
  let saved={};
  let availableClips=[];
  try { availableClips=fs.readdirSync(path.resolve(__dirname,'../../../assets/webm')).filter(n=>n.endsWith('.webm')).map(n=>n.slice(0,-5)); } catch {}
  try { const parsed=JSON.parse(fs.readFileSync(file,'utf8')); if(parsed.version===1) saved=parsed.pets || {}; } catch {}
  const holds=new Map(),running=new Set(),latest=new Map(),background=new Map();
  let desktop=null;
  const memory=require('./experience.cjs')(data),acks=new Map(),published=new Map();
  let publishing=false,publishAgain=false,lastPublish=0;
  const petId=pet=>latest.get(pet)?.id || [...pets.entries()].find(([,p])=>p===pet)?.[0] || (pets.size===1?'main':null);
  function record(pet,type,details={}) {
    const id=petId(pet);if(typeof id!=='string')return;
    memory.record(id,type,details);void publish();
  }
  function ingest(pet,fact) {
    if(!fact || typeof fact.petId!=='string' || !Number.isSafeInteger(fact.seq) || typeof fact.session!=='string')return;
    const known=latest.get(pet)?.id;if(known && known!==fact.petId)return;
    if(memory.append(fact))void publish();
  }
  async function publish() {
    if(disposed || typeof host!=='function')return;
    if(publishing){publishAgain=true;return;}
    publishing=true;
    try {
      for(const pet of pets.values()) {
        if(pet.isDestroyed())continue;
        const id=petId(pet);if(typeof id!=='string')continue;const view=memory.view(id);
        const events=memory.since(id,published.get(id)),since=published.get(id);
        // 完整路径只留在本机日志/面板，发送给聊天的事实移除 path 字段。
        const shared=value=>Array.isArray(value)?value.map(shared):value&&typeof value==='object'?
          Object.fromEntries(Object.entries(value).filter(([key])=>key!=='path').map(([key,v])=>[key,shared(v)])):value;
        const reply=await host('POST','/dsh-pet-7340/life-awareness',JSON.stringify(shared({petId:id,...view,events,since})));
        const result=JSON.parse(reply.body);
        for(const fact of result.observed || [])memory.append(fact);
        if(result.needFull){published.delete(id);publishAgain=true;}
        else if(result.ok && events.length)published.set(id,events.at(-1).id);
      }
      lastPublish=Date.now();
    } catch(e) { log(e); }
    finally {publishing=false;if(publishAgain){publishAgain=false;void publish();}}
  }
  const planner=require('./life-planner.cjs')({host});
  let suspended=false, disposed=false, foreground=null, sensor=null, lastSave=0, timer;
  const log=e=>console.warn('[fish-life]',e.message);
  function persist() {
    try {
      // 诊断快照仅供查看；重启只恢复 pets，不恢复计划、请求或占用令牌。
      const planning=Object.fromEntries([...latest.entries()].filter(([p])=>!p.isDestroyed()).map(([p,s])=>
        [s.id,{...planner.status(p),source:s.source,goal:s.planning?.goal || '',remaining:s.planning?.remaining || 0}]));
      fs.writeFileSync(file+'.tmp',JSON.stringify({version:1,pets:saved,planning,desktop:desktop?.status()},null,2));
      fs.renameSync(file+'.tmp',file); lastSave=Date.now();
    } catch(e) { log(e); }
  }
  if(process.platform==='win32') {
    sensor=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'life-environment.ps1')],
      {windowsHide:true,stdio:['ignore','pipe','ignore']});
    sensor.on('error',log);
    readline.createInterface({input:sensor.stdout}).on('line',line=>{
      try { const value=JSON.parse(line); if([value.x,value.y,value.width,value.height].every(Number.isFinite)) foreground={...value,at:Date.now()}; } catch {}
    });
  }
  function suspend() { suspended=true;for(const pet of pets.values())record(pet,'environment.locked');refresh();persist(); }
  function resume() { suspended=false;foreground=null;for(const pet of pets.values())record(pet,'environment.resumed');refresh(); }
  powerMonitor.on('suspend',suspend); powerMonitor.on('lock-screen',suspend);
  powerMonitor.on('resume',resume); powerMonitor.on('unlock-screen',resume);
  async function tick(pet) {
    if(disposed || pet.isDestroyed() || pet.webContents.isLoadingMainFrame() || running.has(pet)) return;
    running.add(pet);
    try {
      const bounds=pet.getBounds(), center={x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2};
      const display=screen.getDisplayNearestPoint(center), work=display.workArea;
      // 当前上游的 sendBounds 使用虚拟桌面相对坐标；按 renderer 的 VIEW 转换在下一层完成。
      const fresh=foreground && Date.now()-foreground.at<15000;
      const fg=fresh?screen.screenToDipRect(null,foreground):null;
      const covers=(a,b)=>a.x<=b.x+2 && a.y<=b.y+2 && a.x+a.width>=b.x+b.width-2 && a.y+a.height>=b.y+b.height-2;
      const fullscreen=!!fg && !foreground.desktop && foreground.pid!==process.pid && covers(fg,display.bounds);
      const env={now:Date.now(),hour:new Date().getHours(),idle:powerMonitor.getSystemIdleTime(),
        busy:(holds.get(pet)?.size || 0)>0, suspended, fullscreen, quietMode:!!config.lifeQuiet,
        enabled:config.lifeEnabled!==false, aiEnabled:config.lifeAI!==false,visible:pet.isVisible(), area:work,
        foregroundOverlap:!fresh || (!!fg && !foreground.desktop && foreground.pid!==process.pid &&
          center.x>fg.x && center.x<fg.x+fg.width && center.y>fg.y && center.y<fg.y+fg.height),
        defaultAssets:true,availableClips,ack:acks.get(pet)};
      const result=await pet.webContents.executeJavaScript(
        '('+pulse.toString()+')('+core.toString()+','+JSON.stringify(env)+','+JSON.stringify(saved)+','+JSON.stringify(walk)+')');
      if(result && !disposed) {
        latest.set(pet,result); saved[result.id]=result.state;
        for(const fact of result.events || [])ingest(pet,fact);
        acks.set(pet,{session:result.session,seq:result.seq});
        const awareness=memory.view(result.id);
        planner.consider(pet,{...result,awareness},env,async plan=>{
          if(disposed || pet.isDestroyed() || !pet.isVisible() || suspended || config.lifeEnabled===false ||
            config.lifeAI===false || config.lifeQuiet || holds.get(pet)?.size)return false;
          return pet.webContents.executeJavaScript("typeof sprites!=='undefined' && !!sprites[0]?.fishLife?.acceptPlan("+JSON.stringify(plan)+")");
        });
      }
      if(Date.now()-lastSave>30000) persist();
      if(Date.now()-lastPublish>5000)void publish();
    } catch(e) { if(!pet.isDestroyed()) log(e); }
    finally { running.delete(pet); }
  }
  function refresh() { for(const pet of pets.values()) void tick(pet); }
  function acquire(pet,asBackground=false) {
    const targets=pet?[pet]:[...pets.values()], token=require('node:crypto').randomUUID();
    for(const p of targets) {
      if(p.isDestroyed())continue;
      if(!asBackground)background.get(p)?.cancel();
      planner.invalidate(p);
      if(!holds.has(p)) holds.set(p,new Set());
      holds.get(p).add(token);
      // 必须与接件指令在同一 webContents 顺序提交，不能等下一次两秒采样。
      p.webContents.executeJavaScript('('+taskGuard.toString()+')('+JSON.stringify('acquire')+','+JSON.stringify(token)+');'+
        "if(typeof sprites!=='undefined') sprites[0]?.fishLife?.hold("+
        JSON.stringify(asBackground?'观察桌面新增文件':'用户任务接管身体')+"); undefined;").catch(()=>{});
    }
    let released=false;
    return () => {
      if(released)return; released=true;
      for(const p of targets) {
        const set=holds.get(p);set?.delete(token);if(!set?.size)holds.delete(p);
        if(!p.isDestroyed())p.webContents.executeJavaScript('('+taskGuard.toString()+')('+JSON.stringify('release')+','+JSON.stringify(token)+')').catch(()=>{});
      }
      refresh();
    };
  }
  function settings(patch) {
    if(typeof patch?.desktop==='boolean')desktop?.setEnabled(patch.desktop);
    if(typeof patch?.dialogueAI==='boolean')config.desktopPeekAI=patch.dialogueAI;
    if(patch?.quiet===true || patch?.enabled===false)desktop?.cancel('已切换安静模式或关闭自主生活');
    if(typeof patch?.ai==='boolean')config.lifeAI=patch.ai;
    if(typeof patch?.enabled==='boolean')config.lifeEnabled=patch.enabled;
    if(typeof patch?.quiet==='boolean')config.lifeQuiet=patch.quiet;
    for(const p of pets.values()) {
      planner.invalidate(p);
      if(patch?.replan===true)planner.request(p);
      if(patch?.resume===true && !p.isDestroyed())p.webContents.executeJavaScript(
        "typeof sprites!=='undefined' && sprites[0]?.fishLife?.resumePrevious()"
      ).catch(()=>{});
      if(!p.isDestroyed() && (patch?.replan===true || patch?.ai===false || patch?.enabled===false || patch?.quiet===true))
        p.webContents.executeJavaScript("if(typeof sprites!=='undefined') sprites[0]?.fishLife?.brain.cancelPlan(); undefined;").catch(()=>{});
    }
    save(); refresh(); return status();
  }
  function complete(pet,details={}) {
    record(pet,'task.filed',details);
    if(pet && !pet.isDestroyed())pet.webContents.executeJavaScript(
      "if(typeof sprites!=='undefined') sprites[0]?.fishLife?.brain.complete(Date.now()); undefined;"
    ).catch(()=>{});
  }
  function status() {
    return {enabled:config.lifeEnabled!==false,quiet:!!config.lifeQuiet,ai:config.lifeAI!==false,desktop:desktop?.status(),
      pets:[...latest.entries()].filter(([p])=>!p.isDestroyed()).map(([p,s])=>({
        id:s.id, activity:holds.get(p)?.size?'task':s.activity,reason:holds.get(p)?.size?'先把你的事情做好':s.reason,
        energy:Math.round(s.state.energy),sleepiness:Math.round(s.state.sleepiness),
        mood:Math.round(s.state.mood),home:s.home,history:memory.view(s.id).recent.slice(-18),awareness:memory.view(s.id),
        canResume:!!s.previous && Date.now()-s.previous.at<600000 && ['observe','stretch','play','rest'].includes(s.previous.activity),
        source:s.source,planning:s.planning,planner:planner.status(p)}))};
  }
  function dispose() {
    if(disposed)return; disposed=true;clearInterval(timer);desktop?.dispose();persist();sensor?.kill();planner.dispose();
    powerMonitor.removeListener('suspend',suspend); powerMonitor.removeListener('lock-screen',suspend);
    powerMonitor.removeListener('resume',resume); powerMonitor.removeListener('unlock-screen',resume);
    app.removeListener('before-quit',dispose); holds.clear(); latest.clear();
  }
  timer=setInterval(()=>{
    for(const p of latest.keys())if(p.isDestroyed()){latest.delete(p);holds.delete(p);planner.forget(p);}
    refresh();
  },2000);
  timer.unref(); app.once('before-quit',dispose); refresh();
  const canBackground=pet=>!disposed && !holds.get(pet)?.size && !!latest.get(pet)?.backgroundReady;
  return {acquire,status,settings,dispose,refresh,complete,record,ingest,canBackground,attachDesktop:value=>desktop=value,
    acquireBackground(pet,cancel){
      if(!canBackground(pet))return null;
      const release=acquire(pet,true),entry={cancel};background.set(pet,entry);
      return ()=>{if(background.get(pet)===entry)background.delete(pet);release();};
    }};
};
