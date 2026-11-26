import argparse
import contextlib
import json
import os
import re
import shutil
import sqlite3
import sys
import tempfile
import uuid
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree

CATEGORIES = [
    ("财务票据", ("发票", "价税合计", "invoice", "收据", "报销")),
    ("合同协议", ("合同", "协议", "甲方", "agreement", "contract")),
    ("会议记录", ("会议纪要", "参会人", "周会", "会议记录", "meeting minutes")),
]
TYPES = {"图片素材": "png jpg jpeg gif webp svg bmp heic", "影音": "mp3 mp4 mov wav mkv flac",
         "压缩包": "zip rar 7z gz tar", "表格": "xlsx xls csv", "演示文稿": "ppt pptx"}


from catalog import describe, records, sample_text

TYPES.update({"文档": "pdf doc docx txt md rtf odt", "代码与数据": "py js ts json yaml yml xml sql log",
              "表格": "xlsx xls csv tsv ods"})

def classify(path, body):
    ext = path.suffix.lower()
    sample = (path.stem + " " + body[:32000]).casefold()
    hits = [(cat, word) for cat, words in CATEGORIES for word in words if word in sample]
    if len({cat for cat, _ in hits}) == 1:
        return hits[0]
    if not hits:
        for cat, extensions in TYPES.items():
            if ext.lstrip(".") in extensions.split():
                return cat, ext
    return "待分类", "线索不足或有歧义"


# 保存文件身份、大小与修改时间；撤销前用它识别被替换或编辑过的文件。
def identity(path):
    s = path.stat()
    return json.dumps([s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns])


def install_file(source, target):
    # Windows rename fails if destination exists. Never use replace().
    if os.name == "nt":
        os.rename(source, target)
    else:
        os.link(source, target)
        source.unlink()


def move(source, dest, expected):
    if identity(source) != expected:
        raise ValueError("文件已发生变化")
    if source.stat().st_dev == dest.parent.stat().st_dev:
        install_file(source, dest)
        return
    with tempfile.NamedTemporaryFile(dir=dest.parent, prefix=".inbox-", delete=False) as f:
        temp = Path(f.name)
    try:
        shutil.copy2(source, temp)
        if identity(source) != expected or temp.stat().st_size != source.stat().st_size:
            raise ValueError("复制期间文件发生变化")
        install_file(temp, dest)
        source.unlink()
    finally:
        temp.unlink(missing_ok=True)


from warehouse import ALIASES, actual, everyday, media_type
from context import shortlist
from filing import inventory, choose, matches

def categories(root):
    custom = inventory(root)
    return list(dict.fromkeys(custom + [x[0] for x in CATEGORIES] + list(TYPES) + ["待分类"]))

