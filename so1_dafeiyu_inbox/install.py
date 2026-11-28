"""Install, upgrade, or remove the unpacked dsh-pet Windows helper extension."""
import argparse
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

SOURCE = Path(__file__).resolve().parent / "component"
# 保留旧版运行目录及注入标记，让已有安装继续原位升级和卸载。
HOOK = "  linuxPointer?.start();\n  petWindows.create();"
OLD = HOOK + "\n  // dsh-pet-inbox v1\n  require('./dsh-pet-inbox/main.cjs')();"
NEW = HOOK + "\n  // dsh-pet-inbox v2\n  require('./dsh-pet-inbox-v2/main.cjs')(petWindows.state.windows);"
INPUT = "    if (!S.dragHasFiles(e)) return;"
PAUSE = INPUT + "\n    if (!e.shiftKey) { this.stopMove(); this.stopThrow(); } // dsh-pet-inbox v2"
START = "\n// BEGIN dsh-pet-inbox-v2\n"
END = "// END dsh-pet-inbox-v2\n"


def atomic_write(path, data):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as f:
        f.write(data)
    try:
        os.replace(f.name, path)
    finally:
        Path(f.name).unlink(missing_ok=True)


def install_helper(opts):
    base = next((p for p in (opts.location, opts.location/"runtime/electron-helper",
                opts.location/"dsh-pet/runtime/electron-helper") if (p/"sprite/input.js").is_file()), None)
    if base is None:
        raise ValueError("未找到完整的 electron-helper。")
    # Windows 版本隔离部署可能通过 junction 暴露 runtime；后续路径按真实插件根解析。
    base = base.resolve()
    main, preload, controls = [base/p for p in ("main.js","preload.js","sprite/input.js")]
    dest = base/"dsh-pet-inbox-v2"
    changes = {}
    original = {}
    for p in [main, preload, controls]:
        original[p] = p.read_bytes()
        changes[p] = original[p].decode("utf-8").replace("\r\n","\n")
    code = changes[main]
    if opts.uninstall:
        if NEW not in code or PAUSE not in changes[controls] or changes[preload].count(START)!=1:
            raise ValueError("组件入口不完整。")
        head, tail = changes[preload].split(START)
        if END not in tail:
            raise ValueError("preload 标记缺失。")
        changes[preload] = head + tail.split(END,1)[1]
        changes[main] = code.replace(NEW,HOOK)
        changes[controls] = changes[controls].replace(PAUSE,INPUT)
    else:
        if NEW in code:
            # 更新已嵌入上游 preload 的事件处理器，只替换本组件的标记区域。
            pre = changes[preload]
            if pre.count(START)!=1 or pre.count(END)!=1:
                raise ValueError("preload 标记不完整。")
            head, rest = pre.split(START)
            tail = rest.split(END,1)[1]
            updated = head + START + (SOURCE/"pet-hook.js").read_text("utf-8-sig").rstrip() + "\n" + END + tail
            if b"\r\n" in original[preload]:
                updated = updated.replace("\n","\r\n")
            for item in SOURCE.iterdir():
                if item.is_file():
                    atomic_write(dest/item.name,item.read_bytes())
            atomic_write(dest/"runtime.json",json.dumps({"python":sys.executable}).encode())
            atomic_write(preload,updated.encode())
            print("0.19.6-test 已更新，请重启 dsh。")
            return
        if dest.exists() or START in changes[preload] or changes[controls].count(INPUT)!=1 or code.count(HOOK)!=1:
            raise ValueError("上游版本或组件目录不匹配。")
        changes[main] = code.replace(OLD if OLD in code else HOOK,NEW)
        changes[controls] = changes[controls].replace(INPUT,PAUSE)
        changes[preload] += START + (SOURCE/"pet-hook.js").read_text("utf-8-sig").rstrip() + "\n" + END
        with tempfile.TemporaryDirectory(dir=base) as tmp:
            stage = Path(tmp)/"component"
            shutil.copytree(SOURCE,stage,ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
            (stage/"runtime.json").write_text(json.dumps({"python":sys.executable}),encoding="utf8")
            stage.rename(dest)
    completed = []
    try:
        for p in [preload,controls,main]:
            updated = changes[p]
            if b"\r\n" in original[p]:
                updated = updated.replace("\n","\r\n")
            atomic_write(p,updated.encode())
            completed.append(p)
    except Exception:
        for p in reversed(completed):
            atomic_write(p,original[p])
        if not opts.uninstall:
            shutil.rmtree(dest)
        raise
    if opts.uninstall and dest.is_dir():
        for name in [p.name for p in SOURCE.iterdir() if p.is_file()] + ["runtime.json"]:
            (dest/name).unlink(missing_ok=True)
        if not any(dest.iterdir()):
            dest.rmdir()
    print("已卸载。" if opts.uninstall else "已安装，请重启桌面宠物。")


def install(opts):
    base = next((p for p in (opts.location,opts.location/"runtime/electron-helper",
                opts.location/"dsh-pet/runtime/electron-helper") if (p/"sprite/input.js").is_file()),None)
    if base is None:
        raise ValueError("未找到桌宠 helper。")
    base = base.resolve()
    host = base.parents[1]/"lib/index.js"
    main = base/"main.js"
    anchor = b"async function handleDesktopRoutes(deps, input) {"
    start = b"/* BEGIN inbox analysis */"
    end = b"/* END inbox analysis */"
    raw = host.read_bytes()
    original = main.read_bytes()
    wired = NEW.replace("petWindows.state.windows);","petWindows.state.windows,bridge.hostRequest);").splitlines()[-1].encode()
    plain = NEW.splitlines()[-1].encode()
    if raw.count(anchor)!=1 or b"async function generateWith(ctx, llm, sel, request)" not in raw:
        raise ValueError("当前宿主不兼容分析接口。")
    changed = raw
    awareness_start = b"\n/* BEGIN fish experience support */"
    awareness_end = b"/* END fish experience support */\n"
    chat_plain = b"system: patch?.system ?? system,"
    chat_old = b"system: (patch?.system ?? system) + fishAwarenessContext(petId, text),"
    chat_wired = b"system: (patch?.system ?? system) + fishContext,"
    call_plain = b"\t\t\tconst generated = await generateChat({"
    call_old = (b"\t\t\tconst fishContext = fishAwarenessContext(petId, text);\n"
                  b"\t\t\tconst generated = fishWantsFact(text) ? {ok:true,text:fishGroundedReply(petId,text,'')} : await generateChat({")
    call_previous = (b"\t\t\tconst fishContext = fishAwarenessContext(petId, text);\n"
                  b"\t\t\tconst fishMemory = await fishMemoryTurn(petId, text);\n"
                  b"\t\t\tconst generated = fishMemory !== null ? {ok:true,text:fishMemory} : fishWantsFact(text) ? {ok:true,text:fishGroundedReply(petId,text,'')} : await generateChat({")
    call_context = (b"\t\t\tconst fishTurn = await fishDescribeTurn(petId, text);\n"
                 b"\t\t\tconst fishContext = fishTurn.context || '';\n"
                 b"\t\t\tconst generated = fishTurn.reply !== null ? {ok:true,text:fishTurn.reply} : await generateChat({")
    call_wired = call_context.replace(b"await generateChat({", b"await fishGenerateFromKnowledge(fishTurn, {")
    answer_plain = b"\t\t\tif (!generated.ok) return generated;"
    answer_wired = answer_plain + b"\n\t\t\t/* fish grounded reply */ generated.text = fishGroundedReply(petId, text, generated.text);"
    if awareness_start in changed:
        a = changed.index(awareness_start)
        b = changed.index(awareness_end,a)+len(awareness_end)
        changed = changed[:a]+changed[b:]
    changed = changed.replace(chat_wired,chat_plain)
    changed = changed.replace(chat_old,chat_plain).replace(call_wired,call_plain).replace(call_context,call_plain).replace(call_previous,call_plain).replace(call_old,call_plain)
    changed = changed.replace(answer_wired,answer_plain)
    if start in changed:
        a = changed.index(start)
        b = changed.index(end,a)+len(end)
        changed = changed[:a]+changed[b:]
    if not opts.uninstall:
        snippet = ((SOURCE/"analysis-route.txt").read_text("utf-8-sig") +
                   (SOURCE/"life-plan-route.txt").read_text("utf-8-sig") +
                   (SOURCE/"awareness-route.txt").read_text("utf-8-sig") +
                   (SOURCE/"persona-route.txt").read_text("utf-8-sig")).encode()
        changed = changed.replace(anchor,anchor+start+b"\n"+snippet+end)
        if changed.count(chat_plain)!=1:
            raise ValueError("当前宿主聊天入口不兼容经历上下文。")
        changed = changed.replace(chat_plain,chat_wired)
        if changed.count(call_plain)!=1:
            raise ValueError("当前宿主对话入口不兼容事实回执。")
        changed = changed.replace(call_plain,call_wired)
        changed = changed+awareness_start+b"\n"+(SOURCE/"awareness-support.js").read_bytes()+b"\n"+awareness_end
    if wired in original:
        atomic_write(main,original.replace(wired,plain))
    try:
        # Copy the component-owned clips before enabling the new entry point.
        # User data and upstream animation files are separate from these names.
        clips=Path(__file__).resolve().parent/"assets"
        if not opts.uninstall:
            target=base.parents[1]/"assets/webm"
            target.mkdir(parents=True,exist_ok=True)
            for clip in clips.glob("*.webm"):
                atomic_write(target/clip.name,clip.read_bytes())
        install_helper(opts)
        if not opts.uninstall:
            atomic_write(main,main.read_bytes().replace(plain,wired))
        atomic_write(host,changed)
    except Exception:
        atomic_write(main,original)
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("location",type=Path)
    parser.add_argument("--uninstall",action="store_true")
    try:
        install(parser.parse_args())
    except (ValueError,OSError) as e:
        parser.exit(1,str(e)+"\n")
