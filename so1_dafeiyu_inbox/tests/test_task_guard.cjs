const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const guard=require('../component/task-guard.cjs'),pulse=require('../component/life-renderer.cjs'),core=require('../component/life-core.cjs');
const walk=require('../component/actions.json').walk;
const helper=process.env.DSH_PET_HELPER;
const c=vm.createContext({console,PetSprite:function(){},BUBBLE_DURATION_MS:10000,
  S:{balancePercent:()=>50,balanceBubbleView:()=>[],balanceEventIndex:()=>0,pickSlot:x=>Array.isArray(x)?x[0]:x,
    pick:x=>x[0],rollKind:()=> 'idle',whisperBubbleView:()=>[],WORK_STATUS_INDEX:{working:0},poolIncludes:(pool,n)=>pool.includes(n)},
  window:{setTimeout:()=>1,clearTimeout(){},postMessage(){},addEventListener(){},removeEventListener(){}},
  requestAnimationFrame:()=>1,cancelAnimationFrame(){},VIEW:{x:0,y:0,w:1000,h:800},CONFIG:{scale:1},
  core,walk,performance:{now:()=>0}});
if(helper){
  // 可选：直接对本机上游真实实现施压，防止夹具漏掉旁路。
  for(const f of ['sprite/playback.js','events.js'])vm.runInContext(fs.readFileSync(path.join(helper,f),'utf8'),c);
}
const calls=[];
const s=Object.assign(new c.PetSprite(),{
  pet:{id:'main',workStatusEnabled:true,balanceEnabled:true},assetRoot:'main',
  animations:{idle:['idle'],events:{workStatus:['work'],whisper:['whisper'],balance:['balance']}},
  pos:{x:600,y:700},halfW:60,halfH:45,size:120,winH:90,moveRef:null,throwRef:null,posFollow:null,
  facing:'left',dragState:{active:false},front:0,pending:null,
  videoA:{ended:false,loop:true,onended:'task-handler'},videoB:{ended:false},
  bubble:{classList:{remove(){}}},renderBubble(){calls.push('bubble');},applyWhisperHold(){calls.push('bubble');},
  stopMove(){calls.push('stopMove');},stopThrow(){calls.push('stopThrow');},
  switchTo(n){this.anim=n;calls.push(n);},playOnce(n){this.switchTo(n,true);},reportPlayback(p,state){calls.push(state);},
});
if(!helper)Object.assign(s,{
  playIdle(){this.stopMove();this.playOnce('random');},
  handleEnded(){this.playOnce('direct-event-next');},resumeWorkStatusAnim(){this.playOnce('work');return true;},
  onWorkTick(){this.stopMove();this.videoA.loop=false;this.playOnce('work');},
  showWhisper(...args){if(args[4]!==false){this.stopMove();this.playOnce('whisper');}this.renderBubble();},
  showBalanceNow(){this.renderBubble();this.stopMove();this.playOnce('balance');}
});
c.sprites=[s];
const apply=(op,id)=>vm.runInContext('('+guard.toString()+')('+JSON.stringify(op)+','+JSON.stringify(id)+')',c);
for(const enabled of [true,false]){
  c.options={now:Date.now(),hour:12,idle:0,enabled,visible:true,defaultAssets:true,availableClips:[]};
  vm.runInContext('('+pulse.toString()+')(core,options,{},walk)',c);
  apply('acquire','batch');s.fishLife.hold();apply('acquire','nested');
  for(const clip of ['啊呜吞件',walk.clip,'小小魔法-开合','轻轻丢文件-交接',walk.clip,'收好啦等夸','发现有文件','普通小跑-桌面靠近循环','偷偷看文件']){
    s.playOnce(clip);const before=calls.length,oldLoop=s.videoA.loop,oldHandler=s.videoA.onended;
    s.playIdle();s.handleEnded();assert.equal(s.resumeWorkStatusAnim(),false);
    s.onWorkTick({state:'working',sessionId:'session'},before+1);
    s.showWhisper('hello','','',10000,true);s.showBalanceNow({ok:true},false);
    c.options={...c.options,busy:false,now:c.options.now+2000};
    vm.runInContext('('+pulse.toString()+')(core,options,{},walk)',c);
    assert.equal(s.anim,clip,'automatic source replaced '+clip);
    assert(calls.slice(before).every(n=>n==='bubble'),'automatic source moved or changed clip');
    assert.equal(s.videoA.loop,oldLoop);assert.equal(s.videoA.onended,oldHandler);
  }
  s.playback={id:'receipt'};s.handleEnded();assert.equal(s.playback,null);assert(calls.includes('ended'));
  apply('release','nested');apply('release','nested');s.playIdle();assert.equal(s.anim,'偷偷看文件');
  assert.equal(s.fishTaskGuard.tokens.size,1,'nested/duplicate release unlocked active series');
  s.onWorkTick({state:null},999999);assert.equal(s.workState,null);
  apply('release','batch');assert.equal(s.fishTaskGuard.tokens.size,0);
  c.options={...c.options,busy:false,now:c.options.now+30000};
  vm.runInContext('('+pulse.toString()+')(core,options,{},walk)',c);
  s.playIdle();assert.equal(s.anim,helper || enabled?'idle':'random','random/idle chain failed to resume after final release');
  // 显式动作不受随机门禁影响，取消/用户拖动仍能 stopMove。
  s.playOnce('manual');s.stopMove();assert.equal(s.anim,'manual');
}
assert.equal(apply('release','unknown'),0);
// 任务先于生活初始化也要受保护；无需开启生活引擎才能暂停原版随机链。
const standalone={...s,fishTaskGuard:undefined,fishLife:undefined,playIdle(){this.anim='random';}};
c.sprites=[standalone];apply('acquire','early');standalone.anim='walk';standalone.playIdle();assert.equal(standalone.anim,'walk');
apply('release','early');standalone.playIdle();assert.equal(standalone.anim,'random');
console.log('PASS task guard: whole series, random/end/work/whisper/balance, stale tick, nested locks, receipts, life off and release'+(helper?' (actual installed upstream)':''));
