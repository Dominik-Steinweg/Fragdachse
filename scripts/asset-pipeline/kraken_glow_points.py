"""Kraken sucker glow points: the visible ventral cups of each master pose, read once from the
hash-pinned saved scene of the selected revision. Never saves a Blend or an image.

Background Blender only; scripts/asset-pipeline/kraken-glow-points.mjs writes the job.
Output per asset: glow-points.bin (records of src/effects/kraken/KrakenGlowPoints.ts) and glow-points.json.
"""
import sys
sys.dont_write_bytecode = True
import argparse, hashlib, json, math
from pathlib import Path
import bpy
import numpy as np
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

RECORD = np.dtype([('x', '<u2'), ('y', '<u2'), ('z', '<u2'), ('t', 'u1'), ('vis', 'u1'), ('r', 'u1'), ('arm', 'u1')])
ARM_SIDES = 44  # kraken_arm_parts.arm(): rings of 44 body vertices come first, then the cups
MIN_VIS, MERGE_PX, MAX_POINTS = .2, 1.25, 512
RIM_SHARE = .7  # rim ray samples: the cup's four outermost points seen from above, pulled towards the middle
RAY_TOP = 1000.0
if RECORD.itemsize != 10: raise ValueError('Record layout differs from KRAKEN_GLOW_POINT_BYTES')


def digest(file): return hashlib.sha256(Path(file).read_bytes()).hexdigest()
def write(file, value): Path(file).write_text(json.dumps(value, indent=2) + '\n', encoding='utf8')
def sample(scene, value):
    scene.frame_set(math.floor(value), subframe=value % 1)
    bpy.context.view_layer.update()


def flagged_slots(ob):
    return {i for i, m in enumerate(ob.data.materials) if m and m.get('ventralSuckerSurface')}


def evaluated(ob, deps, full=False):
    """World positions and face materials of the evaluated mesh; topology arrays on request."""
    ev = ob.evaluated_get(deps); me = ev.to_mesh()
    try:
        co = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get('co', co)
        matrix = np.asarray(ev.matrix_world, dtype=np.float64)
        out = {'co': co.reshape(-1, 3).astype(np.float64) @ matrix[:3, :3].T + matrix[:3, 3]}
        material = np.empty(len(me.polygons), np.int32); me.polygons.foreach_get('material_index', material)
        out['material'] = material
        if full:
            start = np.empty(len(me.polygons), np.int32); me.polygons.foreach_get('loop_start', start)
            total = np.empty(len(me.polygons), np.int32); me.polygons.foreach_get('loop_total', total)
            corners = np.empty(len(me.loops), np.int32); me.loops.foreach_get('vertex_index', corners)
            rest = np.empty(len(me.vertices) * 3, np.float32); me.attributes['FD_Rest'].data.foreach_get('vector', rest)
            out.update(start=start, total=total, corners=corners, rest=rest.reshape(-1, 3).astype(np.float64))
        return out
    finally:
        ev.to_mesh_clear()


def islands(material, start, total, corners, flagged, vertex_count):
    """Connected face islands of the flagged materials. Lip and well share rings: one island per cup."""
    faces = np.flatnonzero(np.isin(material, sorted(flagged)))
    parent = list(range(vertex_count))
    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]; a = parent[a]
        return a
    for f in faces.tolist():
        vs = corners[start[f]:start[f] + total[f]].tolist(); root = find(vs[0])
        for v in vs[1:]:
            r = find(v)
            if r != root: parent[r] = root
    roots = np.array([find(int(corners[start[f]])) for f in faces], np.int64)
    _, ids = np.unique(roots, return_inverse=True)
    face_island = np.full(len(material), -1, np.int32); face_island[faces] = ids
    verts = [np.unique(np.concatenate([corners[start[f]:start[f] + total[f]] for f in faces[ids == k]])) for k in range(ids.max() + 1)]
    return face_island, verts


def polyline_project(points, line):
    """Arc length and fractional segment index of each point's closest position on a polyline."""
    a, b = line[:-1], line[1:]; ab = b - a; length = np.linalg.norm(ab, axis=1)
    cumulative = np.concatenate([[0], np.cumsum(length)])
    rel = points[:, None, :] - a[None]
    u = np.clip(np.einsum('kmj,mj->km', rel, ab) / np.maximum(length ** 2, 1e-12), 0, 1)
    distance = np.linalg.norm(rel - u[..., None] * ab[None], axis=2)
    seg = distance.argmin(axis=1); k = np.arange(len(points))
    return cumulative[seg] + u[k, seg] * length[seg], seg + u[k, seg], cumulative[-1]


def first_rise_through(values, level=0.0):
    """Fractional index where a root-to-tip profile first rises through `level`."""
    for i in range(len(values) - 1):
        if values[i] < level <= values[i + 1]:
            return i + (level - values[i]) / (values[i + 1] - values[i])
    raise ValueError('Strike tentacle never rises through the waterline at the idle pose')


