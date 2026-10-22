"""Brutkadaver (GDD Spawnbauwerk V1): painted layers from the chosen concept image.

    python -I scripts/asset-pipeline/spawn-structure-painted.py <label>

Sources: tools/source-art/spawn-structure/ (README.md). The carcass and its ground were painted as
one concept image; the Qwen edits beside it isolate the carcass (outer silhouette), remove the
carcass and creatures from the ground, and paint the damaged/rubble/sealed/dry states on the same
layout. This script only cuts, keys and aligns them: no pixel is repainted here.

Output: art/poc/spawn-structure/painted/<label>/<asset>/<state>.png plus congruent emissive layers
(white RGB, alpha = intensity) and sockets.json, read by export-spawn-structure.mjs painted.
Both canvases are centred on the brood nest centre (the pivot) at 32 px per world cell, opening
south; the runtime turns them toward the other openings.
"""
import json
import os
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'tools', 'source-art', 'spawn-structure')
# The concept's gap between snout and jaw faces south-southwest; this turn (degrees, counter-clockwise)
# about the ring centre opens it to the south.
TURN_DEG, TURN_CENTRE = 18, (537, 482)
# After the turn the body cells (src/config/spawnStructure.ts SOUTH_BODY) sit on a 120 px grid at
# this origin; the nest (2x3 cells at 2,2) centre is the pivot of every canvas.
CELL = 120
GRID_ORIGIN = (182, 123)
PIVOT = (GRID_ORIGIN[0] + 3 * CELL, GRID_ORIGIN[1] + 3.5 * CELL)
GRASS = np.array([76, 74, 48], float)
ASSETS = {
    'spawn-structure': {'canvasCells': 8, 'sourceSize': 512, 'states': ['intact', 'damaged', 'rubble']},
    'spawn-brood-pit': {'canvasCells': 10, 'sourceSize': 640, 'states': ['sealed', 'active', 'dry']},
}


# The state edits were painted on the already turned intact layers, so they are not turned again.
TURNED = {'carcass-damaged.png', 'carcass-rubble.png', 'ground-sealed.png', 'ground-dry.png'}


def load(name, fill):
    image = Image.open(os.path.join(SRC, name)).convert('RGB')
    if image.size != (1024, 1024): raise SystemExit(f'{name}: expected 1024x1024, got {image.size}')
    if name in TURNED: return image
    return image.rotate(TURN_DEG, resample=Image.BICUBIC, center=TURN_CENTRE, fillcolor=fill)


def flood(mask, seeds):
    """Pixels of mask 4-connected to any seed."""
    h, w = mask.shape
    out = np.zeros_like(mask)
    queue = deque()
    for x, y in seeds:
        if mask[y, x] and not out[y, x]:
            out[y, x] = True
            queue.append((x, y))
    while queue:
        x, y = queue.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and mask[ny, nx] and not out[ny, nx]:
                out[ny, nx] = True
                queue.append((nx, ny))
    return out


def grow(mask, px):
    image = Image.fromarray((mask * 255).astype('uint8'))
    step = ImageFilter.MaxFilter(3) if px > 0 else ImageFilter.MinFilter(3)
    for _ in range(abs(px)): image = image.filter(step)
    return np.asarray(image) > 127


def components(mask, min_px):
    """Union of the connected components of at least min_px pixels."""
    seen = np.zeros_like(mask)
    keep = np.zeros_like(mask)
    ys, xs = np.nonzero(mask)
    for y, x in zip(ys[::61], xs[::61]):
        if seen[y, x]: continue
        part = flood(mask & ~seen, [(x, y)])
        seen |= part
        if part.sum() >= min_px: keep |= part
    return keep


def fill_small_holes(mask, max_px):
    holes = ~flood(~mask, [(0, 0)]) & ~mask
    return mask | (holes & ~components(holes, max_px))


def soft(mask, radius):
    return np.asarray(Image.fromarray((mask * 255).astype('uint8')).filter(ImageFilter.GaussianBlur(radius))).astype(float) / 255


