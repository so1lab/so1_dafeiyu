const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const open=require('../component/pet-memory.cjs');

async function main(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fish-memory-'));
  let at=new Date(2026,10,27,23,0).getTime(),notebook=open(dir,()=>at);
  try{
    const rule=notebook.insert('fish','work_move',true,{source:'chat',evidence:'工作时别跑来跑去',requestId:'req-1'});
    assert.equal(notebook.insert('fish','work_move',true,{requestId:'req-1'}),null);
    assert.equal(notebook.policy('fish',{working:true}).stationary,rule);
    assert.equal(notebook.policy('other',{working:true}).stationary,null);
    assert.equal(notebook.policy('fish',{working:false}).stationary,null);
    const quiet=notebook.insert('fish','quiet_hours',{start:'22:00',end:'07:00'});
    notebook.decide('fish','episode','observe_in_place',[rule]);
    notebook.close();notebook=open(dir,()=>at);
    assert.equal(notebook.policy('fish',{working:true}).stationary,rule);
    assert.equal(notebook.policy('fish').quiet,quiet);
    assert.equal(notebook.snapshot('fish',['episode']).decisions[0].evidence[0],rule);
    assert.equal(notebook.policy('fish',{at:new Date(2026,10,28,7,0).getTime()}).quiet,null);
    at++;
    const replacement=notebook.insert('fish','work_move',false);
    assert.equal(notebook.policy('fish',{working:true}).stationary,null);
    assert.equal(notebook.snapshot('fish').memories.find(x=>x.id===rule).status,'superseded');
    assert.equal(notebook.snapshot('fish').memories.find(x=>x.id===replacement).supersedes,rule);
    assert(notebook.forget('fish',replacement));
    assert(!notebook.snapshot('fish').memories.some(x=>x.key==='work_move'));
    const draft=notebook.insert('fish','note','在做桌宠', {suggestion:true,source:'model'});
    assert(!notebook.chatContext('fish').some(x=>x.text==='在做桌宠'));
    assert(!notebook.confirm('other',draft));
    assert(notebook.confirm('fish',draft));
    assert(notebook.chatContext('fish').some(x=>x.text==='在做桌宠'));
    assert.throws(()=>notebook.insert('fish','run_shell','cmd'));

    const support=fs.readFileSync(path.join(__dirname,'../component/awareness-support.js'),'utf8');
    const ctx=vm.createContext({setTimeout,clearTimeout});
    vm.runInContext(support+'\n globalThis.store=new Map(); globalThis[Symbol.for("so1.dafeiyu.experiences")]=store;',ctx);
    assert.equal(ctx.fishParseMemoryCommand('记住，工作时别跑来跑去').key,'work_move');
    assert.equal(ctx.fishParseMemoryCommand('记住，晚上10点后少说话').value.start,'22:00');
    assert.equal(ctx.fishParseMemoryCommand('我今天工作很忙'),null);
    assert.match(await ctx.fishMemoryTurn('fish','记住，工作时别跑'),/没有保存/);
    const pending=new Map();
    ctx.store.set('fish',{at:Date.now(),notebook:{entries:[]},pending});
    const result=ctx.fishMemoryTurn('fish','记住，工作时别跑');
    const [request]=pending.values();
    assert.equal(request.kind,'write');assert.equal(request.value,true);
    notebook.insert('fish',request.key,request.value,{requestId:request.id,evidence:request.text});
    request.finish(true);
    assert.match(await result,/已经生效/);
    console.log('PASS memory: persistence, scope, temporal preferences, provenance, replacement, deletion and saved-reply protocol');
  }finally{notebook.close();fs.rmSync(dir,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
