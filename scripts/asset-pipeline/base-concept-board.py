"""Concept boards for the rustic base styles, composed onto real game ground (system Python, Pillow, NumPy).

python base-concept-board.py <concept-folder> --ground <capture-folder> [--styles burg,fort,feld,wall] [--round R1b]
  <capture-folder> holds map04-{day,night}__01-core.png and __02-meadow.png from base-ground-capture.json.
Writes board-<style>.png, board-overview.png and kit-proof-<style>.png into the concept folder.

Day: the Blender day render (structures, courtyard ground and caught shadows) over the day capture.
Night, the way the game's light map works: the night capture plus the day capture lit by the lamp
pass; structures are their day colour at the capture's night ambient plus their own lamp light.
Sample base turrets stand on some pads (40 px plasma/rocket, 32 px spore at 1:1).
Renders and captures are 64 px per metre; boards show them at 1:1 game scale (32 px per metre).
"""
import argparse
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont

BG, INK, MUTED = (30, 33, 36), (228, 224, 212), (150, 152, 146)
NAMES = dict(burg='Steinbastion', fort='Palisadenschanze', feld='Feldstellung', wall='Wallanlage')
PX = 64
ROOT = Path(__file__).resolve().parents[2]
CROPS = dict(core=('01-core', (384, 32, 1088, 736)), outposts=('02-meadow', (288, 128, 1376, 768)))
# (cell, turret, angle in degrees) on the core grid 0..6 and the outpost sheet.
TURRETS = dict(core=[((0, 0), 'plasma', 225), ((1, 0), 'rocket', 260), ((6, 1), 'spore', 0),
                     ((6, 6), 'plasma', 45), ((0, 5), 'rocket', 160), ((5, 6), 'spore', 0)],
               outposts=[((1, 1), 'plasma', 300), ((3, 1), 'rocket', 210), ((7, 2), 'spore', 0),
                         ((6, 7), 'plasma', 180), ((15, 9), 'rocket', 20)])
LAMP_GAIN = 2.4
N, NE, E, SE, S, SW, W, NW = 1, 2, 4, 8, 16, 32, 64, 128


def font(size):
    for name in ('segoeui.ttf', 'arial.ttf'):
        try: return ImageFont.truetype(name, size)
        except OSError: pass
    return ImageFont.load_default()


def label(draw, xy, text, size=17, fill=INK):
    draw.text(xy, text, fill=fill, font=font(size))


def lin(a): return np.where(a <= .04045, a / 12.92, ((a + .055) / 1.055) ** 2.4)
def srgb(a): return np.where(a <= .0031308, a * 12.92, 1.055 * np.clip(a, 0, None) ** (1 / 2.4) - .055)


def load(path):
    im = Image.open(path)
    arr = np.asarray(im, float)
    return arr / (65535.0 if arr.max() > 255 else 255.0)


def turret_layer(size, layout, scale=PX):
    """Turret sprites at 2x source scale (80/64 px) on their cells, as straight-alpha RGBA."""
    layer = Image.new('RGBA', size, (0, 0, 0, 0))
    for (gx, gy), kind, angle in TURRETS[layout]:
        sprite = Image.open(ROOT / f'public/assets/sprites/pipeline-v2/{kind}/idle.png').convert('RGBA')
        px = 64 if kind == 'spore' else 80
        sprite = sprite.resize((px, px), Image.LANCZOS).rotate(-angle, Image.BICUBIC)
        cx, cy = ((gx + 2.5) * scale, (gy + 2.5) * scale) if layout == 'core' else ((gx + .5) * scale, (gy + .5) * scale)
        layer.alpha_composite(sprite, (int(cx - px / 2), int(cy - px / 2)))
    return np.asarray(layer, float) / 255