class Arm:
    def __init__(self, ob, role, deps):
        self.ob = ob; self.flagged = flagged_slots(ob)
        motion = ob.get('motionRole')
        if role == 'tentacle':
            if motion != 'strike-tentacle': raise ValueError(f'Unexpected sucker object on the tentacle: {ob.name}')
            self.index = 0
        else:
            if motion != 'tentacle' or ob.get('tentacleIndex') not in range(8): raise ValueError(f'Unexpected sucker object: {ob.name}')
            self.index = int(ob['tentacleIndex'])
        base = ob.data; n = len(base.vertices)
        base_rest = np.empty(n * 3, np.float32); base.attributes['FD_Rest'].data.foreach_get('vector', base_rest)
        base_rest = base_rest.reshape(-1, 3).astype(np.float64)
        used = set()
        for p in base.polygons:
            if p.material_index in self.flagged: used.update(p.vertices)
        body = np.setdiff1d(np.arange(n), np.fromiter(used, np.int64))
        if not np.array_equal(body, np.arange(len(body))) or len(body) % ARM_SIDES:
            raise ValueError(f'{ob.name}: arm body is not ring-ordered before its cups')
        self.body = len(body)
        # Rest centre line (FD_Rest, world space at build): t is a property of the cup, not of the pose.
        self.rest_line = base_rest[:self.body].reshape(-1, ARM_SIDES, 3).mean(axis=1)
        e = evaluated(ob, deps, full=True)
        # Subdivision keeps coarse vertices first; the ring centres of every pose rely on it.
        if np.abs(e['rest'][:n] - base_rest).max() > 1e-6: raise ValueError(f'{ob.name}: evaluated mesh lost coarse vertex order')
        self.vertex_count, self.material = len(e['co']), e['material']
        self.face_island, verts = islands(e['material'], e['start'], e['total'], e['corners'], self.flagged, self.vertex_count)
        base_islands = sum(len(p.vertices) == 14 and p.material_index in self.flagged for p in base.polygons)
        if len(verts) != base_islands or len({len(v) for v in verts}) != 1:
            raise ValueError(f'{ob.name}: {len(verts)} cup islands, {base_islands} cup wells; cups merged or split')
        self.cups = np.stack(verts)
        rest_centres = e['rest'][self.cups].mean(axis=1)
        s, ring, length = polyline_project(rest_centres, self.rest_line)
        self.ring = np.rint(ring).astype(np.int64)
        if role == 'tentacle':
            # t = 0 where the idle (hover) pose climbs out of the water, i.e. at the waterEntry socket.
            posed = e['co'][:self.body].reshape(-1, ARM_SIDES, 3).mean(axis=1)
            entry = first_rise_through(posed[:, 2])
            i = min(int(entry), len(posed) - 2)
            self.entry_world = posed[i] + (posed[i + 1] - posed[i]) * (entry - i)
            seg = np.linalg.norm(np.diff(self.rest_line, axis=0), axis=1)
            start = seg[:i].sum() + seg[i] * (entry - i)
            self.t = np.clip((s - start) / (length - start), 0, 1)
            self.t_reference = {'origin': 'idle-pose waterline crossing', 'ringFraction': float(entry),
                                'restArcLength': float(start), 'length': float(length)}
        else:
            self.t = np.clip(s / length, 0, 1)
            self.t_reference = {'origin': 'arm root (sunk into the body)', 'length': float(length)}


def cast_hits(scene, deps, arm, cup, points):
    """Rays straight down; a sample counts when the first rendered surface is this same cup."""
    hits = []
    for p in points:
        origin = Vector((float(p[0]), float(p[1]), RAY_TOP))
        for _ in range(16):
            ok, location, _, index, hit, _ = scene.ray_cast(deps, origin, Vector((0, 0, -1)))
            if not ok: break
            if hit.hide_render:
                origin = Vector((origin.x, origin.y, location.z - 1e-5)); continue
            if hit.name == arm.ob.name and arm.face_island[index] == cup: hits.append(tuple(location))
            break
    return hits


