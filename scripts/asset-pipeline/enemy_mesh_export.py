"""Enemy-only geometry export from a verified staged source. Never renders/imports.

The source-rig repair is deliberately opt-in; source and corrected geometry can be
diagnosed before spending render time. Failed gap gates retain diagnostic evidence
on D: but never write an acceptance receipt.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
import time
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy
import bmesh
import numpy as np
from mesh_shadow_geometry import select_source_scene
from mesh_shadow_blender import candidates, fixed_proxy, bind, evaluated, emit, part_audit
from enemy_mesh_anatomy import (legacy_anatomy, freeze_anchors, follow_body, sample_anatomy,
                                contact_anchors, FOLLOW_BONE, LEGS, add_transitions)
from enemy_mesh_corridor import compare_sample
from enemy_mesh_union import prepare_union, sample_union, leg_triangles


def write_json(file, value):
    with Path(file).open('x', encoding='utf8') as stream:
        json.dump(value, stream, indent=2, allow_nan=False)
        stream.write('\n')


def set_frame(scene, frame):
    scene.frame_set(math.floor(frame), subframe=frame % 1)
    bpy.context.view_layer.update()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--job', required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    job_file = Path(args.job).resolve()
    job = json.loads(job_file.read_text(encoding='utf8'))
    output = job_file.parent
    root = Path(job['outputRoot']).resolve()
    if output.parent != root or root.parent != Path('D:/Fragdachse-render').resolve() or not root.name.startswith('enemy-mesh-'):
        raise ValueError('Enemy export must stay in the declared D: revision')
    for member, expected in job['sourceFiles'].items():
        file = (output / member).resolve()
        if not file.is_relative_to(output) or hashlib.sha256(file.read_bytes()).hexdigest() != expected:
            raise ValueError('Enemy input hash/path changed: ' + member)
    cached_source = None
    if job.get('reuseSourceReview'):
        revision = job['reuseSourceReview']
        if not revision.startswith('enemy-mesh-') or any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789-' for c in revision):
            raise ValueError('Invalid source review revision')
        prior = root.parent/revision/job['id']
        prior_job = json.loads((prior/'job.json').read_text(encoding='utf8'))
        for member in ('source.blend', 'source-render.json', 'source-pilot.json',
                       'source-tools/enemy_mesh_anatomy.py', 'source-tools/enemy_mesh_corridor.py',
                       'source-tools/mesh_shadow_blender.py'):
            if (prior_job['sourceFiles'][member] != job['sourceFiles'][member]
                or hashlib.sha256((prior/member).read_bytes()).hexdigest() != job['sourceFiles'][member]):
                raise ValueError('Source review cache does not match immutable inputs: '+member)
        if any(prior_job[k] != job[k] for k in ('reviewSamples','coordinates','pilot','poses')):
            raise ValueError('Cached source review differs in anatomy, scale or sampled times')
        cached_source = json.loads((prior/'corridors.json').read_text(encoding='utf8'))
        prior_manifest = json.loads((prior/'mesh-manifest.json').read_text(encoding='utf8'))
        if (cached_source['samples'] != 118 or cached_source['flaggedAfter']
            or prior_manifest['blenderVersion'] != bpy.app.version_string):
            raise ValueError('Incomplete or incompatible cached source review')
        cached_source['reusedSourceReview'] = dict(revision=revision,
            reportSha256=hashlib.sha256((prior/'corridors.json').read_bytes()).hexdigest(),
            reason='identical source, repair/evaluation/checker code, Blender version, anatomy, poses and intermediate samples; only shadow approximation changes')
    render = job['render']; started = time.monotonic()
    bpy.ops.wm.open_mainfile(filepath=str(output/'source.blend'), load_ui=False)
    scene = select_source_scene(bpy.data.scenes, render['inputHash'], job['id'])
    bpy.context.window.scene = scene
    if (scene.camera.data.type != 'ORTHO' or any(abs(v) > 1e-7 for v in scene.camera.rotation_euler)
        or abs(scene.camera.data.ortho_scale - render['orthoScale']) > 1e-5):
        raise ValueError('Enemy source camera changed')
    set_frame(scene, 0)
    anatomy = legacy_anatomy(scene, job['pilot'])
    anchors = freeze_anchors(anatomy)
    scale = job['coordinates']['worldPxPerBlenderUnit']
    rest_heights = {name: float(evaluated(anatomy['limbs'][name]['foot'])[0][:, 2].min()) for name in LEGS}
    changed = follow_body(anatomy)
    transitions = add_transitions(scene, anatomy, anchors, job['reviewSamples'])
    constraint = anatomy['rig'].pose.bones[FOLLOW_BONE].constraints[0]
    parts, excluded = candidates(scene, .075)
    # Surface decoration consumes hundreds of disconnected minimum-budget parts
    # without defining anatomy. Keep it in Beauty and in the full QA reference,
    # but spend the shadow budget on body, paws, claws and outer fur instead.
    decorative_prefixes = ('Curved aged copper suture', 'Dry irregular stain',
        'Flattened exposed muscle', 'Old exposed tissue fold', 'Raised cloth fold',
        'Sunken stitched scar')
    kept = []
    for part in parts:
        if part['ob'].name.startswith(decorative_prefixes) or 'rough toe pad' in part['ob'].name:
            excluded.append(dict(object=part['ob'].name, reason='interior surface decoration; retained in full silhouette QA'))
        else:
            # Dense open fur ribbons should not starve the continuous core mesh.
            if 'fur' in part['ob'].name.lower() or 'coat' in part['ob'].name.lower():
                part['weight'] *= .3
            kept.append(part)
    parts = kept
    # Source transition topology is protected from simplification. It is visible
    # Beauty geometry, and its endpoints must survive the lower shadow budget.
    sleeves = [p for p in parts if p['ob'].get('FD_EnemyTransition')]
    ordinary = [p for p in parts if p not in sleeves]
    # The middle ring is exactly the average of the end rings in every authored
    # shape key. Omit that redundant ring and triangulate each convex cap using
    # its boundary. This is the same closed volume with 24 rather than 38 vertices.
    sleeve_vertices = 24*len(sleeves)
    # Dense fur is many tiny disconnected ribbons. Collapsing those independently
    # produces sparse scraps instead of its outer coat. Use a closed rest envelope
    # for explicitly named coat patches; bind its vertices back to the real fur.
    # Paws, claws and equipment keep their own surfaces and natural separations.
    original_triangles = {}
    for part in ordinary:
        name = part['ob'].name
        if ('fur' in name.lower() or 'body coat' in name.lower()) and 'ruff' not in name.lower():
            split_coat = job['id'] == 'rabid-badger' and 'body coat' in name.lower()
            clusters = [np.arange(len(part['rest']))]
            if split_coat:
                # Rabid's pelt has a narrow waist and separated haunches. A single
                # convex hull bridges those natural recesses. Overlapping local
                # rest patches preserve them without adding per-pose topology.
                clusters = []
                low, high = part['rest'].min(0), part['rest'].max(0)
                step = (high-low)/[3,6,1]
                for x in range(3):
                    for y in range(6):
                        lo = low[:2]+step[:2]*[x,y]-step[:2]*.12
                        hi = low[:2]+step[:2]*[x+1,y+1]+step[:2]*.12
                        subset = np.flatnonzero(np.all(part['rest'][:,:2]>=lo,axis=1)&np.all(part['rest'][:,:2]<=hi,axis=1))
                        if len(subset)>=4:clusters.append(subset)
            faces = []
            for subset in clusters:
                bm = bmesh.new()
                for vertex in part['rest'][subset]:bm.verts.new(vertex)
                bmesh.ops.convex_hull(bm, input=list(bm.verts), use_existing_faces=False)
                bmesh.ops.triangulate(bm, faces=list(bm.faces));bm.verts.index_update()
                faces.extend([[int(subset[v.index]) for v in f.verts] for f in bm.faces])
                bm.free()
            triangles = np.array(faces,dtype=np.int32)
            original_triangles[name] = part['sourceTris']
            part['coatEnvelope'] = .99 if split_coat else .97
            part['coatClusters'] = len(clusters)
            part['sourceTris'] = triangles
            part['weight'] *= 4 if split_coat else 2
    attempts = fixed_proxy(scene, ordinary, 3250, (1000-sleeve_vertices, 2000-sleeve_vertices, 1, 4000-288))
    for part in ordinary:
        if part['ob'].name in original_triangles:
            part['sourceTris'] = original_triangles[part['ob'].name]
    for p in sleeves:
        p['proxy'] = p['rest'][np.r_[0:12,24:36]]
        faces=[]
        for j in range(12):
            k=(j+1)%12;faces.extend([[j,k,k+12],[j,k+12,j+12]])
        for j in range(1,11):faces.extend([[0,j+1,j],[12,12+j,12+j+1]])
        p['triangles'] = np.array(faces,dtype=np.int32)
        p['proxyTriangleCleanup'] = p['sourceTriangleCleanup']
    if job['id'] == 'rabid-badger':
        union, attempts = prepare_union(scene, ordinary, scale, anatomy, 2000-sleeve_vertices, job['poses'])
        ordinary = [union]
        # Union first makes the anatomical triangle subsets use zero-based indices.
        parts = ordinary + sleeves
    offset, indices, part_indices = 0, [], {}
    for part in parts:
        bind(part)
        indices.extend((part['triangles'] + offset).tolist())
        part_indices[part['ob'].name] = part['triangles'] + offset
        offset += len(part['proxy'])
    indices = np.asarray(indices, np.int32)
    bounds = {}
    for part in parts:
        bounds[part['ob'].name] = [len(part['rest']), part['signature']]
    def current_proxy():
        arrays = []
        for part in parts:
            positions, _, signature = sample_union(part) if part.get('unionSources') else evaluated(part['ob'])
            if [len(positions), signature] != bounds[part['ob'].name]:
                raise ValueError('Enemy topology changes with pose: ' + part['ob'].name)
            transferred = (positions[part['binding']] * part['weights'][:, :, None]).sum(axis=1)
            if part.get('coatEnvelope'):
                # The outer tips of sparse ribbons overestimate the opaque coat.
                # A 3% inset removes that hull bias; continuous anatomy remains
                # independently represented and every final silhouette is gated.
                center = positions.mean(0)
                transferred = center + (transferred-center)*part['coatEnvelope']
            arrays.append(transferred * [scale, -scale, scale])
        return np.concatenate(arrays)
    before_poses, after_poses, frozen_samples, contacts, rows, repair_bounds = {}, {}, {}, [], [], {}
    untouched = [o for o in scene.objects if o.type == 'MESH' and not o.hide_render
                 and o.name not in changed+transitions['objects']]
    review_samples = [s for s in job['reviewSamples'] if s['exported']] if cached_source else job['reviewSamples']
    for sample in review_samples:
        set_frame(scene, sample['blenderFrame'])
        constraint.influence = 0; bpy.context.view_layer.update()
        before = sample_anatomy(anatomy, anchors, scale, transitions=False)
        fingerprints = {o.name: hashlib.sha256(evaluated(o)[0].tobytes()).hexdigest() for o in untouched}
        repair_points = [evaluated(scene.objects[n])[0] for n in changed]
        if sample['exported']:
            before_poses[sample['index']] = current_proxy()
            frozen_samples[sample['index']] = before
        constraint.influence = 1; bpy.context.view_layer.update()
        after = sample_anatomy(anatomy, anchors, scale)
        for ob in untouched:
            if hashlib.sha256(evaluated(ob)[0].tobytes()).hexdigest() != fingerprints[ob.name]:
                raise ValueError('Unrelated geometry changed: '+ob.name)
        result = [] if cached_source else compare_sample(before, after)
        rows.extend(dict(sampleId=sample['sampleId'], **row) for row in result)
        if sample['exported']:
            repair_points += [evaluated(scene.objects[n])[0] for n in changed+transitions['objects']]
            repair_bounds[sample['index']] = [dict(min=p.min(0).tolist(), max=p.max(0).tolist()) for p in repair_points]
            after_poses[sample['index']] = current_proxy()
            contacts.append(contact_anchors(anatomy, sample['index'], scale, rest_heights))
        print('FD_ENEMY_SAMPLE '+json.dumps(dict(asset=job['id'], sample=sample['sampleId'],
              before=sum(r['flaggedBefore'] for r in result), after=sum(r['flaggedAfter'] for r in result))), flush=True)
    report = cached_source or dict(schema='fd-enemy-attachment-review', version=1, samples=len(job['reviewSamples']),
                  probes=len(rows), anchors=anchors, changedObjects=changed, transitions=transitions,
                  untouchedObjectsVerified=len(untouched),
                  flaggedBefore=sum(r['flaggedBefore'] for r in rows), flaggedAfter=sum(r['flaggedAfter'] for r in rows),
                  maximumGapBefore=max(r['before']['maxGapWorld'] for r in rows),
                  maximumGapAfter=max(r['after']['maxGapWorld'] for r in rows), rows=rows)
    write_json(output/'corridors.json', report)
    audit = dict(method='rest-decimation/source-triangle-barycentric-skinning', attempts=attempts, excluded=excluded,
                 parts=part_audit(parts, scale), repair='proximal body weights and closed source muscle transitions',
                 coatEnvelopes=[dict(object=p['ob'].name, scale=p['coatEnvelope'],clusters=p['coatClusters']) for p in parts if p.get('coatEnvelope')],
                 restUnion=[p['unionAudit'] for p in parts if p.get('unionSources')])
    mesh = emit(output, job['id'], np.stack([after_poses[i] for i in range(31)]), indices, list(range(31)), audit)
    # Gates inspect the actual emitted U16 values, not just in-memory float geometry.
    encoded = np.frombuffer((output/mesh['positions']['file']).read_bytes(), dtype='<u2').reshape(31, -1, 3)
    low, high = np.array(mesh['bounds']['min']), np.array(mesh['bounds']['max'])
    decoded = low + encoded / 65535. * (high-low)
    proxy_rows = []
    for pose, points in enumerate(decoded):
        original = frozen_samples[pose]
        proxy = {}
        for leg_index, name in enumerate(LEGS):
            if ordinary[0].get('unionSources'):
                tri = np.concatenate([leg_triangles(ordinary[0],leg_index),part_indices[anatomy['limbs'][name]['transition'].name]])
                proxy[name] = dict(surfaces=[(points,tri)])
                continue
            names = [ob.name for ob in anatomy['cores']] + [anatomy['limbs'][name][k].name for k in ('upper', 'transition')]
            if any(n not in part_indices for n in names):
                raise ValueError('Proxy omitted an anatomical core')
            proxy[name] = dict(surfaces=[(points, np.concatenate([part_indices[n] for n in names]))])
        proxy_rows.extend(dict(pose=pose, **row) for row in compare_sample(original, proxy))
    proxy_report = dict(probes=len(proxy_rows), flaggedAfter=sum(r['flaggedAfter'] for r in proxy_rows),
                        maximumGapAfter=max(r['after']['maxGapWorld'] for r in proxy_rows), rows=proxy_rows)
    write_json(output/'proxy-corridors.json', proxy_report)
    old_indices = np.concatenate([part_indices[p['ob'].name] for p in ordinary])
    np.savez_compressed(output/'before-review.npz', positions=np.stack([before_poses[i] for i in range(31)]), indices=old_indices)
    write_json(output/'repair-bounds.json', repair_bounds)
    write_json(output/'bindings.json', {p['ob'].name: dict(sourceTriangles=p['binding'].tolist(),
               weights=p['weights'].tolist()) for p in parts})
    manifest = dict(schema='fd-projected-enemy-mesh', version=1, id=job['id'], revision=job['revision'],
                    status='diagnostic', coordinates=job['coordinates'], poses=job['poses'],
                    mesh=mesh, contacts=sorted(contacts, key=lambda c:c['pose']), sourceFiles=job['sourceFiles'],
                    contactPolicy=dict(reference='rest evaluated foot minimum Z', restFootHeightsBlender=rest_heights,
                                       fadeWorldPx=1.5, gameplayAuthority=False),
                    gapReport='corridors.json', geometrySeconds=time.monotonic()-started,
                    blenderVersion=bpy.app.version_string)
    write_json(output/'mesh-manifest.json', manifest)
    set_frame(scene, 0)
    bpy.data.libraries.write(str(output/'candidate.blend'), {scene}, fake_user=True, compress=True)
    if report['flaggedAfter'] or proxy_report['flaggedAfter']:
        raise ValueError('Source attachments still fail; candidate is diagnostic, not render/import ready')
    # Passing corridors is not acceptance of the full silhouette or Beauty.
    write_json(output/'geometry-receipt.json', dict(status='source-and-proxy-corridors-passed',
               pending=['silhouette-review', 'beauty-material-renders', 'visual-review']))


if __name__ == '__main__':
    main()
