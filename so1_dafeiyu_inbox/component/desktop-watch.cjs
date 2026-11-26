// 第一层元数据观察：存量不触发，不读正文，不改文件。事件通知与定期核对互相补充。
const fs=require('node:fs'),path=require('node:path');
module.exports=function watchDesktop({roots,onFound,onError=()=>{},intervalMs=1000,stableMs=400,now=Date.now}) {
  const key=p=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);
  const ignored=name=>name.startsWith('.') || /^(desktop\.ini|thumbs\.db)$/i.test(name) ||
    /(?:\.tmp|\.temp|\.crdownload|\.part|\.partial|\.download|~)$/i.test(name) || name.startsWith('~$');
  let known=new Map(),pending=new Map(),retired=new Map(),baseline=false,scanning=false,closed=false;
  let confirmation=null;
  const watchers=[];
  const identity=s=>s.ino?`${s.dev}:${s.ino}:${s.birthtimeMs}`:null;
  function confirmSoon(){
    clearTimeout(confirmation);confirmation=null;
    if(closed || !pending.size)return;
    // 文件事件立即建候选；稳定窗口到期直接确认，不再等下一次整秒轮询。
    const deadline=Math.min(...[...pending.values()].map(p=>p.since+stableMs));
    confirmation=setTimeout(()=>void scan(),Math.max(20,deadline-now()));confirmation.unref();
  }
  async function scan() {
    if(closed || scanning)return;scanning=true;
    try {
      const rows=new Map();
      for(const root of roots) {
        const entries=await fs.promises.readdir(root,{withFileTypes:true});
        for(const entry of entries) {
          if(ignored(entry.name) || !entry.isFile() || entry.isSymbolicLink())continue;
          const file=path.join(root,entry.name);
          try {
            const s=await fs.promises.lstat(file);if(!s.isFile() || s.isSymbolicLink())continue;
            rows.set(key(file),{path:file,name:entry.name,size:s.size,modifiedAt:s.mtimeMs,identity:identity(s),stamp:s.size+':'+s.mtimeMs});
          } catch {/* 文件可能已在枚举期间被删除。 */}
        }
      }
      if(closed)return;
      if(!baseline){known=rows;baseline=true;return;}
      const time=now(),found=[];
      for(const [id,row] of known)if(!rows.has(id)){
        const unannounced=pending.has(id);pending.delete(id);
        if(row.identity && !unannounced)retired.set(row.identity,time);
      }
      for(const [id,at] of retired)if(time-at>60000)retired.delete(id);
      for(const [id,row] of rows) {
        if(!known.has(id) && !(row.identity && retired.has(row.identity)))pending.set(id,{stamp:row.stamp,since:time});
        const waiting=pending.get(id);if(!waiting)continue;
        if(waiting.stamp!==row.stamp){waiting.stamp=row.stamp;waiting.since=time;}
        if(time-waiting.since>=stableMs){pending.delete(id);found.push(row);}
      }
      known=rows;
      if(found.length && !closed)await onFound(found);
    }catch(e){if(!closed)onError(e);}
    finally{scanning=false;confirmSoon();}
  }
  const ready=scan();
  for(const root of roots)try {
    const watcher=fs.watch(root,{persistent:false},()=>void scan());watcher.on('error',onError);watchers.push(watcher);
  }catch(e){onError(e);}
  const timer=setInterval(()=>void scan(),intervalMs);timer.unref();
  return {ready,scan,status:()=>({ready:baseline,pending:pending.size}),stop(){closed=true;clearInterval(timer);clearTimeout(confirmation);for(const w of watchers)w.close();pending.clear();}};
};
