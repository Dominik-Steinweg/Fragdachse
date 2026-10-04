"""Shared offline gates and content-addressed EXR cache (no Cycles persistence).

Cache callers supply a complete source/settings fingerprint and evaluated pose.
Receipts are published last; incomplete, tampered or old entries are misses.
"""
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import tempfile


def sha(path):
    with open(path, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def provenance(scene=None, sources=None):
    import bpy
    import numpy as np
    return dict(schema='fd-export-provenance', version=1,
                versions=dict(blender=bpy.app.version_string,
                              blenderBuild=bpy.app.build_hash.decode(), python=platform.python_version(), numpy=np.__version__),
                seeds=dict(cycles=scene.cycles.seed if scene else None,
                           animated=scene.cycles.use_animated_seed if scene else False,
                           policy='Cycles seed' if scene else 'deterministic geometry; no random sampling'),
                render=dict(samples=scene.cycles.samples, persistentData=scene.render.use_persistent_data,
                            device=scene.cycles.device) if scene else None,
                sources=sources or {},
                tools={p.name: sha(p) for p in Path(__file__).parent.glob('*.py')})


def inspect_float(pixels, mode):
    import numpy as np
    if pixels.ndim != 3 or pixels.shape[2] != 4 or not np.isfinite(pixels).all():
        raise ValueError('Nonfinite/invalid '+mode+' pass')
    coverage = pixels[:, :, 3]
    if np.any((coverage < -1e-5) | (coverage > 1.00001)):
        raise ValueError('Invalid coverage in '+mode)
    opaque = coverage > .99
    rgb = pixels[:, :, :3] / np.maximum(coverage[:, :, None], 1e-8)
    black = int(np.count_nonzero(opaque & np.all(np.abs(rgb) < 1e-8, axis=2)))
    # Zero is a valid AO visibility or emission; never repair it as colour.
    if mode in ('albedo', 'normal') and black:
        raise ValueError(f'Opaque black {mode} corruption: {black} pixels')
    if mode == 'normal':
        length = np.linalg.norm(rgb * 2 - 1, axis=2)
        if np.any(opaque & ((length < 1e-5) | (length > 1.02))):
            raise ValueError('Invalid raw normal vectors')
    if mode == 'ao' and np.any(opaque[:, :, None] & ((rgb < -1e-5) | (rgb > 1.00001))):
        raise ValueError('AO outside visibility range')
    return dict(opaqueBlack=black, finite=True)


def cache_key(inputs):
    return hashlib.sha256(json.dumps(inputs, sort_keys=True, allow_nan=False, separators=(',', ':')).encode()).hexdigest()


def configure_cache(scene, job, output):
    import bpy
    # Includes transitive authoring helpers, exact loaded Blend and full job/spec.
    sources = {str(p): sha(p) for p in Path(__file__).parent.glob('*.py')}
    sources[bpy.data.filepath] = sha(bpy.data.filepath)
    inputs = dict(job=job, sources=sources,
                  blender=bpy.app.version_string, build=bpy.app.build_hash.decode())
    scene['fd_pass_cache_context'] = cache_key(inputs)
    scene['fd_pass_cache_root'] = os.environ.get('FD_RENDER_CACHE', str(Path(output)/'pass-cache'))
    snapshot = Path(output)/'executed-tools'; snapshot.mkdir(exist_ok=True)
    for file, expected in sources.items():
        if not file.endswith('.py'):
            continue
        target = snapshot/Path(file).name
        if target.exists() and sha(target) != expected:
            raise ValueError('Changed executed tool snapshot: '+str(target))
        if not target.exists():
            shutil.copyfile(file, target)
    receipt = Path(output)/'render-inputs.json'
    text = json.dumps(inputs, sort_keys=True, indent=2)+'\n'
    if receipt.exists() and receipt.read_text(encoding='utf8') != text:
        raise ValueError('Changed render inputs; use a new revision')
    receipt.write_text(text, encoding='utf8')
    scene['fd_cache_hits'] = 0
    scene['fd_cache_misses'] = 0


def pass_key(scene, label):
    if not scene.get('fd_pass_cache_context'):
        return None
    # Label retains shadow light/canvas identity; frame and all changing render settings are bound.
    return cache_key(dict(context=scene['fd_pass_cache_context'], label=label,
        frame=scene.frame_current, subframe=scene.frame_subframe,
        camera=[list(row) for row in scene.camera.matrix_world], scale=scene.camera.data.ortho_scale,
        size=[scene.render.resolution_x,scene.render.resolution_y,scene.render.resolution_percentage],
        seed=scene.cycles.seed, animated=scene.cycles.use_animated_seed, samples=scene.cycles.samples,
        device=scene.cycles.device, denoise=scene.cycles.use_denoising,
        persistent=scene.render.use_persistent_data))


def restore(cache, key, destination):
    root = Path(cache) / key
    try:
        receipt = json.loads((root/'receipt.json').read_text())
        if receipt['key'] != key or sha(root/'pass.exr') != receipt['sha256']:
            return False
        shutil.copyfile(root/'pass.exr', destination)
        return sha(destination) == receipt['sha256']
    except (OSError, ValueError, KeyError):
        return False


def store(cache, key, source):
    cache = Path(cache); cache.mkdir(parents=True, exist_ok=True)
    # A temporary sibling plus rename keeps parallel writers from sharing output.
    with tempfile.TemporaryDirectory(prefix='pending-', dir=cache) as temporary:
        root = Path(temporary)
        shutil.copyfile(source, root/'pass.exr')
        (root/'receipt.json').write_text(json.dumps(dict(key=key, sha256=sha(root/'pass.exr'))))
        try:
            os.rename(root, cache/key)
        except FileExistsError:
            pass
