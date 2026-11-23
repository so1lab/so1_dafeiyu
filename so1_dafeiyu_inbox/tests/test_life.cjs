const assert=require('node:assert/strict'), vm=require('node:vm');
const create=require('../component/life-core.cjs'), pulse=require('../component/life-renderer.cjs');
const walk=require('../component/actions.json').walk;
const base=Date.UTC(2026,10,24,4);
const env=(now,extra={})=>({now,hour:12,idle:180,available:['observe','stretch','play','rest','stroll','nap'],canStroll:true,...extra});

// 八小时虚拟运行：有活动变化、最短间隔、状态有界，恢复时不会补播。
const brain=create({},()=>.37);let changes=[];
for(let t=0;t<8*3600;t+=2) {
  const p=brain.tick(env(base+t*1000,{idle:t%1200}));
  if(p.activity!=='quiet' && changes.at(-1)?.until!==p.until)changes.push({id:p.activity,until:p.until,at:base+t*1000});
  for(const key of ['energy','sleepiness','mood','curiosity'])assert(brain.state[key]>=0 && brain.state[key]<=100);
}
assert(changes.length>20);assert(new Set(changes.map(x=>x.id)).size>=4);
for(let i=1;i<changes.length;i++)assert(changes[i].at-changes[i-1].at>=90000);
assert(brain.state.history.length<=40);
let now=base+9*3600e3;
assert.equal(brain.tick(env(now)).activity,'quiet');
assert.equal(brain.tick(env(now+2000,{busy:true})).activity,'quiet');
assert.equal(brain.tick(env(now+100000,{fullscreen:true})).activity,'quiet');
const nap=create({sleepiness:85},()=>.2);
nap.tick(env(base,{available:['nap'],idle:600}));
for(let t=2000;t<60000;t+=2000)nap.tick(env(base+t,{available:['nap'],idle:600}));
assert.equal(nap.tick(env(base+60000,{available:['nap'],idle:600})).activity,'nap');
assert.equal(nap.tick(env(base+62000,{available:['nap'],idle:0})).activity,'quiet');
const restored=create(JSON.parse(JSON.stringify(brain.state)),()=>.1);
assert.equal(restored.tick(env(now+86400e3)).activity,'quiet');
assert.equal(create({energy:'bad',sleepiness:-20}).state.energy,78);

// 渲染调度验收：真实入口结构，虚拟时钟，不依赖 Electron 或用户桌面。
function harness(extra={}) {
  let clock=base, next=0;const frames=new Map(), calls=[],listeners=new Map();
  const s={pet:{id:'main',workStatusEnabled:false},assetRoot:'main',animations:{idle:['idle'],categories:[{actions:['超大伸懒腰','原地专心玩魔方','东张西望']}],sleep:[{start:['start'],loop:['sleep'],end:['wake']}]},
    pos:{x:600,y:700},halfW:60,halfH:45,size:120,winH:90,moveRef:null,throwRef:null,posFollow:null,
    moveToken:0,dragState:{active:false},facing:'left',front:0,pending:null,
    videoA:{readyState:3,paused:false,currentTime:0},videoB:{readyState:3,paused:false,currentTime:0},
    stopMove(){this.moveToken++;this.moveRef=null;},stopThrow(){},sendBounds(x,y){this.pos={x,y};calls.push(['move',x,y]);},
    switchTo(name){this.anim=name;calls.push(['clip',name]);},playOnce(name){this.switchTo(name,true);},
    playIdle(){this.switchTo('upstream-random');},handleEnded(){this.playIdle();},...extra};
  const context=vm.createContext({sprites:[s],VIEW:{x:0,y:0,w:1000,h:800},CONFIG:{scale:1},
    Date:class extends Date {static now(){return clock;}},performance:{now:()=>clock},
    requestAnimationFrame:fn=>{frames.set(++next,fn);return next;},cancelAnimationFrame:id=>frames.delete(id),
    window:{addEventListener:(n,fn)=>listeners.set(n,fn),removeEventListener:n=>listeners.delete(n)},
    createLife:(saved)=>create(saved,()=>extra.testRandom??.1),walk,saved:extra.savedState || {},options:null});
  let lastT=null;
  function tick(t,more={}) {
    if(lastT!==null && t-lastT>2000)for(let k=lastT+2000;k<t;k+=2000)tick(k,more);
    lastT=t;
    clock=base+t;context.options={now:clock,hour:12,idle:180,area:{x:0,y:0,width:1000,height:800},
      enabled:true,visible:true,defaultAssets:true,busy:false,foregroundOverlap:false,...more};
    return vm.runInContext('('+pulse.toString()+')(createLife,options,saved,walk)',context);
  }
  return {s,tick,calls,frames,listeners,context,frame(){for(const [id,fn]of [...frames]){frames.delete(id);fn();}}};
}
let h=harness();h.tick(0);h.tick(40000);assert.notEqual(h.s.anim,'idle');
h.s.handleEnded();assert.equal(h.s.anim,'idle');
h.tick(42000);assert.equal(h.s.anim,'idle','a finished action must not restart on each poll');
h.s.fishLife.hold();h.s.playOnce('啊呜吞件');h.tick(44000,{busy:true});h.s.playIdle();
assert.equal(h.s.anim,'啊呜吞件','random chain must not overwrite bite');
h.tick(80000,{busy:true});assert.equal(h.s.anim,'啊呜吞件');
h.s.playOnce('收好啦等夸');h.tick(90000,{busy:true});assert.equal(h.s.anim,'收好啦等夸');
h.tick(92000);h.tick(120000);assert.notEqual(h.s.anim,'upstream-random');
h.tick(122000,{enabled:false});assert.equal(h.s.anim,'upstream-random');
h.tick(124000,{enabled:true});h.tick(150000);assert.notEqual(h.s.anim,'upstream-random');
h.s.playOnce('user-action');h.tick(152000);assert.equal(h.s.anim,'user-action');
h.tick(200000,{fullscreen:true});assert.equal(h.s.anim,'idle');
h.s.frozen=true;h.s.playOnce('locked');h.tick(202000);assert.equal(h.s.anim,'locked');
h.s.frozen=false;h.s.sleeping=true;h.s.playOnce('native-sleep');h.tick(240000);assert.equal(h.s.anim,'native-sleep');
h.s.fishLife.dispose();assert(!h.s.fishLife);h.s.playIdle();assert.equal(h.s.anim,'upstream-random');

