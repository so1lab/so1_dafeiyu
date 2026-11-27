"""用兼容入口夹具验证接入、重复升级、聊天上下文和完整卸载，不修改真实桌宠。"""
from pathlib import Path
import json
import subprocess
import sys
import tempfile

source = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp) / "dsh-pet"
    helper = root / "runtime/electron-helper"
    (helper / "sprite").mkdir(parents=True)
    (root / "lib").mkdir()
    files = {
        root / "lib/index.js": '''async function handleDesktopRoutes(deps, input) { return null; }
const {readFileSync,writeFileSync,renameSync,mkdirSync,unlinkSync}=require('node:fs');
const path=require('node:path');
const okResult=value=>value;
const readAllConfig=paths=>({main:{whisperPrompt:'默认语气',pets:paths?JSON.parse(readFileSync(paths.userFile,'utf8')).pets:[{id:'main'}]}});
const findPetInstance=(config,id)=>{
  const pet=config.main.pets.find(row=>row.id===id);
  return pet?{entry:'main',pet,conf:config.main}:null;
};
const resolveConfigLayer=deps=>({ok:true,layer:{path:deps.configPaths.userFile,
  dir:path.dirname(deps.configPaths.userFile),existing:JSON.parse(readFileSync(deps.configPaths.userFile,'utf8'))}});
const userConfigUnparsable=()=>false;
async function generateWith(ctx, llm, sel, request) {}
let calls=0;
async function generateChat(args){calls++;return {ok:true,text:'model reply',system:args.system};}
async function chat(petId,text,system,patch) {
\t\t\tconst generated = await generateChat({
  system: patch?.system ?? system,
  });
\t\t\tif (!generated.ok) return generated;
  return generated;
}
module.exports={chat,handleDesktopRoutes,calls:()=>calls};
''',
        helper / "main.js": 'function boot(){\n  linuxPointer?.start();\n  petWindows.create();\n}\n',
        helper / "preload.js": '// original preload\n',
        helper / "sprite/input.js": 'function input(e){\n    if (!S.dragHasFiles(e)) return;\n}\n',
    }
    for p, text in files.items():
        p.write_bytes(text.encode())

    def install(*args):
        proc = subprocess.run([sys.executable, str(source / "install.py"), str(root), *args],
                              capture_output=True, text=True, encoding="utf-8")
        assert proc.returncode == 0, (proc.stdout, proc.stderr)

    install()
    install()
    host = root / "lib/index.js"
    patched = host.read_text(encoding="utf-8")
    assert patched.count("/* BEGIN fish experience support */") == 1
    assert patched.count("fishDescribeTurn(petId, text)") == 1
    assert 'input.rest==="life-awareness"' in patched
    assert (helper / "dsh-pet-inbox-v2/experience.cjs").is_file()
    subprocess.run(["node", "--check", str(host)], check=True, capture_output=True)
    # 执行实际安装器改写的聊天入口，验证正确宠物的事实进入 system。
    script = r'''const assert=require('node:assert/strict');
const {chat,handleDesktopRoutes,calls}=require(process.argv[1]);
const fs=require('node:fs');
globalThis[Symbol.for('so1.dafeiyu.experiences')]=new Map([['main',{
 at:Date.now(),current:{activity:'quiet',status:'running'},previous:null,
 events:[{id:'1',at:Date.now(),actor:'user',type:'user.fed',text:'你投喂了 2 份文件',details:{count:2}}]
}]]);
(async()=>{const a=await chat('main','你好','base',{});
assert(a.system.includes('投喂了 2 份文件'));assert(a.system.startsWith('base'));
const b=await chat('other','你好','base',{});assert(!b.system.includes('投喂了 2'));
const count=calls();const c=await chat('main','你现在在干什么，我刚才做了什么','base',{});
assert(c.text.includes('投喂了 2 份文件'));assert.equal(calls(),count,'factual questions work without model requests');
const key='a'.repeat(48);
const notebook={key,entries:[],hasMemories:true};
const poll=extra=>handleDesktopRoutes({}, {rest:'life-awareness',method:'POST',
  body:JSON.stringify({petId:'main',events:[],notebook:{...notebook,...extra}})});
await poll();
const locate=chat('main','报价表在哪','base',{});
await new Promise(resolve=>setImmediate(resolve));
const request=(await poll()).memoryRequests.find(x=>x.kind==='warehouse');
assert(request);
await poll({acks:[[request.id,{files:[{name:'报价表.xlsx',path:'采购/报价表.xlsx'}]}]]});
assert.match((await locate).text,/采购\/报价表.xlsx/);
assert.equal(calls(),count,'file answers use only the local lookup');
const recall=chat('main','还记得青檀吗','base',{});
await new Promise(resolve=>setImmediate(resolve));
const recallRequest=(await poll()).memoryRequests.find(x=>x.kind==='recall');
assert(recallRequest);
await poll({acks:[[recallRequest.id,{entries:[{kind:'note',text:'之前的约定叫青檀'}]}]]});
assert.match((await recall).system,/之前的约定叫青檀/);
const userFile=process.argv[2],state={notices:0,writeSection(){this.notices++;}};
const initial={customField:{kept:true},pets:[{id:'main',name:'鱼',whisperPrompt:'原有人设',position:{x:11}},
  {id:'other',whisperPrompt:'另一只的提示词'}]};
fs.writeFileSync(userFile,JSON.stringify(initial));
const persona=changes=>handleDesktopRoutes({configPaths:{userFile},state},
  {rest:'life-persona',method:'POST',body:JSON.stringify({id:'main',...changes})});
assert.equal((await persona()).prompt,'原有人设');
assert.equal((await persona({prompt:'冲突',expected:'旧版本'})).reason,'changed');
assert.equal((await persona({prompt:'  轻松幽默\n说话自然  ',expected:'原有人设'})).prompt,'轻松幽默\n说话自然');
const saved=JSON.parse(fs.readFileSync(userFile,'utf8'));
assert.deepEqual(saved.customField,initial.customField);
assert.deepEqual(saved.pets[1],initial.pets[1]);
assert.deepEqual(saved.pets[0].position,initial.pets[0].position);
assert.equal((await persona({prompt:'',expected:'轻松幽默\n说话自然'})).prompt,'');
assert(!Object.hasOwn(JSON.parse(fs.readFileSync(userFile,'utf8')).pets[0],'whisperPrompt'));
assert.equal((await persona()).defaultPrompt,'默认语气');
assert.equal(state.notices,2);
console.log('PASS installed chat: scoped facts, local warehouse lookup and ranked recall');})();'''
    subprocess.run(["node", "-e", script, str(host), str(root / "persona-test.jsonc")], check=True)
    install("--uninstall")
    for p, text in files.items():
        assert p.read_bytes() == text.encode(), p
print("PASS install: fresh/repeat, syntax, fact-aware chat, exact uninstall")
