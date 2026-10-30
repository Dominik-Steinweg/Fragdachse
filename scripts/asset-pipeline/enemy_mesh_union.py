"""Rest-only enemy union, bound back to original animated source triangles."""
import hashlib
import math
from types import SimpleNamespace
import bpy
import numpy as np
from mathutils.kdtree import KDTree
from mesh_shadow_blender import evaluated, fixed_proxy, bind
from mesh_shadow_weapon_blender import voxel_union

VOXELS_ACROSS = 1200


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


def close_open(points, triangles):
    """Cap every open boundary loop with a fan to its centroid.

    A modelled open shell (a mushroom cap without underside, a raised plate) casts the shadow
    of the volume it encloses; voxel remeshing would turn the bare shell into a skin that the
    decimation then drops. Closed parts pass unchanged.
    """
    directed=np.concatenate([triangles[:,[0,1]],triangles[:,[1,2]],triangles[:,[2,0]]])
    key=np.sort(directed,axis=1)
    _,inverse,count=np.unique(key,axis=0,return_inverse=True,return_counts=True)
    boundary=directed[count[inverse.reshape(-1)]==1]
    if not len(boundary):
        return points,triangles
    following={int(a):int(b) for a,b in boundary}
    extra,caps,seen=[],[],set()
    for start in list(following):
        if start in seen:
            continue
        loop,vertex=[],start
        while vertex in following and vertex not in seen:
            seen.add(vertex);loop.append(vertex);vertex=following[vertex]
        if len(loop)<3:
            continue
        centre=len(points)+len(extra);extra.append(points[loop].mean(0))
        # Reverse the boundary direction so the cap continues the shell's winding.
        caps.extend((loop[(i+1)%len(loop)],loop[i],centre) for i in range(len(loop)))
    if not caps:
        return points,triangles
    return np.concatenate([points,np.array(extra)]),np.concatenate([triangles,np.array(caps,dtype=triangles.dtype)])


