"""资料库目录、常用媒体类型，以及旧默认路径的可重试迁移。"""
import json
import os
import sqlite3
from contextlib import closing
import sys
from pathlib import Path

GROUPS = {
    "工作与学习": {"工作项目":["客户项目","项目资料"],"学习参考":["参考资料","学习资料"],"模板素材":["模板","素材模板"],"往来沟通":["沟通记录"]},
    "个人生活": {"生活事务":["生活资料"],"财务票据":["财务凭证"],"旅行出行":["旅行资料","出行资料"]},
    "照片与影音": {"照片图片":["照片","图片"],"截图录屏":["截屏录屏"],"视频":["视频资料"],"音频录音":["音频","录音"]},
    "软件与设备": {"软件工具":["软件安装包","应用工具"]},
}
ALIASES = {key:aliases for group in GROUPS.values() for key,aliases in group.items()}
MEDIA = {"图片":"jpg jpeg png gif bmp webp heic heif tif tiff avif dng raw cr2 nef svg",
         "视频":"mp4 mov mkv avi flv m4v wmv webm mpg mpeg mts",
         "音频":"mp3 wav m4a flac aac amr ogg opus aiff wma"}

def actual(root,category):
    for name in [category,*ALIASES.get(category,[])]:
        p=root/name
        if p.is_dir() and p.resolve()==p:
            return name
    return category

def media_type(path):
    ext=path.suffix.lower()[1:]
    return next((kind for kind,extensions in MEDIA.items() if ext in extensions.split()),"")

def everyday(src,body):
    kind=media_type(src)
    name=src.stem.casefold()
    text=name+" "+body[:1600].casefold()
    if any(w in text for w in ("租房","租赁住房","保修单","体检预约","家长会","学校通知")):
        return "生活事务"
    if any(w in text for w in ("行程单","酒店预订","酒店确认","旅行攻略","航班预订","电子登机牌")):
        return "旅行出行"
    if kind in ("图片","视频") and any(w in name for w in ("截图","录屏","截屏","屏幕录制","screenshot","screen recording","屏幕快照")):
        return "截图录屏"
    if any(w in name for w in ("模板","海报","设计素材")):
        return "模板素材"
    ext=src.suffix.lower()
    if ext in (".msi",".exe",".msix",".apk",".dmg",".deb",".pkg") or ext in (".zip",".rar",".7z") and any(w in name for w in ("驱动","安装包","installer","driver")):
        return "软件工具"
    return {"图片":"照片图片","音频":"音频录音","视频":"视频"}.get(kind,"")

def init(root,old,data):
    root,old=root.absolute(),old.absolute()
    marker=data/"warehouse-migration.json"
    if old!=root and old.is_dir() and not root.exists() and not marker.exists():
        marker.write_text(json.dumps([str(old),str(root)]),encoding="utf8")
    if marker.exists():
        source,target=map(Path,json.loads(marker.read_text("utf8")))
        if source!=old or target!=root:
            raise ValueError("资料库迁移路径发生变化")
        if source.exists():
            if target.exists():raise FileExistsError("新旧资料库同时存在，需核对路径")
            source.rename(target)
        dbfile=data/"history.sqlite"
        if dbfile.exists():
            with closing(sqlite3.connect(dbfile)) as db, db:
                tables={r[0] for r in db.execute("select name from sqlite_master where type='table'")}
                for table,cols in (("items",("src","dst")),("adjustments",("src","dst")),("aliases",("root",))):
                    if table not in tables:continue
                    for col in cols:
                        for rid,value in list(db.execute(f"select rowid,{col} from {table}")):
                            if value and Path(value).is_relative_to(source):
                                new=target/Path(value).relative_to(source)
                                db.execute(f"update {table} set {col}=? where rowid=?",(str(new),rid))
        marker.unlink()
    elif old!=root and old.exists() and root.exists():
        root=old  # 保留已有双库的资料归属，避免覆盖同名目录。
    root.mkdir(parents=True,exist_ok=True)
    for name in ALIASES:
        (root/actual(root,name)).mkdir(exist_ok=True)
    return root

if __name__=="__main__":
    print(json.dumps(str(init(*(Path(p) for p in sys.argv[1:])))))
