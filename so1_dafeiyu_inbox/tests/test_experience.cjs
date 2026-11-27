const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const experience=require('../component/experience.cjs'),pulse=require('../component/life-renderer.cjs'),core=require('../component/life-core.cjs');
const walk=require('../component/actions.json').walk;
function harness() {
  let clock=1000000,next=0;const listeners=new Map(),frames=new Map();
  const video=()=>({src:'',readyState:3,currentTime:0,paused:false,listeners:new Map(),
    addEventListener(t,f){this.listeners.set(t,f);},removeEventListener(t){this.listeners.delete(t);},
    emit(t){if(t==='ended')this.ended=true;this.listeners.get(t)?.({target:this,type:t});}});
  const a=video(),b=video();
  const s={pet:{id:'main',workStatusEnabled:false},assetRoot:'main',animations:{idle:['idle'],categories:[{actions:['东张西望','原地专心玩魔方']}],
    sleep:[{start:['start'],loop:['sleep'],end:['wake']}]},
    pos:{x:600,y:700},halfW:60,halfH:45,size:120,winH:90,moveRef:null,throwRef:null,posFollow:null,
    videoA:a,videoB:b,front:0,dragState:{active:false},facing:'left',pending:null,
    stopMove(){},stopThrow(){},sendBounds(x,y){this.pos={x,y};},
    switchTo(name,once){this.anim=name;this.once=once;a.ended=false;a.src='file:///'+encodeURIComponent(name)+'.webm';},
    playIdle(){this.switchTo('idle',false);},handleEnded(){this.playIdle();}};
  const c=vm.createContext({sprites:[s],VIEW:{x:0,y:0,w:1000,h:800},CONFIG:{scale:1},
    Date:class extends Date{static now(){return clock;}},Math,performance:{now:()=>clock},
    window:{addEventListener:(t,f)=>listeners.set(t,f),removeEventListener:t=>listeners.delete(t)},
    requestAnimationFrame:f=>{frames.set(++next,f);return next;},cancelAnimationFrame:id=>frames.delete(id),
    core:(saved)=>core(saved,()=>.1),walk,env:null});
  const tick=(t,extra={})=>{
    clock=1000000+t;c.env={now:clock,hour:12,idle:180,area:{x:0,y:0,width:1000,height:800},enabled:true,visible:true,defaultAssets:true,...extra};
    return vm.runInContext('('+pulse.toString()+')(core,env,{},walk)',c);
  };
  const trusted=type=>({type,isTrusted:true,target:{closest:()=>true}});
  return {s,a,b,tick,frames,listeners,trusted,clock:t=>clock=1000000+t};
}
let h=harness();h.tick(0);assert.equal(h.s.fishLife.run.status,'preparing');
assert(!h.s.fishLife.events.some(e=>e.type==='activity.completed'));
h.a.emit('playing');assert.equal(h.s.fishLife.run.status,'running');
h.a.emit('pause');assert.equal(h.s.fishLife.run.status,'paused');h.a.emit('playing');assert.equal(h.s.fishLife.run.status,'running');
for(let t=2000;t<=38000;t+=2000)h.tick(t);
assert.equal(h.s.fishLife.run.activity,'observe');assert.equal(h.s.fishLife.run.status,'preparing');
const observe=h.s.fishLife.run.id;h.a.emit('playing');
assert(h.s.fishLife.events.some(e=>e.type==='activity.started' && e.details.runId===observe));
h.a.emit('ended');h.s.handleEnded();h.a.emit('playing');
const snapshot=h.tick(40000);assert.equal(snapshot.self.activity,'quiet');
assert(snapshot.events.some(e=>e.type==='activity.completed' && e.details.runId===observe));
assert.equal(snapshot.activity,'observe','planned state can differ; self must report actual quiet pose');
let work=harness();work.s.pet.workStatusEnabled=true;work.s.workState='running';
const working=work.tick(5000);
assert(working.working && working.stationaryReady && !working.backgroundReady);
assert.equal(work.tick(6000,{fullscreen:true}).stationaryReady,false);
// 用户按下、拖动及放置保留明确原因；没有旧位移回写。
h.s.fishLife.start('play');h.a.emit('playing');
h.listeners.get('pointerdown')(h.trusted('pointerdown'));
h.s.dragState.active=true;h.s.switchTo('drag-pose',true);
assert.equal(h.tick(40050).backgroundReady,false,'drag blocks background tasks');
h.s.dragState.active=false;
h.s.pos={x:400,y:700};h.listeners.get('pointerup')(h.trusted('pointerup'));
assert.equal(h.tick(40450).backgroundReady,true,'released drag should not keep the long host cooldown');
assert(h.s.fishLife.events.some(e=>e.type==='user.dragged' && e.details.direction==='向左'));
assert(h.s.fishLife.events.some(e=>e.type==='activity.interrupted' && e.details.activity==='play' && e.details.reason.includes('按下')));
for(let t=42000;t<=48000;t+=2000)h.tick(t);
assert.equal(h.s.pos.x,400);assert(h.s.fishLife.events.some(e=>e.type==='user.position_settled'));
assert(h.s.fishLife.resumePrevious());h.tick(50000);assert.equal(h.s.fishLife.run.activity,'play');assert.equal(h.s.pos.x,400);h.a.emit('playing');
// 多个任务持锁不会把仍在真实播放的吞件误记为中断。
h.s.fishLife.hold();h.s.switchTo('啊呜吞件',true);h.a.emit('playing');const bite=h.s.fishLife.run.id;
h.s.fishLife.hold();assert.equal(h.s.fishLife.run.status,'running');
assert(!h.s.fishLife.events.some(e=>e.type==='activity.interrupted' && e.details.runId===bite));
h.a.ended=true;h.a.emit('pause');assert.equal(h.s.fishLife.run.status,'running');
h.a.emit('ended');assert(h.s.fishLife.events.some(e=>e.type==='activity.completed' && e.details.runId===bite));
const externalUntil=h.s.fishLife.externalUntil;
h.clock(51000);h.s.switchTo('idle',true);
assert.equal(h.s.fishLife.externalUntil,externalUntil,'idle must not extend host cooldown');
h.s.fishDesktopVisitToken='test';h.s.switchTo('发现有文件',true);
assert.equal(h.s.fishLife.externalUntil,externalUntil,'desktop activity must not extend host cooldown');
h.s.fishDesktopVisitToken=null;
// 解码失败和从未开始的动作不记录为完成。
h.s.switchTo('broken',true);const broken=h.s.fishLife.run.id;h.a.emit('error');
assert.equal(h.s.fishLife.run.status,'failed');assert(!h.s.fishLife.events.some(e=>e.type==='activity.completed'&&e.details.runId===broken));
// 快照确认只删除同一个 renderer session 的已持久化事件。
let current=h.tick(50000,{busy:true});const count=current.events.length;
current=h.tick(52000,{busy:true,ack:{session:'other',seq:9999}});assert(current.events.length>=count);
current=h.tick(54000,{busy:true,ack:{session:current.session,seq:current.seq}});assert.equal(current.events.length,0);
// 重启保留事实与打断原因；文件归档与送件是独立结果。
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fish-experience-'));
try {
  let journal=experience(dir);const facts=h.s.fishLife.events;
  const fact={id:'test:1',petId:'main',at:Date.now(),type:'activity.requested',details:{runId:'run1',activity:'play'}};
  assert(journal.append(fact));assert(!journal.append(fact));
  journal.append({...fact,id:'test:2',type:'activity.started'});
  journal.record('main','user.clicked');journal.record('main','user.fed',{count:2});
  journal.record('main','task.filed',{count:2,folders:['学习参考','财务票据']});
  journal=experience(dir);
  const view=journal.view('main','文件');assert.equal(view.current.status,'interrupted');
  assert(view.previous.reason.includes('重启'));assert(view.recent.some(e=>e.type==='task.filed'));
  assert(!view.recent.some(e=>e.type==='task.delivery_completed'));
  assert(view.relevant.some(e=>e.details.count===2));assert(journal.since('main','test:1').length>0);
  // 两只宠物的经历不能混入彼此的问答。
  journal.record('other','user.fed',{count:99});assert(!journal.view('main').recent.some(e=>e.details.count===99));
  const c=vm.createContext({globalThis:{},Symbol,Map,Date,JSON});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../component/awareness-support.js'),'utf8'),c);
  c.globalThis[Symbol.for('so1.dafeiyu.experiences')]=new Map([['main',{...view,events:view.recent,at:Date.now()}]]);
  const prompt=vm.runInContext("fishAwarenessContext('main','刚才我给了你什么文件')",c);
  assert(prompt.includes('投喂了 2 份文件'));assert(prompt.includes('财务票据'));assert(prompt.includes('归档成功不等于送件演出成功'));
  assert(vm.runInContext("fishAwarenessContext('missing','刚才')",c).includes('不要编造'));
  c.globalThis[Symbol.for('so1.dafeiyu.experiences')].get('main').at=Date.now()-20000;
  assert(vm.runInContext("fishAwarenessContext('main','现在')",c).includes('unknown'));
}finally{fs.rmSync(dir,{recursive:true,force:true});}
console.log('PASS experiences: real playback receipts, user drag/click, interruption cause, no stale movement, task ownership, failure, ack/replay, durable restart, separate filing/delivery and shared chat facts');
