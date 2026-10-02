"""Pure NumPy contract checks; no Blender, renders or filesystem outputs."""
import unittest
import numpy as np
from enemy_mesh_corridor import segment_coverage, missing_intervals, project, corridor_metric


class CorridorChecks(unittest.TestCase):
    def test_union_winding_and_open_gap(self):
        # Two disconnected rectangles; the open slit is connected to the exterior.
        tri = np.array([[[0, -1], [1, -1], [1, 1]], [[0, -1], [1, 1], [0, 1]],
                        [[2, -1], [3, -1], [3, 1]], [[2, -1], [3, 1], [2, 1]]], float)
        coverage = segment_coverage([0, 0], [3, 0], tri)
        np.testing.assert_allclose(coverage, [[0, 1/3], [2/3, 1]])
        np.testing.assert_allclose(segment_coverage([0, 0], [3, 0], tri[:, ::-1]), coverage)
        np.testing.assert_allclose(missing_intervals(coverage), [[1/3, 2/3]])
        bridge = np.array([[[.9, -1], [2.1, -1], [2.1, 1]], [[.9, -1], [2.1, 1], [.9, 1]]])
        self.assertEqual(segment_coverage([0, 0], [3, 0], np.concatenate([tri, bridge])), [[0., 1.]])

    def test_degenerate_and_parallel_edges(self):
        tri = np.array([[[0, 0], [0, 0], [0, 0]], [[0, -1], [2, -1], [0, 1]]])
        self.assertEqual(segment_coverage([0, 3], [1, 3], tri), [])
        self.assertEqual(segment_coverage([0, 0], [1, 0], tri), [[0., 1.]])

    def test_ground_clamp_and_jump(self):
        points = np.array([[0, 0, -2], [0, 0, 2], [0, 0, 5]])
        np.testing.assert_allclose(project(points, 0, 45), [[0, 0], [-2, 0], [-5, 0]], atol=1e-12)
        with self.assertRaises(ValueError):
            project(points, 0, 0)

    def test_world_units_and_frozen_corridor(self):
        p = np.array([[0, -1, 0], [1, -1, 0], [1, 1, 0], [0, 1, 0],
                      [2, -1, 0], [3, -1, 0], [3, 1, 0], [2, 1, 0]], float)
        t = np.array([[0, 1, 2], [0, 2, 3], [4, 5, 6], [4, 6, 7]])
        result = corridor_metric([0, 0, 0], [3, 0, 0], [(p, t)], 0, 90)
        self.assertAlmostEqual(result['maxGapWorld'], 1.)
        self.assertAlmostEqual(result['missingAreaWorld2'], .5)
        self.assertTrue(result['endpointsCovered'])


if __name__ == '__main__':
    unittest.main()
