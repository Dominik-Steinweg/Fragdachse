"""Static-only union adapter. Never changes the animated body or source objects."""
import bpy
import bmesh
import numpy as np


def voxel_union(scene, parts, voxel_world, scale, evaluate):
    points, triangles, offset = [], [], 0
    for part in parts:
        points.extend(part['rest'].tolist())
        triangles.extend((part['sourceTris']+offset).tolist())
        offset += len(part['rest'])
    mesh = bpy.data.meshes.new('FD_static_weapon_union')
    obj = bpy.data.objects.new('FD_static_weapon_union', mesh)
    scene.collection.objects.link(obj)
    try:
        mesh.from_pydata(points, [], triangles)
        # Evaluated bevel/material seams may have coincident but disconnected
        # vertices. Close those seams before constructing the volume, not by
        # increasing the minimum geometry budget of each decorative object.
        bm = bmesh.new()
        try:
            bm.from_mesh(mesh)
            bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=voxel_world/scale*1e-4)
            bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
            bm.to_mesh(mesh)
        finally:
            bm.free()
        mesh.update()
        mod = obj.modifiers.new('Static shadow volume union', 'REMESH')
        mod.mode, mod.voxel_size = 'VOXEL', voxel_world/scale
        mod.use_remove_disconnected = False  # retain barrels, rails and separate meaningful tips
        mod.adaptivity = 0.0
        bpy.context.view_layer.update()
        result, faces, _ = evaluate(obj)
        if not len(faces):
            raise ValueError('Static weapon voxel union is empty')
        return result, faces
    finally:
        bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.meshes.remove(mesh)
