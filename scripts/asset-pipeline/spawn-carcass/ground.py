"""Organic ground and older bones on the v6 carcass (run after tweak.py, before export.py).

Needs build/spawn-structure/live/bone-proximity.png from proximity.py (bones of a first export, dilated).

The stain is no longer the painted disc: a strongly warped nest core joins a creep that follows the
skeleton (bone-proximity mask baked from the south building frame), frayed by noise, so the footprint
runs out in lobes and fingers instead of a stamp. Bones get darker and older; the eye embers keep only a
dark violet base, the game adds the glow on the GPU.
"""
import bpy

ROOT = globals()['ROOT']        # injected by bl.py
LIVE = globals()['LIVE']        # injected by bl.py
NEST = (0.0, 0.3, 0.0)

# --- Older, darker bones ----------------------------------------------------------------------
# The mix nodes keep carcass.py's creation names, so a second run sets the same values again.
for name, base in (('v6_bone', (0.22, 0.185, 0.14)), ('v6_old_bone', (0.16, 0.135, 0.105))):
    nodes = bpy.data.materials[name].node_tree.nodes
    nodes['Mix'].inputs['A'].default_value = (*base, 1)                    # base colour over the hide tile
    nodes['Mix.001'].inputs['B'].default_value = (0.34, 0.29, 0.22, 1)     # stains
    nodes['Mix.002'].inputs['B'].default_value = (0.3, 0.28, 0.245, 1)     # bleach
    nodes['Mix.006'].inputs['B'].default_value = (0.38, 0.355, 0.31, 1)    # worn edges

# --- Eyes: dark embers only --------------------------------------------------------------------
ember = bpy.data.materials['v6_ember'].node_tree.nodes
ember['Principled BSDF'].inputs['Emission Color'].default_value = (0.12, 0.015, 0.26, 1)
for n in ember:
    if n.type == 'MAP_RANGE': n.inputs['To Max'].default_value = 0.7

# --- Organic stain ------------------------------------------------------------------------------
tree = bpy.data.materials['atmos6_floor'].node_tree
nodes, links = tree.nodes, tree.links
for n in [n for n in nodes if n.name.startswith('org_')]: nodes.remove(n)


def node(kind, name, **inputs):
    n = nodes.new(kind); n.name = 'org_' + name
    for key, value in inputs.items(): n.inputs[key].default_value = value
    return n


coord = next(n for n in nodes if n.type == 'TEX_COORD')
decal = next(n for n in nodes if n.type == 'TEX_IMAGE' and n.image and n.image.name.startswith('active'))
bsdf = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
over = bsdf.inputs['Base Color'].links[0].from_node            # forest floor / pool mix
pool = next(n for n in nodes if n.type == 'MIX' and n.blend_type == 'OVERLAY').outputs['Result']   # painted pool

