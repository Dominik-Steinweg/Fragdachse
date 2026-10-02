"""Weapon union policy regression, no Blender process/import and no output files."""
import ast
from pathlib import Path
from types import SimpleNamespace as NS
import unittest
import numpy as np
from mesh_shadow_weapon import (weapon_budget, reference_views, compare_views, quantized_roundtrip,
                                silhouette_sheet, raster, VIEWS, weapon_candidate_plan, evaluate_weapon_batch)


def box(x0, y0, x1, y1, z0=0, z1=1):
    p = np.array([[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],
                  [x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]], float)
    t = np.array([[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],
                  [1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]], int)
    return p, t


def join(*parts):
    offset, p, t = 0, [], []
    for points, triangles in parts:
        p.append(points); t.append(triangles+offset); offset += len(points)
    return np.concatenate(p), np.concatenate(t)


class WeaponChecks(unittest.TestCase):
    def test_hidden_cartridges_do_not_require_independent_proxy_geometry(self):
        body = box(-5,-10,5,10,0,4)
        source = join(body, *[box(-2,-8+i,2,-7.5+i,1,2) for i in range(16)])
        refs = reference_views(*source)
        report, masks = compare_views(*body, refs)
        self.assertTrue(report['passed']); self.assertEqual(report['minimumIou'], 1)
        self.assertEqual(len(report['rows']), len(VIEWS))
        png, layout = silhouette_sheet(refs, masks)
        self.assertEqual(png[:8], b'\x89PNG\r\n\x1a\n')
        self.assertGreater(layout['width'], 0)

    def test_missing_long_thin_barrel_fails_even_when_iou_is_high(self):
        body = box(-6,-6,6,6,0,1)
        source = join(body, box(-.3,-12,.3,-5,0,1))
        report, _ = compare_views(*body, reference_views(*source))
        top = report['rows'][0]
        self.assertGreater(top['iou'], .95)
        self.assertGreater(top['missingBeyondTolerancePixels'], 0)
        self.assertFalse(report['passed'])

    def test_global_convex_hull_would_destroy_the_grip_opening(self):
        source = join(box(-5,-5,-3,5), box(3,-5,5,5), box(-5,3,5,5))
        report, _ = compare_views(*box(-5,-5,5,5), reference_views(*source))
        self.assertFalse(report['passed'])
        self.assertGreater(report['rows'][0]['extraBeyondTolerancePixels'], 0)

    def test_budget_scales_with_size_not_decorative_object_count(self):
        small = box(-2,-2,2,2)[0]; large = box(-5,-18,5,18)[0]
        a, b = weapon_budget(small), weapon_budget(large)
        self.assertLess(a['baseVertices'], b['baseVertices'])
        self.assertEqual(weapon_budget(np.concatenate([small]*100)), a)
        self.assertLessEqual(weapon_budget(large*100)['maxVertices'], 1600)
        self.assertEqual(b['maxTriangles'], b['maxVertices']*2)

    def test_thin_weapon_gets_reserve_and_finer_voxels_without_relaxing_gate(self):
        budget=weapon_budget(box(-8,-16,8,2)[0])
        plan=weapon_candidate_plan(budget)
        self.assertLess(budget['baseVertices'],budget['maxVertices'])
        coarse=[p for p in plan if p['voxelWorld']==.075]
        self.assertEqual(coarse[0]['vertexLimit'],budget['baseVertices'])
        self.assertEqual(coarse[-1]['vertexLimit'],1600)
        self.assertLess(plan[-1]['voxelWorld'],.075)
        self.assertTrue(all(p['vertexLimit']<=1600 and max(p['fractions'])<=1 for p in plan))
        # Even the finer schedule must still reject the same missing thin barrel.
        body=box(-6,-6,6,6);source=join(body,box(-.3,-12,.3,-5))
        report,_=compare_views(*body,reference_views(*source));self.assertFalse(report['passed'])

    def test_batch_continues_after_first_and_middle_errors(self):
        weapons=[dict(render=dict(id='held-'+str(i))) for i in range(28)]
        seen,recorded=[],[]
        def export(w):
            asset=w['render']['id'];seen.append(asset)
            if asset in ('held-0','held-7'):raise ValueError('strict silhouette gate')
            return dict(id=asset,vertexCount=10,triangleCount=12,audit=dict(qualityReport=dict(file='qa.json')))
        meshes,report=evaluate_weapon_batch(weapons,export,recorded.append)
        self.assertEqual(len(seen),28);self.assertEqual(len(recorded),28)
        self.assertEqual(report['failed'],2);self.assertEqual(report['passed'],26);self.assertEqual(len(meshes),26)
        self.assertEqual(report['rows'][-1]['status'],'passed')
        self.assertTrue(all('error' in r for r in report['rows'] if r['status']=='failed'))
        def stop(_):raise KeyboardInterrupt()
        with self.assertRaises(KeyboardInterrupt):evaluate_weapon_batch(weapons,stop)

    def test_union_raster_winding_order_and_quantization(self):
        p, t = box(-2,-4,2,4)
        refs = reference_views(p,t)
        report, _ = compare_views(quantized_roundtrip(p), np.concatenate([t[::-1,::-1],t]), refs)
        self.assertTrue(report['passed'])
        with self.assertRaises(ValueError):
            raster(np.array([[0,0],[10,0],[0,10]]), np.array([[0,1,2]]), [0,0,1,1])

    def test_actual_union_adapter_settings_cleanup_and_source_immutability(self):
        tree = ast.parse(Path(__file__).with_name('mesh_shadow_weapon_blender.py').read_text(encoding='utf8'))
        fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name=='voxel_union')
        calls, mod = [], NS()
        mesh = NS(from_pydata=lambda *a:calls.append('source-copy'),update=lambda:None)
        obj = NS(modifiers=NS(new=lambda *a:mod))
        bpy = NS(data=NS(meshes=NS(new=lambda *a:mesh,remove=lambda x:calls.append('remove-mesh')),
                         objects=NS(new=lambda *a:obj,remove=lambda *a,**k:calls.append('remove-object'))),
                 context=NS(view_layer=NS(update=lambda:None)))
        bm = NS(verts=[1,2,3],faces=[1],from_mesh=lambda m:None,to_mesh=lambda m:None,free=lambda:calls.append('free-bmesh'))
        bmesh = NS(new=lambda:bm,ops=NS(remove_doubles=lambda *a,**k:calls.append(('weld',k['dist'])),recalc_face_normals=lambda *a,**k:None))
        env = dict(bpy=bpy,bmesh=bmesh,np=np)
        exec(compile(ast.Module(body=[fn],type_ignores=[]),'<actual union adapter>','exec'),env)
        p,t=box(-1,-2,1,2);original=p.copy();parts=[dict(rest=p,sourceTris=t)]
        scene=NS(collection=NS(objects=NS(link=lambda o:None)))
        result=env['voxel_union'](scene,parts,.2,12,lambda o:(p,t,'signature'))
        self.assertEqual(mod.mode,'VOXEL');self.assertAlmostEqual(mod.voxel_size,.2/12)
        self.assertFalse(mod.use_remove_disconnected);self.assertEqual(mod.adaptivity,0)
        np.testing.assert_array_equal(p,original);np.testing.assert_array_equal(result[1],t)
        self.assertIn('free-bmesh',calls);self.assertEqual(calls[-2:],['remove-object','remove-mesh'])
        def fail(_): raise RuntimeError('evaluation failed')
        with self.assertRaises(RuntimeError):env['voxel_union'](scene,parts,.2,12,fail)
        self.assertEqual(calls[-2:],['remove-object','remove-mesh'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