def compose(folder, ground, style, layout):
    shot, box = CROPS[layout]
    cap_d = np.asarray(Image.open(ground / f'map04-day__{shot}.png').convert('RGB').crop(box), float) / 255
    cap_n = np.asarray(Image.open(ground / f'map04-night__{shot}.png').convert('RGB').crop(box), float) / 255
    d = folder / f'{style}-{layout}'
    day = load(d / 'day.png'); mask = load(d / 'mask.png')[:, :, 3:4]; lamp = load(d / 'lamp.png')[:, :, :3]
    a = day[:, :, 3:4]
    day_rgb = day[:, :, :3] * a + cap_d * (1 - a)
    turret = turret_layer((cap_d.shape[1], cap_d.shape[0]), layout)
    ta = turret[:, :, 3:4]
    day_rgb = turret[:, :, :3] * ta + day_rgb * (1 - ta)
    # Night: ambient ratio of the captures, then light-map style lamp light.
    ld, ln = lin(cap_d), lin(cap_n)
    ambient = float(np.clip(np.median(ln.mean(axis=2) / np.maximum(ld.mean(axis=2), .01)), .02, .4))
    light = lin(lamp) / .8 * LAMP_GAIN
    ground_n = ln + ld * light
    struct_day = lin(np.clip(day[:, :, :3], 0, 1))
    struct_n = struct_day * ambient + lin(lamp) * LAMP_GAIN
    night = struct_n * mask + ground_n * (1 - mask)
    night = lin(turret[:, :, :3]) * (ambient + light) * ta + night * (1 - ta)
    to_img = lambda x: Image.fromarray(np.clip(x * 255, 0, 255).astype('uint8'), 'RGB')
    return to_img(day_rgb), to_img(srgb(night)), ambient


