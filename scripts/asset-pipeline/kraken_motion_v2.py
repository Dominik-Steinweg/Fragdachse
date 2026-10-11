"""Muscular waves and a delayed whip, sampled into portable Blender Actions."""
import math


def smooth(a,b,x):
    t=max(0,min(1,(x-a)/(b-a)))
    return t*t*(3-2*t)


def apply_kraken(asset,motion,phase,frame,idle,p,pose,key):
    active=not idle
    cycle=math.tau*phase
    pose('body'); pose('surfacing')
    attack=motion=='kraken_slam' and active
    emerge=motion=='kraken_emerge' and active
    loop=active and motion in ('kraken_idle','kraken_swim')
    swim=motion=='kraken_swim'
    if loop:
        breath=.5-.5*math.cos(cycle)
        pose('body',scale=(1+.035*breath,1+.025*breath,1+.065*breath),location=(0,0,.04*breath))
    if emerge:
        rise=smooth(0,.70,phase)
        overshoot=math.sin(math.pi*smooth(.38,1,phase))*(1-rise)*.13
        pose('surfacing',location=(0,0,-.65*(1-rise)),scale=(.70+.30*rise+overshoot,.76+.24*rise, .55+.45*rise))
    if attack:
        coil=smooth(0,.32,phase)*(1-smooth(.36,.51,phase))
        impact=smooth(.36,.53,phase)*(1-smooth(.56,.96,phase))
        pose('body',location=(0,-.09*coil+.10*impact,.06*coil),scale=(1+.035*coil,1-.06*coil,1+.07*coil))
    for i,chain in enumerate(asset['parts']['tentacle_chains']):
        side=-1 if i<4 else 1
        for j,name in enumerate(chain):
            t=j/(len(chain)-1)
            lateral=vertical=twist=0
            # Small distal rolls expose just one ventral rim on a few resting
            # hooks; the large wind-up still presents the complete underside.
            rest_roll={1:2.02,3:1.90,6:2.05}.get(i,0)
            roll_start,roll_end=7,13
            if rest_roll and roll_start<=j<roll_end:
                weights=[math.sin(math.pi*(k+.5)/(roll_end-roll_start)) for k in range(roll_end-roll_start)]
                twist=side*rest_roll*weights[j-roll_start]/sum(weights)
            if loop:
                amplitude=p.get('wave',.025 if not swim else .055)
                lateral=amplitude*side*math.sin(cycle-t*math.tau*1.1+i*.72)*(.45+t)
                vertical=amplitude*.7*math.cos(cycle-t*4+i*.72)
            if emerge:
                fold=(1-smooth(t*.14,.68+t*.18,phase))
                lateral=side*.085*fold
                vertical=.06*fold
            if attack:
                delay=t*.08
                coil=smooth(0,.30+delay,phase)*(1-smooth(.36+delay,.49+delay,phase))
                hit=smooth(.36+delay,.50+delay,phase)*(1-smooth(.58,.97,phase))
                # The two forward arms wind up, whip inward and relax tip-last.
                if i in (0,4):
                    lateral=side*(-.075*coil+.075*hit)*(1-.48*t)
                    vertical=.14*coil-.10*hit
                    # Spread the muscular roll over the proximal half of the
                    # chain: the ventral cups turn toward the camera during the
                    # wind-up/contact, then turn back underneath on recovery.
                    exposure=smooth(.08,.34,phase)*(1-smooth(.58,.95,phase))
                    roll_joints=len(chain)//2
                    if j<roll_joints:
                        weights=[math.sin(math.pi*(k+.5)/roll_joints) for k in range(roll_joints)]
                        twist+=side*math.pi*.96*exposure*weights[j]/sum(weights)
                else:
                    lateral=side*(-.025*coil+.025*hit)*(.4+t)
                    vertical=-.025*coil+.016*hit
            bone=asset['rig'].pose.bones[name]
            key(bone,'rotation_euler',(vertical,twist,lateral),frame)
            key(bone,'location',(0,0,0),frame)
