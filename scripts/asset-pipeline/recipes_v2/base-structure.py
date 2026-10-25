"""Rustic persistent base core, outpost sets and the 47-mask kit (1 BU = 1 m = 1 cell = 32 px).

model = {style: burg|fort|hut|camp, layout: core|outposts|kit, variant: 0, conceptGround: false}

- core: the 12 base-surface cells of the 7 x 7 persistent core (four 3-cell corner bastions,
  3-cell entrances), centred on the pivot. Cells are seeded by position: this is the master.
- outposts: the friendly outpost and middle-base shapes of the campaign maps side by side,
  seeded by mask exactly like the kit, so each cell equals its kit frame.
- kit: every one of the 47 masks as a lone centre cell on a 2 m pitch, 7 per row, in the order of
  `all_masks()`. Only the centre cell is built; its geometry never leaves the cell.

`conceptGround` adds meadow and the style's courtyard ground for concept boards only; those
objects carry `fdConceptOnly` and never belong to a runtime pass.
"""
import json
import random
from pathlib import Path
from dawn_parts import root, finish, material_factory
from lobby_structure_parts import socket
from base_structure_parts import mask_of, all_masks, cell_seed, flat_sheet
from base_styles import STYLES, courtyard_ground

CORE = [(x, y) for y in range(7) for x in range(7)
        if (x in (0, 6) or y in (0, 6)) and not ((x in (0, 6) and 2 <= y <= 4) or (y in (0, 6) and 2 <= x <= 4))]

# Friendly cell shapes of the campaign maps, shared with the concept board.
SHAPES = json.loads((Path(__file__).resolve().parents[1] / 'base-structure-shapes.json').read_text(encoding='utf8'))


def outpost_shapes():
    for shape in SHAPES['outposts']:
        ox, oy = shape['origin']
        yield {(ox + x, oy + y) for y, row in enumerate(shape['rows']) for x, ch in enumerate(row) if ch == '#'}


def side_uvs(meshes):
    """finish() projects every face from the top; walls get a side projection instead, so the
    diagnostic oblique view shows masonry and bark rather than stretched stripes."""
    for ob in meshes:
        uv = ob.data.uv_layers.get('FD_DawnMaterial')
        if not uv: continue
        for poly in ob.data.polygons:
            n = poly.normal
            if abs(n.z) > .5: continue
            for li in poly.loop_indices:
                p = ob.matrix_world @ ob.data.vertices[ob.data.loops[li].vertex_index].co
                uv.data[li].uv = ((p.x if abs(n.x) < abs(n.y) else p.y) + .31, p.z + .17)


def build(c, spec):
    pivot = root(c)
    model = spec['model']
    m = material_factory(c, spec)
    style = STYLES[model['style']](c, m)
    variant = model.get('variant', 0)
    layout = model['layout']
    if layout == 'core':
        cells = set(CORE)
        for gx, gy in sorted(cells):
            style.cell(gx, gy, gx - 3.0, 3.0 - gy, mask_of(cells, gx, gy), random.Random(cell_seed(gx, gy, variant)))
        ground = (-6.0, -6.0, 6.0, 6.0)
        courtyard = (-3.8, -3.8, 3.8, 3.8)
    elif layout == 'outposts':
        w, h = SHAPES['sheet']
        for cells in outpost_shapes():
            for gx, gy in sorted(cells):
                mask = mask_of(cells, gx, gy)
                style.cell(gx, gy, gx + .5 - w / 2, h / 2 - gy - .5, mask, random.Random(cell_seed(mask, 0, variant)))
        ground = (-w / 2 - .5, -h / 2 - .5, w / 2 + .5, h / 2 + .5)
        courtyard = None
    else:
        for index, mask in enumerate(all_masks()):
            col, row = index % 7, index // 7
            style.cell(col, row, (col - 3) * 2.0, (3 - row) * 2.0, mask, random.Random(cell_seed(mask, 0, variant)))
        ground = courtyard = None
    style.flush()
    if model.get('conceptGround') and ground:
        meadow = flat_sheet(c, 'Concept lobby meadow', *ground, -.004, m('Concept meadow', (60, 76, 42), .2))
        meadow['fdConceptOnly'] = True
        if courtyard:
            for ob in courtyard_ground(c, model['style'], m, courtyard, random.Random(17)):
                ob['fdConceptOnly'] = True
    asset = finish(c, pivot)
    side_uvs(asset['parts']['meshes'])
    asset['sockets'] = {name: socket(c, name, *xyz) for name, xyz in style.sockets.items()}
    for ob in asset['sockets'].values(): ob.parent = pivot
    return asset
