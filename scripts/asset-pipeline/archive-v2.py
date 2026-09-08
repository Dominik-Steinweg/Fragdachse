"""Package a verified V2 selection using only Python's standard library."""
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import zipfile


def digest(data):
    return hashlib.sha256(data).hexdigest()


def checked_file(root, relative):
    parts = relative.split('/')
    if not relative or '\\' in relative or any(p in ('', '.', '..') for p in parts):
        raise ValueError('Invalid archive member path')
    candidate = root.joinpath(*parts)
    if not candidate.resolve().is_relative_to(root) or any(p.is_symlink() for p in [candidate, *candidate.parents] if p != root):
        raise ValueError('Archive member escapes source root')
    return candidate


def archive(folder, destination):
    root = Path(folder).resolve()
    target = Path(destination).resolve()
    if target.parent != root or target.name != 'source-bundle.zip' or target.exists():
        raise ValueError('Archive must be a new source-bundle.zip in the asset folder')
    selection_data = (root / 'selection.json').read_bytes()
    selection = json.loads(selection_data)
    if selection.get('version') != 2 or not selection.get('files'):
        raise ValueError('Completed V2 selection required')
    files = dict(selection['files'])
    files['selection.json'] = digest(selection_data)
    manifest = dict(version=2, id=selection['id'], revision=selection['revision'],
                    selectionSha256=files['selection.json'], files=files)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(prefix='.source-bundle-', suffix='.tmp', dir=root, delete=False) as handle:
            temporary = Path(handle.name)
        with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9, allowZip64=True) as bundle:
            for relative, expected in sorted(files.items()):
                content = checked_file(root, relative).read_bytes()
                if digest(content) != expected:
                    raise ValueError(f'Selected file changed: {relative}')
                write_member(bundle, relative, content)
            write_member(bundle, 'archive-manifest.json', (json.dumps(manifest, indent=2) + '\n').encode('utf-8'))
        # Linking exclusively avoids overwriting an archive created concurrently.
        os.link(temporary, target)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return str(target)


def write_member(bundle, name, data):
    info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    info.create_system = 3
    info.external_attr = 0o644 << 16
    bundle.writestr(info, data, compresslevel=9)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('Usage: python archive-v2.py <asset-folder> <asset-folder>/source-bundle.zip')
    print(archive(sys.argv[1], sys.argv[2]))
