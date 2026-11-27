"""Read-only projection for the pet's memory graph."""

from contextlib import closing
import json
from pathlib import Path
import sqlite3


def snapshot(root, database):
    root = root.resolve(strict=True)
    if not database.is_file():
        return []
    uri = database.resolve().as_uri() + "?mode=ro"
    with closing(sqlite3.connect(uri, timeout=2, uri=True)) as db:
        db.execute("BEGIN")
        ledger = db.execute("""
            SELECT i.rowid, i.dst, i.sig, i.batch, c.added
            FROM items i LEFT JOIN catalog c ON c.item=i.rowid
            WHERE i.status IN ('已收纳','已同步') ORDER BY i.rowid DESC
        """).fetchall()
        history = db.execute("""
            SELECT item,src,dst FROM desk_moves WHERE undone=0
            UNION ALL SELECT item,src,dst FROM adjustments
        """).fetchall()

    def inside(raw):
        path = Path(raw)
        return path.relative_to(root) if path.is_absolute() and path.is_relative_to(root) else None

    # A correction describes the current item only while its destination still matches.
    corrections = {}
    for item, before, after in history:
        original, target = inside(before), inside(after)
        if original is not None and target is not None and original.parent != target.parent:
            sources = corrections.setdefault((item, target), set())
            sources.add(original.parent.as_posix())

    seen = set()
    files = []
    for item, destination, signature, batch, added in ledger:
        relative = inside(destination)
        if relative is None or relative in seen:
            continue
        path = root / relative
        try:
            if path.resolve() != path or not path.is_file():
                continue
            info = path.stat()
            if json.loads(signature)[:2] != [info.st_dev, info.st_ino]:
                continue
        except (OSError, ValueError, TypeError, RuntimeError):
            continue
        seen.add(relative)
        files.append(dict(id=str(item), name=path.name, path=relative.as_posix(),
                          folder=relative.parent.as_posix(), format=path.suffix[1:].upper(),
                          batch=batch, added=added, correctedFrom=sorted(corrections.get((item, relative), ()))))
    return files