# Warped distance from the nest: lobes in a few directions, never a circle.
off = node('ShaderNodeVectorMath', 'offset'); off.operation = 'SUBTRACT'; off.inputs[1].default_value = NEST
links.new(coord.outputs['Object'], off.inputs[0])
flat = node('ShaderNodeVectorMath', 'flat'); flat.operation = 'MULTIPLY'; flat.inputs[1].default_value = (1, 1, 0)
links.new(off.outputs['Vector'], flat.inputs[0])
dist = node('ShaderNodeVectorMath', 'dist'); dist.operation = 'LENGTH'; links.new(flat.outputs['Vector'], dist.inputs[0])
lobes = node('ShaderNodeTexNoise', 'lobes', Scale=0.42, Detail=2.0, Roughness=0.4)
links.new(coord.outputs['Object'], lobes.inputs['Vector'])
lobe_amt = node('ShaderNodeMapRange', 'lobe_amt', **{'To Min': -1.5, 'To Max': 1.5})
links.new(lobes.outputs['Fac'], lobe_amt.inputs['Value'])
warped = node('ShaderNodeMath', 'warped'); warped.operation = 'ADD'
links.new(dist.outputs['Value'], warped.inputs[0]); links.new(lobe_amt.outputs['Result'], warped.inputs[1])
core = node('ShaderNodeMapRange', 'core', **{'From Min': 1.7, 'From Max': 3.3, 'To Min': 1.0, 'To Max': 0.0})
core.interpolation_type = 'SMOOTHSTEP'
links.new(warped.outputs['Value'], core.inputs['Value'])
# Creep along the bones, broken into patches.
bone_img = bpy.data.images.load(f'{LIVE}/bone-proximity.png', check_existing=True); bone_img.colorspace_settings.name = 'Non-Color'
bmap = node('ShaderNodeMapping', 'bone_map'); bmap.inputs['Location'].default_value = (0.5, 0.5, 0); bmap.inputs['Scale'].default_value = (1 / 11, 1 / 11, 1)
links.new(coord.outputs['Object'], bmap.inputs['Vector'])
bone = nodes.new('ShaderNodeTexImage'); bone.name = 'org_bone'; bone.image = bone_img; bone.extension = 'CLIP'
links.new(bmap.outputs['Vector'], bone.inputs['Vector'])
patches = node('ShaderNodeTexNoise', 'patches', Scale=1.6, Detail=5.0, Roughness=0.6)
links.new(coord.outputs['Object'], patches.inputs['Vector'])
patch_amt = node('ShaderNodeMapRange', 'patch_amt', **{'From Min': 0.35, 'From Max': 0.6, 'To Min': 0.2, 'To Max': 1.1})
links.new(patches.outputs['Fac'], patch_amt.inputs['Value'])
creep = node('ShaderNodeMath', 'creep'); creep.operation = 'MULTIPLY'; creep.use_clamp = True
links.new(bone.outputs['Color'], creep.inputs[0]); links.new(patch_amt.outputs['Result'], creep.inputs[1])
stain = node('ShaderNodeMath', 'stain'); stain.operation = 'MAXIMUM'
links.new(core.outputs['Result'], stain.inputs[0]); links.new(creep.outputs['Value'], stain.inputs[1])
# Frayed rim: fine noise eats into the edge; the outer ring stays semi-transparent (export cut).
fray = node('ShaderNodeTexNoise', 'fray', Scale=4.5, Detail=8.0, Roughness=0.7)
links.new(coord.outputs['Object'], fray.inputs['Vector'])
fray_amt = node('ShaderNodeMapRange', 'fray_amt', **{'To Min': 0.5, 'To Max': 1.4})
links.new(fray.outputs['Fac'], fray_amt.inputs['Value'])
frayed = node('ShaderNodeMath', 'frayed'); frayed.operation = 'MULTIPLY'; frayed.use_clamp = True
links.new(stain.outputs['Value'], frayed.inputs[0]); links.new(fray_amt.outputs['Result'], frayed.inputs[1])
ramp = nodes.get('edge_ramp')
if ramp:
    links.new(frayed.outputs['Value'], ramp.inputs['Fac'])
# Colour: the painted pool inside the nest, a dark veined creep where the stain runs along the bones.
veins = node('ShaderNodeTexVoronoi', 'veins'); veins.feature = 'DISTANCE_TO_EDGE'; veins.inputs['Scale'].default_value = 6.0
links.new(coord.outputs['Object'], veins.inputs['Vector'])
vein_amt = node('ShaderNodeMapRange', 'vein_amt', **{'From Max': 0.05, 'To Min': 1.0, 'To Max': 0.0})
links.new(veins.outputs['Distance'], vein_amt.inputs['Value'])
creep_col = node('ShaderNodeMix', 'creep_col'); creep_col.data_type = 'RGBA'
creep_col.inputs['A'].default_value = (0.022, 0.016, 0.026, 1); creep_col.inputs['B'].default_value = (0.09, 0.03, 0.15, 1)
links.new(vein_amt.outputs['Result'], creep_col.inputs['Factor'])
inner = node('ShaderNodeMix', 'inner'); inner.data_type = 'RGBA'
links.new(decal.outputs['Alpha'], inner.inputs['Factor'])
links.new(creep_col.outputs['Result'], inner.inputs['A']); links.new(pool, inner.inputs['B'])
links.new(inner.outputs['Result'], over.inputs['B'])
cover = node('ShaderNodeMath', 'cover'); cover.operation = 'MAXIMUM'; cover.use_clamp = True
links.new(decal.outputs['Alpha'], cover.inputs[0]); links.new(frayed.outputs['Value'], cover.inputs[1])
links.new(cover.outputs['Value'], over.inputs['Factor'])
result = {'ok': True, 'edge_ramp': bool(ramp)}
