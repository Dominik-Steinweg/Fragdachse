"""Void flora source processing: chroma-key cutout, canvas normalisation, emissive mask.

Cut-out from a raw Antigravity JPG or ComfyUI PNG (flat #00FF00 key):
    python -I void_flora.py <raw.jpg> <out_dir> <name> <family> [--fill F] [--gain G] [--match ref.png,...]
--match pulls the base tissue colour (mean/spread per channel) to that of approved sources, so a
second generator reads as the same material.
Re-derive masks from committed sources (bit-exact, no raw needed):
    python -I void_flora.py --mask-only <void-*.png>... [--gain G]
family: pad | group | nest | strip | lichen | overhang
Writes <name>.png (RGBA, authored alpha) and <name>-emissive.png (8-bit L, identical canvas,
zero wherever the colour is transparent).
"""
import sys, json
import numpy as np
from PIL import Image, ImageFilter

# Fraction of the canvas the plant's alpha bbox occupies (matches the v8 sources).
FILL = {'pad': .71, 'group': .72, 'nest': .73, 'strip': .82, 'lichen': .77, 'overhang': .82}
# Canvas aspect (w/h) for families whose exporter keeps the canvas (preserveCanvas); None = bbox aspect.
ASPECT = {'nest': 1768 / 1178}


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def key_out(rgb):
    """Alpha from green dominance; colour decontaminated against the measured key."""
    h, w, _ = rgb.shape
    border = np.concatenate([rgb[:8].reshape(-1, 3), rgb[-8:].reshape(-1, 3),
                             rgb[:, :8].reshape(-1, 3), rgb[:, -8:].reshape(-1, 3)])
    key = np.median(border, axis=0)
    g = rgb[..., 1] - np.maximum(rgb[..., 0], rgb[..., 2])
    g_key = key[1] - max(key[0], key[2])
    # Plant pixels have g <= ~25 (dark green remnants); background ~g_key.
    lo, hi = 28.0, g_key * .82
    alpha = 1 - np.clip((g - lo) / (hi - lo), 0, 1)
    a = alpha[..., None]
    colour = np.where(a > .02, (rgb - (1 - a) * key) / np.maximum(a, 1e-3), 0)
    colour = np.clip(colour, 0, 255)
    # Despill fringe: green may not exceed the larger of red/blue by more than a little.
    fringe = alpha < .995
    cap = np.maximum(colour[..., 0], colour[..., 2]) + 6
    colour[..., 1] = np.where(fringe, np.minimum(colour[..., 1], cap), colour[..., 1])
    # Kill isolated low-alpha JPEG haze in the background.
    alpha = np.where(alpha < .04, 0, alpha)
    return colour, alpha, key


def _box(x, r, axis):
    pad = [(0, 0)] * x.ndim
    pad[axis] = (r + 1, r)
    c = np.cumsum(np.pad(x, pad, mode='edge'), axis=axis, dtype=np.float64)
    hi = np.take(c, range(2 * r + 1, c.shape[axis]), axis=axis)
    lo = np.take(c, range(0, c.shape[axis] - 2 * r - 1), axis=axis)
    return ((hi - lo) / (2 * r + 1)).astype(np.float32)


