"""Art-independent V2 contracts shared by authoring and saved-Blend verification."""
import math
import re


def validate_clips(clips, sampled=False):
    names = [clip.get('name') for clip in clips]
    if any(not isinstance(name, str) or not re.fullmatch('[a-z][a-z0-9-]*', name) for name in names) or len(set(names)) != len(names):
        raise ValueError('Invalid or duplicate clip name')
    for clip in clips:
        count = len(clip['frames']) if sampled else clip['frameCount']
        if type(count) is not int or not 2 <= count <= 120:
            raise ValueError('Clip needs 2–120 sampled frames')
        if type(clip['loop']) is not bool or not math.isfinite(clip['frameRate']) or clip['frameRate'] <= 0:
            raise ValueError('Invalid clip timing')
        markers = clip.get('markers', {})
        if not isinstance(markers, dict) or any(not isinstance(name, str) or not re.fullmatch('[a-z][a-z0-9-]*', name) or type(index) is not int or not 0 <= index < count for name, index in markers.items()):
            raise ValueError('Invalid clip marker name or frame index')
        if len(set(markers.values())) != len(markers):
            raise ValueError('Clip markers must have distinct frame indices')
        if clip['name'] == 'claw' and (clip['loop'] or set(markers) != {'strike', 'impact'} or not 0 < markers['strike'] < markers['impact'] < count - 1):
            raise ValueError('Claw requires ordered strike/contact markers')
        # JSON object order is not a timing contract. Consumers sort by index.
        end = clip.get('end', 'rest')
        if end not in ('rest', 'free', 'terminal') or clip.get('start', 'rest') not in ('rest', 'free'):
            raise ValueError('Invalid clip start/end')
        if clip['loop'] and (end != 'rest' or 'next' in clip):
            raise ValueError('Loop clips close themselves and cannot declare end/next transitions')
        if 'next' in clip and (end != 'free' or clip['next'] not in names):
            raise ValueError('Clip next requires end=free and an existing clip')


def validate_extensions(spec):
    if 'runtimeAtlas' in spec and type(spec['runtimeAtlas']) is not bool:
        raise ValueError('runtimeAtlas must be boolean')
    if 'elevation' in spec:
        e = spec['elevation']
        if not isinstance(e, dict) or any(type(e.get(k)) not in (int, float) or not math.isfinite(e[k]) for k in ('min', 'max')) or e['min'] >= e['max']:
            raise ValueError('Elevation requires finite min < max')
        scale = e.get('scale', .5)
        if type(scale) not in (int, float) or not math.isfinite(scale) or not 0 < scale <= 1:
            raise ValueError('Elevation scale must be in (0, 1]')
        if any(math.floor(size * scale + .5) < 1 for size in [spec['targetSize'], *spec['sourceSizes']]):
            raise ValueError('Elevation scale produces an empty image')
    if 'runtimeBudgetMB' in spec and (type(spec['runtimeBudgetMB']) not in (int, float) or not math.isfinite(spec['runtimeBudgetMB']) or spec['runtimeBudgetMB'] <= 0):
        raise ValueError('runtimeBudgetMB must be positive')
    if 'runtimeContract' in spec:
        if spec['runtimeContract'] != 'boss' or spec['category'] not in ('enemy', 'boss-part'):
            raise ValueError('Unsupported runtime contract/category')
        if spec.get('runtimeAtlas') is not True or 'elevation' not in spec or 'runtimeBudgetMB' not in spec:
            raise ValueError('Boss runtime requires atlases, elevation and runtimeBudgetMB')