def pose_cups(scene, deps, arms, job):
    camera, size, elevation = scene.camera, job['sourceSize'], job['elevation']
    px_per_bu = size / camera.data.ortho_scale
    cups = []
    for arm in arms:
        e = evaluated(arm.ob, deps)
        if len(e['co']) != arm.vertex_count or not np.array_equal(e['material'], arm.material):
            raise ValueError(f'{arm.ob.name}: topology differs from the idle pose')
        co = e['co']; rings = co[:arm.body].reshape(-1, ARM_SIDES, 3).mean(axis=1)
        points = co[arm.cups]; centre = points.mean(axis=1)
        # Cups sit on the radial direction of their ring (kraken_arm_parts.arm: surface = centre + normal * r).
        normal = centre - rings[arm.ring]; normal /= np.linalg.norm(normal, axis=1, keepdims=True)
        rel = points - centre[:, None]
        perp = rel - np.einsum('cvj,cj->cv', rel, normal)[..., None] * normal[:, None]
        radius = np.linalg.norm(perp, axis=2).max(axis=1)
        for k in range(len(centre)):
            # Footprint seen from above: along the cup's horizontal tangent and across it (the roll direction).
            n = normal[k]; a = np.cross(n, (0, 0, 1))[:2]
            a = a / np.linalg.norm(a) if np.linalg.norm(a) > 1e-6 else np.array([1.0, 0])
            b = np.array([-a[1], a[0]]); flat = points[k][:, :2] - centre[k][:2]
            ea, eb = flat @ a, flat @ b
            middle = centre[k][:2] + a * (ea.max() + ea.min()) / 2 + b * (eb.max() + eb.min()) / 2
            rims = [flat[i] for i in (ea.argmax(), ea.argmin(), eb.argmax(), eb.argmin())]
            samples = [middle] + [middle + RIM_SHARE * (centre[k][:2] + r - middle) for r in rims]
            hits = cast_hits(scene, deps, arm, k, samples)
            # Most visible cups are lips rolled out past the arm edge: anchor on what the rays saw.
            anchor = Vector(np.mean(hits, axis=0).tolist() if hits else centre[k].tolist())
            projected = world_to_camera_view(scene, camera, anchor)
            x, y, z = projected.x, 1 - projected.y, anchor.z
            if not (0 <= x <= 1 and 0 <= y <= 1) or not elevation['min'] <= z <= elevation['max']:
                raise ValueError(f'Cup outside canvas or elevation: {arm.ob.name} {k}: {(x, y, z)}')
            cups.append(dict(x=x, y=y, z=z, t=float(arm.t[k]), vis=len(hits) / len(samples), hits=len(hits), facing=float(n[2]),
                             radiusPx=float(radius[k] * px_per_bu), arm=arm.index, cup=k))
    return cups


def select(cups, size):
    """vis >= MIN_VIS, then greedy merge (highest vis wins) within MERGE_PX source px, then cap."""
    visible = sorted((c for c in cups if c['vis'] >= MIN_VIS), key=lambda c: (-c['vis'], c['arm'], c['t'], c['cup']))
    kept = []
    for c in visible:
        if all(math.hypot((c['x'] - k['x']) * size, (c['y'] - k['y']) * size) >= MERGE_PX for k in kept): kept.append(c)
    capped = max(0, len(kept) - MAX_POINTS); kept = kept[:MAX_POINTS]
    kept.sort(key=lambda c: (c['arm'], c['t'], c['cup']))
    return kept, {'cups': len(cups), 'visible': len(visible), 'merged': len(visible) - len(kept) - capped, 'capped': capped, 'kept': len(kept)}


