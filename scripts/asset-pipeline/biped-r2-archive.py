"""Seal and independently read back every member of an accepted R2 source bundle."""
import argparse,hashlib,json,shutil,zipfile
from pathlib import Path
ap=argparse.ArgumentParser();ap.add_argument('root');args=ap.parse_args();root=Path(args.root).resolve();repo=Path('C:/Fragdachse')
if root.parent.parent!=Path('D:/Fragdachse-render') or not root.parent.name.startswith('player-r2-'):raise ValueError('External R2 source required')
g=json.loads((root/'geometry.json').read_text());publication=root/'publication/publication.json'
if not publication.exists() or not json.loads((root/'visual-review.json').read_text()).get('accepted'):raise ValueError('Unselected source')
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
parent=repo/'art/poc/pipeline-v2/runs/v2-ai/badger/source-bundle.zip'
if sha(parent)!=g['source']['archiveSha256']:raise ValueError('Original source archive changed')
if not (root/'parent-source-bundle.zip').exists():shutil.copyfile(parent,root/'parent-source-bundle.zip')
for name in ('biped-r2-review.mjs','biped-r2-publish.mjs','biped-r2-archive.py','biped-r2-export-check.py','mesh-shadow-gap-metric.mjs','mesh-shadow-raster.mjs'):
 destination=root/'source-tools'/name
 if destination.exists() and sha(destination)!=sha(repo/'scripts/asset-pipeline'/name):raise ValueError('Executed tool copy differs')
 if not destination.exists():shutil.copyfile(repo/'scripts/asset-pipeline'/name,destination)
shutil.copyfile(repo/'src/assets/manifests/character-mesh-badger-player-mesh-22-production-r3.json',root/'inherited-held-manifest.json')
members=sorted(p for p in root.rglob('*') if p.is_file() and p.name not in ('source-bundle.zip','archive-receipt.json'))
files={p.relative_to(root).as_posix():sha(p) for p in members};target=root/'source-bundle.zip'
with zipfile.ZipFile(target,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=6,allowZip64=True) as z:
 for file in members:z.write(file,file.relative_to(root).as_posix())
with zipfile.ZipFile(target) as z:
 if set(z.namelist())!=set(files):raise ValueError('Archive member set differs')
 for name,expected in files.items():
  if hashlib.sha256(z.read(name)).hexdigest()!=expected:raise ValueError('Archive readback mismatch: '+name)
receipt=dict(file=target.name,sha256=sha(target),bytes=target.stat().st_size,verified=True,files=files)
(root/'archive-receipt.json').write_text(json.dumps(receipt,indent=2));print('R2_ARCHIVE',receipt['bytes'],receipt['sha256'],flush=True)
