"""Authored Actions sampled at fixed phases. Motion never translates the asset root."""
import math


def key(ob, path, value, frame):
    setattr(ob, path, value)
    ob.keyframe_insert(data_path=path, frame=frame, group='Asset motion')


def author(asset, clips):
    # Controls may pivot at necks/shoulders. Keep every authored rest transform.
    controls = [ob for ob in asset['parts'].values() if hasattr(ob, 'location')]
    rests = {id(ob): (tuple(ob.location), tuple(ob.rotation_euler), tuple(ob.scale)) for ob in controls}
    frame = 1
    samples = [{'index': 0, 'blenderFrame': 0}]
    exported = []
    for clip in clips:
        count, name, motion = clip['frameCount'], clip['name'], clip['motion']
        step = 24 / clip['frameRate']
        frames = []
        # Evaluate the closure pose at N for loops, but export only [0, N).
        for i in range(count + (1 if clip['loop'] else 0)):
            phase = i / (count if clip['loop'] else count - 1)
            apply(asset, motion, phase, frame + i * step, parameters=clip.get('parameters', {}), rests=rests)
            if i < count:
                index = len(samples)
                frames.append(index)
                samples.append({'index': index, 'blenderFrame': frame + i * step})
        exported.append({k: clip[k] for k in ('name', 'motion', 'frameRate', 'loop')} | {'frames': frames,
                         'timelineStart': frame, 'timelineEnd': max(frame + count * step - 1, samples[-1]['blenderFrame']),
                         **({'parameters': clip['parameters']} if 'parameters' in clip else {})})
        frame += count * step + 2
    # Idle keys are independent of the first phase in an active loop.
    for clip in clips:
        apply(asset, clip['motion'], 0, 0, idle=True, parameters=clip.get('parameters', {}), rests=rests)
    # Blender 4.4+ stores curves in slotted Actions. Set sampled interpolation linear.
    animated = [asset['rig']] if asset['rig'] else []
    animated += [ob for ob in asset['parts'].values() if hasattr(ob, 'animation_data')]
    for ob in animated:
        if ob and ob.animation_data and ob.animation_data.action:
            action = ob.animation_data.action
            action.name = 'FD ' + '-'.join(c['name'] for c in clips) + ' — ' + ob.name
            action.use_fake_user = True
            for layer in action.layers:
                for strip in layer.strips:
                    for bag in strip.channelbags:
                        for curve in bag.fcurves:
                            for point in curve.keyframe_points:
                                point.interpolation = 'LINEAR'
    return samples, exported


def apply(asset, motion, phase, frame, idle=False, parameters=None, rests=None):
    parts = asset['parts']
    p = parameters or {}
    rests = rests or {}
    def pose(name, location=(0, 0, 0), rotation=(0, 0, 0), scale=(1, 1, 1)):
        if name not in parts: return
        ob = parts[name]
        base = rests.get(id(ob), ((0, 0, 0), (0, 0, 0), (1, 1, 1)))
        key(ob, 'location', tuple(a + b for a, b in zip(base[0], location)), frame)
        key(ob, 'rotation_euler', tuple(a + b for a, b in zip(base[1], rotation)), frame)
        key(ob, 'scale', tuple(a * b for a, b in zip(base[2], scale)), frame)
    angle = math.tau * phase
    if motion in ('mechanical_fire', 'energy_fire'):
        # Immediate response, then smooth recovery; no baked salvo timing.
        kick = 0 if idle or phase == 1 else (1 - phase) ** 2
        for name in ('left_pod', 'right_pod'):
            pose(name, location=(-p.get('recoil', .16) * kick, 0, 0))
        if motion == 'energy_fire':
            pulse = 0 if idle else math.sin(math.pi * phase) ** 2
            expansion = p.get('corePulse', .12) * pulse
            pose('core', scale=(1 + expansion, 1 + expansion, 1))
            socket = parts.get('emission')
            if socket is not None:
                socket.default_value = p.get('idleEmission', .3) + p.get('activeEmission', 1.1) * pulse
                socket.keyframe_insert(data_path='default_value', frame=frame)
    elif motion == 'organic_pulse':
        pulse = 0 if idle else math.sin(math.pi * phase) ** 2
        pose('cap', scale=(1 + p.get('pulseWidth', .10) * pulse, 1 - p.get('pulseCompression', .13) * pulse, 1 + .08 * pulse))
        pose('gills', rotation=(0, 0, .07 * pulse))
    elif motion == 'sustained':
        wave = 0 if idle else .5 - .5 * math.cos(angle)
        pose('rotor', rotation=(0, 0, p.get('rotorSwing', .22) * (0 if idle else math.sin(angle))))
        pulse = p.get('corePulse', .12) * wave
        pose('core', scale=(1 + pulse, 1 + pulse, 1))
        # Local emission remains part of the material, with no world glow/bloom.
        socket = parts.get('emission')
        if socket is not None:
            socket.default_value = p.get('idleEmission', .3) + p.get('activeEmission', 1.4) * wave
            socket.keyframe_insert(data_path='default_value', frame=frame)
    elif motion in ('biped', 'quadruped', 'player_walk'):
        for i, name in enumerate(parts['limbs']):
            # Quadrupeds pair opposite front/back feet; bipeds alternate left/right.
            offset = (0 if i in (0, 3) else math.pi) if motion == 'quadruped' else i * math.pi
            cycle = 0 if idle else math.sin(angle + offset)
            lift = 0 if idle else max(0, math.cos(angle + offset))
            bone = asset['rig'].pose.bones[name]
            stride = .20 if motion == 'player_walk' else (.16 if motion == 'quadruped' else .19)
            reach = p.get('strideForward', stride) if cycle >= 0 else p.get('strideBack', stride)
            key(bone, 'location', (0, reach * cycle, p.get('lift', .06) * lift), frame)
            key(bone, 'rotation_euler', (p.get('footRoll', .08) * cycle, 0, p.get('footYaw', .05) * cycle), frame)
        sway = 0 if idle else math.sin(angle)
        bob = 0 if idle else .5 - .5 * math.cos(2 * angle)
        pose('body', location=(p.get('bodyShift', 0) * sway, p.get('bodySurge', 0) * bob, p.get('bodyBob', 0) * bob),
             rotation=(p.get('bodyPitch', 0) * bob, p.get('bodyRoll', 0) * sway, p.get('bodyYaw', .025) * sway))
        pose('head', location=(0, 0, p.get('headBob', 0) * bob), rotation=(0, 0, p.get('headYaw', 0) * sway))
        pose('tail', rotation=(0, 0, p.get('tailYaw', 0) * sway))
        pose('arms', location=(0, p.get('armBob', 0) * bob, 0), rotation=(0, 0, p.get('armSwing', 0) * sway))
        for side, name in [(-1, 'left_arm'), (1, 'right_arm')]:
            pose(name, rotation=(p.get('armSwing', 0) * sway * side, 0, p.get('armSwing', 0) * sway * side * .35),
                 location=(0, p.get('armBob', 0) * sway * side, 0))
        delayed = 0 if idle else math.sin(angle - .4)
        for name in ('brood', 'load', 'rear_body'):
            pose(name, location=(0, 0, p.get('loadBob', 0) * delayed), rotation=(0, 0, p.get('bodyYaw', .025) * delayed * .5))
    else:
        raise ValueError(f'Unknown authored motion: {motion}')