def game(im):
    return im.resize((im.width // 2, im.height // 2), Image.LANCZOS)


def style_board(folder, ground, style, round_label):
    core_day, core_night, ambient = compose(folder, ground, style, 'core')
    out_day, out_night, _ = compose(folder, ground, style, 'outposts')
    oblique = Image.open(folder / f'{style}-core' / 'oblique.png').convert('RGB')
    oblique = oblique.resize((int(oblique.width * 352 / oblique.height), 352), Image.LANCZOS)
    detail = core_day.crop((96, 96, 352, 352))
    gap = 20
    row_a = [('Kern · Tag 1:1', game(core_day)), ('Kern · Nacht 1:1', game(core_night)), ('Ecke · 2×', detail),
             ('Schrägansicht (nur zur Form)', oblique)]
    row_b = [('Vorposten · Tag 1:1', game(out_day)), ('Vorposten · Nacht 1:1', game(out_night))]
    width = max(sum(im.width for _, im in row) + gap * (len(row) + 1) for row in (row_a, row_b))
    height = 84 + 30 + max(im.height for _, im in row_a) + gap + 30 + max(im.height for _, im in row_b) + gap
    board = Image.new('RGB', (width, height), BG)
    d = ImageDraw.Draw(board)
    label(d, (gap, 12), f'{round_label} · {NAMES[style]}', 26)
    label(d, (gap, 48), 'Spielboden aus Karte 04 (12:00 / 23:00), Bauten aus Blender mit Schatten und Lichtpfützen · '
                        '1:1 = 32 px pro Feld · Probetürme (Plasma, Rakete, Sporen) auf einigen Plattformen', 15, MUTED)
    y = 84
    for row in (row_a, row_b):
        x = gap
        for text, im in row:
            label(d, (x, y), text, 16)
            board.paste(im, (x, y + 28))
            x += im.width + gap
        y += 28 + max(im.height for _, im in row) + gap
    board.save(folder / f'board-{style}.png')
    return game(core_day), game(core_night), game(out_day)


def overview(folder, tiles, round_label):
    gap, w = 18, 352
    cols = list(tiles.items())
    out_h = int(tiles[cols[0][0]][2].height * w / tiles[cols[0][0]][2].width)
    height = 84 + 30 + w + gap + w + gap + 30 + out_h + gap
    board = Image.new('RGB', (len(cols) * (w + gap) + gap, height), BG)
    d = ImageDraw.Draw(board)
    label(d, (gap, 12), f'{round_label} · Rustikale Basis – vier Entwürfe, jede Zelle ein Turmplatz', 26)
    label(d, (gap, 48), 'Kern Tag und Nacht in Spielgröße 1:1 auf echtem Spielboden · Vorposten-Set verkleinert', 15, MUTED)
    for i, (style, (day, night, outposts)) in enumerate(cols):
        x = gap + i * (w + gap)
        label(d, (x, 84), NAMES[style], 19)
        board.paste(day, (x, 114)); board.paste(night, (x, 114 + w + gap))
        label(d, (x, 114 + 2 * (w + gap)), 'Vorposten (verkleinert)', 15, MUTED)
        board.paste(outposts.resize((w, out_h), Image.LANCZOS), (x, 114 + 2 * (w + gap) + 26))
    board.save(folder / 'board-overview.png')


def mask_of(cells, gx, gy):
    has = lambda x, y: (x, y) in cells
    n, e, s, w = has(gx, gy - 1), has(gx + 1, gy), has(gx, gy + 1), has(gx - 1, gy)
    mask = (N if n else 0) | (E if e else 0) | (S if s else 0) | (W if w else 0)
    if n and e and has(gx + 1, gy - 1): mask |= NE
    if s and e and has(gx + 1, gy + 1): mask |= SE
    if s and w and has(gx - 1, gy + 1): mask |= SW
    if n and w and has(gx - 1, gy - 1): mask |= NW
    return mask


def all_masks():
    found = set()
    for bits in range(256):
        mask = bits & (N | E | S | W)
        if bits & N and bits & E and bits & NE: mask |= NE
        if bits & S and bits & E and bits & SE: mask |= SE
        if bits & S and bits & W and bits & SW: mask |= SW
        if bits & N and bits & W and bits & NW: mask |= NW
        found.add(mask)
    return sorted(found)


def kit_proof(folder, style, shapes):
    """Outpost sheet composed from the 47 kit frames beside its whole render, with the difference."""
    kit = Image.open(folder / f'{style}-kit' / 'top.png').convert('RGBA')
    whole = Image.open(folder / f'{style}-outposts' / 'top.png').convert('RGBA')
    frames = {}
    for index, mask in enumerate(all_masks()):
        col, row = index % 7, index // 7
        cx, cy = ((col - 3) * 2 + 7) * PX, (7 - (3 - row) * 2) * PX
        frames[mask] = kit.crop((cx - PX // 2, cy - PX // 2, cx + PX // 2, cy + PX // 2))
    composed = Image.new('RGBA', whole.size, (0, 0, 0, 0))
    for shape in shapes['outposts']:
        ox, oy = shape['origin']
        cells = {(ox + x, oy + y) for y, row in enumerate(shape['rows']) for x, ch in enumerate(row) if ch == '#'}
        for gx, gy in cells:
            composed.alpha_composite(frames[mask_of(cells, gx, gy)], (gx * PX, gy * PX))
    flat = lambda im: np.asarray(Image.alpha_composite(Image.new('RGBA', im.size, (96, 104, 84, 255)), im).convert('RGB'), float)
    a, b = flat(composed), flat(whole)
    diff = np.abs(a - b).mean(axis=2)
    covered = (np.asarray(whole)[:, :, 3] > 8) | (np.asarray(composed)[:, :, 3] > 8)
    stats = dict(meanDiff=float(diff[covered].mean()), p99Diff=float(np.percentile(diff[covered], 99)))
    amp = Image.fromarray(np.clip(diff * 4, 0, 255).astype('uint8'), 'L').convert('RGB')
    w, h = whole.size
    board = Image.new('RGB', (w + 40, h * 3 + 150), BG)
    d = ImageDraw.Draw(board)
    label(d, (20, 12), f'Bausatz-Nachweis · {NAMES[style]} · Quellauflösung 2×', 22)
    label(d, (20, 44), f'oben: aus 47 Bausatz-Kacheln zusammengesetzt · Mitte: Gesamtrender · unten: Differenz ×4 '
                       f'(Ø {stats["meanDiff"]:.1f}, 99 % ≤ {stats["p99Diff"]:.0f} von 255)', 15, MUTED)
    for i, im in enumerate((Image.fromarray(a.astype('uint8')), Image.fromarray(b.astype('uint8')), amp)):
        board.paste(im, (20, 80 + i * (h + 20)))
    board.save(folder / f'kit-proof-{style}.png')
    return stats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('folder')
    ap.add_argument('--ground', required=True)
    ap.add_argument('--styles', default='burg,fort,feld,wall')
    ap.add_argument('--round', default='R1b')
    args = ap.parse_args()
    folder, ground = Path(args.folder), Path(args.ground)
    shapes = json.loads((Path(__file__).with_name('base-structure-shapes.json')).read_text(encoding='utf8'))
    tiles, proof = {}, {}
    for style in args.styles.split(','):
        tiles[style] = style_board(folder, ground, style, args.round)
        if (folder / f'{style}-kit' / 'top.png').exists(): proof[style] = kit_proof(folder, style, shapes)
    overview(folder, tiles, args.round)
    (folder / 'kit-proof.json').write_text(json.dumps(proof, indent=2), encoding='utf8')
    print(json.dumps(proof, indent=1))


if __name__ == '__main__':
    main()