def run(req, db, root):
    from desk_moves import setup,recent,transfer,history
    setup(db)
    action = req["action"]
    if action in ("desk_move","desk_undo"):return transfer(db,root,req,identity,move)
    if action in ("catalog","adjust","undo","relink"):
        from sync_library import sync
        sync(db,root,identity)
    if action=="relink":
        p=Path(req["path"]).resolve()
        row=db.execute("select dst,sig,status from items where rowid=?",(req["id"],)).fetchone()
        if not row or not p.is_file() or not p.is_relative_to(root):
            raise ValueError("请选择仓库内的文件")
        if Path(row[0]).exists() and Path(row[0])!=p:
            raise ValueError("原位置仍有文件，无法关联")
        duplicates=db.execute("select rowid,status from items where dst=? and rowid<>? and status in ('已同步','已收纳')",(str(p),req["id"])).fetchall()
        if any(st=="已收纳" for _,st in duplicates):raise ValueError("所选文件已有收纳记录")
        for rid,_ in duplicates:
            db.execute("delete from items where rowid=?",(rid,))
            for tab in ("catalog","filing","indexed","proposals"):db.execute("delete from "+tab+" where item=?",(rid,))
        db.execute("update items set dst=?,sig=?,status='已同步' where rowid=?",(str(p),json.dumps(json.loads(identity(p))[:2]+[-1,-1]),req["id"]))
        db.commit()
        sync(db,root,identity)
        return {"message":"已更新文件位置"}
    if action == "sample":
        p = Path(req["file"])
        if not p.is_absolute() or p.is_symlink() or not p.is_file() or p.resolve().is_relative_to(root):
            return {}
        try:
            sig = identity(p)
            body = sample_text(p)
        except Exception:
            return {}
        folders=inventory(root)
        return {"sig":sig,"body":body[:3500],"categories":categories(root)[:100],"candidates":shortlist(db,root,folders,p.stem+" "+body[:3500])}
    if action == "forget":
        db.execute("delete from aliases where root=? and term=?",(str(root),req["term"]))
        db.commit()
        return {"message":"已移除别名"}
    if action == "create_project":
        rec=db.execute("select proposed from proposals where item=?",(req["id"],)).fetchone()
        if not rec or not rec[0]:
            raise ValueError("项目建议已失效")
        parent=Path(req["parent"]).resolve()
        if not parent.is_dir() or not parent.is_relative_to(root):
            raise ValueError("请选择资料库内的上级目录")
        folder=parent/rec[0]
        if folder.resolve()!=folder:
            raise ValueError("目录位置已变化")
        folder.mkdir(exist_ok=True)
        return run({"action":"adjust","id":req["id"],"folder":str(folder)},db,root)
    if action == "alias":
        term = req["term"].strip()
        row = db.execute("select dst from items where rowid=? and status='已收纳'",(req["id"],)).fetchone()
        if not row or not 2<=len(term)<=40:
            raise ValueError("别名需为 2 至 40 个字符，且文件已归档")
        dest = Path(row[0]).parent.resolve().relative_to(root).as_posix()
        if dest in ("待确认","待分类",".") or dest not in inventory(root):
            raise ValueError("请先选择明确的归档目录")
        existing=db.execute("select dest from aliases where root=? and term=?",(str(root),term)).fetchone()
        if existing and existing[0]!=dest:
            raise ValueError("这个别名已经关联了其他目录")
        db.execute("insert or ignore into aliases values(?,?,?)",(str(root),term,dest))
        db.commit()
        return {"message":"已记住："+term+" → "+dest}
    if action == "adjust":
        row = db.execute("select dst,sig,status from items where rowid=? and status in ('已收纳','已同步')", (req["id"],)).fetchone()
        if not row:
            raise ValueError("文件当前不可调整")
        src = Path(row[0])
        folder = Path(req["folder"]).resolve()
        if not src.resolve().is_relative_to(root) or folder == root or not folder.is_relative_to(root) or not folder.is_dir():
            raise ValueError("请选择资料库内的分类目录")
        if src.parent == folder:
            return {"message":"文件已在这个分类"}
        dest = folder / src.name
        n = 2
        while dest.exists():
            dest = folder / f"{src.stem} ({n}){src.suffix}"
            n += 1
        # 先记录两端位置，中途退出时仍可核对磁盘状态。
        if identity(src) != row[1]:
            raise ValueError("文件内容已变更，请先核对")
        db.execute("update items set status='调整中' where rowid=?",(req["id"],))
        db.execute("insert or replace into adjustments values(?,?,?)",(req["id"],str(src),str(dest)))
        db.commit()
        try:
            move(src,dest,row[1])
        except OSError:
            db.execute("update items set status='需核对' where rowid=?",(req["id"],))
            db.commit()
            raise
        db.execute("update items set status=?,dst=?,sig=? where rowid=?",(row[2],str(dest),identity(dest),req["id"]))
        db.execute("update catalog set category=? where item=?",(str(folder.relative_to(root)),req["id"]))
        db.execute("delete from proposals where item=?",(req["id"],))
        db.execute("update filing set suggestion='',why='用户手动确认归属' where item=?",(req["id"],))
        db.commit()
        return {"message":"分类已调整"}
    if action == "catalog":
        batch_ids=dict(db.execute("select rowid,batch from items where batch is not null"))
        return {"entries": [dict(row,batch=batch_ids.get(row["id"])) for row in records(db)],"folders":inventory(root),"root":str(root),"history":history(db,root),"moves":recent(db,root),"examples":[(Path(dst).stem,Path(dst).parent.relative_to(root).as_posix()) for (dst,) in db.execute("select m.dst from desk_moves m join items i on i.rowid=m.item and i.dst=m.dst where m.undone=0 order by m.rowid desc limit 150") if Path(dst).is_relative_to(root)]}
    if action == "history":
        rows = db.execute("select src,dst,status,reason from items order by rowid desc limit 80")
        return {"rows": list(rows)}
    if action == "undo":
        batch = db.execute("select batch from items where status='已收纳' order by rowid desc limit 1").fetchone()
        if req.get("batch"):
            batch = (req["batch"],)
        count = conflicts = 0
        for row, src, dst, sig in list(db.execute("select rowid,src,dst,sig from items where batch=? and status='已收纳'", batch or ("",))):
            try:
                if Path(src).exists() or not Path(src).parent.is_dir():
                    raise ValueError("原位置已占用或目录已移走")
                db.execute("update items set status='撤销中' where rowid=?", (row,))
                db.commit()
                move(Path(dst), Path(src), sig)
                status, reason = "已撤销", ""
                db.execute("update items set sig=? where rowid=?", (identity(Path(src)),row))
                count += 1
            except (ValueError, OSError) as e:
                status, reason = "需核对", str(e)
                conflicts += 1
            db.execute("update items set status=?,reason=? where rowid=?", (status, reason, row))
            db.commit()
        return {"message": f"已撤销 {count} 个，需核对 {conflicts} 个"}
    if action not in ("drop", "deliver"):
        raise ValueError("未知操作")
    batch = req.get("batch") or uuid.uuid4().hex
    counts = [0, 0, 0]
    summaries = []
    deliveries = {}
    projects=set()
    pending=[]
    folders=inventory(root)
    aliases=list(db.execute("select term,dest from aliases where root=?",(str(root),)))
    paths = list(dict.fromkeys(req["paths"]))
    for index, raw in enumerate(paths, 1):
        src = Path(raw)
        dest = None
        row = None
        try:
            if not src.is_absolute() or src.is_symlink() or not src.is_file() or (action == "drop" and src.resolve().is_relative_to(root)):
                raise ValueError("仅接收收纳箱之外的普通文件")
            sig = identity(src)
            try:
                body = sample_text(src)
            except Exception:
                body = ""
            cat, reason = classify(src, body)
            default=cat
            plan = req.get("plans", {}).get(raw, {})
            if plan.get("sig") != sig:
                plan = {}
            cat,tags,reason,is_project = choose(src,body,folders,aliases,cat,plan,set(TYPES)|set(ALIASES)|{n for names in ALIASES.values() for n in names}|{k for k,_ in CATEGORIES})
            suggestion=""
            if cat=="待确认" and reason.startswith("缺少") and plan.get("folder") in folders:
                from filing import semantic_route
                candidates=shortlist(db,root,folders,src.stem+" "+body[:3500])
                cat,reason,suggestion=semantic_route(src.stem+" "+body[:3500],plan,candidates,reason)
                is_project=cat!="待确认"
            if cat=="待确认":
                from filing import purpose_folder
                cat,reason=purpose_folder(src,body,plan,folders,default,root)
                suggestion=""
            if not is_project:
                daily=everyday(src,body)
                if daily and not (daily in ("照片图片","音频录音","视频") and cat in ("财务票据","合同协议","学习参考","生活事务","旅行出行","模板素材","会议记录")):
                    cat,reason=daily,"日常资料用途："+daily
                cat={"模板":"模板素材","参考资料":"学习参考","宣传素材":"模板素材"}.get(cat,cat)
                cat=actual(root,cat)
            media=media_type(src)
            if media and media not in tags:
                tags.append(media)
            summary = plan.get("summary") or f"{src.stem[:28]} · {tags[0]}（本地判断）"
            if action == "deliver":
                folder = Path(req["folder"])
                reason = "指定目录搬运"
                if not folder.is_absolute() or not folder.is_dir():
                    raise ValueError("目标目录不可用")
                if not folder.resolve().is_relative_to(root):
                    raise ValueError("请选择资料库根目录或其子文件夹")
                if folder.samefile(src.parent):
                    raise ValueError("文件已在目标目录")
            else:
                folder = root / cat
                if folder.exists() and (not folder.is_dir() or folder.resolve()!=folder):
                    raise ValueError("分类名称与已有文件或链接冲突")
                folder.mkdir(exist_ok=True)
                if cat not in folders:
                    folders.append(cat)
                if folder.resolve() != folder or not folder.resolve().is_relative_to(root):
                    raise ValueError("分类目录位置已改变")
            dest = folder / src.name
            n = 2
            while dest.exists():
                dest = folder / f"{src.stem} ({n}){src.suffix}"
                n += 1
            row = db.execute("insert into items values(?,?,?,?,?,?)", (batch,str(src),str(dest),"移动中",reason,sig)).lastrowid
            db.commit()
            move(src, dest, sig)
            db.execute("update items set status='已收纳',sig=? where rowid=?", (identity(dest),row))
            db.execute("insert into catalog(item,category,summary,search_text) values (?,?,?,?)",(row,cat,summary,body[:8000]))
            db.execute("insert into filing values(?,?,?,?)",(row,json.dumps(tags,ensure_ascii=False),reason,suggestion))
            project=plan.get("project","")
            if cat=="待确认" and isinstance(project,str) and re.fullmatch(r"[一-龥A-Za-z0-9][一-龥A-Za-z0-9 _-]{1,39}",project) and matches(project,src.stem+" "+body) and not (root/project).is_reserved() and not any(Path(p).name==project for p in folders):
                db.execute("insert into proposals values(?,?)",(row,project))
            if action=="drop" and is_project:
                projects.add(cat)
            if action=="drop" and cat=="待确认":
                pending.append(row)
            group = deliveries.setdefault(str(folder),dict(folder=str(folder),name=dest.name,count=0))
            group.setdefault("ids",[]).append(row)
            group['count'] += 1
            summaries.append(summary)
            counts[int(action == "drop" and cat == "待确认")] += 1
        except (ValueError, OSError) as e:
            if row is None:
                db.execute("insert into items values(?,?,?,?,?,?)", (batch,str(src),"","已跳过",str(e),""))
            else:
                db.execute("update items set status='需核对',reason=? where rowid=?", (str(e),row))
            counts[2] += 1
        db.commit()
        print(json.dumps({"progress": f"正在收纳 {index}/{len(paths)}"}), flush=True)
    if len(projects)==1 and pending:
        suggestion=next(iter(projects))
        db.executemany("update filing set suggestion=? where item=? and why='缺少可唯一确认的项目或用途' and not exists(select 1 from proposals where proposals.item=filing.item)",[(suggestion,r) for r in pending])
        db.commit()
    if action == "deliver":
        return {"success": counts[0], "batch": batch, "message": f"已送达 {counts[0]} 项 · 跳过或需核对 {counts[2]} 项"}
    if summaries and len(paths)==1:
        return {"message": summaries[0], "deliveries": list(deliveries.values())}
    return {"deliveries": list(deliveries.values()), "message": f"已归类 {counts[0]} · 跳过或需核对 {counts[2]}"}