def encode(points, elevation):
    out = np.zeros(len(points), RECORD)
    span = elevation['max'] - elevation['min']
    for i, p in enumerate(points):
        r = round(p['radiusPx'] * 4)
        if r > 255: raise ValueError(f'Cup radius exceeds the u8 encoding: {p["radiusPx"]} px')
        out[i] = (round(p['x'] * 65535), round(p['y'] * 65535), round((p['z'] - elevation['min']) / span * 65535),
                  round(p['t'] * 255), round(p['vis'] * 255), max(1, r), p['arm'])
    return out


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--job', required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    job = json.loads(Path(args.job).read_text(encoding='utf8'))
    source, out = Path(job['source']), Path(job['out'])
    if Path(bpy.data.filepath).resolve() != (source / 'asset.blend').resolve() or digest(bpy.data.filepath) != job['provenance']['blend']:
        raise ValueError('Source blend mismatch')
    if digest(source / 'render.json') != job['provenance']['render']: raise ValueError('Source render.json mismatch')
    render = json.loads((source / 'render.json').read_text(encoding='utf8'))
    scenes = [s for s in bpy.data.scenes if s.get('inputHash') == render['inputHash']]
    if len(scenes) != 1: raise ValueError('Expected exactly one selected asset scene')
    scene = scenes[0]; bpy.context.window.scene = scene
    camera = scene.camera
    if camera.data.type != 'ORTHO' or any(abs(v) > 1e-7 for v in camera.rotation_euler): raise ValueError('Not exact top-down')
    if abs(camera.data.ortho_scale - render['orthoScale']) > 1e-5: raise ValueError('Ortho scale differs from render.json')
    if scene.render.resolution_x != scene.render.resolution_y: raise ValueError('Canvas must be square')
    sockets = {name: scene.objects[obj] for name, obj in json.loads(scene['asset_socket_objects']).items()}
    sample(scene, render['frames'][job['idleFrame']]['blenderFrame'])
    deps = bpy.context.evaluated_depsgraph_get()
    arms = sorted((Arm(ob, job['role'], deps) for ob in scene.objects
                   if ob.type == 'MESH' and not ob.hide_render and flagged_slots(ob)), key=lambda a: a.index)
    expected = [0] if job['role'] == 'tentacle' else list(range(8))
    if [a.index for a in arms] != expected: raise ValueError(f'Unexpected arm set: {[a.index for a in arms]}')
    if job['role'] == 'tentacle':
        entry = sockets['waterEntry'].evaluated_get(deps).matrix_world.translation
        if math.dist(arms[0].entry_world[:2], (entry.x, entry.y)) > .5: raise ValueError('Waterline crossing far from the waterEntry socket')
    frames, stats, debug, records = [], [], [], []
    by_index = {p['index']: p for p in job['poses']}
    for index in range(job['masterCount']):
        pose = by_index.get(index)
        if pose is None:
            frames.append([len(records), 0]); continue
        frame = render['frames'][index]
        if frame['index'] != index or frame['blenderFrame'] != pose['blenderFrame']: raise ValueError('Pose table differs from render.json')
        sample(scene, pose['blenderFrame'])
        if abs(camera.location.x) > 1e-7 or abs(camera.location.y) > 1e-7: raise ValueError('Camera moved')
        deps = bpy.context.evaluated_depsgraph_get()
        # Same projection as socketFrames: re-derive every exported socket of this pose.
        for name, obj in sockets.items():
            world = obj.evaluated_get(deps).matrix_world.translation
            p = world_to_camera_view(scene, camera, world); ref = render['socketFrames'][index][name]
            if max(abs(p.x - ref['x']), abs(1 - p.y - ref['y']), abs(world.z - ref['z'])) > 2e-6:
                raise ValueError(f'Pose {index} does not reproduce socket {name}')
        cups = pose_cups(scene, deps, arms, job)
        kept, stat = select(cups, job['sourceSize'])
        frames.append([len(records), len(kept)]); records.extend(kept)
        stats.append({'index': index, 'blenderFrame': pose['blenderFrame'], **stat})
        if job.get('debug'):
            debug.append({'index': index, 'cups': [{k: (round(v, 6) if isinstance(v, float) else v) for k, v in c.items()} for c in cups],
                          'kept': [(c['arm'], c['cup']) for c in kept]})
        print(f'Glow points {job["id"]} pose {index}: {stat}', flush=True)
    data = encode(records, job['elevation']).tobytes()
    (out / 'glow-points.bin').write_bytes(data)
    if job.get('debug'): write(out / 'glow-debug.json', debug)
    counts = [s['kept'] for s in stats]
    write(out / 'glow-points.json', {
        'schema': 'kraken-glow-points', 'version': 1, 'recordBytes': RECORD.itemsize,
        'revision': job['revision'], 'sourceRevision': job['sourceRevision'], 'id': job['id'], 'variant': job['variant'],
        'role': job['role'], 'sourceSize': job['sourceSize'], 'orthoScale': render['orthoScale'], 'elevation': job['elevation'],
        'masterCount': job['masterCount'], 'complete': len(stats) == job['masterCount'], 'sampled': [s['index'] for s in stats],
        'file': 'glow-points.bin', 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'records': len(records),
        'frames': frames,
        'arms': [{'arm': a.index, 'object': a.ob.name, 'cups': len(a.cups), 't': a.t_reference} for a in arms],
        'parameters': {'minVis': MIN_VIS, 'mergePx': MERGE_PX, 'maxPoints': MAX_POINTS, 'rimShare': RIM_SHARE,
                       'vis': 'share of 5 downward rays (middle of the cup footprint seen from above + its 4 outermost points along '
                              'and across the cup, pulled to rimShare) whose first rendered hit is the same cup',
                       'anchor': 'mean of those hit locations (x/y projected like socketFrames, z in Blender units)'},
        'stats': {'points': len(records), 'maxPerFrame': max(counts, default=0),
                  'maxFrame': stats[counts.index(max(counts))]['index'] if counts else None,
                  'meanPerFrame': round(sum(counts) / max(1, len(counts)), 2), 'emptyFrames': sum(c == 0 for c in counts),
                  'merged': sum(s['merged'] for s in stats), 'capped': sum(s['capped'] for s in stats)},
        'frameStats': stats, 'provenance': job['provenance'], 'helperHashes': job['helperHashes']})
    if digest(source / 'asset.blend') != job['provenance']['blend']: raise ValueError('Source changed')


if __name__ == '__main__':
    main()
