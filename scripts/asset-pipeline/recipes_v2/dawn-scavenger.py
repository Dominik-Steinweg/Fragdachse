"""Lean north-facing badger thief; own anatomy, four-leg rig and heavy salvage sack."""
from recipes_v2.enemy_parts_a import ell,loft,horn,paw,head,finish
from rigs_v2 import control,attach
from dawn_parts import surface,salvage_gear,tube,plate
from weapon_surface_parts import paint_depth


def burlap_weave(material):
    """Crossing coarse fibers over the existing dirt; only the thief's sack uses it."""
    n,l=material.node_tree.nodes,material.node_tree.links
    bs=n['Principled BSDF'];base_normal=bs.inputs['Normal'].links[0].from_socket
    coords=n.new('ShaderNodeTexCoord');waves=[]
    for direction in ('X','Y'):
        wave=n.new('ShaderNodeTexWave');wave.bands_direction=direction
        wave.inputs['Scale'].default_value=34;wave.inputs['Distortion'].default_value=1.2
        l.new(coords.outputs['Generated'],wave.inputs['Vector']);waves.append(wave)
    cross=n.new('ShaderNodeMath');cross.operation='MULTIPLY'
    for i,wave in enumerate(waves):l.new(wave.outputs['Fac'],cross.inputs[i])
    bump=n.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.28;bump.inputs['Distance'].default_value=.018
    l.new(cross.outputs[0],bump.inputs['Height']);l.new(base_normal,bump.inputs['Normal']);l.new(bump.outputs[0],bs.inputs['Normal'])


def build(c,spec):
    coat=surface(c,'Dirty charcoal fur',(46,30,58),.18)
    flank=surface(c,'Violet enemy flank fur',(135,49,181),.20)
    dark=surface(c,'Near black facial mask',(18,15,26),.04)
    pale=surface(c,'Contrasting ivory facial fur',(242,233,210),.10)
    red=surface(c,'Thief crimson harness',(190,38,79),.15)
    sack=surface(c,'Coarse patched ochre sack',(177,123,53),.32)
    seam=surface(c,'Worn flax bag seams',(218,173,94),.20)
    metal=surface(c,'Loot bright scratched steel',(224,233,229),.20)
    patch=surface(c,'Old leather sack repair',(105,67,34),.27)
    burlap_weave(sack)
    eye=surface(c,'Small hostile amber eyes',(229,139,67),.02)
    materials=(coat,flank,dark,pale,red,sack,seam,metal,eye,patch)
    # Dawn form shading is already complete; retain it through the shared rig finisher.
    for material in materials:material['FD_EnemyFinish']=True
    limbs={}
    for name,x,y in [('front_left',-.66,.49),('front_right',.66,.49),('rear_left',-.76,-.64),('rear_right',.76,-.64)]:
        limbs[name]=paw(c,name,x,y,flank,dark,pale,width=.15,length=.36,toe_length=.13)
    body=[loft(c,'Lean thief torso',[(-.72,.05,.28,.05),(-.52,.31,.40,.20),(-.15,.29,.44,.20),(.25,.37,.49,.24),(.55,.40,.57,.22),(.77,.15,.61,.10)],coat)]
    for side in (-1,1):
        body.append(ell(c,'Lean angular haunch',(side*.40,-.44,.42),(.22,.36,.22),flank,angle=side*.17))
        body.append(ell(c,'Violet shoulder visible ahead of sack',(side*.34,.37,.63),(.22,.38,.19),flank,angle=-side*.18))
        body.append(horn(c,'Ragged shoulder fur',[(side*.30,.51,.64),(side*.50,.23,.59),(side*.59,.12,.46)],[.15,.08,.004],flank))
    skull=head(c,pale,dark,coat,eye,y=.96,z=.78,width=.34,length=.50,register_sockets=True)
    tail=[horn(c,'Thin ragged tail',[(0,-.74,.35),(.13,-.95,.23),(.29,-1.12,.18)],[.095,.07,.005],flank)]
    asset=finish(c,body,skull,limbs,tail)
    before=set(c.scene.objects)
    for side in (-1,1):
        tube(c,'Crimson shoulder harness',[(side*.25,.64,.75),(side*.40,.40,.82),(side*.39,-.18,.76)],.055,red,10)
    attach(set(c.scene.objects)-before,asset['parts']['body'])
    before=set(c.scene.objects)
    ell(c,'Oversized full salvage sack',(0,-.73,.93),(.68,.77,.43),sack,taper=-.13,angle=-.09)
    ell(c,'Sagging bag lobe',(.35,-1.03,.94),(.34,.36,.29),sack)
    for side in (-1,1):
        tube(c,'Raised stitched sack seam',[(side*.27,-.23,1.12),(side*.46,-.59,1.24),(side*.39,-1.09,1.13),(side*.13,-1.39,.98)],.022,seam,8)
    plate(c,'Repaired cloth patch',(-.19,-.99,1.335),[(-.14,-.11),(.12,-.12),(.13,.13),(-.12,.11)],.018,patch,.02)
    ell(c,'Gathered open sack mouth',(.05,-.27,1.16),(.38,.23,.12),dark)
    tube(c,'Rolled mouth rim',[(-.32,-.32,1.21),(-.23,-.10,1.23),(.17,-.07,1.23),(.43,-.24,1.19),(.20,-.48,1.19),(-.32,-.32,1.21)],.043,seam,10)
    salvage_gear(c,(-.34,-.55,1.46),.31,{'edge':metal},10)
    loot=plate(c,'Loot plate projecting from sack',(0,0,0),[(-.10,-.19),(.12,-.14),(.15,.30),(.05,.24),(-.10,.34)],.045,metal,.018)
    loot.location=(.30,-.22,1.44);loot.rotation_euler.y=-.25;loot.rotation_euler.z=-.28
    for y in (-1.02,-.93,-.84):
        tube(c,'Broad sack stitch',[(-.32,y,1.335),(-.25,y+.012,1.36)],.018,seam,8)
    tube(c,'Gathered sack lower fold',[(-.39,-1.18,1.13),(-.16,-1.31,1.15),(.13,-1.30,1.16),(.34,-1.17,1.13)],.028,seam,10)
    tube(c,'Loose drawstring loop',[(.31,-.51,1.28),(.43,-.66,1.33),(.31,-.80,1.32),(.25,-.62,1.33),(.31,-.51,1.28)],.021,seam,8)
    tube(c,'Loose drawstring end',[(.31,-.51,1.28),(.41,-.81,1.30),(.35,-1.01,1.30)],.019,seam,8)
    tube(c,'Loot hooked pipe',[(.15,-.42,1.37),(.46,-.36,1.48),(.57,-.12,1.47),(.44,-.04,1.46)],.055,metal,12)
    load=control(c.scene,'Heavy sack delayed sway',location=(0,-.18,.70),parent=asset['parts']['body'])
    attach(set(c.scene.objects)-before-{load},load);asset['parts']['load']=load
    for ob in c.scene.objects:
        if ob.type=='MESH':paint_depth(c,ob)
    return asset