def channels(rgb):
    a = np.asarray(rgb).astype(float)
    return a, a.mean(-1), a[..., 2] - (a[..., 0] + a[..., 1]) / 2


def magenta_key(rgb):
    """Coverage from the distance to flat magenta, with the magenta spill removed from the edges."""
    a = np.asarray(rgb).astype(float)
    dist = np.sqrt(((a - [255, 0, 255]) ** 2).sum(-1))
    alpha = np.clip((dist - 70) / 90, 0, 1)
    body = components(alpha > .5, 3000)
    alpha = np.where(grow(body, 2), alpha, 0)
    # Magenta bleeds into every edge and gap of the debris: pull red and blue back toward green where a
    # pixel leans magenta (both clearly above green). Violet flesh is dark and keeps its colour.
    spill = np.clip(np.minimum(a[..., 0], a[..., 2]) - a[..., 1] - 12, 0, None) * np.clip((a[..., 0] + a[..., 2] - 180) / 120, 0, 1)
    a[..., 0] -= spill
    a[..., 2] -= spill
    return np.clip(a, 0, 255), alpha * np.clip(1 - spill / 90, 0, 1)


def intact_body(concept, silhouette):
    """The concept's own carcass pixels: inside the Qwen silhouette, without eggs, slime and rib gaps."""
    a, lum, violet = channels(concept)
    iso = np.asarray(silhouette).astype(int)
    magenta = (iso[..., 0] > 160) & (iso[..., 2] > 160) & (iso[..., 1] < 130)
    outer = ~flood(magenta, [(0, 0), (1023, 0), (0, 1023), (1023, 1023)])
    body = outer & ~((violet > 12) | (lum < 24))
    body = components(grow(grow(body, -1), 1), 4000)
    body = fill_small_holes(body, 2500)
    return a, soft(grow(grow(body, -1), 1), .8)


def ground_layer(ground):
    """Creep stain and nest over grass: coverage from the grass distance, colour un-mixed from the grass."""
    a, _, violet = channels(ground)
    dist = np.sqrt(((a - GRASS) ** 2).sum(-1))
    alpha = np.clip((dist - 14) / 34, 0, 1) * np.clip((violet + 16) / 18, 0, 1)
    # The grass texture itself reaches the threshold in specks: keep the stain's body and let its edge
    # fade over a wide band, so the creep frays into any map ground instead of ending in a dark fringe.
    stain = fill_small_holes(components(soft(alpha > .45, 2) > .5, 20000), 40000)
    fade = np.clip((soft(stain, 40) - .25) / .7, 0, 1)
    alpha = np.clip(alpha * 1.1, 0, 1) * fade * fade * (3 - 2 * fade)
    colour = (a - (1 - alpha[..., None]) * GRASS) / np.maximum(alpha[..., None], .08)
    return np.clip(colour, 0, 255), alpha


def emissive(mask):
    out = np.zeros(mask.shape + (4,), 'uint8')
    out[..., :3] = 255
    out[..., 3] = (np.clip(mask, 0, 1) * 255).astype('uint8')
    return out


def building_emission(a, alpha):
    _, lum, violet = channels(Image.fromarray(a.astype('uint8')))
    inside = soft(alpha > .5, 0) * soft(grow(alpha > .5, -3), 1.5)
    # Torn hide: only the deep dark holes, where flesh shows through; they pulse with an announced release.
    tears = np.clip((38 - lum) / 12, 0, 1) * np.clip((violet + 2) / 8, 0, 1) * inside
    # Violet flesh in the tears: the brood heart's strongest glow.
    flesh = np.clip((violet - 4) / 10, 0, 1) * np.clip((70 - lum) / 30, 0, 1) * inside
    # The flank facing the nest catches the nest's light.
    yy, xx = np.mgrid[0:1024, 0:1024]
    toward = np.clip(1 - np.hypot(xx - PIVOT[0], yy - (PIVOT[1] - 40)) / 330, 0, 1) ** 1.5
    rim = soft(alpha > .5, 0) * np.clip((lum - 40) / 90, 0, 1) * toward * .55
    return {'rim': rim, 'veins': soft(tears > .4, 1.5) * .8, 'core': soft(flesh > .4, 1.2)}


