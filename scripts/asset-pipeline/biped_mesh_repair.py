"""Source-only biped hip repair. The original Blend and distal feet/hands stay untouched.

Explicit references are passed by fresh recipes; archived sources are resolved only
after their selected Blend hash has been checked by the caller.
"""
import bpy
import math
import numpy as np
from mathutils import Vector
from mesh_shadow_blender import evaluated


def anatomy(scene):
    body = scene.objects.get('Balanced pelvis and torso')
    pelvis = scene.objects.get('Pelvis')
    torso = scene.objects.get('Standing torso')
    rig = scene.objects.get('Locomotion rig')
    if not body or not pelvis or not torso or not rig or not rig.pose.bones.get('mantle'):
        raise ValueError('Unsupported archived biped anatomy')
    legs = {}
    for side in ('left_leg', 'right_leg'):
        matches = [o for o in scene.objects if o.type == 'MESH'
                   and o.name.split('.')[0] == 'Upright hind leg' and o.vertex_groups.get(side)]
        if len(matches) != 1:
            raise ValueError('Missing or ambiguous upper leg: ' + side)
        legs[side] = matches[0]
    return dict(body=body, cores=[pelvis, torso], rig=rig, legs=legs)


def repair(a):
    """Mantle already follows the pelvis in WORLD space, including the jump parent.

    Blend only the proximal part of each upper leg. Vertices below .44 BE retain
    the exact old limb transform; feet and their vertex groups are not touched.
    """
    follow = a['rig'].pose.bones['mantle']
    if not any(c.type == 'COPY_TRANSFORMS' and c.target == a['body']
               and c.owner_space == c.target_space == 'WORLD' for c in follow.constraints):
        raise ValueError('Pelvis follow constraint differs from the pinned rig')
    records = []
    for side, ob in a['legs'].items():
        if ob.vertex_groups.get('mantle'):
            raise ValueError('Source already contains proximal weighting')
        moving = ob.vertex_groups.new(name='mantle')
        limb = ob.vertex_groups[side]
        changed = 0
        for vertex in ob.data.vertices:
            z = (ob.matrix_world @ vertex.co).z
            t = min(1., max(0., (z - .44) / .30))
            weight = t*t*(3-2*t)
            if weight:
                moving.add([vertex.index], weight, 'REPLACE')
                limb.add([vertex.index], 1-weight, 'REPLACE')
                changed += 1
        ob['FD_BipedHipRepair'] = 'pelvis-follow proximal weights v1'
        records.append(dict(object=ob.name, leg=side, changedVertices=changed,
                            unchangedBelowZBlender=.44, fullBodyWeightAboveZBlender=.74))
    bpy.context.view_layer.update()
    return records


def anchors(a):
    result = {}
    inverse = a['body'].matrix_world.inverted()
    for side, leg in a['legs'].items():
        p, _, _ = evaluated(leg)
        # Both anchors are inside the declared volumes, frozen before repairing.
        center = p.mean(0)
        start = np.array([center[0], -.26, .87])
        result[side] = dict(bodyLocal=list(inverse @ Vector(start)))
    return result


def sample(a, frozen, scale):
    conversion = np.array([scale, -scale, scale])
    cores = []
    for ob in a['cores']:
        p, t, _ = evaluated(ob)
        cores.append((p*conversion, t))
    result = {}
    for side, leg in a['legs'].items():
        p, t, _ = evaluated(leg)
        surfaces=cores+[(p*conversion, t)]
        if side in a.get('transitions',{}):
            bridge,faces,_=evaluated(a['transitions'][side]);surfaces.append((bridge*conversion,faces))
        result[side] = dict(start=np.array(a['body'].matrix_world @ Vector(frozen[side]['bodyLocal']))*conversion,
                            end=p.mean(0)*conversion, surfaces=surfaces)
    return result


def add_transitions(scene,a,times,before,scale):
    """Closed source sleeves between the frozen body/leg interiors; never join feet.
    Absolute keys persist every original and quarter sample in the source Blend.
    """
    ordered=sorted(zip(times,before),key=lambda row:row[0]['frame'])
    sides=12;faces=[]
    for ring in range(2):
        for j in range(sides):
            x,y=ring*sides+j,ring*sides+(j+1)%sides
            faces.extend([(x,y,y+sides),(x,y+sides,x+sides)])
    for j in range(sides):faces.extend([(36,(j+1)%sides,j),(37,24+j,24+(j+1)%sides)])
    a['transitions']={}
    for side,leg in a['legs'].items():
        samples=[]
        for time,old in ordered:
            start,end=[old[side][key]/[scale,-scale,scale] for key in ('start','end')]
            axis=end-start;axis/=np.linalg.norm(axis)
            cross=np.cross(axis,[0.,0.,1.])
            if np.linalg.norm(cross)<.1:cross=np.cross(axis,[0.,1.,0.])
            cross/=np.linalg.norm(cross);up=np.cross(axis,cross);vertices=[]
            for t in (0.,.5,1.):
                center=start*(1-t)+end*t
                for j in range(sides):
                    angle=j*2*math.pi/sides;vertices.append(center+.155*(math.cos(angle)*cross+math.sin(angle)*up))
            samples.append(np.array([*vertices,start,end]))
        mesh=bpy.data.meshes.new(side+' hip transition');mesh.from_pydata(samples[0].tolist(),[],faces);mesh.update()
        ob=bpy.data.objects.new(side+' closed hip transition',mesh);scene.collection.objects.link(ob)
        for material in leg.data.materials:mesh.materials.append(material)
        for polygon in mesh.polygons:polygon.use_smooth=True
        ob['FD_BipedHipTransition']=side
        for index,((time,_),positions) in enumerate(zip(ordered,samples)):
            key=ob.shape_key_add(name=f'phase_{index:03d}');key.data.foreach_set('co',positions.ravel());key.interpolation='KEY_LINEAR'
            keys=mesh.shape_keys;keys.use_relative=False;keys.eval_time=key.frame;keys.keyframe_insert('eval_time',frame=time['frame'])
        for layer in mesh.shape_keys.animation_data.action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    for curve in bag.fcurves:
                        for point in curve.keyframe_points:point.interpolation='LINEAR'
        a['transitions'][side]=ob
    scene.frame_set(0);bpy.context.view_layer.update()
    return dict(radiusBlender=.155,verticesPerHip=38,trianglesPerHip=72,samples=len(ordered),objects=[o.name for o in a['transitions'].values()])

