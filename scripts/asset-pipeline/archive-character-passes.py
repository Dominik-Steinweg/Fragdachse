"""Stream a selected pass revision into an immutable V2-style source archive.

No render or working-source mutation. ZIP members, selection and manifest are SHA-256
checked, including a full readback before the exclusive final archive is published.
"""
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import zipfile


def digest(data):
    return hashlib.sha256(data).hexdigest()


def stream_hash(handle):
    result = hashlib.sha256()
    for block in iter(lambda: handle.read(1024 * 1024), b''):
        result.update(block)
    return result.hexdigest()


def safe_name(name):
    if not name or any(c in name for c in ('\\', ':', '\0')) or any(p in ('', '.', '..') for p in name.split('/')):
        raise ValueError('Unsafe archive member: ' + name)
    return name


def verify_archive(filename, expected_selection=None):
    with zipfile.ZipFile(filename) as bundle:
        names = bundle.namelist()
        if len(names) != len(set(names)):
            raise ValueError('Duplicate archive entries')
        for name in names:
            safe_name(name)
        selection_bytes = bundle.read('selection.json')
        selection = json.loads(selection_bytes)
        manifest = json.loads(bundle.read('archive-manifest.json'))
        selection_hash = digest(selection_bytes)
        if expected_selection and selection_hash != expected_selection:
            raise ValueError('Wrong archived selection')
        files = dict(selection['files'], **{'selection.json': selection_hash})
        if (selection.get('version') != 2 or manifest.get('version') != 2
                or manifest['id'] != selection['id'] or manifest['revision'] != selection['revision']
                or manifest['selectionSha256'] != selection_hash or manifest['files'] != files
                or set(names) != set(files) | {'archive-manifest.json'}):
            raise ValueError('Archive/selection binding mismatch')
        for name, expected in files.items():
            with bundle.open(name) as handle:
                if stream_hash(handle) != expected:
                    raise ValueError('Archive hash mismatch: ' + name)
        return manifest


def archive(folder):
    root = Path(folder).resolve()
    target = root / 'source-bundle.zip'
    if target.exists():
        raise ValueError('Immutable archive already exists')
    selection_data = (root / 'selection.json').read_bytes()
    selection = json.loads(selection_data)
    if selection.get('schema') not in ('fd-character-pass-selection', 'fd-character-mesh-selection') or selection.get('version') != 2 or not selection.get('files'):
        raise ValueError('Completed character pass/mesh selection required')
    files = dict(selection['files'], **{'selection.json': digest(selection_data)})
    manifest = dict(version=2, id=selection['id'], revision=selection['revision'],
                    selectionSha256=files['selection.json'], files=files)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(prefix='.source-bundle-', suffix='.tmp', dir=root, delete=False) as handle:
            temporary = Path(handle.name)
        with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as bundle:
            for name, expected in sorted(files.items()):
                source = root / safe_name(name)
                if not source.resolve().is_relative_to(root) or any(p.is_symlink() for p in [source, *source.parents] if p != root):
                    raise ValueError('Source escapes revision')
                info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.create_system = 3
                info.external_attr = 0o644 << 16
                hashed = hashlib.sha256()
                with source.open('rb') as src, bundle.open(info, 'w', force_zip64=True) as dest:
                    for block in iter(lambda: src.read(1024 * 1024), b''):
                        hashed.update(block)
                        dest.write(block)
                if hashed.hexdigest() != expected:
                    raise ValueError('Selected file changed: ' + name)
            bundle.writestr('archive-manifest.json', json.dumps(manifest, indent=2) + '\n')
        verify_archive(temporary, files['selection.json'])
        os.link(temporary, target)  # exclusive publication, never replace a completed archive
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return {'archive': str(target), 'verifiedFiles': len(files)}


if __name__ == '__main__':
    if len(sys.argv) < 3 or sys.argv[1] not in ('--create', '--verify'):
        raise SystemExit('Usage: archive-character-passes.py --create <revision> | --verify <zip> [selection-sha256]')
    if sys.argv[1] == '--create':
        print(json.dumps(archive(sys.argv[2])))
    else:
        result = verify_archive(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
        print(json.dumps({'archive': sys.argv[2], 'verifiedFiles': len(result['files'])}))
