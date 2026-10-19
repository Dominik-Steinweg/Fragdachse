"""One-off codemod (GDD Void-Gefahrenzonen V1, phase 6): the campaign's front groups, map sources
and default boss spawns move onto named World spawn zones placed in their old edge band. Groups of
one front cycle through that front's zones, encounter by encounter; mass groups split across them
with the same total. The new zones keep their core clear (fingerprints change, accepted by E1).
The hand-formatted JSON is edited textually; every group keeps its own formatting style.

python -I scripts/map-tools/migrate-front-zones.py [map-id ...]
"""
import json
import math
import re
import sys
from pathlib import Path

MAPS = Path(__file__).resolve().parents[2] / 'src/config/coopDefenseMaps'
# Groups larger than this split across the zones of their front, at most one share per zone.
SPLIT_ABOVE = 15

# zones: (id, side, position along the side 0..1); fronts: front -> zones it cycles through;
# encounters: encounter id -> zones overriding its front; boss: zone of a boss without habitat.
SPEC = {
    '02': {'zones': [('west-upper', 'west', .3), ('west-lower', 'west', .7), ('east-mid', 'east', .5)],
           'fronts': {'west': ['west-upper', 'west-lower'], 'east': ['east-mid']}},
    '03': {'zones': [('west-upper', 'west', .3), ('west-lower', 'west', .7), ('east-upper', 'east', .3), ('east-lower', 'east', .7)],
           'fronts': {'west': ['west-upper', 'west-lower'], 'east': ['east-upper', 'east-lower']}},
    '04': {'zones': [('west-upper', 'west', .2), ('west-mid', 'west', .5), ('west-lower', 'west', .8)],
           'fronts': {'west': ['west-upper', 'west-mid', 'west-lower']}},
    '05': {'zones': [('west-upper', 'west', .25), ('west-lower', 'west', .75), ('south-mid', 'south', .5), ('titan-grave', 'west', .5)],
           'fronts': {'west': ['west-upper', 'west-lower'], 'south': ['south-mid']}, 'boss': 'titan-grave'},
    # The middle of the south edge lies in the persistent rear base's reservation.
    '06': {'zones': [('west-upper', 'west', .3), ('west-lower', 'west', .7), ('east-upper', 'east', .3), ('east-lower', 'east', .7), ('south-east', 'south', .68)],
           'fronts': {'west': ['west-upper', 'west-lower'], 'east': ['east-upper', 'east-lower'], 'south': ['south-east']}},
    '08': {'zones': [('west-upper', 'west', .2), ('west-mid', 'west', .5), ('west-lower', 'west', .8), ('north-mid', 'north', .5), ('south-mid', 'south', .5)],
           'fronts': {'west': ['west-upper', 'west-mid', 'west-lower']},
           'encounters': {'dimension-north': ['north-mid'], 'dimension-south': ['south-mid']}},
    '09': {'zones': [('west-upper', 'west', .3), ('west-lower', 'west', .7), ('east-mid', 'east', .5), ('north-mid', 'north', .5), ('south-mid', 'south', .5)],
           'fronts': {'west': ['west-upper', 'west-lower'], 'east': ['east-mid'], 'north': ['north-mid'], 'south': ['south-mid']}},
    '10': {'zones': [('west-upper', 'west', .3), ('west-lower', 'west', .7), ('east-upper', 'east', .3), ('east-lower', 'east', .7),
                     ('north-mid', 'north', .5), ('south-mid', 'south', .5), ('colossus-forge', 'west', .5)],
           'fronts': {'west': ['west-upper', 'west-lower'], 'east': ['east-upper', 'east-lower'], 'north': ['north-mid'], 'south': ['south-mid']},
           'boss': 'colossus-forge'},
    '11': {'zones': [('north-west', 'north', .22), ('north-east', 'north', .78), ('west-mid', 'west', .5), ('south-mid', 'south', .5)],
           'fronts': {'north': ['north-west', 'north-east'], 'west': ['west-mid'], 'south': ['south-mid']}},
    '12': {'zones': [('hive-north', 'west', .2), ('hive-south', 'west', .8)],
           'fronts': {'west': ['hive-north', 'hive-south']}},
    '13': {'zones': [('west-mid', 'west', .5)], 'fronts': {'west': ['west-mid']}},
    '14': {'zones': [('west-upper', 'west', .3), ('west-lower', 'west', .7), ('north-mid', 'north', .5), ('south-mid', 'south', .5)],
           'fronts': {'west': ['west-upper', 'west-lower'], 'north': ['north-mid'], 'south': ['south-mid']}},
    '15': {'zones': [('west-mid', 'west', .5), ('east-mid', 'east', .5), ('north-mid', 'north', .5), ('south-mid', 'south', .5)],
           'fronts': {'west': ['west-mid'], 'east': ['east-mid'], 'north': ['north-mid'], 'south': ['south-mid']}, 'boss': 'west-mid'},
    '17': {'zones': [('west-upper', 'west', .25), ('east-mid', 'east', .5), ('north-mid', 'north', .5), ('south-mid', 'south', .5)],
           'fronts': {'west': ['west-upper'], 'east': ['east-mid'], 'north': ['north-mid'], 'south': ['south-mid']}},
    '18': {'zones': [('west-upper', 'west', .3), ('west-lower', 'west', .7), ('east-upper', 'east', .3), ('east-lower', 'east', .7)],
           'fronts': {'west': ['west-upper', 'west-lower'], 'east': ['east-upper', 'east-lower']}},
    '19': {'zones': [('west-upper', 'west', .3), ('west-lower', 'west', .7), ('east-upper', 'east', .3), ('east-lower', 'east', .7)],
           'fronts': {'west': ['west-upper', 'west-lower'], 'east': ['east-upper', 'east-lower']}},
    '20': {'zones': [('west-mid', 'west', .5), ('east-mid', 'east', .5)],
           'fronts': {'west': ['west-mid'], 'east': ['east-mid']}},
}


