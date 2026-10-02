"""Regression checks for the actual binding math, with no bpy/Blender process."""
import ast
import json
from pathlib import Path
import unittest
from types import SimpleNamespace
import numpy as np
from mesh_shadow_geometry import clean_triangles, triangle_binding, select_source_scene


class GeometryChecks(unittest.TestCase):
    def test_tiny_valid_triangles_do_not_hit_absolute_denominator_cutoff(self):
        for scale in [1e-9, 1e-6, 1., 1e6]:
            with self.subTest(scale=scale):
                triangle = np.array([[0., 0, 0], [1, 0, 0], [0, 1, 0]]) * scale
                triangles, audit = clean_triangles(triangle, [[0, 1, 2]])
                self.assertEqual(audit['outputTriangles'], 1)
                weights, distance = triangle_binding(np.array([.2, .3, 4])*scale, triangle)
                np.testing.assert_allclose(weights, [.5, .2, .3], atol=1e-12)
                self.assertAlmostEqual(distance/scale, 4)

    def test_zero_area_skinny_and_repeated_faces_are_removed(self):
        points = np.array([[0., 0, 0], [1, 0, 0], [0, 1, 0], [2, 0, 0], [1, 1e-10, 0]])
        triangles, audit = clean_triangles(points, [[0, 1, 3], [0, 0, 2], [0, 1, 4], [0, 1, 2], [2, 1, 0]])
        np.testing.assert_array_equal(triangles, [[0, 1, 2]])
        self.assertEqual(audit, dict(inputTriangles=5, degenerateTriangles=3, duplicateTriangles=1, outputTriangles=1))

    def test_source_vertex_identities_are_not_welded(self):
        points = np.array([[0., 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 0]])
        triangles, _ = clean_triangles(points, [[0, 1, 2], [3, 1, 2]])
        np.testing.assert_array_equal(triangles, [[0, 1, 2], [3, 1, 2]])
        moved = points.copy(); moved[3, 2] = 5
        self.assertNotEqual(moved[triangles[0, 0], 2], moved[triangles[1, 0], 2])

    def test_skinny_valid_triangle_has_bounded_affine_weights(self):
        triangle = np.array([[0., 0, 0], [1, 0, 0], [1, 5e-7, 0]]) * 1e-5
        point = np.array([.2, .3, .5]) @ triangle + [0, 0, 1e-5]
        weights, _ = triangle_binding(point, triangle)
        np.testing.assert_allclose(weights, [.2, .3, .5], atol=1e-10)
        moved = triangle @ np.array([[2, 0, 0], [0, 3, 0], [0, 0, 1]]) + [1, 2, 3]
        np.testing.assert_allclose(weights @ moved, np.array([.2, .3, .5]) @ moved)

    def test_outside_projection_uses_nearest_edge_or_vertex(self):
        triangle = np.array([[0., 0, 0], [1, 0, 0], [0, 1, 0]])
        for point, expected in [([1, 1, 3], [0, .5, .5]), ([-1, -1, 0], [1, 0, 0]), ([.2, -.5, 2], [.8, .2, 0])]:
            weights, _ = triangle_binding(point, triangle)
            np.testing.assert_allclose(weights, expected, atol=1e-12)
            self.assertTrue(np.all(weights >= 0))
            self.assertAlmostEqual(float(weights.sum()), 1)

    def test_invalid_and_empty_geometry_is_explicit(self):
        points = np.array([[0., 0, 0], [1, 0, 0], [2, 0, 0]])
        triangles, audit = clean_triangles(points, [[0, 1, 2]])
        self.assertEqual(triangles.shape, (0, 3)); self.assertEqual(audit['degenerateTriangles'], 1)
        self.assertEqual(clean_triangles(points, [])[0].shape, (0, 3))
        with self.assertRaises(ValueError):
            triangle_binding([0, 0, 0], points)
        with self.assertRaises(ValueError):
            clean_triangles(points, [[0, 1, 3]])
        points[0, 0] = np.nan
        with self.assertRaises(ValueError):
            clean_triangles(points, [[0, 1, 2]])

    def test_library_startup_scene_is_not_selected(self):
        empty = {'name': 'Scene'}
        source = {'inputHash': 'source', 'asset_manifest': json.dumps({'id': 'held-glock'})}
        self.assertIs(select_source_scene([empty, source], 'source', 'held-glock'), source)
        for scenes, asset in [([empty], 'held-glock'), ([source, source.copy()], 'held-glock'), ([source], 'badger')]:
            with self.assertRaises(ValueError):
                select_source_scene(scenes, 'source', asset)

    def test_exporter_bind_filters_bvh_and_preserves_original_indices(self):
        # Execute the actual exporter function, isolating only Blender's BVH service.
        # This exercises the previous failure site without importing bpy or rendering.
        tree = ast.parse(Path(__file__).with_name('mesh_shadow_blender.py').read_text(encoding='utf8'))
        function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'bind')
        calls = []

        class Bvh:
            @staticmethod
            def FromPolygons(points, triangles, all_triangles):
                calls.append(triangles)
                return SimpleNamespace(find_nearest=lambda point: (None, None, 0, None))

        env = dict(np=np, BVHTree=Bvh, Vector=lambda point: point,
                   clean_triangles=clean_triangles, triangle_binding=triangle_binding)
        exec(compile(ast.Module(body=[function], type_ignores=[]), '<actual exporter bind>', 'exec'), env)
        part = dict(ob=SimpleNamespace(name='tiny Glock bevel'), rest=np.array([[0., 0, 0], [1e-6, 0, 0], [0, 1e-6, 0]]),
                    sourceTris=np.array([[0, 0, 1], [0, 1, 2], [2, 1, 0]]), proxy=np.array([[.2e-6, .3e-6, 1e-6]]))
        env['bind'](part)
        self.assertEqual(calls, [[[0, 1, 2]]])
        np.testing.assert_array_equal(part['binding'], [[0, 1, 2]])
        np.testing.assert_allclose(part['weights'], [[.5, .2, .3]], atol=1e-12)
        self.assertAlmostEqual(part['maxRestSnapBlender'], 1e-6)


if __name__ == '__main__':
    unittest.main(verbosity=2)
