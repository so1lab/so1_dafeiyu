const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const watch=require('../component/desktop-watch.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fish-desktop-'));
async function main(){
  let clock=10000;const found=[];
  fs.writeFileSync(path.join(dir,'old.txt'),'old');
  const watcher=watch({roots:[dir],now:()=>clock,intervalMs:1000000,stableMs:1500,onFound:rows=>found.push(...rows),onError:e=>{throw e;}});
  const scan=async()=>{await wait(20);await watcher.scan();await wait(20);};
  await watcher.ready;clock+=5000;await scan();assert.equal(found.length,0);
  fs.appendFileSync(path.join(dir,'old.txt'),'updated');await scan();assert.equal(found.length,0);
  const file=path.join(dir,'new.txt');fs.writeFileSync(file,'new');await scan();assert.equal(found.length,0);
  clock+=1000;fs.appendFileSync(file,'still writing');await scan();clock+=1000;await scan();assert.equal(found.length,0);
  clock+=1600;await scan();assert.equal(found.length,1);assert.equal(found[0].name,'new.txt');assert.equal(found[0].path,file);
  clock+=5000;await scan();assert.equal(found.length,1,'one appearance must notify once');
  fs.renameSync(path.join(dir,'old.txt'),path.join(dir,'old-renamed.txt'));await scan();clock+=2000;await scan();assert.equal(found.length,1);
  // 新建后尚未稳定就改名，仍须识别最终文件。
  fs.writeFileSync(path.join(dir,'draft.txt'),'x');await scan();fs.renameSync(path.join(dir,'draft.txt'),path.join(dir,'final.txt'));
  await scan();clock+=2000;await scan();assert(found.some(r=>r.name==='final.txt'));assert(!found.some(r=>r.name==='draft.txt'));
  fs.writeFileSync(path.join(dir,'download.crdownload'),'x');fs.mkdirSync(path.join(dir,'nested'));fs.writeFileSync(path.join(dir,'nested/child.txt'),'x');
  fs.writeFileSync(path.join(dir,'.hidden'),'x');await scan();clock+=3000;await scan();assert.equal(found.length,2);
  fs.renameSync(path.join(dir,'download.crdownload'),path.join(dir,'download.pdf'));await scan();clock+=2000;await scan();assert(found.some(r=>r.name==='download.pdf'));
  fs.writeFileSync(path.join(dir,'gone.txt'),'x');await scan();fs.unlinkSync(path.join(dir,'gone.txt'));clock+=3000;await scan();assert(!found.some(r=>r.name==='gone.txt'));
  watcher.stop();fs.writeFileSync(path.join(dir,'after-stop.txt'),'x');clock+=3000;await scan();assert(!found.some(r=>r.name==='after-stop.txt'));

  // 用真实文件事件测量默认速度；关闭整秒兜底，证明由确认定时器直接唤醒。
  const speedDir=path.join(dir,'speed');fs.mkdirSync(speedDir);
  const speedRows=[];let observed,firstWrite,lastWrite;
  const noticed=new Promise(resolve=>observed=resolve);
  const fast=watch({roots:[speedDir],intervalMs:60000,onFound:rows=>{speedRows.push(...rows);observed(Date.now());},onError:e=>{throw e;}});
  try {
    await fast.ready;const quick=path.join(speedDir,'quick.txt');
    firstWrite=Date.now();fs.writeFileSync(quick,'a');
    await wait(100);assert.equal(speedRows.length,0);
    fs.appendFileSync(quick,'b');await wait(100);assert.equal(speedRows.length,0);
    fs.appendFileSync(quick,'c');lastWrite=Date.now();
    let timeout;
    const at=await Promise.race([noticed,new Promise((_,reject)=>timeout=setTimeout(()=>reject(Error('fast watcher missed confirmation deadline')),1300))]).finally(()=>clearTimeout(timeout));
    assert(at-lastWrite>=370,'must still wait for writing to settle');
    assert(at-lastWrite<1200,'should not wait for the fallback poll');
    assert.equal(speedRows.length,1);assert.equal(speedRows[0].size,3);
    await wait(100);assert.equal(speedRows.length,1,'rapid writes must notify once');
    console.log('MEASURE desktop discovery: '+(at-firstWrite)+' ms from first appearance, '+(at-lastWrite)+' ms after final write');
  } finally {fast.stop();}

  function controllerHarness() {
    let foundCallback,point=null,resolveMove,cancelTask,clock=Date.now();const records=[],timers=[],scripts=[],messages=[];let released=0,visits=0,reactions=0;
    let reaction,lookups=0,policy={};
    const pet={isDestroyed:()=>false,isVisible:()=>true,webContents:{executeJavaScript:async code=>scripts.push(code)}};
    const life={canBackground:()=>true,record:(_p,type,details)=>records.push({type,details}),
      memoryPolicy:()=>policy,rememberDecision:(_p,episode,action,ids)=>records.push({type:'decision',details:{episode,action,ids}}),
      acquireBackground:(_p,cancel)=>{cancelTask=cancel;return ()=>released++;}};
    const archive={locate:async file=>{lookups++;return typeof point==='function'?point(file):point;},
      reactToFile:async()=>{reactions++;await reaction;},visitFile:async()=>{visits++;return new Promise(r=>resolveMove=r);}};
    const context={module:{exports:{}},__dirname:path.resolve(__dirname,'../component'),console,
      Date:class extends Date{static now(){return clock;}},
      setInterval:fn=>{timers.push(fn);return {unref(){}};},clearInterval(){},setTimeout:fn=>queueMicrotask(fn),clearTimeout(){},
      require:n=>n==='electron'?{app:{getPath:()=>dir}}:n==='./archive.cjs'?archive:n==='./desktop-watch.cjs'?
        opts=>{foundCallback=opts.onFound;return {status:()=>({ready:true}),stop(){}};}:require(n)};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../component/desktop-visit.cjs'),'utf8'),context);
    const controller=context.module.exports({pets:new Map([['main',pet]]),life,config:{},save(){},say:message=>messages.push(message),roots:[dir]});
    controller.setEnabled(true);
    return {controller,records,scripts,messages,emit:row=>foundCallback([row]),point:p=>point=p,finish:()=>resolveMove?.({x:200,y:200}),
      cancel:()=>cancelTask?.(),pump:(advance=0)=>{clock+=advance;timers[0]();},visits:()=>visits,reactions:()=>reactions,released:()=>released,
      lookups:()=>lookups,policy:p=>policy=p,holdReaction:()=>{let finish;reaction=new Promise(r=>finish=r);return finish;}};
  }
  const row={path:file,name:'new.txt',size:fs.statSync(file).size},before=fs.readFileSync(file);
  let h=controllerHarness();h.emit(row);await wait(5);
  assert.deepEqual(h.messages,[],'discovery should not show a text prompt');
  assert.equal(h.controller.status().phase,'waiting-desktop');assert.equal(h.visits(),0);assert.equal(h.reactions(),1,'covered icon must not replay discovery');
  h.point({kind:'desktop',x:200,y:200});h.pump(2000);await wait(5);assert.equal(h.visits(),1);
  h.cancel();h.finish();await wait(5);assert.equal(h.controller.status().phase,'cancelled');assert.equal(h.released(),2);
  assert(!h.records.some(e=>e.type==='desktop.arrived'));assert(h.records.some(e=>e.type==='desktop.cancelled'));h.controller.dispose();
  h=controllerHarness();h.point({kind:'desktop',x:200,y:200});
  const finishReaction=h.holdReaction();
  h.emit(row);await wait(5);
  assert.equal(h.lookups(),1,'locate during discovery playback');
  assert.equal(h.visits(),0,'wait for the discovery animation to finish');
  finishReaction();await wait(5);
  assert.equal(h.visits(),1,'approach without waiting for another scheduler tick');
  assert.equal(h.released(),0,'keep the original task lock through the handoff');
  h.finish();await wait(5);
  assert.equal(h.controller.status().phase,'arrived');assert(h.records.some(e=>e.type==='desktop.arrived'&&e.details.name==='new.txt'));
  assert.deepEqual(h.messages,[],'arrival should not show a text prompt');
  assert.equal(h.released(),1);h.controller.dispose();assert.deepEqual(fs.readFileSync(file),before);
  h=controllerHarness();h.point({kind:'desktop',x:200,y:200});
  const finishCancelledReaction=h.holdReaction();h.emit(row);await wait(5);
  h.cancel();finishCancelledReaction();await wait(5);
  assert.equal(h.visits(),0,'a cancelled reaction never starts walking');
  assert.equal(h.released(),1);h.controller.dispose();
  // 第一份文件一直被遮挡时，第二份仍然要完成发现、靠近和偷看。
  h=controllerHarness();
  const second={name:'next.txt',path:path.join(dir,'next.txt')};
  fs.writeFileSync(second.path,'second');
  h.point(target=>({kind:'desktop',x:200,y:200,visible:target===second.path}));
  h.emit(row);await wait(5);h.pump();await wait(5);
  assert.equal(h.controller.status().phase,'waiting-desktop');
  h.emit(second);await wait(5);assert.equal(h.reactions(),2);
  h.pump(2000);await wait(5);assert.equal(h.visits(),1);
  h.finish();await wait(5);
  assert(h.records.some(e=>e.type==='desktop.arrived'&&e.details.name===second.name));
  assert.equal(h.controller.status().queued,1);
  h.controller.dispose();
  h=controllerHarness();h.policy({stationary:'saved-work-rule'});h.emit(row);await wait(5);
  assert.equal(h.controller.status().phase,'observed');
  assert.equal(h.lookups(),0);assert.equal(h.visits(),0);
  assert.equal(h.reactions(),1);
  const stationaryEvent=h.records.find(row=>row.type==='desktop.stationary');
  assert(h.records.some(e=>e.type==='decision'&&e.details.episode===stationaryEvent.details.episodeId&&e.details.ids[0]==='saved-work-rule'));
  h.controller.dispose();
  const stat=fs.statSync(file);
  const fixture={peek:'咦，这是一份排班表！',reaction:'啧，周末还要排班呀。'};
  let dialogueCalls=0;
  const dialogue=require('../component/analyze.cjs').desktopDialogue(
    async req=>{assert.deepEqual(req,{action:'desktop_excerpt',file});return {excerpt:'周末活动排班'};},
    async (method,url,body)=>{
      dialogueCalls++;
      assert.equal(method,'POST');assert.equal(url,'/dsh-pet-7340/desktop-dialogue');
      assert.deepEqual(JSON.parse(body),{name:'new.txt',excerpt:'周末活动排班'});
      return {body:JSON.stringify({ok:true,text:JSON.stringify(fixture)})};
    });
  assert.deepEqual(await dialogue({...row,modifiedAt:stat.mtimeMs},()=>true),fixture);
  assert.equal(await dialogue({...row,modifiedAt:0},()=>true),null);
  assert.equal(dialogueCalls,1,'only the original file may send a sample');
  // 真实 visitFile 编排：只做桌面查询和位移；不允许开窗、施法、投放或回程。
  for(const mode of ['visible','slow-model','moved','cancel-before-walk','cancel-after-peek','fullscreen-before-walk','fullscreen-during-load']) {
    const events=[],position={x:100,y:100},module={exports:{}};let alive=true,claims=0,dialogueState;
    const context={module,__dirname:path.resolve(__dirname,'../component'),Buffer,console,
      setInterval:()=>1,clearInterval(){},setTimeout:fn=>{queueMicrotask(fn);return 1;},clearTimeout(){},
      require:n=>n==='electron'?{screen:{screenToDipPoint:p=>p,getDisplayNearestPoint:()=>({workArea:{x:0,y:0,width:1200,height:900}})}}:
        n==='node:child_process'?{execFile:(_cmd,args,_opts,cb)=>{
          assert(args.includes('-DesktopOnly'));assert(!args.includes('-OpenAndLocate'));events.push('locate');
          cb(null,JSON.stringify({x:mode==='moved'?750:700,y:400,kind:'desktop',visible:true}));}}:
        n.startsWith('./')?require(path.join(__dirname,'../component',n)):require(n)};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../component/archive.cjs'),'utf8'),context);
    const pet={isDestroyed:()=>false,isVisible:()=>true,getNativeWindowHandle:()=>Buffer.alloc(8),getContentBounds:()=>({x:0,y:0}),
      webContents:{getZoomFactor:()=>1,async executeJavaScript(code){
        if(code.includes('fishDesktopVisitToken=id;')){
          claims++;if(mode==='cancel-before-walk'&&claims===2)alive=false;
          return true;
        }
        if(code.startsWith('(function(id)')){
          return true;
        }
        if(code.startsWith('(function noticeFile')){
          const args=JSON.parse('['+code.slice(code.lastIndexOf(')(')+2,-1)+']');
          const stage={'发现有文件':'discover','偷偷看文件':'peek','一脸嫌弃':'disdain'}[args[0]];
          assert(stage);events.push(stage);
          if(stage==='discover')return true;
          const cue=stage==='peek'?4.2:1.25;
          const line=stage==='peek'?fixture.peek:fixture.reaction;
          const frames=[],spoken=[],video={paused:false,currentTime:0};
          const sprite={fishDesktopVisitToken:'visit',fishDesktopDialogue:dialogueState,front:0,videoB:video,pet:{},dragState:{active:false},
            stopMove(){},stopThrow(){},playOnce(clip){this.anim=clip;},
            showWhisper(text,_image,_url,_duration,anim){assert.equal(anim,false);spoken.push(text);events.push(stage+'-bubble');}};
          const playing=vm.runInNewContext(code,{sprites:[sprite],setTimeout:()=>1,clearTimeout(){},
            requestAnimationFrame:fn=>frames.push(fn),cancelAnimationFrame(){}});
          sprite.front=1;
          video.currentTime=cue-.05;frames.shift()();
          assert.deepEqual(spoken,[],'speech must wait for the matching pose');
          video.currentTime=cue+.05;video.paused=true;frames.shift()();
          assert.deepEqual(spoken,[],'speech must wait while the clip is paused');
          video.paused=false;frames.shift()();frames.shift()();
          assert.deepEqual(spoken,mode==='slow-model'?[]:[line],'ready dialogue is spoken once');
          video.ended=true;video.onended();
          if(stage==='peek' && mode==='cancel-after-peek')alive=false;
          return playing;
        }
        if(code.startsWith('(function(id,lines)')){
          const sprite={fishDesktopVisitToken:'visit'};
          vm.runInNewContext(code,{sprites:[sprite]});
          dialogueState=sprite.fishDesktopDialogue;
        }
        if(code.startsWith('(function spriteGeometry'))return {...position,w:100};
        if(code.startsWith('(async function travel')){
          const args=JSON.parse('['+code.slice(code.lastIndexOf(')(')+2,-1)+']');
          assert.equal(args[3].clip,'普通小跑-桌面靠近循环');
          if(mode.startsWith('fullscreen')){
            const swaps=[],env={fullscreen:mode==='fullscreen-before-walk'};
            const video={src:encodeURIComponent(args[3].clip)+'.webm',paused:false,pause(){this.paused=true;}};
            const sprite={fishDesktopVisitToken:'visit',fishLife:{env},pet:{},dragState:{},
              pos:{...position},videoB:video,stopMove(){},stopThrow(){},
              switchTo(clip){swaps.push(clip);this.anim=clip;this.pending={anim:clip};},
              sendBounds(){assert.fail('fullscreen must block displacement');}};
            await assert.rejects(vm.runInNewContext(code,{sprites:[sprite],performance,requestAnimationFrame:fn=>{
              env.fullscreen=true;queueMicrotask(fn);
            }}),/环境变化/);
            if(mode==='fullscreen-before-walk')assert.deepEqual(swaps,[]);
            else{assert.deepEqual(swaps,[args[3].clip,args[5].idle]);assert(video.paused);}
            throw Error('桌面观察被用户操作或环境变化中断');
          }
          position.x+=args[0];position.y+=args[1];events.push('walk');
        }
        if(code.startsWith('(function(id,clip)'))events.push('idle');
      }}};
    await module.exports.reactToFile(pet,{token:'react',alive:()=>alive});
    const result=module.exports.visitFile(pet,file,{point:{x:700,y:400,kind:'desktop'},token:'visit',alive:()=>alive,
      prepareDialogue:()=>mode==='slow-model'?new Promise(()=>{}):fixture});
    if(mode==='visible' || mode==='slow-model'){
      await result;assert.equal(position.x,625);assert.equal(position.y,391);
      const expected=['discover','walk','peek','peek-bubble','disdain','disdain-bubble','idle'];
      assert.deepEqual(events.filter(x=>x!=='locate'),mode==='slow-model'?expected.filter(x=>!x.endsWith('-bubble')):expected);
    }else{
      await assert.rejects(result);assert(!events.includes('disdain'));
      if(mode==='cancel-before-walk')assert(!events.includes('walk'));
    }
  }
  console.log('PASS desktop: baseline, stability, one-time detection, new/existing rename, download completion, deletion, no recursion, hidden files, stop, visible-icon wait, task cancellation and unchanged file');
  const analyze=require('../component/analyze.cjs');
  let releaseSlow;
  const results=[];
  const host=(_method,_url,payload)=>JSON.parse(payload).name==='slow.txt'?
    new Promise(resolve=>{releaseSlow=resolve;}):{body:JSON.stringify({ok:true,text:JSON.stringify({summary:'快速文件'})})};
  for await(const item of analyze(['slow.txt','fast.txt','damaged.txt'],dir,async req=>{
    if(req.file==='damaged.txt')throw Error('采样失败');
    return {sig:'sample',body:'片段',localBody:'完整本地采样',candidates:[],categories:[]};
  },host,35))results.push(item);
  assert.equal(results.at(-1).file,'slow.txt');
  assert(results.find(item=>item.file==='fast.txt')?.plan);
  assert.equal(results.find(item=>item.file==='damaged.txt').sample,null);
  assert.equal(results.at(-1).sample.body,'完整本地采样');
  assert.equal(results.at(-1).plan,undefined);
  releaseSlow({body:'{"ok":false}'});
  console.log('PASS batch: fast files proceed, timed-out and failed samples fall back independently');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>fs.rmSync(dir,{recursive:true,force:true}));
