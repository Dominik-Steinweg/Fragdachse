"""Pack/verify self-contained R1 source evidence. No recursive removal or import."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import zipfile


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--revision',required=True)
    parser.add_argument('--root',help='Optional single-asset directory inside this worktree')
    args=parser.parse_args()
    if not args.revision.startswith('enemy-mesh-') or any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789-' for c in args.revision):
        raise ValueError('Explicit D: revision required')
    root=Path('D:/Fragdachse-render')/args.revision
    if args.root:
        root=Path(args.root).resolve()
        allowed=Path.cwd()/'art/poc/pipeline-v2/enemy-mesh'
        if not root.is_relative_to(allowed) or root.parent.name != args.revision:
            raise ValueError('Single-asset archive must stay in its worktree revision')
    if root.resolve()!=root.absolute():raise ValueError('Redirected output root')
    result=json.loads((root/'review-result.json').read_text(encoding='utf8'))
    if result['status']!='reviewed-not-imported':raise ValueError('Review not complete')
    members=[]
    for file in sorted(root.rglob('*')):
        if not file.is_file():continue
        relative=file.relative_to(root)
        if file.resolve()!=file.absolute():raise ValueError('Redirected archive member')
        if any(p in ('intermediate','review-source','pass-cache','__pycache__') for p in relative.parts) or file.suffix=='.log' or file.name in ('r4-source-bundle.zip','archive-receipt.json'):
            continue
        members.append((relative.as_posix(),file))
    entries={name:dict(sha256=sha(file.read_bytes()),bytes=file.stat().st_size) for name,file in members}
    destination=root/'r4-source-bundle.zip'
    with zipfile.ZipFile(destination,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
        for name,file in members:archive.write(file,name)
        archive.writestr('bundle-manifest.json',json.dumps(dict(schema='fd-enemy-source-bundle',version=1,revision=args.revision,files=entries),indent=2)+'\n')
    with zipfile.ZipFile(destination) as archive:
        if set(archive.namelist())!=set(entries)|{'bundle-manifest.json'}:raise ValueError('Archive member set differs')
        for name,expected in entries.items():
            member=PurePosixPath(name)
            if member.is_absolute() or '..' in member.parts:raise ValueError('Unsafe archive member')
            data=archive.read(name)
            if len(data)!=expected['bytes'] or sha(data)!=expected['sha256']:raise ValueError('Archive verification failed: '+name)
    receipt=dict(file=destination.name,sha256=sha(destination.read_bytes()),bytes=destination.stat().st_size,members=len(entries),verified=True,files=entries,
                 omittedReproducibleIntermediates=['intermediate EXR/cache','review-source dense binary extraction','process logs'])
    (root/'archive-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf8')
    print(json.dumps(receipt))


if __name__=='__main__':main()
