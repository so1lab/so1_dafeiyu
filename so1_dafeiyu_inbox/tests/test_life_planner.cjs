const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const createPlanner=require('../component/life-planner.cjs'),createLife=require('../component/life-core.cjs');
const valid={ok:true,provider:'deepseek-official',model:'deepseek-flash',text:JSON.stringify({goal:'休息一下，再看看四周',steps:[
  {activity:'quiet',durationSec:90,reason:'安静陪伴'}, {activity:'observe',durationSec:8,reason:'看看周围'}]})};
const eligible=['quiet','observe','rest','play'];
const snapshot={activity:'quiet',reason:'陪伴',state:{energy:80,sleepiness:20,mood:60,curiosity:50,history:[]},
  planning:{ready:true,eligible,revision:0,remaining:0}};
const env={enabled:true,aiEnabled:true,visible:true,idle:180,hour:12};
const settle=()=>new Promise(r=>setImmediate(r));
async function main(){
  assert.equal(createPlanner.parsePlan(valid,eligible).steps.length,2);
  for(const step of [{activity:'delete-file',durationSec:5,reason:'删除'}, {activity:'stroll',durationSec:10,reason:'走走'},
    {activity:'observe',durationSec:999,reason:'看'}, {activity:'observe',durationSec:NaN,reason:'看'}])
    assert.throws(()=>createPlanner.parsePlan({...valid,text:JSON.stringify({goal:'test',steps:[step,step]})},eligible));
  assert.throws(()=>createPlanner.parsePlan({...valid,text:'not JSON'},eligible));
  assert.throws(()=>createPlanner.parsePlan({...valid,text:JSON.stringify({goal:'test',steps:[{activity:'play',durationSec:10,reason:'玩'},{activity:'observe',durationSec:8,reason:'看'}]})},eligible));
  let clock=100000,calls=0,release,applied=[];
  const planner=createPlanner({now:()=>clock,host:async(method,url,body)=>{
    calls++;assert.equal(url,'/dsh-pet-7340/life-plan');assert(!body.includes('path'));await new Promise(r=>release=r);return {body:JSON.stringify(valid)};
  }});
  planner.consider('pet',snapshot,env,p=>{applied.push(p);return true;});assert.equal(calls,0);
  clock+=16000;planner.consider('pet',snapshot,env,p=>{applied.push(p);return true;});await settle();assert.equal(calls,1);
  planner.consider('pet',snapshot,env,()=>true);assert.equal(calls,1);
  planner.invalidate('pet');release();await settle();assert.equal(applied.length,0,'late task-interrupted plan must be discarded');
  clock+=301000;planner.consider('pet',snapshot,env,p=>{applied.push(p);return true;});await settle();release();await settle();
  assert.equal(applied.length,1);assert.equal(planner.status('pet').status,'ready');
  planner.consider('pet',snapshot,env,()=>true);assert.equal(calls,2);
  clock+=301000;planner.consider('pet',snapshot,{...env,quietMode:true},()=>true);assert.equal(calls,2);
  planner.dispose();
  let failClock=1,count=0;
  const failed=createPlanner({now:()=>failClock,host:async()=>{count++;throw Error('offline');}});
  failed.consider('p',snapshot,env,()=>true);failClock+=16000;failed.consider('p',snapshot,env,()=>true);await settle();
  assert.equal(failed.status('p').status,'fallback');failed.consider('p',snapshot,env,()=>true);assert.equal(count,1);failed.dispose();
  let budgetClock=1000,budgetCalls=0;
  const budget=createPlanner({now:()=>budgetClock,host:async()=>{budgetCalls++;return {body:JSON.stringify(valid)};}});
  budget.consider('p',snapshot,env,()=>true);budgetClock+=16000;
  for(let n=0;n<7;n++){budget.consider('p',snapshot,env,()=>true);await settle();budgetClock+=301000;}
  assert.equal(budgetCalls,6);assert.equal(budget.status('p').status,'budget');budget.dispose();
  let timeoutClock=1,resolveSlow;
  const timed=createPlanner({timeoutMs:5,now:()=>timeoutClock,host:()=>new Promise(r=>resolveSlow=r)});
  timed.consider('p',snapshot,env,()=>{throw Error('expired response applied');});timeoutClock+=16000;
  timed.consider('p',snapshot,env,()=>{throw Error('expired response applied');});await new Promise(r=>setTimeout(r,12));
  assert.equal(timed.status('p').reason,'timeout');resolveSlow({body:JSON.stringify(valid)});await settle();timed.dispose();
  // 模型计划只在边界执行，且任务中断后的旧 revision 不再可用。
  const brain=createLife({},()=>.1),at=1000000;
  let state=brain.tick({now:at,hour:12,idle:200,available:eligible});
  const plan={...createPlanner.parsePlan(valid,eligible),expiresAt:at+600000};
  assert(brain.offerPlan(plan,at,state.planning.revision));
  for(let t=2000;t<=40000;t+=2000)state=brain.tick({now:at+t,hour:12,idle:200,available:eligible});
  assert.equal(state.source,'deepseek');assert.equal(state.activity,'quiet');assert(state.planning.goal);
  brain.interrupt(at+41000);assert(!brain.offerPlan(plan,at+42000,0));
  assert.equal(brain.tick({now:at+42000,hour:12,idle:200,available:eligible,busy:true}).source,'local');
  const sequence=createLife({},()=>.1);let seq=sequence.tick({now:at,hour:12,idle:200,available:eligible});
  assert(sequence.offerPlan(plan,at,seq.planning.revision));
  for(let t=2000;t<220000;t+=2000)seq=sequence.tick({now:at+t,hour:12,idle:200,available:eligible});
  assert.equal(seq.planning.remaining,0,'a completed stage should not block future planning forever');

  // 宿主路由真实片段：默认本地模型时选已配置 DeepSeek，流式超时/错误返回可诊断状态。
  const route=fs.readFileSync(path.join(__dirname,'../component/life-plan-route.txt'),'utf8');
  const context=vm.createContext({AbortSignal,JSON,ReasoningEffortId:x=>x,PET_CALL_IDENTITY:'pet',
    createUserMessage:x=>x,BlockAssembler:class{constructor(){this.text=''}push(c){this.text+=c}blocks(){return [{type:'text',text:this.text}]}},
    supportsReasoningOff:async()=>true,okResult:x=>x,methodNotAllowed:()=>({bad:true})});
  const fn=vm.runInContext('(async function(deps,input){'+route+'})',context);
  let options;
  const llm={listProviders:()=>[{id:'deepseek-official',name:'DeepSeek'}],listModels:async()=>[{id:'deepseek-flash'}],
    async *stream(value){options=value;yield valid.text;}};
  const deps={optionalService:n=>n==='llm'?llm:{currentSelection:()=>({provider:'local-qwen',model:'qwen'})}};
  let answer=await fn(deps,{method:'POST',rest:'life-plan',body:JSON.stringify({eligible})});
  assert(answer.ok);assert.equal(options.provider,'deepseek-official');assert.equal(options.model,'deepseek-flash');
  assert(options.signal instanceof AbortSignal);assert.equal(options.reasoningEffort,'off');
  llm.stream=async function*(){throw Error('network');};
  answer=await fn(deps,{method:'POST',rest:'life-plan',body:'{}'});assert.equal(answer.reason,'model-request-failed');
  console.log('PASS planner: schema, candidate limits, cadence, async single-flight, stale rejection, timeout, fallback, stage execution and real host route');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
