"""Deform the fused oral crown without changing its geometry or facial attachments.

Five bones per authored centre line, ordered by root X (left outer to right outer).
The existing root supplies the stationary weight remainder. Skin stays under the
breathing body object; an unposed armature is an identity deformation in every clip.
"""
import json
from mathutils import Vector
from mathutils.kdtree import KDTree
from kraken_arm_parts import bind, chain_weights


def smooth(a, b, x):
    t = max(0, min(1, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def add_beard_chains(data, root, lines):
    """Called in the existing armature's EDIT mode; +X pitch, +Y twist, +Z yaw."""
    chains = []
    for i, line in enumerate(lines):
        chain, previous = [], root
        for j in range(5):
            bone = data.edit_bones.new(f'beard_{i + 1:02d}_{j + 1:02d}')
            bone.head = line[round(j * (len(line) - 1) / 5)][0]
            bone.tail = line[round((j + 1) * (len(line) - 1) / 5)][0]
            bone.parent, bone.use_connect = previous, j > 0
            bone.align_roll(Vector((0, 0, 1)))
            previous = bone
            chain.append(bone.name)
        chains.append(chain)
    return chains


def preserve_neutral_surface(modifier, rig, chains):
    """Skip Blender's round-trip deformation math in the exact zero rotation pose.

    Even identity skinning perturbs floating-point coordinates/normals enough to
    change Cycles pixels. Simple-expression drivers observe the actual Euler
    channels, so interpolation and manual posing work without an enable switch.
    Small batches keep every expression within Blender's expression length limit.
    """
    channels = [(name, axis) for chain in chains for name in chain for axis in range(3)]
    properties = []
    for start in range(0, len(channels), 25):
        prop = f'beard_rotation_activity_{start // 25}'
        rig[prop] = 0.0
        driver = rig.driver_add(f'["{prop}"]').driver
        driver.type = 'SCRIPTED'
        terms = []
        for index, (name, axis) in enumerate(channels[start:start + 25]):
            variable = driver.variables.new()
            variable.name = chr(ord('a') + index)
            variable.type = 'SINGLE_PROP'
            variable.targets[0].id = rig
            variable.targets[0].data_path = f'pose.bones["{name}"].rotation_euler[{axis}]'
            terms.append(f'abs({variable.name})')
        driver.expression = 'max(' + ','.join(terms) + ')'
        properties.append(prop)
    for path in ('show_viewport', 'show_render'):
        driver = modifier.driver_add(path).driver
        driver.type = 'SCRIPTED'
        terms = []
        for index, prop in enumerate(properties):
            variable = driver.variables.new()
            variable.name = chr(ord('a') + index)
            variable.type = 'SINGLE_PROP'
            variable.targets[0].id = rig
            variable.targets[0].data_path = f'["{prop}"]'
            terms.append(variable.name)
        driver.expression = '+'.join(terms) + '>0'


def bind_beard(skin, rig, lines, chains):
    """KD candidates + segment projection, with smooth root and radial falloffs.

    Nearby roots share influence, avoiding a nearest-chain seam in fused tissue.
    Beyond the facial blend only the closest tendril owns a vertex. Brows and
    sockets lie behind the zero-weight facial boundary (y <= 1.94).
    """
    samples = [(i, j, p, r, t) for i, line in enumerate(lines)
               for j, (p, r, t) in enumerate(line)]
    tree = KDTree(len(samples))
    for k, (_, _, p, _, _) in enumerate(samples):
        tree.insert(p, k)
    tree.balance()
    weights = []
    for vertex in skin.data.vertices:
        co = vertex.co
        influences = {}
        if co.y > 1.94:
            for _, k, _ in tree.find_range(co, .23):
                i, j, _, _, _ = samples[k]
                for start in (j - 1, j):
                    if start < 0 or start >= len(lines[i]) - 1:
                        continue
                    a, ra, ta = lines[i][start]
                    b, rb, tb = lines[i][start + 1]
                    delta = b - a
                    u = max(0, min(1, (co - a).dot(delta) / delta.length_squared))
                    distance = (co - a.lerp(b, u)).length
                    if i not in influences or distance < influences[i][0]:
                        influences[i] = (distance, ra + (rb - ra) * u, ta + (tb - ta) * u)
        candidates = []
        for i, (distance, radius, t) in influences.items():
            support = 1 - smooth(radius + .015, radius + .065, distance)
            amount = support * smooth(.16, .48, t) * smooth(1.94, 2.14, co.y)
            if amount > 0:
                candidates.append((i, distance, t, amount))
        pairs = []
        if candidates:
            closest = min(candidates, key=lambda item: item[1])
            # Distal neighbouring strands must remain independent even at a crossing.
            if closest[2] >= .48:
                candidates = [closest]
            total = sum(item[3] for item in candidates)
            amount = max(item[3] for item in candidates)
            for i, _, t, influence in candidates:
                pairs.extend((name, weight * amount * influence / total)
                             for name, weight in chain_weights(chains[i], t))
            if amount < 1:
                pairs.append(('root', 1 - amount))
        else:
            pairs = [('root', 1)]
        weights.append(pairs)
    modifier = bind(skin, rig, weights)
    modifier.name = 'Continuous oral crown deformation'
    preserve_neutral_surface(modifier, rig, chains)
    # Persist the explicit contract for saved-blend verification, never name discovery.
    rig['beardChains'] = json.dumps(chains)
    rig['beardLines'] = json.dumps([[[list(p), r, t] for p, r, t in line] for line in lines])
    skin['beardRig'] = rig
