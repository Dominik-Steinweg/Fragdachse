"""No-bpy checks using Blender's bundled Python/NumPy."""
from pathlib import Path
import tempfile
import numpy as np
from render_integrity import inspect_float, cache_key, store, restore


def rejects(function):
    try:
        function()
    except ValueError:
        return
    raise AssertionError('Invalid sample accepted')


with tempfile.TemporaryDirectory() as temporary:
    root=Path(temporary); source=root/'source.exr'; source.write_bytes(b'exact float pixels')
    key=cache_key(dict(blend='a',seed=37,pose=2,mode='albedo'))
    assert key!=cache_key(dict(blend='b',seed=37,pose=2,mode='albedo'))
    assert key!=cache_key(dict(blend='a',seed=38,pose=2,mode='albedo'))
    assert key!=cache_key(dict(blend='a',seed=37,pose=2,mode='normal'))
    store(root/'cache',key,source)
    assert restore(root/'cache',key,root/'copy.exr')
    assert (root/'copy.exr').read_bytes()==source.read_bytes()
    (root/'cache'/key/'pass.exr').write_bytes(b'tampered')
    assert not restore(root/'cache',key,root/'copy.exr')
    rejects(lambda:cache_key(dict(frame=float('nan'))))
valid=np.array([[[.5,.5,1.,1.]]],dtype=np.float32)
inspect_float(valid,'normal')
# Antialiasing averages opposing surfaces before the encoder renormalizes.
inspect_float(np.array([[[.5,.5,.6,1.]]]),'normal')
rejects(lambda:inspect_float(np.array([[[0,0,0,1.]]]),'albedo'))
rejects(lambda:inspect_float(np.array([[[.5,.5,.5,1.]]]),'normal'))
rejects(lambda:inspect_float(np.array([[[1,1,float('nan'),1.]]]),'ao'))
inspect_float(np.array([[[0.,0.,0.,1.]]]),'ao')
print('Render integrity: finite/normal/black/AO/cache checks passed')
