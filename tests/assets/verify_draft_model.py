"""CPU-only model cache round trip, including explicit rig/socket/material references."""
import sys
sys.dont_write_bytecode = True
import importlib.util
from pathlib import Path
import bpy

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / 'scripts/asset-pipeline'))
definition = importlib.util.spec_from_file_location('draft', root / 'scripts/asset-pipeline/draft-v2.py')
draft = importlib.util.module_from_spec(definition); definition.loader.exec_module(draft)
from demand_catalog import read_catalog
catalog = read_catalog(root)
args = sys.argv[sys.argv.index('--') + 1:]
for asset_id in args:
    spec = next(a for a in catalog['assets'] if a['id'] == asset_id)
    folder = root / 'art/poc/pipeline-v2/drafts/model-cache-check' / asset_id
    folder.mkdir(parents=True, exist_ok=True)
    job = dict(spec=spec, model=str(folder / 'model.blend'), modelHash='fixture-' + asset_id)
    scene, asset, _ = draft.model(job)
    expected = draft.encode(asset)
    samples, clips = draft.motions_v2.author(asset, spec['clips'])
    scene.frame_set(0)
    first = draft.sockets(scene, asset, set(), 'before')
    # Loading the cached scene must discard the authored Actions and restore actual rest controls.
    scene, asset, hit = draft.model(job)
    assert hit and draft.encode(asset) == expected
    again, exported = draft.motions_v2.author(asset, spec['clips'])
    assert samples == again and clips == exported
    scene.frame_set(0)
    assert draft.sockets(scene, asset, set(), 'after') == first
    print('Draft model round trip passed: ' + asset_id, flush=True)