def clamp(value, low, high):
    return max(low, min(high, value))


def zone_rect(side, frac, width, height):
    """A zone inside the old edge band of its front (15 % of the arena), centred at `frac`."""
    if side in ('west', 'east'):
        w = clamp(math.floor(width * .15), 5, 8)
        h = clamp(round(height * .28), 8, 14)
        x = 0 if side == 'west' else width - w
        y = clamp(round(frac * height - h / 2), 0, height - h)
    else:
        h = clamp(math.floor(height * .15), 4, 7)
        w = clamp(round(width * .16), 10, 16)
        y = 0 if side == 'north' else height - h
        x = clamp(round(frac * width - w / 2), 0, width - w)
    return x, y, w, h


def group_objects(text):
    """Spans of the top-level objects inside every encounter's `"groups": [...]`."""
    for match in re.finditer(r'"groups"\s*:\s*\[', text):
        i, depth, start = match.end(), 0, None
        while True:
            char = text[i]
            if char == '"':
                i = text.index('"', i + 1) + 1
                continue
            if char == '{':
                if depth == 0:
                    start = i
                depth += 1
            elif char == '}':
                depth -= 1
                if depth == 0:
                    yield start, i + 1
            elif char == ']' and depth == 0:
                break
            i += 1


def render_like(original, group, indent):
    """The group in the formatting of `original`: one line, or one property per line."""
    if '\n' not in original:
        body = ', '.join(f'"{key}": {json.dumps(value)}' for key, value in group.items())
        return '{ ' + body + ' }' if original.startswith('{ ') else '{' + body + '}'
    inner = re.search(r'\n(\s*)"', original).group(1)
    return '{\n' + ',\n'.join(f'{inner}"{key}": {json.dumps(value)}' for key, value in group.items()) + '\n' + indent + '}'


def with_zone(group, zone):
    out = {key: value for key, value in group.items() if key != 'front'}
    out['spawnZoneId'] = zone
    return out


