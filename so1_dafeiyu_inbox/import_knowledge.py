"""Build the local knowledge index from the source archives without extracting them."""

import argparse
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import sqlite3
import tempfile
import unicodedata
from zipfile import ZipFile


DOMAINS = {
    'dafeiyu-kb': '大肥鱼手册',
    'dsh-pet-main': 'dsh-pet 上游快照',
    'bicopter-kb': '双旋翼知识库',
}
OWNER_DOMAIN = 'so1-kb'
UPSTREAM_DOCS = ('README.md', 'FEATURES.md', 'INSTALL.md', 'CONFIG.md', 'API.md',
                 'CORDIS.md', 'CORDIS-API.md', 'MAKE-YOUR-OWN-PET.md')


def tokenize(value):
    normalized = unicodedata.normalize('NFKC', value).lower()
    for word in re.findall(r'[\u3400-\u9fff]+|[a-z0-9_]+', normalized):
        if '\u3400' <= word[0] <= '\u9fff':
            yield from (word[i:i+2] for i in range(len(word)-1))
        elif len(word) >= 2:
            yield word


def read_text(archive, member):
    if archive.getinfo(member).file_size > 2_000_000:
        raise ValueError(f'资料条目过大：{member}')
    return archive.read(member).decode('utf-8-sig')


def chapters(text, default_title):
    heading = default_title
    lines = []
    for line in text.splitlines():
        match = re.match(r'^#{1,3}\s+(.+)$', line)
        if match:
            if any(lines):
                yield heading, '\n'.join(lines).strip()
            heading, lines = match[1].strip(), []
        else:
            lines.append(line)
    if any(lines):
        yield heading, '\n'.join(lines).strip()


def import_archive(archive, domain):
    if domain != 'dsh-pet-main':
        filename = 'profile.json' if domain == OWNER_DOMAIN else 'knowledge.json'
        metadata = json.loads(read_text(archive, f'{domain}/data/{filename}'))
        version = f"{metadata['version']} · {metadata.get('updated', metadata.get('as_of', ''))}"
        rows = []
        for line in read_text(archive, f'{domain}/data/knowledge.jsonl').splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            document = PurePosixPath(row['doc'])
            if len(document.parts) != 2 or document.parts[0] != 'docs' or document.suffix != '.md':
                continue
            archive.getinfo(f'{domain}/{document.as_posix()}')
            rows.append((document.as_posix(), row['title'], row['text'], ' '.join(row.get('tags', []))))
        return version, rows

    version = json.loads(read_text(archive, f'{domain}/dsh-pet/package.json'))['version']
    rows = []
    for document in UPSTREAM_DOCS:
        for heading, text in chapters(read_text(archive, f'{domain}/{document}'), document):
            if len(text) < 28:
                continue
            for offset in range(0, len(text), 1550):
                snippet = text[max(0, offset - 110):offset + 1550]
                rows.append((document, heading, snippet, 'dsh-pet upstream 上游 源码'))
    # Keep a navigation index for source questions without loading the source tree into chat.
    prefix = f'{domain}/dsh-pet/src/'
    for folder in ('host', 'client', 'shared'):
        files = sorted(n.removeprefix(f'{domain}/') for n in archive.namelist()
                       if n.startswith(f'{prefix}{folder}/') and n.endswith('.ts')
                       and not n.endswith('.test.ts') and '/tests/' not in n)
        for index in range(0, len(files), 20):
            rows.append((f'dsh-pet/src/{folder}/', f'{folder} 源代码位置', '\n'.join(files[index:index+20]),
                         f'dsh-pet 源码 TypeScript {folder}'))
    return version, rows


def owner_profile(archive):
    profile = json.loads(read_text(archive, 'so1-kb/data/profile.json'))
    identity = profile['identity']
    # Only the stable public-facing fields enter everyday conversation context.
    return {
        'name': identity['name'],
        'aliases': identity['alias'],
        'role': identity['type'],
        'positioning': identity['one_liner'],
        'principle': identity['principle'],
        'directions': [row['name'] for row in profile['content_directions']],
        'contentPrinciples': profile['content_principles'],
        'asOf': profile['as_of'],
    }


def build(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, staged = tempfile.mkstemp(prefix='knowledge-', suffix='.sqlite', dir=destination.parent)
    os.close(fd)
    try:
        with closing(sqlite3.connect(staged)) as db, db:
            db.executescript('''
                CREATE TABLE libraries(id TEXT PRIMARY KEY, label TEXT, version TEXT, documents TEXT, passages INTEGER);
                CREATE TABLE passages(id TEXT UNIQUE, domain TEXT, document TEXT, title TEXT, text TEXT);
                CREATE VIRTUAL TABLE search USING fts5(title_words, body_words);
                CREATE TABLE owner_profile(id TEXT PRIMARY KEY, facts TEXT);
            ''')
            report = []
            domains = dict(DOMAINS)
            if (source / (OWNER_DOMAIN + '.zip')).is_file():
                domains[OWNER_DOMAIN] = '守一（SO1）个人知识库'
            for domain, label in domains.items():
                with ZipFile(source / (domain + '.zip')) as archive:
                    version, rows = import_archive(archive, domain)
                    if domain == OWNER_DOMAIN:
                        db.execute('INSERT INTO owner_profile VALUES (?, ?)',
                                   (domain, json.dumps(owner_profile(archive), ensure_ascii=False)))
                docs = {'data/profile.json'} if domain == OWNER_DOMAIN else set()
                count = 0
                for document, title, text, tags in rows:
                    title, text = title.strip()[:160], text.strip()[:2200]
                    if not title or not text:
                        continue
                    key = hashlib.sha256('\0'.join((domain, document, title, text)).encode()).hexdigest()
                    cursor = db.execute('INSERT OR IGNORE INTO passages VALUES (?, ?, ?, ?, ?)',
                                        (key, domain, document, title, text))
                    if not cursor.rowcount:
                        continue
                    db.execute('INSERT INTO search(rowid,title_words,body_words) VALUES (?,?,?)',
                               (cursor.lastrowid, ' '.join(tokenize(f'{title} {document}')),
                                ' '.join(tokenize(f'{tags} {text}'))))
                    docs.add(document)
                    count += 1
                db.execute('INSERT INTO libraries VALUES (?,?,?,?,?)',
                           (domain, label, version, json.dumps(sorted(docs), ensure_ascii=False), count))
                report.append(dict(label=label, version=version, documents=len(docs), passages=count))
            db.execute('INSERT INTO search(search) VALUES (\'optimize\')')
        os.replace(staged, destination)
        return report
    finally:
        Path(staged).unlink(missing_ok=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archives', type=Path, help='directory containing the knowledge zip archives')
    parser.add_argument('data', type=Path, help='local file-inbox data directory')
    args = parser.parse_args()
    print(json.dumps(build(args.archives, args.data / 'knowledge.sqlite'), ensure_ascii=False))
