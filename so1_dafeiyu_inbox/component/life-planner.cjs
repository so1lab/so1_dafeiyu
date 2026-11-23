// 异步慢规划：模型不持有身体，不生成系统指令，不阻塞实时行为。
const LIMITS={quiet:[30,180],rest:[30,180],observe:[6,12],stretch:[6,15],play:[8,20],stroll:[8,15],nap:[60,180]};
function parsePlan(reply,eligible) {
  if(!reply?.ok || typeof reply.text!=='string' || reply.text.length>5000)throw Error(reply?.reason || 'invalid-response');
  const value=JSON.parse(reply.text.trim().replace(/^```(?:json)?\s*|\s*```$/gi,''));
  if(typeof value.goal!=='string' || !value.goal.trim() || !Array.isArray(value.steps) || value.steps.length<2 || value.steps.length>4)throw Error('invalid-plan');
  let total=0,gap=Infinity;
  const steps=value.steps.map(step=>{
    const bounds=LIMITS[step.activity];
    if(!bounds || !eligible.includes(step.activity) || !Number.isFinite(step.durationSec) ||
      step.durationSec<bounds[0] || step.durationSec>bounds[1] || typeof step.reason!=='string' || !step.reason.trim())throw Error('invalid-step');
    total+=step.durationSec;
    if(step.activity!=='quiet'){if(gap<90)throw Error('too-frequent');gap=0;}else gap+=step.durationSec;
    return {activity:step.activity,durationSec:Math.round(step.durationSec),reason:step.reason.trim().slice(0,30)};
  });
  if(total>600)throw Error('plan-too-long');
  return {goal:value.goal.trim().slice(0,24),steps,provider:String(reply.provider || '').slice(0,80),model:String(reply.model || '').slice(0,100)};
}
module.exports=function createPlanner({host,now=Date.now,timeoutMs=23000}) {
  const records=new Map();let inflight=false,disposed=false,calls=[],lastCall=-Infinity;
  function entry(key) {
    if(!records.has(key))records.set(key,{next:now()+15000,failures:0,status:'waiting',generation:0,model:''});
    return records.get(key);
  }
  function invalidate(key){const r=entry(key);r.generation++;if(r.status==='planning')r.status='discarded';}
  function status(key){const r=entry(key);return {status:r.status,model:r.model,provider:r.provider,reason:r.reason,updatedAt:r.updatedAt,nextAt:r.next};}
  function consider(key,snapshot,env,apply) {
    const r=entry(key),time=now();
    if(disposed || typeof host!=='function' || env.enabled===false || env.aiEnabled===false || env.quietMode ||
      env.busy || env.suspended || env.fullscreen || !env.visible || !snapshot?.planning?.ready) {
      if(r.status==='planning')invalidate(key);return;
    }
    if(inflight || time<r.next || time-lastCall<60000 || snapshot.planning.remaining>0)return;
    calls=calls.filter(t=>time-t<3600000);
    if(calls.length>=6){r.status='budget';r.next=calls[0]+3600000;return;}
    const generation=++r.generation,revision=snapshot.planning.revision;
    const eligible=snapshot.planning.eligible;
    const context={hour:env.hour,idleSeconds:Math.min(3600,Math.round(env.idle)),
      activity:snapshot.activity,reason:snapshot.reason,eligible,
      state:Object.fromEntries(['energy','sleepiness','mood','curiosity'].map(k=>[k,Math.round(snapshot.state[k])])),
      recent:snapshot.state.history.slice(-8).map(e=>({kind:e.kind,text:e.text,minutesAgo:Math.max(0,Math.round((time-e.at)/60000))}))};
    inflight=true;lastCall=time;calls.push(time);r.status='planning';r.updatedAt=time;
    // timeout 后也不允许新的请求与尚未返回的宿主请求重叠。
    let expired=false;
    const timeout=setTimeout(()=>{expired=true;r.status='fallback';r.reason='timeout';r.updatedAt=now();},timeoutMs);
    Promise.resolve().then(()=>host('POST','/dsh-pet-7340/life-plan',JSON.stringify(context))).then(async response=>{
      if(disposed || expired || generation!==r.generation)return;
      const reply=JSON.parse(response.body);
      if(typeof reply.model==='string')r.model=reply.model.slice(0,100);
      if(typeof reply.provider==='string')r.provider=reply.provider.slice(0,80);
      const plan=parsePlan(reply,eligible);
      r.model=plan.model;r.provider=plan.provider;
      const accepted=await apply({id:time+'-'+generation,revision,createdAt:time,expiresAt:time+600000,...plan});
      if(disposed || generation!==r.generation)return;
      r.status=accepted?'ready':'discarded';r.reason=accepted?'accepted':'context-changed';r.failures=0;
    }).catch(e=>{
      if(disposed || generation!==r.generation)return;
      r.status='fallback';r.reason=/^[a-z-]+$/.test(e.message)?e.message:'invalid-response';r.failures++;
    }).finally(()=>{
      clearTimeout(timeout);inflight=false;r.updatedAt=now();
      r.next=now()+(r.status==='fallback'?Math.min(600000,60000*2**Math.min(r.failures,3)):300000);
    });
  }
  return {consider,status,invalidate,request(key){const r=entry(key);r.next=0;r.status='waiting';},
    dispose(){disposed=true;for(const key of records.keys())invalidate(key);},forget:key=>records.delete(key)};
};
module.exports.parsePlan=parsePlan;