def prepare_union(scene, sources, scale, anatomy, max_vertices, poses):
    # Recipes may tag rigid props that swing away from the body (e.g. a shield) with
    # ob['meshUnionGroup']; each group gets its own rest volume and its proxy vertices
    # bind only to that group's source triangles, so the proxy never bridges parts that
    # separate in later poses. Untagged sources share one group (unchanged behaviour).
    names=sorted({str(p['ob'].get('meshUnionGroup','body')) for p in sources})
    volume={name:[] for name in names};points=[];faces=[];offset=0;owners=[];source_groups=[]
    legs=list(anatomy['limbs'])
    for p in sources:
        name=p['ob'].name;rest,tri=p['rest'],p['sourceTris']
        if 'fur' in name.lower() or 'coat' in name.lower():
            rest,tri=shell(rest,tri,.012)
        else:
            rest,tri=close_open(rest,tri)
        group=str(p['ob'].get('meshUnionGroup','body'))
        volume[group].append(dict(rest=rest,sourceTris=tri));source_groups.extend([names.index(group)]*len(p['rest']))
        points.append(p['rest']);faces.append(p['sourceTris']+offset)
        owner=0
        for i,leg in enumerate(legs):
            ob=p['ob']
            if name.startswith(leg) or ob.vertex_groups.get(leg) or ob.parent_bone==leg:
                owner=i+1;break
        owners.extend([owner]*len(p['rest']));offset+=len(p['rest'])
    # 0.08 world px up to ~96 px of extent; larger bodies (the 336-px Grave Titan) keep the same voxel count
    # across instead, or the sparse volume outgrows memory long before it could matter for a 2000-vertex proxy.
    every=np.concatenate([p['rest'] for p in sources])
    voxel_world=max(.08,float((every.max(0)-every.min(0))[:2].max())*scale/VOXELS_ACROSS)
    union_points,union_faces,union_groups,count=[],[],[],0
    for index,group in enumerate(names):
        group_points,group_faces=voxel_union(scene,volume[group],voxel_world,scale,evaluated)
        union_points.append(group_points);union_faces.append(group_faces+count);count+=len(group_points)
        union_groups.append(np.full(len(group_points),index,np.int32))
    union_points,union_faces,union_groups=np.concatenate(union_points),np.concatenate(union_faces),np.concatenate(union_groups)
    placeholder=SimpleNamespace(name='Enemy rest volume union')
    candidate=dict(ob=placeholder,rest=union_points,sourceTris=union_faces,weight=1.,signature='rest-union')
    attempts=fixed_proxy(scene,[candidate],max_vertices*2-8,(1000,max_vertices,1,max_vertices*2))
    source_points,source_faces=np.concatenate(points),np.concatenate(faces)
    candidate.update(rest=source_points,sourceTris=source_faces,unionSources=sources,
                     signature=hashlib.sha256(''.join(p['signature'] for p in sources).encode()).hexdigest(),
                     sourceTriangleCleanup=dict(degenerateTriangles=0,duplicateTriangles=0),
                     sourceOwners=np.array(owners,dtype=np.int8),
                     unionAudit=dict(voxelWorld=voxel_world,furShellBlender=.012,restVertices=len(union_points),unionGroups=names,
                                     sourceParts=[p['ob'].name for p in sources]))
    source_groups=np.array(source_groups,np.int32)
    if len(names)>1:
        # Decimation never joins components, so each connected proxy component keeps
        # the group of the rest union it came from. Vote per component: touching or
        # overlapping groups (a paw inside a grip strap) make single-vertex lookups ambiguous.
        nearest=KDTree(len(union_points))
        for i,point in enumerate(union_points):nearest.insert(point,i)
        nearest.balance()
        votes=np.array([union_groups[nearest.find(p)[1]] for p in candidate['proxy']],np.int32)
        parent=np.arange(len(votes))
        def root(i):
            while parent[i]!=i:parent[i]=parent[parent[i]];i=parent[i]
            return i
        for a,b,c in candidate['triangles']:
            for x,y in ((a,b),(b,c)):parent[root(x)]=root(y)
        roots=np.array([root(i) for i in range(len(votes))])
        groups=np.empty_like(votes)
        for component in np.unique(roots):
            members=roots==component;groups[members]=np.bincount(votes[members]).argmax()
        candidate['bindGroups']=dict(source=source_groups,proxy=groups)
    # Spend the remaining vertices on the edges which deform least faithfully.
    # One immutable refinement in rest space; all poses share these new identities.
    bind(candidate)
    triangles=candidate['triangles']
    edges=np.unique(np.sort(np.concatenate([triangles[:,[0,1]],triangles[:,[1,2]],triangles[:,[2,0]]]),axis=1),axis=0)
    snapped=(source_points[candidate['binding']]*candidate['weights'][:,:,None]).sum(1)
    midpoint=(snapped[edges[:,0]]+snapped[edges[:,1]])/2
    middle=dict(ob=placeholder,rest=source_points,sourceTris=source_faces,proxy=midpoint)
    if 'bindGroups' in candidate:
        middle['bindGroups']=dict(source=source_groups,proxy=candidate['bindGroups']['proxy'][edges[:,0]])
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
    accepted=0
    for edge_index in ranked:
        a,b=edges[edge_index]
        # A volumetric union may contain non-manifold edges with >2 incident faces.
        # Splitting one must fit both budgets, not just the remaining vertex slots.
        incident=sum(int(a in face and b in face) for face in faces)
        if not incident or len(faces)+incident>max_vertices*2:continue
        accepted+=1;new=len(vertices)
        if 'bindGroups' in candidate:
            groups=candidate['bindGroups'];groups['proxy']=np.append(groups['proxy'],groups['proxy'][a])
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
    candidate['unionAudit']['deformationRefinement']=dict(addedVertices=accepted,evaluatedPoses=len(poses),
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