def migrate(map_id):
    path = next(MAPS.glob(f'{map_id}-*.json'))
    spec = SPEC[map_id]
    text = path.read_text(encoding='utf-8')
    data = json.loads(text)
    width, height = data['arenaWidthCells'], data['arenaHeightCells']
    used = set()

    # Encounter groups in file order; each object is rewritten in its own style.
    groups = [(index, encounter, group) for index, encounter in enumerate(data.get('encounters', [])) for group in encounter['groups']]
    objects = list(group_objects(text))
    assert len(objects) == len(groups), (path.name, len(objects), len(groups))
    turn, pieces, last = {}, [], 0
    for (start, end), (index, encounter, group) in zip(objects, groups):
        original = text[start:end]
        assert json.loads(original) == group, (path.name, original)
        pieces.append(text[last:start])
        last = end
        if 'spawnZoneId' in group or 'spawnArea' in group:
            pieces.append(original)
            continue
        front = group.get('front', 'west')
        zones = spec.get('encounters', {}).get(encounter['id']) or spec['fronts'][front]
        key = (index, tuple(zones))
        first = turn.get(key, index)
        if len(zones) > 1 and group['count'] > SPLIT_ABOVE:
            shares = min(len(zones), math.ceil(group['count'] / SPLIT_ABOVE))
            counts = [group['count'] // shares + (1 if i < group['count'] % shares else 0) for i in range(shares)]
            parts = [with_zone({**group, 'count': count}, zones[(first + i) % len(zones)]) for i, count in enumerate(counts)]
            turn[key] = first + shares
        else:
            parts = [with_zone(group, zones[first % len(zones)])]
            turn[key] = first + 1
        used.update(part['spawnZoneId'] for part in parts)
        indent = text[text.rfind('\n', 0, start) + 1:start]
        pieces.append((',\n' + indent).join(render_like(original, part, indent) for part in parts))
    pieces.append(text[last:])
    text = ''.join(pieces)

    # Persistent map sources: the zones of their front, in turn.
    source_turn = {}

    def persistent(match):
        body = match.group(0)
        spawn = json.loads(body)
        if spawn.get('source', {}).get('type') != 'map':
            return body
        zones = spec['fronts'][spawn.get('front', 'west')]
        n = source_turn.get(tuple(zones), 0)
        source_turn[tuple(zones)] = n + 1
        zone = zones[n % len(zones)]
        used.add(zone)
        body = re.sub(r'\n\s*"front": "[a-z]+",', '', body)
        body, count = re.subn(r'"source": \{\s*"type": "map"\s*\}', f'"source": {{ "type": "zone", "zoneId": "{zone}" }}', body)
        assert count == 1, (path.name, body)
        return body

    if data.get('persistentSpawns'):
        start = text.index('"persistentSpawns": [')
        end = text.index('\n  ]', start)
        block = re.sub(r'\{\n(?:[^{}]|\{[^{}]*\})*?\n    \}', persistent, text[start:end])
        text = text[:start] + block + text[end:]

    # The boss leaves from its own zone.
    if 'boss' in data and 'habitatId' not in data['boss'] and 'spawnZoneId' not in data['boss']:
        zone = spec['boss']
        used.add(zone)
        text, count = re.subn(r'("boss": \{\n(\s*)"enemyKind": "[a-z-]+",)', r'\1' + '\n' + r'\2' + f'"spawnZoneId": "{zone}",', text)
        assert count == 1, path.name

    zones = [(zone_id, *zone_rect(side, frac, width, height)) for zone_id, side, frac in spec['zones']]
    assert {z[0] for z in zones} == used, (path.name, sorted(used), sorted(z[0] for z in zones))
    entries = ',\n'.join(f'    {{ "id": "{z}", "gridX": {x}, "gridY": {y}, "widthCells": {w}, "heightCells": {h} }}' for z, x, y, w, h in zones)
    if '"spawnZones": [' in text:
        start = text.index('"spawnZones": [')
        end = text.index('\n  ],', start)
        text = text[:end] + ',\n' + entries + text[end:]
    else:
        anchor = (re.search(r'\n  "arenaHeightCells": \d+,\n', text) or re.search(r'\n  "arenaWidthCells": \d+,\n', text)
                  or re.search(r'\n  "mapId": "[^"]+",\n', text))
        text = text[:anchor.end()] + '  "spawnZones": [\n' + entries + '\n  ],\n' + text[anchor.end():]
    migrated = json.loads(text)
    leftover = [g for e in migrated.get('encounters', []) for g in e['groups'] if 'spawnZoneId' not in g and 'spawnArea' not in g]
    assert not leftover, (path.name, leftover)
    assert all(s.get('source', {}).get('type') != 'map' for s in migrated.get('persistentSpawns', [])), path.name
    total = lambda d: sum(g['count'] for e in d.get('encounters', []) for g in e['groups'])
    assert total(migrated) == total(data), path.name
    path.write_text(text, encoding='utf-8', newline='\n')
    print(f'{path.name}: {len(zones)} zones')


for map_id in sys.argv[1:] or sorted(SPEC):
    migrate(map_id)
