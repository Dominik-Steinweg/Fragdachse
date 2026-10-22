"""Bone-proximity mask for ground.py: the south building frame, dilated and blurred on the ground canvas.

    python -I scripts/asset-pipeline/spawn-carcass/proximity.py <label of a previous export>
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[3]
label = sys.argv[1] if len(sys.argv) > 1 else 'v7'
bones = Image.open(ROOT / f'art/poc/spawn-structure/blender/{label}/spawn-structure/intact-south.png').getchannel('A')
canvas = Image.new('L', (704, 704), 0)            # 11 cells at 64 px; the building frame spans 9 cells
canvas.paste(bones, (64, 64))
mask = canvas.point(lambda v: 255 if v > 40 else 0).filter(ImageFilter.MaxFilter(41)).filter(ImageFilter.GaussianBlur(20))
mask = np.clip(np.asarray(mask).astype(float) / 255 * 1.5, 0, 1)
out = ROOT / 'build/spawn-structure/live/bone-proximity.png'
out.parent.mkdir(parents=True, exist_ok=True)
Image.fromarray((mask * 255).astype('uint8')).save(out)
print(out)
