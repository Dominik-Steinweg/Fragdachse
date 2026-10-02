"""22a: geometry only. Decimate REST meshes once; bind proxy vertices to source triangles.

Every animation sample evaluates the ORIGINAL skinning/modifiers, then transfers their
positions through the fixed barycentric bindings. No per-frame decimation or rendering.
Only the runner's copied .blend files are opened. No blend file is ever saved.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
import time
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mesh_shadow_geometry import clean_triangles, triangle_binding, select_source_scene
from mesh_shadow_weapon import (weapon_budget, reference_views, compare_views, quantized_roundtrip,
                                silhouette_sheet, weapon_candidate_plan, evaluate_weapon_batch, DENSITY, MIN_IOU, EDGE_TOLERANCE_PIXELS)
from mesh_shadow_weapon_blender import voxel_union


def digest(data):
    return hashlib.sha256(data).hexdigest()


def save(root, name, data):
    (root / name).parent.mkdir(parents=True, exist_ok=True)
    with (root / name).open('xb') as f:
        f.write(data)
    return dict(file=name, bytes=len(data), sha256=digest(data))


def evaluated(ob):
    obj = ob.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = obj.to_mesh()
    try:
        co = np.empty(len(mesh.vertices) * 3, np.float64)
        mesh.vertices.foreach_get('co', co)
        matrix = np.array(obj.matrix_world)
        co = co.reshape(-1, 3) @ matrix[:3, :3].T + matrix[:3, 3]
        # Polygon loops, not pose-dependent ngon tessellation, define source identities.
        loops = np.empty(len(mesh.loops), np.int32)
        mesh.loops.foreach_get('vertex_index', loops)
        counts = np.empty(len(mesh.polygons), np.int32)
        mesh.polygons.foreach_get('loop_total', counts)
        signature = digest(loops.tobytes() + counts.tobytes())
        mesh.calc_loop_triangles()
        tris = np.empty(len(mesh.loop_triangles) * 3, np.int32)
        mesh.loop_triangles.foreach_get('vertices', tris)
        return co, tris.reshape(-1, 3), signature
    finally:
        obj.to_mesh_clear()


def open_source(root, role, job):
    filename = root / ('source-' + role + '.blend')
    if digest(filename.read_bytes()) != job['sourceFiles'][filename.name]:
        raise ValueError('Changed source blend')
    bpy.ops.wm.open_mainfile(filepath=str(filename), load_ui=False)
    render = job[role]['render']
    # Library .blends may initially activate an empty startup scene. Select the
    # archived asset explicitly by provenance, never rely on that startup scene.
    scene = select_source_scene(bpy.data.scenes, render['inputHash'], render['id'])
    if bpy.context.window is None:
        raise ValueError('No Blender window context to select source scene')
    bpy.context.window.scene = scene
    if (scene.camera is None or scene.camera.data.type != 'ORTHO' or any(abs(v) > 1e-7 for v in scene.camera.rotation_euler)
            or abs(scene.camera.data.ortho_scale - render['orthoScale']) > 1e-5):
        raise ValueError('Source projection changed')
    scene.frame_set(0)
    bpy.context.view_layer.update()
    meshes = [ob for ob in scene.objects if ob.type == 'MESH' and not ob.hide_render]
    if bpy.context.scene != scene or not meshes:
        raise ValueError('Selected source scene is inactive or contains no caster meshes')
    print('FD_MESH_SCENE ' + json.dumps(dict(role=role, asset=render['id'], scene=scene.name,
                                           visibleMeshObjects=len(meshes))), flush=True)
    return scene


def candidates(scene, minimum_diagonal):
    parts, excluded = [], []
    for ob in sorted(scene.objects, key=lambda o: o.name):
        if ob.type != 'MESH' or ob.hide_render:
            continue
        points, tris, signature = evaluated(ob)
        if not len(tris):
            continue
        extent = points.max(0) - points.min(0)
        if np.linalg.norm(extent) < minimum_diagonal:
            excluded.append(dict(object=ob.name, reason='subpixel detail', diagonalBlender=float(np.linalg.norm(extent))))
            continue
        tris, cleanup = clean_triangles(points, tris)
        if cleanup['degenerateTriangles'] or cleanup['duplicateTriangles']:
            print('FD_MESH_CLEANUP ' + json.dumps(dict(object=ob.name, stage='source-rest', **cleanup)), flush=True)
        if not len(tris):
            excluded.append(dict(object=ob.name, reason='no nondegenerate surface triangles', cleanup=cleanup))
            continue
        abc = points[tris]
        area = np.linalg.norm(np.cross(abc[:, 1]-abc[:, 0], abc[:, 2]-abc[:, 0]), axis=1).sum() / 2
        parts.append(dict(ob=ob, rest=points, sourceTris=tris, signature=signature,
                          sourceTriangleCleanup=cleanup, weight=float(area)**.7))
    if not parts:
        raise ValueError('No proxy source geometry')
    return parts, excluded


def simplify(scene, part, triangle_budget):
    mesh = bpy.data.meshes.new('FD_proxy_rest')
    mesh.from_pydata(part['rest'].tolist(), [], part['sourceTris'].tolist())
    mesh.update()
    ob = bpy.data.objects.new('FD_proxy_rest', mesh)
    scene.collection.objects.link(ob)
    try:
        mod = ob.modifiers.new('Rest-only collapse', 'DECIMATE')
        mod.ratio = min(1., max(4, triangle_budget) / len(part['sourceTris']))
        mod.use_collapse_triangulate = True
        bpy.context.view_layer.update()
        points, triangles, _ = evaluated(ob)
        triangles, part['proxyTriangleCleanup'] = clean_triangles(points, triangles)
        cleanup = part['proxyTriangleCleanup']
        if cleanup['degenerateTriangles'] or cleanup['duplicateTriangles']:
            print('FD_MESH_CLEANUP ' + json.dumps(dict(object=part['ob'].name, stage='decimated-rest', **cleanup)), flush=True)
        if not len(triangles):
            raise ValueError('Rest decimation removed entire surface: ' + part['ob'].name)
        # Remove unused proxy vertices in deterministic ascending index order.
        used, inverse = np.unique(triangles.reshape(-1), return_inverse=True)
        return points[used], inverse.reshape(-1, 3)
    finally:
        bpy.data.objects.remove(ob, do_unlink=True)
        bpy.data.meshes.remove(mesh)


def fixed_proxy(scene, parts, target, limits):
    weight = sum(p['weight'] for p in parts)
    attempts = []
    for _ in range(7):
        for p in parts:
            p['proxy'], p['triangles'] = simplify(scene, p, max(8, round(target * p['weight'] / weight)))
        vertices = sum(len(p['proxy']) for p in parts)
        triangles = sum(len(p['triangles']) for p in parts)
        attempts.append(dict(target=target, vertices=vertices, triangles=triangles))
        if limits[0] <= vertices <= limits[1] and limits[2] <= triangles <= limits[3]:
            return attempts
        if vertices > limits[1] or triangles > limits[3]:
            target *= min(limits[1] / vertices, limits[3] / triangles) * .94
        else:
            target *= max(limits[0] / max(vertices, 1), limits[2] / max(triangles, 1)) * 1.06
    raise ValueError('Proxy cannot meet budget; inspect source part counts: ' + json.dumps(attempts))


def bind(part):
    source, tris = part['rest'], part['sourceTris']
    # Defense in depth: no degenerate face may enter BVH nearest-surface queries.
    tris, part['bindingTriangleCleanup'] = clean_triangles(source, tris)
    if not len(tris):
        raise ValueError('No bindable source surface: ' + part['ob'].name)
    tree = BVHTree.FromPolygons(source.tolist(), tris.tolist(), all_triangles=True)
    bindings, weights, errors = [], [], []
    for point in part['proxy']:
        _, _, index, _ = tree.find_nearest(Vector(point))
        if index is None:
            raise ValueError('Unbound proxy vertex: ' + part['ob'].name)
        tri = tris[index]
        try:
            barycentric, distance = triangle_binding(point, source[tri])
        except ValueError as error:
            raise ValueError(f"Binding failed on {part['ob'].name}, source indices {tri.tolist()}: {error}") from error
        bindings.append(tri); weights.append(barycentric); errors.append(distance)
    part['binding'] = np.array(bindings, np.int32)
    part['weights'] = np.array(weights)
    part['maxRestSnapBlender'] = float(max(errors))


def part_audit(parts, scale):
    return [dict(object=p['ob'].name, sourceVertexCount=len(p['rest']), sourceTopologySha256=p['signature'],
                 proxyVertices=len(p['proxy']), maxRestSnapWorld=p['maxRestSnapBlender']*scale,
                 sourceTriangleCleanup=p['sourceTriangleCleanup'], proxyTriangleCleanup=p['proxyTriangleCleanup'],
                 bindingTriangleCleanup=p['bindingTriangleCleanup']) for p in parts]


def hand_sources(parts):
    result = {}
    for name, sign in [('left', -1), ('right', 1)]:
        choices = [p for p in parts if p['ob'].get('motionRole') == 'grip'
                   and float(p['ob'].matrix_world.translation.x) * sign > 0]
        if not choices:
            raise ValueError('Source lacks explicit grip-role geometry for ' + name)
        # Recipe marks paw and small thumb as grip. The largest volume is the paw.
        result[name] = max(choices, key=lambda p: float(np.prod(p['rest'].max(0)-p['rest'].min(0))))['ob']
    return result


def socket(ob, scale):
    matrix = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()).matrix_world
    conversion = np.diag([1., -1., 1.])
    rotation = conversion @ np.array(matrix.to_quaternion().to_matrix()) @ conversion
    position = np.array(matrix.translation) * [scale, -scale, scale]
    return dict(position=position.tolist(), rotationMatrix=rotation.reshape(-1).tolist(),
                yaw=float(math.atan2(rotation[1, 0], rotation[0, 0])), sourceObject=ob.name)


def bake(scene, parts, frames, scale, origin=None, hands=None):
    for p in parts:
        bind(p)
    samples, sockets = [], []
    offset, indices = 0, []
    for p in parts:
        indices.extend((p['triangles']+offset).tolist())
        offset += len(p['proxy'])
    for f in frames:
        value = f['blenderFrame']
        scene.frame_set(math.floor(value), subframe=value % 1)
        bpy.context.view_layer.update()
        pose = []
        for p in parts:
            points, _, signature = evaluated(p['ob'])
            if signature != p['signature'] or len(points) != len(p['rest']):
                raise ValueError('Animated source changes vertex identities: ' + p['ob'].name)
            transferred = (points[p['binding']] * p['weights'][:, :, None]).sum(axis=1)
            if origin is not None:
                transferred -= origin
            pose.append(transferred * [scale, -scale, scale])
        samples.append(np.concatenate(pose))
        if hands:
            entry = dict(pose=f['index'], **{name: socket(ob, scale) for name, ob in hands.items()})
            # This pilot uses the real right palm; no legacy runtime XY/Z offset.
            entry['weapon'] = dict(entry['right'], mount='right-palm')
            sockets.append(entry)
        print('FD_MESH_POSE ' + str(f['index']), flush=True)
    return np.stack(samples), np.asarray(indices, np.int32), sockets


def emit(root, asset_id, samples, triangles, pose_indices, audit):
    if not np.isfinite(samples).all() or len(samples[0]) >= 65536:
        raise ValueError('Invalid mesh data')
    lo, hi = samples.min(axis=(0, 1)), samples.max(axis=(0, 1))
    span = np.where(hi > lo, hi-lo, 1)
    quantized = np.rint((samples-lo)/span*65535).clip(0, 65535).astype('<u2')
    indices = triangles.astype('<u2').tobytes()
    pb = quantized.tobytes()
    p = save(root, 'meshes/' + asset_id + '-positions-' + digest(pb)[:16] + '.bin', pb)
    i = save(root, 'meshes/' + asset_id + '-indices-' + digest(indices)[:16] + '.bin', indices)
    i['encoding'] = 'uint16-le-triangles'
    return dict(id=asset_id, encoding='uint16-le-xyz-bounds', bounds=dict(min=lo.tolist(), max=hi.tolist()),
                vertexCount=len(samples[0]), triangleCount=len(triangles), poseIndices=pose_indices,
                positions=p, indices=i, topologySha256=i['sha256'], downloadBytes=len(pb)+len(indices),
                gpuFloat32Bytes=samples.size*4+len(indices), quantizationMaxErrorWorld=((hi-lo)/65535/2).tolist(), audit=audit)


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--job', required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    job_file = Path(args.job).resolve(); root = job_file.parent
    job = json.loads(job_file.read_text(encoding='utf8'))
    if root.parent != Path(job['outputRoot']).resolve():
        raise ValueError('Export outside declared output root')
    started = time.monotonic()
    scene = open_source(root, 'body', job)
    parts, excluded = candidates(scene, .075)
    hands = hand_sources(parts)
    attempts = fixed_proxy(scene, parts, 3100, (1000, 2000, 2000, 4000))
    scale = 38.4 / 2.2
    samples, triangles, sockets = bake(scene, parts, job['body']['render']['frames'], scale, hands=hands)
    audit = dict(method='rest-decimation/source-triangle-barycentric-skinning', attempts=attempts, excluded=excluded,
                 parts=part_audit(parts, scale))
    # Bindings are authoring evidence, not runtime download.
    bindings = dict(parts=[dict(object=p['ob'].name, sourceTriangles=p['binding'].tolist(), weights=p['weights'].tolist()) for p in parts])
    save(root, 'proxy-bindings.json', (json.dumps(bindings)+'\n').encode())
    body = emit(root, 'badger', samples, triangles, list(range(37)), audit)
    def export_one(weapon):
        role = weapon.get('role', 'weapon')
        job[role] = weapon
        return export_weapon(root, job, role, weapon)
    def record(row):
        save(root, 'weapon-batch/'+row['asset']+'.json', (json.dumps(row, indent=2)+'\n').encode())
        print('FD_WEAPON_RESULT '+json.dumps({k: v for k, v in row.items() if k != 'traceback'}), flush=True)
    held_meshes, batch = evaluate_weapon_batch(job.get('weapons', [job['weapon']]), export_one, record)
    batch['revision'] = job['revision']
    save(root, 'weapon-batch-report.json', (json.dumps(batch, indent=2)+'\n').encode())
    if batch['failed']:
        raise ValueError('Weapon batch complete: '+str(batch['passed'])+' passed, '+str(batch['failed'])+' failed: '+
                         ', '.join(r['asset'] for r in batch['rows'] if r['status']=='failed')+'; see weapon-batch-report.json')
    manifest = dict(schema='fd-projected-character-mesh', version=1, status='pilot-unreviewed', revision=job['revision'],
                    coordinates=job['coordinates'], poses=job['poses'], sockets=sockets, meshes=[body] + held_meshes,
                    sourceFiles=job['sourceFiles'], blenderVersion=bpy.app.version_string,
                    geometryWallSeconds=time.monotonic()-started)
    name = 'mesh-base-manifest.json' if job.get('production') else 'mesh-manifest.json'
    save(root, name, (json.dumps(manifest, indent=2)+'\n').encode())
    print('FD_MESH_COMPLETE ' + json.dumps(dict(seconds=manifest['geometryWallSeconds'], vertices=body['vertexCount'], triangles=body['triangleCount'])), flush=True)


def export_weapon(root, job, role, weapon):
    scene = open_source(root, role, job)
    render = weapon['render']; scale = 38.4 / render['orthoScale']
    # These are explicit controls authored by held-weapon.py, checked against the 2D contract.
    controls = {}
    for name in ['grip', 'muzzle']:
        found = [o for o in scene.objects if o.type == 'EMPTY' and o.name.split('.')[0] == name]
        if len(found) != 1:
            raise ValueError('Missing unique authored weapon socket: ' + name)
        controls[name] = np.array(found[0].matrix_world.translation)
        ref = render['heldItem'][name]; expected = np.array([ref[0]-16, 16-ref[1]]) / 10
        if np.max(np.abs(controls[name][:2]-expected)) > 1e-5:
            raise ValueError('Held socket/reference projection mismatch')
    value = render['frames'][0]['blenderFrame']
    scene.frame_set(math.floor(value), subframe=value % 1)
    bpy.context.view_layer.update()
    # Static weapons do not need barycentric skinning or per-part minimum budgets.
    # Keep every nondegenerate source surface in the reference, including tiny details.
    parts, excluded = candidates(scene, 0)
    points, faces, offset = [], [], 0
    for part in parts:
        points.append(part['rest'])
        faces.append(part['sourceTris']+offset)
        offset += len(part['rest'])
    source = (np.concatenate(points)-controls['grip'])*[scale, -scale, scale]
    reference = reference_views(source, np.concatenate(faces))
    budget = weapon_budget(source)
    attempts, chosen, last_comparison = [], None, None
    # Refine voxel resolution if a thin feature disappears. Increase the shared
    # triangle budget for shape fidelity, never keep a floor for each cartridge.
    union, cached_voxel = None, None
    for stage in weapon_candidate_plan(budget):
        voxel_world, vertex_limit = stage['voxelWorld'], stage['vertexLimit']
        if union is None or voxel_world != cached_voxel:
            try:
                union_points, union_faces = voxel_union(scene, parts, voxel_world, scale, evaluated)
                union_faces, cleanup = clean_triangles(union_points, union_faces)
                if not len(union_faces):
                    raise ValueError('No nondegenerate union faces')
            except ValueError as error:
                union = None
                attempts.append(dict(voxelWorld=voxel_world, failure=str(error))); continue
            union = dict(rest=union_points, sourceTris=union_faces, ob=parts[0]['ob'])
            cached_voxel = voxel_world
        for fraction in stage['fractions']:
            target = vertex_limit*2*fraction
            try:
                for _ in range(4):
                    proxy, triangles = simplify(scene, union, target)
                    if len(proxy) <= vertex_limit and len(triangles) <= vertex_limit*2:
                        break
                    target *= min(vertex_limit/len(proxy), vertex_limit*2/len(triangles))*.97
            except ValueError as error:
                attempts.append(dict(voxelWorld=voxel_world, targetTriangles=target, failure=str(error))); continue
            row = dict(voxelWorld=voxel_world, vertexLimit=vertex_limit, targetTriangles=target, vertices=len(proxy), triangles=len(triangles))
            if len(proxy) > vertex_limit or len(triangles) > vertex_limit*2:
                row['failure'] = 'shared union budget'; attempts.append(row); continue
            positions = (proxy-controls['grip'])*[scale, -scale, scale]
            try:
                quality, masks = compare_views(quantized_roundtrip(positions), triangles, reference)
            except ValueError as error:
                row['failure'] = str(error); attempts.append(row); continue
            row.update(minimumIou=quality['minimumIou'], passed=quality['passed'])
            last_comparison = quality, masks
            if not quality['passed']:
                row['failedViews'] = [r for r in quality['rows'] if r['iou'] < MIN_IOU or r['missingBeyondTolerancePixels'] or r['extraBeyondTolerancePixels']]
            attempts.append(row)
            print('FD_WEAPON_UNION ' + json.dumps(dict(asset=render['id'], **row)), flush=True)
            if quality['passed']:
                chosen = positions, triangles, quality, masks
                break
        if chosen:
            break
    report = dict(asset=render['id'], method='static-voxel-union/adaptive-decimation-v3', budget=budget,
                  density=DENSITY, minIou=MIN_IOU, edgeTolerancePixels=EDGE_TOLERANCE_PIXELS,
                  sourceBoundsWorld=dict(min=source.min(0).tolist(), max=source.max(0).tolist()),
                  sourceVertices=len(source), sourceTriangles=sum(len(f) for f in faces), attempts=attempts,
                  sourceParts=[dict(object=p['ob'].name, vertices=len(p['rest']), triangles=len(p['sourceTris'])) for p in parts])
    if chosen is None:
        report['passed'] = False
        if last_comparison:
            quality, masks = last_comparison
            png, layout = silhouette_sheet(reference, masks)
            report.update(quality, image=save(root, 'weapon-quality/'+render['id']+'.png', png), layout=layout)
        save(root, 'weapon-quality/'+render['id']+'.json', (json.dumps(report, indent=2)+'\n').encode())
        raise ValueError('Weapon union failed silhouette/budget gate: '+render['id']+'; inspect weapon-quality report')
    positions, triangles, quality, masks = chosen
    png, layout = silhouette_sheet(reference, masks)
    image = save(root, 'weapon-quality/'+render['id']+'.png', png)
    report.update(quality, image=image, layout=layout)
    qa = save(root, 'weapon-quality/'+render['id']+'.json', (json.dumps(report, indent=2)+'\n').encode())
    held = emit(root, render['id'], positions[None, :, :], triangles, [0],
                dict(method=report['method'], excluded=excluded, attempts=attempts, qualityReport=qa))
    held['budget'] = budget
    held.update(grip=[0, 0, 0], muzzle=((controls['muzzle']-controls['grip'])*[scale, -scale, scale]).tolist(),
                beautyCanvasWorldPx=38.4, beautyGripUv=[v/32 for v in render['heldItem']['grip']],
                sourceGripBlender=controls['grip'].tolist(), sourceMuzzleBlender=controls['muzzle'].tolist())
    held['gameIds'] = weapon.get('gameIds', [])
    held['sourceRole'] = role
    print('FD_MESH_WEAPON ' + render['id'], flush=True)
    return held


if __name__ == '__main__':
    main()
