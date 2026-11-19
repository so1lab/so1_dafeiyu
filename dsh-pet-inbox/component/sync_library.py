"""以磁盘文件身份关联台账，外部加入的文件只索引，不进入可撤销的投放批次。"""
import json
import os
from pathlib import Path
from catalog import sample_text
from warehouse import media_type


def sync(db,root,identity):
    records=list(db.execute("select rowid,dst,sig,status from items where status in ('已收纳','已同步','需核对') order by rowid desc"))
    by_path={}
    by_id={}
    for row in records:
        old=Path(row[1])
        if not old.is_relative_to(root):continue
        by_path.setdefault(old,row)
        try: key=tuple(json.loads(row[2])[:2])
        except (TypeError,ValueError):continue
        by_id.setdefault(key,[]).append(row)
    for base,dirs,files in os.walk(root):
        dirs[:]=[n for n in dirs if not n.startswith('.') and (Path(base)/n).resolve()==Path(base)/n]
        for name in files:
            p=Path(base)/name
            if name.startswith(('.','~$')) or p.is_symlink():continue
            try:
                sig=identity(p)
                key=json.loads(sig)[:2]
                row=by_path.get(p)
                if row and row[2]==sig:continue
                if row and json.loads(row[2] or '[]')[:2]!=key:
                    # 同名替换：需要用户核对，不能把原投放的撤销权限转给新文件。
                    continue
                if not row:
                    matches=[r for r in by_id.get(tuple(key),[]) if not Path(r[1]).exists()]
                    row=matches[0] if len(matches)==1 else None
                if row and row[3]=='需核对':continue
                cat=p.parent.relative_to(root).as_posix()
                if cat=='.':cat='仓库根目录'
                if row and row[2]==sig:
                    db.execute("update items set dst=? where rowid=?",(str(p),row[0]))
                    db.execute("update catalog set category=? where item=?",(cat,row[0]))
                    continue
                try:body=sample_text(p)
                except Exception:body=''
                if identity(p)!=sig:continue
                summary=' '.join(body.split())[:48] or p.stem+' · '+(p.suffix[1:].upper() or '文件')
                if row:
                    rid=row[0]
                    db.execute("update items set dst=?,sig=? where rowid=?",(str(p),sig,rid))
                else:
                    rid=db.execute("insert into items values(null,?,?,?,?,?)",(str(p),str(p),'已同步','资源管理器加入',sig)).lastrowid
                db.execute("""insert into catalog(item,category,summary,search_text) values(?,?,?,?)
                    on conflict(item) do update set category=excluded.category,summary=excluded.summary,search_text=excluded.search_text""",(rid,cat,summary,body[:32000]))
                tags=[t for t in (media_type(p),p.suffix[1:].upper()) if t]
                db.execute("insert or replace into filing values(?,?,?,?)",(rid,json.dumps(tags,ensure_ascii=False),'按磁盘当前位置同步',''))
                db.execute("insert or replace into indexed values(?,datetime('now','localtime'))",(rid,))
            except (OSError,ValueError):continue
    db.commit()
