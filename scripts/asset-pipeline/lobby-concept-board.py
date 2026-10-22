"""Concept gate boards for lobby structures and staff (system Python with Pillow and NumPy).

python lobby-concept-board.py <concept-folder> <out.png> --rows id:Label,... [--variants a,b] [--badger idle.png]
Each row shows per variant: 1:1 game scale on grass with a 32 px badger, the 2x top source and the oblique view.
"""
import argparse
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont

BG = (34, 38, 42)
INK = (226, 224, 214)
MUTED = (150, 154, 150)


def grass(w, h, seed=3):
    rng = np.random.default_rng(seed)
    base = np.array([58, 72, 40], float)
    noise = rng.normal(0, 1, (h // 4 + 1, w // 4 + 1))
    noise = np.kron(noise, np.ones((4, 4)))[:h, :w]
    fine = rng.normal(0, 1, (h, w))
    tone = base[None, None, :] * (1 + .07 * noise[..., None] + .05 * fine[..., None])
    return Image.fromarray(np.clip(tone, 0, 255).astype('uint8'), 'RGB')


def font(size):
    for name in ('segoeui.ttf', 'arial.ttf'):
        try: return ImageFont.truetype(name, size)
        except OSError: pass
    return ImageFont.load_default()


def tile_game(top, badger, size):
    """Downscale the 2x source to game size, place it on grass with the player badger."""
    w = top.width // 2
    game = top.resize((w, w), Image.LANCZOS)
    pad = 24
    canvas = grass(w + pad * 2 + 48, w + pad * 2)
    canvas.paste(game, (pad, pad), game)
    if badger:
        b = badger.resize((32, 32), Image.LANCZOS)
        canvas.paste(b, (w + pad + 8, pad + w // 2 - 16), b)
    return canvas.resize((canvas.width * size, canvas.height * size), Image.NEAREST) if size > 1 else canvas


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('folder'); ap.add_argument('out')
    ap.add_argument('--rows', required=True)
    ap.add_argument('--variants', default='a,b')
    ap.add_argument('--badger')
    ap.add_argument('--title', default='Lobby-Basisgebäude · Konzept-Gate')
    ap.add_argument('--game-scale', type=int, default=1)
    ap.add_argument('--oblique-width', type=int, default=520)
    args = ap.parse_args()
    folder = Path(args.folder)
    badger = Image.open(args.badger).convert('RGBA') if args.badger else None
    rows = [r.split(':', 1) for r in args.rows.split(',')]
    variants = args.variants.split(',')
    cells = []
    for rid, label in rows:
        row = []
        for v in variants:
            d = folder / f'{rid}-{v}'
            top = Image.open(d / 'top.png').convert('RGBA')
            oblique = Image.open(d / 'oblique.png').convert('RGBA')
            bbox = oblique.getbbox() or (0, 0, oblique.width, oblique.height)
            oblique = oblique.crop((max(0, bbox[0] - 16), max(0, bbox[1] - 16), min(oblique.width, bbox[2] + 16), min(oblique.height, bbox[3] + 16)))
            scale = min(args.oblique_width / oblique.width, top.height / oblique.height)
            oblique = oblique.resize((max(1, int(oblique.width * scale)), max(1, int(oblique.height * scale))), Image.LANCZOS)
            topbg = grass(top.width, top.height, 5); topbg.paste(top, (0, 0), top)
            row.append((v, tile_game(top, badger, args.game_scale), topbg, oblique))
        cells.append((label, row))
    gap, head = 18, 34
    widths = [sum(g.width + t.width + o.width + gap * 3 for _, g, t, o in row) for _, row in cells]
    heights = [max(max(g.height, t.height, o.height) for _, g, t, o in row) + head for _, row in cells]
    W = max(widths) + gap * 2
    H = sum(heights) + 70 + gap * len(cells)
    board = Image.new('RGB', (W, H), BG)
    draw = ImageDraw.Draw(board)
    draw.text((gap, 14), args.title, fill=INK, font=font(26))
    draw.text((gap, 46), 'je Variante: Spielgröße 1:1 auf Gras mit 32-px-Dachs · Draufsicht 2× (Quellauflösung) · Schrägansicht nur zur Formbeurteilung',
              fill=MUTED, font=font(15))
    y = 70
    for (label, row), h in zip(cells, heights):
        x = gap
        for v, g, t, o in row:
            draw.text((x, y), f'{label} · Variante {v.upper()}', fill=INK, font=font(19))
            yy = y + head
            for im in (g, t, o):
                board.paste(im, (x, yy), im if im.mode == 'RGBA' else None)
                x += im.width + gap
            x += gap
        y += h + gap
    board.save(args.out)
    print(args.out, board.size)


if __name__ == '__main__':
    main()
