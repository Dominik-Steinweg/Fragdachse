import bpy, sys, json, argparse
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--old',required=True);p.add_argument('--new',required=True);p.add_argument('--out',required=True)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:])
def emission():
    result=[]
    for m in bpy.data.materials:
        if not m.use_nodes:continue
        bs=m.node_tree.nodes.get('Principled BSDF')
        if bs and bs.inputs['Emission Strength'].default_value>0:
            result.append({'color':list(bs.inputs['Emission Color'].default_value),'strength':bs.inputs['Emission Strength'].default_value})
    return sorted(result,key=lambda x:x['strength'])
bpy.ops.wm.open_mainfile(filepath=a.old)
old=emission();assert len(old)==2
bpy.ops.wm.open_mainfile(filepath=a.new)
assert emission()==old,'Emissive colors/strengths changed'
groups=[]
for m in bpy.data.materials:
    if not m.get('FD_ValueGroup'):continue
    bs=m.node_tree.nodes.get('Principled BSDF')
    assert bs.inputs['Emission Strength'].default_value==0
    rough=m.node_tree.nodes['Rubbed versus rough finish'].color_ramp
    assert min(e.color[0] for e in rough.elements)>=.5,'Glossy finish'
    groups.append({'group':m['FD_ValueGroup'],'baseLinear':list(m.diffuse_color),'roughnessRange':[e.color[0] for e in rough.elements]})
assert {g['group'] for g in groups}=={'coat','steel','edge'}
luma=lambda rgb:sum(c*w for c,w in zip(rgb,(.2126,.7152,.0722)))
values={g['group']:luma(g['baseLinear']) for g in groups}
assert values['edge']>values['coat']>values['steel']
lightness=lambda y:116*y**(1/3)-16 if y>(6/29)**3 else y*(29/3)**3
lightness_values={group:lightness(value) for group,value in values.items()}
for group,(low,high) in {'coat':(45,52),'steel':(28,33),'edge':(70,78)}.items():
    assert low<=lightness_values[group]<=high,(group,lightness_values[group])
contacts=[]
for ob in bpy.data.objects:
    if ob.type!='MESH':continue
    mask=ob.data.color_attributes.get('FD_ContactDust')
    if mask:
        v=[c.color[0] for c in mask.data]
        assert min(v)>=0 and max(v)<=1
        contacts.append({'mesh':ob.name,'min':min(v),'max':max(v)})
assert contacts and any(c['max']-c['min']>.25 for c in contacts),'Missing broad contact gradient'
report={'status':'passed','emissivesUnchanged':old,'materialGroups':groups,'baseColorLightness':lightness_values,'contactMasks':contacts}
Path(a.out).write_text(json.dumps(report,indent=2)+'\n',encoding='utf8')
print(json.dumps(report))
