"""One-off codemod (GDD Void-Gefahrenzonen V1, phase 1): inline encounter `spawnArea` rectangles
become World-owned `spawnZones`, referenced by `spawnZoneId`. Identical rectangles (including
medium and cluster) share one zone. Migrated zones keep `keepClear: false`, so generated layouts
stay exactly as they were. The hand-formatted JSON is edited textually.

python -I scripts/map-tools/migrate-spawn-areas.py <map.json>...
"""
import json
import re
import sys

AREA = re.compile(r'"spawnArea"\s*:\s*(\{[^{}]*\})')


def key(area):
    medium = area.get('medium')
    return (area['gridX'], area['gridY'], area['widthCells'], area['heightCells'],
            'water' if medium == 'water' else None, bool(area.get('cluster')))


def zone_line(zone):
    fields = [f'"id": "{zone["id"]}"'] + [f'"{k}": {zone[k]}' for k in ('gridX', 'gridY', 'widthCells', 'heightCells')]
    if zone.get('medium'):
        fields.append('"medium": "water"')
    if zone.get('cluster'):
        fields.append('"cluster": true')
    fields.append('"keepClear": false')
    return '    { ' + ', '.join(fields) + ' }'


def migrate(path):
    text = open(path, encoding='utf-8').read()
    data = json.loads(text)
    if 'spawnZones' in data:
        raise SystemExit(f'{path} already has spawnZones')
    zones, by_key = [], {}
    for encounter in data.get('encounters', []):
        for group in encounter['groups']:
            area = group.get('spawnArea')
            if not area or key(area) in by_key:
                continue
            base = encounter['id']
            zone = {'id': base, 'gridX': area['gridX'], 'gridY': area['gridY'], 'widthCells': area['widthCells'],
                    'heightCells': area['heightCells'], 'medium': key(area)[4], 'cluster': key(area)[5]}
            by_key[key(area)] = zone
            zones.append(zone)
    # Several distinct rectangles first used by the same encounter get letter suffixes.
    counts = {}
    for zone in zones:
        counts[zone['id']] = counts.get(zone['id'], 0) + 1
    seen = {}
    for zone in zones:
        if counts[zone['id']] > 1:
            seen[zone['id']] = seen.get(zone['id'], 0) + 1
            zone['id'] = f"{zone['id']}-{'abcdefghijklmnopqrstuvwxyz'[seen[zone['id']] - 1]}"
    ids = [zone['id'] for zone in zones]
    assert len(ids) == len(set(ids)), ids

    def replace(match):
        return f'"spawnZoneId": "{by_key[key(json.loads(match.group(1)))]["id"]}"'

    text, n = AREA.subn(replace, text)
    assert n == sum(1 for e in data.get('encounters', []) for g in e['groups'] if g.get('spawnArea')), path
    anchor = re.search(r'\n  "arenaHeightCells": \d+,\n', text)
    assert anchor, path
    block = '\n  "spawnZones": [\n' + ',\n'.join(zone_line(z) for z in zones) + '\n  ],\n'
    text = text[:anchor.end() - 1] + block + text[anchor.end():]
    json.loads(text)
    open(path, 'w', encoding='utf-8', newline='\n').write(text)
    print(f'{path}: {len(zones)} zones from {n} areas')


for target in sys.argv[1:]:
    migrate(target)
