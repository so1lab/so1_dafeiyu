"""Manual moves form one reversible learning event per user gesture."""
import json
import uuid
from pathlib import Path


def setup(db):
    db.execute("""create table if not exists desk_moves(
        batch text,item integer,src text,dst text,sig text,metadata text,undone integer default 0,
        primary key(batch,item))""")


def recent(db,root):
    return [dict(batch=batch,count=count,folder=Path(dst).parent.relative_to(root).as_posix())
            for batch,count,dst in db.execute("select batch,count(*),max(dst) from desk_moves where undone=0 group by batch order by max(rowid) desc limit 16")
            if Path(dst).is_relative_to(root)]


def transfer(db,root,req,identity,move):
    undo=req['action']=='desk_undo'
    batch=req['batch'] if undo else uuid.uuid4().hex
    if undo:
        jobs=list(db.execute("select item,dst,src,sig,metadata from desk_moves where batch=? and undone=0 order by rowid desc",(batch,)))
    else:
        folder=(root/req['folder']).resolve()
        if not folder.is_dir() or not folder.is_relative_to(root):raise ValueError('目标目录已变化')
        jobs=[(rid,None,None,None,None) for rid in dict.fromkeys(req['ids'])]
    done=0
    errors=[]
    for rid,expected,original,sig,metadata in jobs:
        try:
            row=db.execute("select dst,sig from items where rowid=? and status in ('已收纳','已同步')",(rid,)).fetchone()
            if not row:raise ValueError('文件记录已变化')
            src=Path(row[0])
            if not src.is_absolute() or not src.resolve().is_relative_to(root) or src.resolve()!=src or identity(src)!=row[1]:raise ValueError('文件已变动')
            if undo:
                dst=Path(original)
                if str(src)!=expected or sig!=row[1] or dst.exists() or not dst.parent.is_dir() or not dst.resolve().is_relative_to(root):raise ValueError('原位置被占用或文件已变化')
                old=json.loads(metadata)
            else:
                if src.parent==folder:continue
                dst=folder/src.name
                n=2
                while dst.exists():
                    dst=folder/f'{src.stem} ({n}){src.suffix}'
                    n+=1
                old=list(db.execute("select why,suggestion from filing where item=?",(rid,)).fetchone() or ('',''))
            move(src,dst,row[1])
            try:
                new_sig=identity(dst)
                db.execute('update items set dst=?,sig=? where rowid=?',(str(dst),new_sig,rid))
                db.execute('update catalog set category=? where item=?',(dst.parent.relative_to(root).as_posix(),rid))
                db.execute('update filing set why=?,suggestion=? where item=?',(*(old if undo else ['仓库中手动调整','']),rid))
                if undo:db.execute('update desk_moves set undone=1 where batch=? and item=?',(batch,rid))
                else:db.execute('insert into desk_moves values(?,?,?,?,?,?,0)',(batch,rid,str(src),str(dst),new_sig,json.dumps(old)))
                db.commit()
            except Exception:
                db.rollback()
                move(dst,src,identity(dst))
                raise
            done+=1
        except (OSError,ValueError) as exc:errors.append(str(exc))
    return dict(done=done,batch=batch,errors=errors)

def history(db,root):
    result=[]
    for src,dst,undone in db.execute("select src,dst,undone from desk_moves order by rowid desc limit 200"):
        src,dst=Path(src),Path(dst)
        if src.is_relative_to(root) and dst.is_relative_to(root):
            result.append(dict(name=dst.name,source=src.parent.relative_to(root).as_posix(),
                               folder=dst.parent.relative_to(root).as_posix(),undone=bool(undone)))
    return result