def blur(x, sigma):
    """Float gaussian approximation (three box passes per axis)."""
    x = np.float32(x)
    if sigma < 1:
        k = np.exp(-np.arange(-2, 3) ** 2 / (2 * sigma * sigma)); k /= k.sum()
        for axis in (0, 1):
            x = sum(w * np.roll(x, s, axis) for s, w in zip(range(-2, 3), k))
        return x
    r = max(1, int(round(np.sqrt(12 * sigma * sigma / 3 + 1) - 1) // 2))
    for axis in (0, 1):
        for _ in range(3):
            x = _box(x, r, axis)
    return x


def tame_highlights(colour, limit=118.0):
    """Darken stray bright non-violet specks (cream nicks, JPEG sparkle); violet tissue untouched."""
    r, g, b = colour[..., 0], colour[..., 1], colour[..., 2]
    hue = smoothstep(-10, 25, r - g) * smoothstep(-40, 10, b - r)
    peak = colour.max(-1)
    scale = np.minimum(1, limit / np.maximum(peak, 1))
    return colour * (1 - (1 - scale) * (1 - hue))[..., None]


def tissue(colour, alpha):
    """Opaque base tissue without the bright violet veins and spore points."""
    return (alpha > .8) & (emissive(colour, alpha) < .08)


def match_palette(colour, alpha, refs):
    """Per-channel mean/spread transfer of the base tissue onto the references' tissue; veins move along."""
    target = []
    for ref in refs:
        rgba = np.asarray(Image.open(ref).convert('RGBA')).astype(np.float32)
        target.append(rgba[..., :3][tissue(rgba[..., :3], rgba[..., 3] / 255)])
    target = np.concatenate(target)
    own = colour[tissue(colour, alpha)]
    ratio = np.clip(target.std(0) / np.maximum(own.std(0), 1e-3), .75, 1.33)
    out = (colour - own.mean(0)) * ratio + target.mean(0)
    return np.where(alpha[..., None] > 0, np.clip(out, 0, 255), colour)


def emissive(colour, alpha, gain=1.0):
    """Glowing veins/spore points only: violet chroma, adaptive to the image, high-passed
    so broad bruise mottling stays dark while thin veins and dots light up."""
    r, g, b = colour[..., 0], colour[..., 1], colour[..., 2]
    # Hue gate: red must sit between green and blue (violet, not pure blue/cyan or magenta).
    hue = smoothstep(-10, 25, r - g) * smoothstep(-40, 10, b - r)
    s = (b - g) * hue
    solid = alpha > .9
    p = float(np.percentile(s[solid], 99.6)) if solid.any() else 120.0
    hi, lo = .82 * p, max(38.0, .46 * p)
    level = smoothstep(lo, hi, s)
    local = s - blur(s * alpha, 14) / np.maximum(blur(alpha, 14), 1e-3)
    detail = smoothstep(2, 22, local)
    # Erode the coverage so decontaminated rim pixels can never form a glowing outline.
    inner = Image.fromarray(np.uint8(np.round(alpha * 255)), 'L').filter(ImageFilter.MinFilter(7))
    inner = np.asarray(inner).astype(np.float32) / 255
    m = np.clip(level * (.35 + .65 * detail) * gain, 0, 1) * inner
    return blur(m, .6) * alpha


def normalise(colour, alpha, family, fill):
    """Trim to the plant and re-pad to the v8 canvas fill; straight RGBA, zero RGB where transparent."""
    ys, xs = np.where(alpha > .03)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    bw, bh = x1 - x0, y1 - y0
    aspect = ASPECT.get(family)
    if aspect:
        cw = max(bw / fill, bh / fill * aspect)
        ch = cw / aspect
    else:
        cw, ch = bw / fill, bh / fill
    cw, ch = int(round(cw)), int(round(ch))
    ox, oy = (cw - bw) // 2, (ch - bh) // 2
    rgba = np.zeros((ch, cw, 4), np.float32)
    rgba[oy:oy + bh, ox:ox + bw, :3] = colour[y0:y1, x0:x1]
    rgba[oy:oy + bh, ox:ox + bw, 3] = alpha[y0:y1, x0:x1] * 255
    rgba[..., :3] *= rgba[..., 3:4] > 0
    return np.uint8(np.round(rgba))


def mask_from_source(path, gain=1.0):
    """Emissive mask derived from the saved 8-bit source, so it is reproducible from the repo alone."""
    rgba = np.asarray(Image.open(path).convert('RGBA')).astype(np.float32)
    alpha = rgba[..., 3] / 255
    em = emissive(rgba[..., :3], alpha, gain)
    out = path[:-4] + '-emissive.png'
    Image.fromarray(np.uint8(np.round(np.clip(em, 0, 1) * 255)), 'L').save(out, optimize=True)
    return alpha, em


def arg(flag, default):
    return float(sys.argv[sys.argv.index(flag) + 1]) if flag in sys.argv else default


def sarg(flag):
    return sys.argv[sys.argv.index(flag) + 1] if flag in sys.argv else None


def main():
    gain = arg('--gain', 1.0)
    if sys.argv[1] == '--mask-only':
        for path in sys.argv[2:]:
            if path.endswith('.png') and not path.endswith('-emissive.png'):
                mask_from_source(path, gain)
        return
    raw, out_dir, name, family = sys.argv[1:5]
    rgb = np.asarray(Image.open(raw).convert('RGB')).astype(np.float32)
    colour, alpha, key = key_out(rgb)
    if sarg('--match'):
        colour = match_palette(colour, alpha, sarg('--match').split(','))
    colour = tame_highlights(colour)
    rgba = normalise(colour, alpha, family, arg('--fill', FILL[family]))
    path = f'{out_dir}/{name}.png'
    Image.fromarray(rgba, 'RGBA').save(path, optimize=True)
    a, em = mask_from_source(path, gain)
    print(json.dumps({'name': name, 'size': [rgba.shape[1], rgba.shape[0]], 'key': [round(float(k)) for k in key],
                      'coverage': round(float((a > .5).mean()), 3),
                      'emissiveShare': round(float((em > .25).sum() / max(1, (a > .5).sum())), 3)}))


main()
