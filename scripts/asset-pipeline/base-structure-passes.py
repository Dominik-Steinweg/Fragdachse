"""Runtime passes of the persistent base fort, split into the built structure and its ground layer.

Usage: blender --background --factory-startup --python base-structure-passes.py -- job.json
job = lobby-structure-passes job + {part: structure|ground}

The fort's ground objects (`fdGround`: worn paths, moss, wear marks, pebbles, rubble) are translucent
layers that the game draws over its own build-area gravel, below figures; the structure (decks,
stakes, posts, lights) stands in the structure band above them. One recipe build serves both: this
wrapper hides the other part after the model loads and then runs the lobby structure passes
unchanged (beauty, albedo, elevation, emission layers, solid mask, sockets).
"""
import sys
sys.dont_write_bytecode = True
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import importlib.util
import json

definition = importlib.util.spec_from_file_location('lobby_structure_passes', Path(__file__).with_name('lobby-structure-passes.py'))
passes = importlib.util.module_from_spec(definition)
definition.loader.exec_module(passes)
load_model = passes.draft.model


def model(job):
    scene, asset, cached = load_model(job)
    ground = job['part'] == 'ground'
    for ob in scene.objects:
        if ob.type == 'MESH':
            ob.hide_render = bool(ob.get('fdGround')) != ground
    return scene, asset, cached


if __name__ == '__main__':
    passes.draft.model = model
    passes.render(json.loads(Path(sys.argv[sys.argv.index('--') + 1]).read_text(encoding='utf8')))