def pit_emission(a, alpha, state):
    _, lum, violet = channels(Image.fromarray(a.astype('uint8')))
    if state == 'dry': return {'glow': np.zeros_like(alpha)}
    # Highlights of the eggs and the creep veins.
    glow = np.clip((violet - 18) / 30, 0, 1) * np.clip((lum - 30) / 50, 0, 1) * alpha
    return {'glow': soft(glow > .05, 1.2) * np.clip(glow * 3, 0, 1) * (.45 if state == 'sealed' else 1)}


def canvas(layer, cells, size):
    """Crop the canvas around the pivot (padding with transparency) and scale to the source size."""
    half = cells * CELL / 2
    box = tuple(int(round(v)) for v in (PIVOT[0] - half, PIVOT[1] - half, PIVOT[0] + half, PIVOT[1] + half))
    image = Image.fromarray(layer, 'RGBA')
    padded = Image.new('RGBA', (box[2] - box[0], box[3] - box[1]), (0, 0, 0, 0))
    padded.paste(image, (-box[0], -box[1]))
    return padded.resize((size, size), Image.LANCZOS)


def rgba(a, alpha):
    out = np.zeros(alpha.shape + (4,), 'uint8')
    out[..., :3] = np.clip(a, 0, 255).astype('uint8')
    out[..., 3] = (np.clip(alpha, 0, 1) * 255).astype('uint8')
    return out


def main(label):
    if not label.replace('-', '').isalnum(): raise SystemExit(f'Invalid label: {label}')
    out_root = os.path.join(ROOT, 'art', 'poc', 'spawn-structure', 'painted', label)
    grass, magenta = tuple(int(v) for v in GRASS), (255, 0, 255)
    building = {'intact': intact_body(load('concept.png', grass), load('carcass-intact.png', magenta))}
    for state in ('damaged', 'rubble'): building[state] = magenta_key(load(f'carcass-{state}.png', magenta))
    pit = {state: ground_layer(load(f'ground-{state}.png', grass)) for state in ASSETS['spawn-brood-pit']['states']}
    # The dormant crust was painted too pale beside the black creep: settle it into the stain.
    colour, alpha = pit['sealed']
    pit['sealed'] = (colour * [.46, .43, .52], alpha)
    # Normalized full-canvas sockets, opening south (y down).
    def socket(cells, dx, dy): return {'x': round(.5 + dx / cells, 6), 'y': round(.5 + dy / cells, 6), 'z': 0}
    cells = ASSETS['spawn-structure']['canvasCells']
    sockets = {'spawn-structure': {'mouth': socket(cells, 0, 2), 'core': socket(cells, 0, -.5)},
               'spawn-brood-pit': {'orifice': socket(ASSETS['spawn-brood-pit']['canvasCells'], 0, 0)}}
    for asset, layers, emit in (('spawn-structure', building, lambda s, a, al: building_emission(a, al)),
                                ('spawn-brood-pit', pit, lambda s, a, al: pit_emission(a, al, s))):
        spec = ASSETS[asset]
        folder = os.path.join(out_root, asset)
        os.makedirs(folder, exist_ok=True)
        for state in spec['states']:
            a, alpha = layers[state]
            canvas(rgba(a, alpha), spec['canvasCells'], spec['sourceSize']).save(os.path.join(folder, f'{state}.png'))
            for name, mask in emit(state, a, alpha).items():
                canvas(emissive(mask), spec['canvasCells'], spec['sourceSize']).save(os.path.join(folder, f'{state}-emission-{name}.png'))
        with open(os.path.join(folder, 'sockets.json'), 'w', newline='\n') as handle:
            json.dump({'canvasCells': spec['canvasCells'], 'sourceSize': spec['sourceSize'], 'sockets': sockets[asset]}, handle, indent=2)
            handle.write('\n')
        print(f'{asset}: {", ".join(spec["states"])} -> {os.path.relpath(folder, ROOT)}')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'painted-a')