if __name__ == "__main__":
    req = json.load(sys.stdin)
    if req["action"] == "desktop_excerpt":
        file = Path(req["file"])
        excerpt = ""
        try:
            if file.is_absolute() and not file.is_symlink() and file.is_file():
                excerpt = " ".join(sample_text(file).split())[:900]
        except Exception:
            pass
        print(json.dumps({"excerpt": excerpt}), flush=True)
        sys.exit(0)
    root = Path(sys.argv[1]).resolve()
    root.mkdir(parents=True, exist_ok=True)
    with contextlib.closing(sqlite3.connect(sys.argv[2])) as db:
        db.execute("create table if not exists indexed(item integer primary key,stamp text)")
        db.execute("create table if not exists proposals(item integer primary key, proposed text)")
        db.execute("create table if not exists aliases(root,term collate nocase,dest,primary key(root,term))")
        db.execute("create table if not exists filing(item integer primary key,tags,why,suggestion)")
        db.execute("create table if not exists adjustments(item integer primary key,src,dst)")
        db.execute("create table if not exists catalog(item integer primary key,category text,summary text,search_text text,added text default (datetime('now','localtime')))")
        db.execute("create table if not exists items(batch,src,dst,status,reason,sig)")
        if req["action"] not in ("catalog","sample"):
            db.execute("update items set status='需核对',reason='上次中断，请核对原位置与目标位置' where status in ('移动中','撤销中','调整中')")
        db.commit()
        print(json.dumps(run(req, db, root)), flush=True)
