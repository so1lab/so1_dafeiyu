const path=require('node:path');
const fs=require('node:fs/promises');
const concurrency=3;
let activeModelRequests=0;
async function prepare(file,root,worker,host,timeoutMs){
  let sample;
  try{sample=await worker({action:'sample',file},root);}
  catch{return {file,sample:null};}
  const result={file,sample:sample?.sig?{sig:sample.sig,body:sample.localBody ?? sample.body}:null};
  if(!result.sample || !host || activeModelRequests>=concurrency)return result;
  activeModelRequests++;
  let timer;
  try{
    const request=Promise.resolve().then(()=>host('POST','/dsh-pet-7340/inbox-analyze',JSON.stringify({
      name:path.basename(file),excerpt:sample.body, candidates:sample.candidates, existingCollections:sample.categories.filter(c=>!c.includes("/") && !["待确认","待分类"].includes(c)).slice(0,80)
    }))).finally(()=>activeModelRequests--);
    // 宿主回执前保留并发槽位。超时文件先走本地规则，迟到的回复不再使用。
    const response=await Promise.race([request,new Promise(resolve=>{timer=setTimeout(resolve,timeoutMs);})]);
    if(!response)return result;
    const reply=JSON.parse(response.body);
    if(!reply.ok)return result;
    const clean=reply.text.trim().replace(/^```(?:json)?\s*|\s*```$/gi,'');
    const plan=JSON.parse(clean);
    if(typeof plan.summary==='string' && plan.summary.trim())
      result.plan={sig:sample.sig,collection:plan.collection,project:plan.project,decision:plan.decision,folder:plan.folder,anchors:plan.anchors,reason:plan.reason,tags:Array.isArray(plan.tags)?plan.tags.slice(0,5):[],summary:plan.summary.trim().slice(0,48)};
  }catch{/* 离线或返回格式错误时，仍在同一资料库完成归档。 */}
  finally{clearTimeout(timer);}
  return result;
}
module.exports=async function* analyze(paths,root,worker,host,timeoutMs=6000){
  const pending=new Map();
  let next=0;
  const fill=()=>{
    while(pending.size<concurrency && next<paths.length){
      const file=paths[next++];
      pending.set(file,prepare(file,root,worker,host,timeoutMs));
    }
  };
  fill();
  while(pending.size){
    const ready=await Promise.race(pending.values());
    pending.delete(ready.file);
    fill();
    yield ready;
  }
};

module.exports.desktopDialogue=function desktopDialogue(worker,host){
  let busy=false;
  return async (file,alive,petId)=>{
    if(busy || !alive())return null;
    busy=true;
    const unchanged=async()=>{
      const stat=await fs.lstat(file.path);
      return stat.isFile() && !stat.isSymbolicLink() && stat.size===file.size &&
        stat.mtimeMs===file.modifiedAt &&
        (!file.identity || file.identity===`${stat.dev}:${stat.ino}:${stat.birthtimeMs}`);
    };
    try {
      if(!await unchanged() || !alive())return null;
      const {excerpt}=await worker({action:'desktop_excerpt',file:file.path});
      if(!await unchanged() || !alive())return null;
      const response=await host('POST','/dsh-pet-7340/desktop-dialogue',JSON.stringify({
        name:file.name.slice(0,180),excerpt:typeof excerpt==='string'?excerpt.slice(0,900):'',
        petId
      }));
      if(!alive() || !await unchanged())return null;
      const reply=JSON.parse(response.body);
      if(!reply.ok || typeof reply.text!=='string')return null;
      const result=JSON.parse(reply.text.trim().replace(/^\x60\x60\x60(?:json)?\s*|\s*\x60\x60\x60$/gi,''));
      const line=value=>typeof value==='string' && !/[\r\n<>]/u.test(value) &&
        value.trim().length<=36 ? value.trim() : '';
      return {peek:line(result?.peek),reaction:line(result?.reaction)};
    }catch{return null;}
    finally{busy=false;}
  };
};
