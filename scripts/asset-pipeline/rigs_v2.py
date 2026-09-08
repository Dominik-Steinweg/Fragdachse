"""Small explicit controls: object hierarchies for mechanisms, rigid bone weights for limbs."""
import bpy
from mathutils import Vector


def control(scene, name, location=(0, 0, 0), parent=None):
    ob = bpy.data.objects.new(name, None)
    scene.collection.objects.link(ob)
    ob.location = location
    if parent:
        ob.parent = parent
    return ob


def attach(objects, parent):
    bpy.context.view_layer.update()
    for ob in objects:
        world = ob.matrix_world.copy()
        ob.parent = parent
        ob.matrix_world = world


def model(scene, groups=None):
    root = control(scene, 'Asset root — fixed export pivot')
    meshes = [ob for ob in scene.objects if ob.type == 'MESH']
    attach(meshes, root)
    return {'root': root, 'parts': groups or {}, 'rig': None, 'sockets': {}}


def limb_rig(scene, asset, limbs):
    """Each limb receives a real bone and deterministic rigid weights; no auto weights."""
    armature = bpy.data.armatures.new('Locomotion controls')
    rig = bpy.data.objects.new('Locomotion rig', armature)
    scene.collection.objects.link(rig)
    rig.parent = asset['root']
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    base = armature.edit_bones.new('root')
    base.head, base.tail = (0, 0, 0), (0, .2, 0)
    for name, (pivot, objects) in limbs.items():
        bone = armature.edit_bones.new(name)
        bone.head, bone.tail = pivot, Vector(pivot) + Vector((0, .25, 0))
        bone.parent = base
    bpy.ops.object.mode_set(mode='OBJECT')
    for name, (_, objects) in limbs.items():
        for ob in objects:
            weights = ob.vertex_groups.new(name=name)
            weights.add(list(range(len(ob.data.vertices))), 1.0, 'REPLACE')
            modifier = ob.modifiers.new('Authored rigid limb', 'ARMATURE')
            modifier.object = rig
        rig.pose.bones[name].rotation_mode = 'XYZ'
    asset['rig'] = rig
    asset['parts']['limbs'] = list(limbs)
    return rig
