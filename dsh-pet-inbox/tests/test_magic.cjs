// 无 Electron 依赖：验证实际施法函数的播放时钟、取消与单次触发语义。
const assert=require('node:assert/strict'),vm=require('node:vm');
const cast=require('../component/magic.cjs');
async function scenario(mode){
  let clock=0, calls=0, firedAt=0;
  const video={currentTime:0,readyState:0,ended:false,style:{},classList:{contains:()=>clock>=300}};
  const s={front:0,videoB:video,dragState:{active:false},moveToken:0,gen:0,facing:'right',
    stopMove(){this.moveToken++},stopThrow(){},playOnce(n){this.anim=n;this.gen++}};
  const context=vm.createContext({sprites:[s],performance:{now:()=>clock},setTimeout(fn){
    clock+=20;
    if(mode!=='stall' && clock>=300){video.readyState=2;video.currentTime=(clock-300)/1000;video.ended=video.currentTime>=.6;}
    if(mode==='drag' && clock>=400)s.dragState.active=true;
    if(mode==='late-drag' && clock>=700)s.moveToken++;
    queueMicrotask(fn);
  }});
  const pet={webContents:{executeJavaScript:code=>Promise.resolve().then(()=>vm.runInContext(code,context))}};
  let error;
  try{await cast(pet,{clip:'magic',releaseMs:200,timeoutMs:1000},()=>{
    calls++;firedAt=clock;assert(video.currentTime>=.2);if(mode==='operation-error')throw Error('operation failed');return 'done';
  });}catch(e){error=e;}
  if(['drag','stall'].includes(mode)){assert(error);assert.equal(calls,0);}
  else {assert.equal(calls,1);assert(firedAt>=500);}
  if(mode==='ok'){assert(!error);assert(video.ended);assert.equal(s.inboxMagic,undefined);assert.equal(video.style.transform,'');}
  if(mode==='late-drag')assert.match(error.message,/打断/);
  if(mode==='operation-error'){assert.match(error.message,/operation failed/);assert(video.ended);}
}
(async()=>{for(const mode of ['ok','drag','late-drag','stall','operation-error'])await scenario(mode);console.log('PASS magic: video clock, delayed load, one trigger, cancellation, timeout, operation failure');})().catch(e=>{console.error(e);process.exitCode=1});
