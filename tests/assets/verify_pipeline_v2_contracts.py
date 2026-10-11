"""Small behavioural checks in Blender's Python; no rendering or source mutation.

Run with Blender --background --python-exit-code 1 --python <this file>.
The ordinary asset suite exercises the matching JavaScript contracts and packing.
"""
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts/asset-pipeline'))
from contracts_v2 import validate_clips, validate_extensions
from pose_validation_v2 import assert_clip_boundary
from pose_validation_v2 import validate_animation
import motions_v2


def state(value):
    return dict(geometry={'mesh': ((value,), (0,))}, bones={'bone': (value,)}, properties={(0, 'location', 0): value})


class PipelineContracts(unittest.TestCase):
    def test_markers_and_author_phases(self):
        clip = dict(name='rise', motion='fixture', frameCount=4, frameRate=12, loop=False,
                    start='free', end='free', next='hover', markers={'release': 3, 'lift': 0})
        hover = dict(name='hover', motion='fixture', frameCount=4, frameRate=12, loop=True, markers={'pulse': 3})
        validate_clips([clip, hover])
        calls = []
        with patch.object(motions_v2, 'apply', side_effect=lambda *args, **kwargs: calls.append((args, kwargs))):
            frames, exported = motions_v2.author(dict(parts={}, rig=None), [clip, hover])
        self.assertEqual(calls[0][1]['parameters']['markerPhases'], {'lift': 0, 'release': 1})
        self.assertEqual(calls[4][1]['parameters']['markerPhases'], {'pulse': .75})
        self.assertEqual(exported[0]['next'], 'hover')
        self.assertEqual(exported[0]['start'], 'free')
        self.assertEqual(exported[0]['markers'], clip['markers'])
        self.assertEqual(len(frames), 9)  # Loop closure is not exported.
        claw = dict(clip, name='claw', end='rest', markers={'impact': 2, 'strike': 1})
        claw.pop('next')
        validate_clips([claw])
        self.assertAlmostEqual(motions_v2.clip_parameters(claw)['strikePhase'], 1 / 3)
        self.assertAlmostEqual(motions_v2.clip_parameters(claw)['impactPhase'], 2 / 3)
        for change in ({'markers': {'lift': 1, 'release': 1}}, {'markers': {'Lift': 0}}, {'markers': {'lift': True}},
                       {'markers': {'lift': 4}}, {'markers': None}, {'end': 'terminal'}, {'next': 'missing'}):
            with self.assertRaises(ValueError):
                validate_clips([dict(clip, **change), hover])

    def test_boundaries_compare_evaluated_poses(self):
        clip = dict(name='rise', loop=False, end='free', next='hover', timelineStart=1, frames=[1, 2], frameRate=24)
        target = dict(clip, name='hover', timelineStart=10)
        assert_clip_boundary(clip, [clip, target], state(0), state(-1), state(1), lambda frame: state(1))
        with self.assertRaises(AssertionError):
            assert_clip_boundary(clip, [clip, target], state(0), state(-1), state(1), lambda frame: state(2))
        for end in ('free', 'terminal'):
            free = dict(clip, end=end); free.pop('next')
            assert_clip_boundary(free, [free], state(0), state(-1), state(1), None)
        rest = dict(clip, end='rest'); rest.pop('next')
        with self.assertRaises(AssertionError):
            assert_clip_boundary(rest, [rest], state(0), state(0), state(1), None)
        assert_clip_boundary(rest, [rest], state(0), state(1), state(1e-7), None)
        with self.assertRaises(AssertionError):
            assert_clip_boundary(dict(rest, start='rest'), [rest], state(0), state(1), state(0), None)
        loop = dict(rest, loop=True)
        assert_clip_boundary(loop, [loop], state(0), state(1), state(2), lambda frame: state(1))
        with self.assertRaises(AssertionError):
            assert_clip_boundary(loop, [loop], state(0), state(1), state(2), lambda frame: state(0))

    def test_lazy_specific_dispatch_and_unknown_motion(self):
        asset = dict(parts={}, rig=None)
        for prefix, module, function in (
            ('kraken_land_', 'kraken_motion_land_v2', 'apply_kraken_land'),
            ('kraken_tentacle_', 'kraken_tentacle_motion_v2', 'apply_kraken_tentacle'),
            ('kraken_egg_', 'kraken_egg_motion_v2', 'apply_kraken_egg')):
            calls = []
            with patch.object(motions_v2.importlib, 'import_module', return_value=types.SimpleNamespace(**{function: lambda *args: calls.append(args)})) as loader:
                motions_v2.apply(asset, prefix + 'fixture', .25, 3, parameters={'markerPhases': {'release': .25}})
            loader.assert_called_once_with(module)
            self.assertEqual(calls[0][5]['markerPhases'], {'release': .25})
        for motion in ('kraken_unknown_fixture', 'kraken_land_unknown_fixture', 'kraken_egg_unknown_fixture'):
            with self.assertRaisesRegex(ValueError, 'Unknown'):
                motions_v2.apply(asset, motion, 0, 0)

    def test_boss_extensions(self):
        spec = dict(category='boss-part', targetSize=64, sourceSizes=[128], runtimeContract='boss', runtimeAtlas=True,
                    runtimeBudgetMB=16, elevation=dict(min=-2, max=3))
        validate_extensions(spec)
        for change in ({'runtimeAtlas': False}, {'runtimeBudgetMB': 0}, {'elevation': {'min': 2, 'max': 2}},
                       {'elevation': {'min': -1, 'max': 2, 'scale': 0}}):
            with self.assertRaises(ValueError):
                validate_extensions(dict(spec, **change))

    def test_boss_part_preflight_requires_moving_weighted_meshes_without_eyes(self):
        import bpy
        import blender_pipeline as shared
        import rigs_v2
        previous = bpy.context.window.scene
        scene = shared.make_scene('Pipeline contract fixture', 2)
        try:
            bpy.ops.mesh.primitive_cube_add(size=.3)
            mesh = bpy.context.object
            asset = rigs_v2.model(scene)
            rig = rigs_v2.limb_rig(scene, asset, {'limb': ((0, 0, 0), [mesh])})
            bone = rig.pose.bones['limb']
            for frame, x in ((0, 0), (1, 0), (2, .1), (3, .2)):
                motions_v2.key(bone, 'location', (x, 0, 0), frame)
            clip = dict(name='rise', loop=False, end='free', timelineStart=1, frames=[1, 2, 3], frameRate=24)
            frames = [dict(blenderFrame=i) for i in range(4)]
            self.assertEqual(asset['sockets'], {})
            validate_animation(scene, asset, {'category': 'boss-part'}, [clip], frames)
            rig.animation_data_clear()
            bone.location = (0, 0, 0)
            with self.assertRaisesRegex(AssertionError, 'no visible geometric movement'):
                validate_animation(scene, asset, {'category': 'boss-part'}, [clip], frames)
            mesh.modifiers.clear()
            with self.assertRaisesRegex(AssertionError, 'rig and weighted meshes'):
                validate_animation(scene, asset, {'category': 'boss-part'}, [clip], frames)
        finally:
            bpy.context.window.scene = previous
            bpy.data.scenes.remove(scene)


if __name__ == '__main__':
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(PipelineContracts))
    if not result.wasSuccessful():
        raise RuntimeError('Pipeline V2 contract checks failed')
