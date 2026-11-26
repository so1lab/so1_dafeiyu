// 验证完整送件编排；不触碰用户文件或桌面窗口。
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const base=path.resolve(__dirname,'../component');
async function run(mode){
  const events=[],state={x:100,y:100},mod={exports:{}};
  const context={module:mod,Buffer,console,__dirname:base,setTimeout:f=>{queueMicrotask(f);return 0},clearTimeout(){},
    require:n=>n==='electron'?{screen:{screenToDipPoint:p=>p,getDisplayNearestPoint:()=>({workArea:{x:0,y:0,width:1200,height:900}})}}:
      n==='node:child_process'?{execFile:(cmd,args,opts,cb)=>{events.push('verify');cb(null,JSON.stringify({x:700,y:mode==='moved'?550:400,kind:'explorer',hwnd:1}))}}:
      n.startsWith('./')?require(path.join(base,n)):require(n)};
  vm.runInNewContext(fs.readFileSync(path.join(base,'archive.cjs'),'utf8'),context);
  const archive=mod.exports,opened=new Set();
  archive.prepareLocator=()=>({cancel(){},async locate(){events.push('open');if(mode!=='existing')opened.add(1);return {x:700,y:400,kind:'explorer',hwnd:1};}});
  archive.closeOpened=async(folder,set)=>{if(set.size)events.push('close');set.clear();};
  const pet={isDestroyed:()=>false,isVisible:()=>true,getNativeWindowHandle:()=>Buffer.alloc(8),getContentBounds:()=>({x:0,y:0}),webContents:{getZoomFactor:()=>1,send(){},
    async executeJavaScript(code){
      if(code.startsWith('(function spriteGeometry'))return {...state,w:100,z:1};
      if(code.startsWith('(function magicPhase')){
        const cue=code.endsWith(',"cue")');events.push(cue?'cue':'end');
        if(cue && mode==='cancel')throw Error('施法被打断');return;
      }
      if(code.startsWith('(async function travel')){const args=JSON.parse('['+code.slice(code.lastIndexOf(')(')+2,-1)+']');state.x+=args[0];state.y+=args[1];events.push('move');return;}
      if(code.startsWith('(function throwCue'))events.push('throw');
      if(code.startsWith('(function celebrate')){events.push('celebrate');return true;}
    }}};
  await archive(pet,[{folder:'C:/warehouse/pictures',name:'test',count:1}],()=>{},true,{opened});
  if(mode==='cancel'){assert(!events.includes('open'));assert(!events.includes('move'));return;}
  assert.equal(events.filter(e=>e==='open').length,1);
  assert(events.indexOf('cue')<events.indexOf('open'));
  assert.equal(events.filter(e=>e==='move').length,2);
  assert.equal(state.x,100);assert.equal(state.y,100);
  assert.equal(events.filter(e=>e==='close').length,mode==='existing'?0:1);
  assert.equal(events.includes('throw'),mode!=='moved');
  assert.equal(events.includes('celebrate'),mode!=='moved');
  if(mode==='stable')assert(events.indexOf('close')<events.lastIndexOf('move') && events.lastIndexOf('move')<events.indexOf('celebrate'));
}
(async()=>{for(const mode of ['stable','moved','existing','cancel'])await run(mode);console.log('PASS flow: one open/close, return before praise, moved target, retained existing window, cancelled cast');})().catch(e=>{console.error(e);process.exitCode=1});