// 独立自主睡眠三段；用户恢复操作会醒来，显式投喂无需等待起床片段。
h=harness({testRandom:.99,pet:{id:'main',fixedEnabled:true},animations:{idle:['idle'],sleep:[{start:['start'],loop:['sleep'],end:['wake']}]}});
h.tick(0,{idle:600});h.tick(61000,{idle:600});assert.equal(h.s.anim,'start');
h.s.handleEnded();assert.equal(h.s.anim,'sleep');h.tick(63000,{idle:600});assert.equal(h.s.anim,'sleep');
h.tick(65000,{idle:0});assert.equal(h.s.anim,'wake');h.s.handleEnded();assert.equal(h.s.anim,'idle');
h.s.fishLife.hold();h.s.playOnce('bite');h.tick(67000,{busy:true});assert.equal(h.s.anim,'bite');

// 自主走位按视频相位推进，且取消后不再有帧、Y 位移或过期位置回写。
h=harness({animations:{idle:['idle']}});h.tick(0);h.tick(38000);assert.equal(h.s.anim,walk.clip);
h.frame();h.s.videoA.currentTime=.2;h.frame();const before={...h.s.pos};
assert(before.x<600);assert.equal(before.y,700);
h.s.fishLife.hold();assert.equal(h.frames.size,0);h.s.pos={x:300,y:400};h.frame();
assert.deepEqual(h.s.pos,{x:300,y:400});
// 固定位置与非默认角色不使用大肥鱼位移素材。
h=harness({pet:{id:'other',fixedEnabled:true},assetRoot:'other',animations:{idle:['idle']}});
h.tick(0);h.tick(60000);assert.equal(h.s.anim,'idle');assert.equal(h.frames.size,0);
// 负坐标屏幕、两倍缩放下恢复用户位置；已有任务/拖拽不被恢复坐标覆盖。
h=harness({savedState:{main:{home:{rx:.2,ry:.3}}}});
h.context.CONFIG.scale=2;h.context.VIEW.x=-500;h.context.VIEW.w=1500;
h.tick(0,{area:{x:-1000,y:0,width:1000,height:1600}});
assert.equal(h.s.pos.x,240);assert.equal(h.s.pos.y,195);
h=harness({savedState:{main:{home:{rx:.1,ry:.1}}}});
h.tick(0,{busy:true});assert.deepEqual(h.s.pos,{x:600,y:700});
h=harness({moveRef:7});h.tick(0);assert(!h.s.fishLife.owns);assert.equal(h.s.moveRef,7);
h=harness();h.tick(0);h.tick(180000,{quietMode:true});
assert(h.calls.filter(x=>x[0]==='clip').every(x=>x[1]==='idle'));
console.log('PASS life: 8-hour rhythm, offline restore, bounded states, task precedence, no repeated action, pause/resume, sleep/wake, manual priority, movement cancellation');
