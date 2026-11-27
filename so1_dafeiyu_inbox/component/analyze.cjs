const path=require('node:path');
const fs=require('node:fs/promises');
module.exports=async function analyze(req,root,worker,host){
  const plans=Object.create(null);
  for(const file of [...new Set(req.paths)]){
    const sample=await worker({action:'sample',file},root);
    if(!sample.sig)continue;
    try{
      const response=await host('POST','/dsh-pet-7340/inbox-analyze',JSON.stringify({
        name:path.basename(file),excerpt:sample.body, candidates:sample.candidates, existingCollections:sample.categories.filter(c=>!c.includes("/") && !["待确认","待分类"].includes(c)).slice(0,80)
      }));
      const reply=JSON.parse(response.body);
      if(!reply.ok)continue;
      const clean=reply.text.trim().replace(/^```(?:json)?\s*|\s*```$/gi,'');
      const plan=JSON.parse(clean);
      if(typeof plan.summary==='string' && plan.summary.trim())
        plans[file]={sig:sample.sig,collection:plan.collection,project:plan.project,decision:plan.decision,folder:plan.folder,anchors:plan.anchors,reason:plan.reason,tags:Array.isArray(plan.tags)?plan.tags.slice(0,5):[],summary:plan.summary.trim().slice(0,48)};
    }catch{/* 离线或返回格式错误时，仍在同一资料库完成归档。 */}
  }
  return plans;
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
