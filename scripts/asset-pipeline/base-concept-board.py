"""Concept boards for the rustic base styles (system Python with Pillow and NumPy).

python base-concept-board.py <concept-folder> [--badger public/assets/sprites/32x32dachs.png] [--styles burg,fort,hut,camp]
       [--round R1]
Writes board-<style>.png per style, board-overview.png and kit-proof-<style>.png into the folder.
Renders are 2x source (64 px per metre); boards show them at 1:1 game scale (32 px per metre).
The kit proof composes the outpost sheet from the 47 kit frames by mask and sets it beside the
whole render of the same sheet, with their amplified difference.
"""
import argparse
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont

BG, INK, MUTED = (30, 33, 36), (228, 224, 212), (150, 152, 146)
NAMES = dict(burg='Burg', fort='Westernfort', hut='Waldhütte', camp='Pfadfinderlager')
PX = 64  # source pixels per metre
N, NE, E, SE, S, SW, W, NW = 1, 2, 4, 8, 16, 32, 64, 128


def font(size):
    for name in ('segoeui.ttf', 'arial.ttf'):
        try: return ImageFont.truetype(name, size)
        except OSError: pass
    return ImageFont.load_default()


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


def game(im):
    return im.resize((im.width // 2, im.height // 2), Image.LANCZOS)


def with_badger(im, badger, x, y):
    if badger: im.paste(badger, (x - 16, y - 16), badger)
    return im


def label(draw, xy, text, size=17, fill=INK):
    draw.text(xy, text, fill=fill, font=font(size))


def kit_proof(folder, style, shapes):
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
    stats = dict(meanDiff=float(diff[covered].mean()), p99Diff=float(np.percentile(diff[covered], 99)),
                 above24=float((diff[covered] > 24).mean()))
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


def style_board(folder, style, badger, round_label):
    core = {v: Image.open(folder / f'{style}-core' / f'{v}.png').convert('RGB') for v in ('day', 'night', 'oblique')}
    outposts = {v: Image.open(folder / f'{style}-outposts' / f'{v}.png').convert('RGB') for v in ('day', 'night')}
    day, night = game(core['day']), game(core['night'])
    with_badger(day, badger, day.width // 2, day.height // 2); with_badger(night, badger, night.width // 2, night.height // 2)
    detail = core['day'].crop((70, 70, 390, 390))
    oblique = core['oblique']
    bbox = oblique.getbbox()
    oblique = oblique.resize((int(oblique.width * 352 / oblique.height), 352), Image.LANCZOS)
    o_day, o_night = game(outposts['day']), game(outposts['night'])
    with_badger(o_day, badger, 16 * 13 + 4, 16 * 15)
    gap = 20
    row_a = [('Kern · Tag 1:1', day), ('Kern · Nacht 1:1', night), ('Ecke · 2×', detail), ('Schrägansicht (nur zur Form)', oblique)]
    row_b = [('Vorposten · Tag 1:1', o_day), ('Vorposten · Nacht 1:1', o_night)]
    width = max(sum(im.width for _, im in row) + gap * (len(row) + 1) for row in (row_a, row_b))
    height = 84 + 30 + max(im.height for _, im in row_a) + gap + 30 + max(im.height for _, im in row_b) + gap
    board = Image.new('RGB', (width, height), BG)
    d = ImageDraw.Draw(board)
    label(d, (gap, 12), f'{round_label} · {NAMES[style]}', 26)
    label(d, (gap, 48), '1:1 = Spielgröße (32 px = 1 m), Dachs zum Vergleich · Tag/Nacht sind Blender-Stimmungsbilder, '
                        'im Spiel kommen Licht und Schatten aus der Laufzeit', 15, MUTED)
    y = 84
    for row in (row_a, row_b):
        x = gap
        for text, im in row:
            label(d, (x, y), text, 16)
            board.paste(im, (x, y + 28))
            x += im.width + gap
        y += 28 + max(im.height for _, im in row) + gap
    board.save(folder / f'board-{style}.png')


def overview(folder, styles, badger, round_label):
    cols = []
    for style in styles:
        day = game(Image.open(folder / f'{style}-core' / 'day.png').convert('RGB'))
        night = game(Image.open(folder / f'{style}-core' / 'night.png').convert('RGB'))
        outposts = Image.open(folder / f'{style}-outposts' / 'day.png').convert('RGB')
        outposts = outposts.resize((352, int(outposts.height * 352 / outposts.width)), Image.LANCZOS)
        with_badger(day, badger, 176, 176)
        cols.append((style, day, night, outposts))
    gap = 18
    width = len(cols) * (352 + gap) + gap
    height = 84 + 30 + 352 + gap + 352 + gap + 30 + cols[0][3].height + gap
    board = Image.new('RGB', (width, height), BG)
    d = ImageDraw.Draw(board)
    label(d, (gap, 12), f'{round_label} · Rustikale Basis – vier Startentwürfe', 26)
    label(d, (gap, 48), 'Kern Tag und Nacht in Spielgröße 1:1 · Vorposten-Set verkleinert (½)', 15, MUTED)
    for i, (style, day, night, outposts) in enumerate(cols):
        x = gap + i * (352 + gap)
        label(d, (x, 84), NAMES[style], 19)
        board.paste(day, (x, 114)); board.paste(night, (x, 114 + 352 + gap))
        label(d, (x, 114 + 2 * (352 + gap)), 'Vorposten (½)', 15, MUTED)
        board.paste(outposts, (x, 114 + 2 * (352 + gap) + 26))
    board.save(folder / 'board-overview.png')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('folder')
    ap.add_argument('--badger')
    ap.add_argument('--styles', default='burg,fort,hut,camp')
    ap.add_argument('--round', default='R1')
    args = ap.parse_args()
    folder = Path(args.folder)
    badger = Image.open(args.badger).convert('RGBA').resize((32, 32), Image.LANCZOS) if args.badger else None
    shapes = json.loads((Path(__file__).with_name('base-structure-shapes.json')).read_text(encoding='utf8'))
    styles = args.styles.split(',')
    proof = {}
    for style in styles:
        style_board(folder, style, badger, args.round)
        if (folder / f'{style}-kit' / 'top.png').exists(): proof[style] = kit_proof(folder, style, shapes)
    overview(folder, styles, badger, args.round)
    (folder / 'kit-proof.json').write_text(json.dumps(proof, indent=2), encoding='utf8')
    print(json.dumps(proof, indent=1))


if __name__ == '__main__':
    main()
