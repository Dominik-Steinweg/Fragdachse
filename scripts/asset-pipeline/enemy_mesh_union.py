"""Rest-only enemy union, bound back to original animated source triangles."""
import hashlib
import math
from types import SimpleNamespace
import bpy
import numpy as np
from mesh_shadow_blender import evaluated, fixed_proxy, bind
from mesh_shadow_weapon_blender import voxel_union


def shell(points, triangles, thickness):
    """Close thin fur cards before the volumetric rest approximation."""
    abc=points[triangles]
    face=np.cross(abc[:,1]-abc[:,0],abc[:,2]-abc[:,0])
    normals=np.zeros_like(points)
    for corner in range(3):np.add.at(normals,triangles[:,corner],face)
    normals/=np.maximum(np.linalg.norm(normals,axis=1,keepdims=True),1e-12)
    n=len(points)
    edges=np.concatenate([triangles[:,[0,1]],triangles[:,[1,2]],triangles[:,[2,0]]])
    _,first,count=np.unique(np.sort(edges,axis=1),axis=0,return_index=True,return_counts=True)
    boundary=edges[first[count==1]]
    caps=np.concatenate([np.c_[boundary[:,0],boundary[:,1],boundary[:,1]+n],
                         np.c_[boundary[:,0],boundary[:,1]+n,boundary[:,0]+n]])
    return np.concatenate([points+normals*thickness/2,points-normals*thickness/2]),np.concatenate([triangles,triangles[:,::-1]+n,caps])


def prepare_union(scene, sources, scale, anatomy, max_vertices, poses):
    volume=[];points=[];faces=[];offset=0;owners=[]
    legs=list(anatomy['limbs'])
    for p in sources:
        name=p['ob'].name;rest,tri=p['rest'],p['sourceTris']
        if 'fur' in name.lower() or 'coat' in name.lower():
            rest,tri=shell(rest,tri,.012)
        volume.append(dict(rest=rest,sourceTris=tri))
        points.append(p['rest']);faces.append(p['sourceTris']+offset)
        owner=0
        for i,leg in enumerate(legs):
            ob=p['ob']
            if name.startswith(leg) or ob.vertex_groups.get(leg) or ob.parent_bone==leg:
                owner=i+1;break
        owners.extend([owner]*len(p['rest']));offset+=len(p['rest'])
    union_points,union_faces=voxel_union(scene,volume,.08,scale,evaluated)
    placeholder=SimpleNamespace(name='Enemy rest volume union')
    candidate=dict(ob=placeholder,rest=union_points,sourceTris=union_faces,weight=1.,signature='rest-union')
    attempts=fixed_proxy(scene,[candidate],max_vertices*2-8,(1000,max_vertices,1,max_vertices*2))
    source_points,source_faces=np.concatenate(points),np.concatenate(faces)
    candidate.update(rest=source_points,sourceTris=source_faces,unionSources=sources,
                     signature=hashlib.sha256(''.join(p['signature'] for p in sources).encode()).hexdigest(),
                     sourceTriangleCleanup=dict(degenerateTriangles=0,duplicateTriangles=0),
                     sourceOwners=np.array(owners,dtype=np.int8),
                     unionAudit=dict(voxelWorld=.08,furShellBlender=.012,restVertices=len(union_points),
                                     sourceParts=[p['ob'].name for p in sources]))
    # Spend the remaining vertices on the edges which deform least faithfully.
    # One immutable refinement in rest space; all poses share these new identities.
    bind(candidate)
    triangles=candidate['triangles']
    edges=np.unique(np.sort(np.concatenate([triangles[:,[0,1]],triangles[:,[1,2]],triangles[:,[2,0]]]),axis=1),axis=0)
    snapped=(source_points[candidate['binding']]*candidate['weights'][:,:,None]).sum(1)
    midpoint=(snapped[edges[:,0]]+snapped[edges[:,1]])/2
    middle=dict(ob=placeholder,rest=source_points,sourceTris=source_faces,proxy=midpoint)
    bind(middle)
    error=np.zeros(len(edges))
    for pose in poses:
        frame=pose['blenderFrame'];scene.frame_set(math.floor(frame),subframe=frame%1);bpy.context.view_layer.update()
        positions,_,_=sample_union(candidate)
        vertices=(positions[candidate['binding']]*candidate['weights'][:,:,None]).sum(1)
        actual=(positions[middle['binding']]*middle['weights'][:,:,None]).sum(1)
        linear=(vertices[edges[:,0]]+vertices[edges[:,1]])/2
        error=np.maximum(error,np.linalg.norm(actual-linear,axis=1))
    scene.frame_set(0);bpy.context.view_layer.update()
    remaining=max_vertices-len(candidate['proxy'])
    ranked=np.argsort(-error,kind='stable')[:remaining]
    vertices=candidate['proxy'].tolist();faces=candidate['triangles'].tolist()
    for edge_index in ranked:
        a,b=edges[edge_index];new=len(vertices)
        point=(source_points[middle['binding'][edge_index]]*middle['weights'][edge_index,:,None]).sum(0)
        vertices.append(point.tolist());refined=[]
        for face in faces:
            replaced=False
            for corner in range(3):
                x,y,z=face[corner],face[(corner+1)%3],face[(corner+2)%3]
                if {x,y}=={int(a),int(b)}:
                    refined.extend([[x,new,z],[new,y,z]]);replaced=True;break
            if not replaced:refined.append(face)
        faces=refined
    candidate['proxy']=np.array(vertices);candidate['triangles']=np.array(faces,dtype=np.int32)
    candidate['unionAudit']['deformationRefinement']=dict(addedVertices=len(ranked),evaluatedPoses=len(poses),
        maximumPreRefinementDeviationWorld=float(error.max()*scale),method='split highest nonlinear source-binding error edges once in rest space')
    return candidate,attempts


def sample_union(part):
    arrays=[]
    for source in part['unionSources']:
        points,_,signature=evaluated(source['ob'])
        if signature!=source['signature'] or len(points)!=len(source['rest']):
            raise ValueError('Animated union source topology changed: '+source['ob'].name)
        arrays.append(points)
    return np.concatenate(arrays),None,part['signature']


def leg_triangles(part, leg_index):
    # Barycentric source triangles never cross object ownership. A face is admitted
    # only when all of its proxy vertices belong to the torso or this same leg.
    owner=part['sourceOwners'][part['binding'][:,0]]
    allowed=(owner==0)|(owner==leg_index+1)
    return part['triangles'][np.all(allowed[part['triangles']],axis=1)]
