"""Read-only inventory/QA of available pre-encoding EXRs. Run in background Blender."""
import argparse
import json
from pathlib import Path
import re
import sys
sys.dont_write_bytecode=True
sys.path.insert(0,str(Path(__file__).resolve().parent))
import bpy
import numpy as np
from render_integrity import inspect_float, sha

ap=argparse.ArgumentParser();ap.add_argument('--repo',required=True);ap.add_argument('--sources',required=True);ap.add_argument('--out',required=True)
args=ap.parse_args(sys.argv[sys.argv.index('--')+1:]);repo=Path(args.repo);root=Path(args.sources)
enemies=json.loads((repo/'src/assets/manifests/enemy-mesh-families.json').read_text(encoding='utf8'))['assets']
directories=[(a['id'],root/a['revision']/a['id']/'intermediate') for a in enemies]
directories += [('badger-r2',root/'player-r2-005/badger/renders/intermediate'),
                ('badger-21c-legacy',root/'player-shadow-21c-production/intermediate'),
                ('badger-21e4',root/'player-material-21e4/isolated-all/intermediate')]
report=dict(schema='fd-float-source-audit',version=1,blender=bpy.app.version_string,toolSha256=sha(__file__),assets=[])
for asset,directory in directories:
    files=sorted(p for p in directory.glob('*.exr') if re.match(r'(albedo|normal|ao|beauty)-\d+',p.name))
    row=dict(id=asset,directory=str(directory),files=len(files),status='checked' if files else 'float-masters-not-retained',findings=[],coverage=[])
    groups={}
    for file in files:
        mode,pose=re.match(r'(albedo|normal|ao|beauty)-(\d+)',file.name).groups()
        groups.setdefault(pose,{})[mode]=file
    for pose,passes in groups.items():
        alphas={}
        for mode,file in passes.items():
            image=bpy.data.images.load(str(file),check_existing=False)
            try:
                image.colorspace_settings.name='Non-Color'
                pixels=np.empty(len(image.pixels),dtype=np.float32);image.pixels.foreach_get(pixels)
                pixels=pixels.reshape(image.size[1],image.size[0],4)
                try:inspect_float(pixels,mode)
                except ValueError as error:row['findings'].append(dict(pose=int(pose),mode=mode,file=str(file),error=str(error)))
                # The invalid pass is already a finding; never serialize NaN into the report.
                if np.isfinite(pixels[:,:,3]).all():
                    alphas[mode]=pixels[:,:,3].copy()
            finally:bpy.data.images.remove(image)
        if alphas:
            reference=next(iter(alphas.values()))
            delta=max(float(np.max(np.abs(a-reference))) for a in alphas.values())
            row['coverage'].append(dict(pose=int(pose),maxDifference=delta))
            if delta>.025:row['findings'].append(dict(pose=int(pose),error='Float pass coverage mismatch',maxDifference=delta))
    report['assets'].append(row)
    print('FD_FLOAT_AUDIT',asset,len(files),len(row['findings']),flush=True)
output=Path(args.out);output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(report,indent=2,allow_nan=False)+'\n',encoding='utf8')
