"""Verify a bomber material revision against the previous saved Blender asset.

Run in background Blender with -- --before <variant-dir> --after <variant-dir>
--report <new-report.json>. Material changes must preserve every evaluated pose.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import sys

import bpy


def digest(values):
    return hashlib.sha256(struct.pack(f'<{len(values)}f', *values)).hexdigest()


def snapshot(folder):
    manifest = json.loads((folder / 'render.json').read_text(encoding='utf-8'))
    bpy.ops.wm.open_mainfile(filepath=str(folder / 'asset.blend'))
    scene = next(scene for scene in bpy.data.scenes if scene.get('inputHash') == manifest['inputHash'])
    bpy.context.window.scene = scene
    samples = []
    for frame in manifest['frames']:
        time = frame['blenderFrame']
        scene.frame_set(int(time), subframe=time % 1)
        deps = bpy.context.evaluated_depsgraph_get()
        meshes, presentation = {}, {}
        for ob in scene.objects:
            evaluated = ob.evaluated_get(deps)
            transform = [value for row in evaluated.matrix_world for value in row]
            if ob.type == 'MESH':
                mesh = evaluated.to_mesh()
                try:
                    vertices = [value for vertex in mesh.vertices for value in vertex.co]
                    topology = [index for poly in mesh.polygons for index in (len(poly.vertices), *poly.vertices)]
                    meshes[ob.name] = [digest(transform + vertices), topology, ob.hide_render]
                finally:
                    evaluated.to_mesh_clear()
            elif ob.type in ('CAMERA', 'LIGHT', 'EMPTY'):
                data = [ob.type, transform]
                if ob.type == 'CAMERA':
                    data += [ob.data.type, ob.data.ortho_scale]
                elif ob.type == 'LIGHT':
                    data += [ob.data.type, ob.data.energy, list(ob.data.color), ob.data.size]
                presentation[ob.name] = data
        samples.append({'meshes': meshes, 'presentation': presentation})
    return {
        'id': manifest['id'],
        'framing': {key: manifest[key] for key in ('forward', 'pivot', 'targetSize', 'sourceSizes', 'orthoScale')},
        'clips': manifest['clips'], 'sockets': manifest['socketFrames'], 'samples': samples,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for option in ('before', 'after', 'report'):
        parser.add_argument('--' + option, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    before, after = snapshot(Path(args.before)), snapshot(Path(args.after))
    assert before['id'] == after['id'] == 'bomber-drone-body'
    for key in before:
        assert before[key] == after[key], f'Material revision changed {key}'
    report = {'status': 'passed', 'before': args.before, 'after': args.after,
              'poses': len(after['samples']), 'meshesPerPose': len(after['samples'][0]['meshes']),
              'checks': ['evaluated_meshes_and_transforms', 'camera_lights_and_controls',
                         'framing', 'clip_timing_and_samples', 'sockets']}
    with Path(args.report).open('x', encoding='utf-8') as handle:
        json.dump(report, handle, indent=2)
        handle.write('\n')
    print(json.dumps(report), flush=True)


if __name__ == '__main__':
    main()
