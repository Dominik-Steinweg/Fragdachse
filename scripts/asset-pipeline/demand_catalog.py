"""V2 demand catalog in the layout of pipeline-registry.mjs, without Blender dependencies.

catalog-v2/registry.json holds the catalog version and catalog-v2/assets/<id>.json one entry each,
so lanes that author different assets never edit the same file. Entries are assembled ordered by id.
"""
import json
from pathlib import Path

DIRECTORY = 'scripts/asset-pipeline/catalog-v2'


def read_catalog(root=Path(__file__).resolve().parents[2]):
    directory = Path(root) / DIRECTORY
    catalog = json.loads((directory / 'registry.json').read_text(encoding='utf-8'))
    assets = []
    for path in (directory / 'assets').glob('*.json'):
        asset = json.loads(path.read_text(encoding='utf-8'))
        if f'{asset.get("id")}.json' != path.name:
            raise ValueError(f'{DIRECTORY} file {path.name} holds asset {asset.get("id")}')
        assets.append(asset)
    return catalog | {'assets': sorted(assets, key=lambda asset: asset['id'])}
