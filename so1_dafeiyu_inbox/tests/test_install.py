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
module.exports={chat,calls:()=>calls};
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
    assert patched.count("fishAwarenessContext(petId, text)") == 1
    assert 'input.rest==="life-awareness"' in patched
    assert (helper / "dsh-pet-inbox-v2/experience.cjs").is_file()
    subprocess.run(["node", "--check", str(host)], check=True, capture_output=True)
    # 执行实际安装器改写的聊天入口，验证正确宠物的事实进入 system。
    script = '''const assert=require('node:assert/strict');
const {chat,calls}=require(process.argv[1]);
globalThis[Symbol.for('so1.dafeiyu.experiences')]=new Map([['main',{
 at:Date.now(),current:{activity:'quiet',status:'running'},previous:null,
 events:[{id:'1',at:Date.now(),actor:'user',type:'user.fed',text:'你投喂了 2 份文件',details:{count:2}}]
}]]);
(async()=>{const a=await chat('main','你好','base',{});
assert(a.system.includes('投喂了 2 份文件'));assert(a.system.startsWith('base'));
const b=await chat('other','你好','base',{});assert(!b.system.includes('投喂了 2'));
const count=calls();const c=await chat('main','你现在在干什么，我刚才做了什么','base',{});
assert(c.text.includes('投喂了 2 份文件'));assert.equal(calls(),count,'factual questions work without model requests');
console.log('PASS installed chat receives shared facts without cross-pet leakage');})();'''
    subprocess.run(["node", "-e", script, str(host)], check=True)
    install("--uninstall")
    for p, text in files.items():
        assert p.read_bytes() == text.encode(), p
print("PASS install: fresh/repeat, syntax, fact-aware chat, exact uninstall")
