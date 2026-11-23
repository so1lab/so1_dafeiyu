const {app, screen, powerMonitor} = require('electron');
const fs = require('node:fs'), path = require('node:path');
const {spawn} = require('node:child_process');
const readline = require('node:readline');
const core = require('./life-core.cjs'), pulse = require('./life-renderer.cjs');
const walk = require('./actions.json').walk;

module.exports = function startLife({pets, data, config, save}) {
  const file=path.join(data,'life-state.json');
  let saved={};
  let availableClips=[];
  try { availableClips=fs.readdirSync(path.resolve(__dirname,'../../../assets/webm')).filter(n=>n.endsWith('.webm')).map(n=>n.slice(0,-5)); } catch {}
  try { const parsed=JSON.parse(fs.readFileSync(file,'utf8')); if(parsed.version===1) saved=parsed.pets || {}; } catch {}
  const holds=new Map(), running=new Set(), latest=new Map();
  let suspended=false, disposed=false, foreground=null, sensor=null, lastSave=0, timer;
  const log=e=>console.warn('[fish-life]',e.message);
  function persist() {
    try {
      fs.writeFileSync(file+'.tmp',JSON.stringify({version:1,pets:saved},null,2));
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
  function suspend() { suspended=true; refresh(); persist(); }
  function resume() { suspended=false; foreground=null; refresh(); }
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
      const fullscreen=!!fg && foreground.pid!==process.pid && covers(fg,display.bounds);
      const env={now:Date.now(),hour:new Date().getHours(),idle:powerMonitor.getSystemIdleTime(),
        busy:(holds.get(pet)?.size || 0)>0, suspended, fullscreen, quietMode:!!config.lifeQuiet,
        enabled:config.lifeEnabled!==false, visible:pet.isVisible(), area:work,
        foregroundOverlap:!fresh || (!!fg && foreground.pid!==process.pid &&
          center.x>fg.x && center.x<fg.x+fg.width && center.y>fg.y && center.y<fg.y+fg.height),
        defaultAssets:true, availableClips};
      const result=await pet.webContents.executeJavaScript(
        '('+pulse.toString()+')('+core.toString()+','+JSON.stringify(env)+','+JSON.stringify(saved)+','+JSON.stringify(walk)+')');
      if(result) { latest.set(pet,result); saved[result.id]=result.state; }
      if(Date.now()-lastSave>30000) persist();
    } catch(e) { if(!pet.isDestroyed()) log(e); }
    finally { running.delete(pet); }
  }
  function refresh() { for(const pet of pets.values()) void tick(pet); }
  function acquire(pet) {
    const targets=pet?[pet]:[...pets.values()], token=Symbol('task');
    for(const p of targets) {
      if(p.isDestroyed())continue;
      if(!holds.has(p)) holds.set(p,new Set());
      holds.get(p).add(token);
      // 必须与接件指令在同一 webContents 顺序提交，不能等下一次两秒采样。
      p.webContents.executeJavaScript("if(typeof sprites!=='undefined') sprites[0]?.fishLife?.hold(); undefined;").catch(()=>{});
    }
    let released=false;
    return () => {
      if(released)return; released=true;
      for(const p of targets) { const set=holds.get(p); set?.delete(token); if(!set?.size)holds.delete(p); }
      refresh();
    };
  }
  function settings(patch) {
    if(typeof patch?.enabled==='boolean')config.lifeEnabled=patch.enabled;
    if(typeof patch?.quiet==='boolean')config.lifeQuiet=patch.quiet;
    save(); refresh(); return status();
  }
  function complete(pet) {
    if(pet && !pet.isDestroyed())pet.webContents.executeJavaScript(
      "if(typeof sprites!=='undefined') sprites[0]?.fishLife?.brain.complete(Date.now()); undefined;"
    ).catch(()=>{});
  }
  function status() {
    return {enabled:config.lifeEnabled!==false,quiet:!!config.lifeQuiet,
      pets:[...latest.entries()].filter(([p])=>!p.isDestroyed()).map(([,s])=>({
        id:s.id, activity:s.held?'task':s.activity,reason:s.held?'先把你的事情做好':s.reason,
        energy:Math.round(s.state.energy),sleepiness:Math.round(s.state.sleepiness),
        mood:Math.round(s.state.mood),home:s.home,history:s.state.history.slice(-12)}))};
  }
  function dispose() {
    if(disposed)return; disposed=true; clearInterval(timer); persist(); sensor?.kill();
    powerMonitor.removeListener('suspend',suspend); powerMonitor.removeListener('lock-screen',suspend);
    powerMonitor.removeListener('resume',resume); powerMonitor.removeListener('unlock-screen',resume);
    app.removeListener('before-quit',dispose); holds.clear(); latest.clear();
  }
  timer=setInterval(()=>{
    for(const p of latest.keys())if(p.isDestroyed()){latest.delete(p);holds.delete(p);}
    refresh();
  },2000);
  timer.unref(); app.once('before-quit',dispose); refresh();
  return {acquire,status,settings,dispose,refresh,complete};
};
