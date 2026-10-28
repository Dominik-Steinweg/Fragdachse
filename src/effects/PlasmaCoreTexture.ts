import type Phaser from 'phaser';
import { ensureCanvasTexture } from './EffectUtils';

export const TEX_PLASMA_CORE = '__turret_plasma_core';
export const PLASMA_CORE_FRAMES = 16;
const SIZE = 32;

/** Plasma colour by energy: deep blue at the rim, cyan filaments, a white-hot heart. */
const PLASMA_RAMP: readonly (readonly [number, number, number, number])[] = [
  [0, 8, 30, 74], [.3, 18, 92, 176], [.55, 46, 176, 236], [.8, 136, 232, 255], [1, 238, 252, 255],
];

function hash(x: number, y: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(x: number, y: number): number {
  return .55 * valueNoise(x, y) + .3 * valueNoise(x * 2.1 + 5.2, y * 2.1 - 1.7) + .15 * valueNoise(x * 4.3 - 3.1, y * 4.3 + 8.4);
}

/**
 * The plasma charge of the plasma turret seen from above, as a looping strip of frames: a ball of
 * energy whose filaments swirl round a white-hot heart and whose turbulence churns. Time runs on a
 * circle through the noise field, so the last frame flows into the first.
 */
export function ensurePlasmaCoreTexture(scene: Phaser.Scene): void {
  ensureCanvasTexture(scene.textures, TEX_PLASMA_CORE, SIZE * PLASMA_CORE_FRAMES, SIZE, (ctx, canvas) => {
    const image = ctx.createImageData(SIZE * PLASMA_CORE_FRAMES, SIZE);
    for (let frame = 0; frame < PLASMA_CORE_FRAMES; frame++) {
      const t = frame / PLASMA_CORE_FRAMES * Math.PI * 2;
      const ox = Math.cos(t) * .9, oy = Math.sin(t) * .9;
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          const u = (x + .5) / SIZE * 2 - 1, v = (y + .5) / SIZE * 2 - 1;
          const r = Math.hypot(u, v);
          if (r >= 1) continue;
          const a = Math.atan2(v, u);
          const turbulence = fbm(u * 2.4 + ox, v * 2.4 + oy);
          // Two spiral arms turning once per loop, bent by the turbulence.
          const arms = .5 + .5 * Math.sin(2 * a + 7 * r - t + 4 * (turbulence - .5));
          const filaments = Math.pow(arms, 3) * (1 - r * .6);
          const heart = Math.max(0, 1 - r / .42);
          const energy = Math.min(1, .18 + .55 * filaments + .35 * turbulence * (1 - r) + .75 * heart * heart);
          let stop = 1;
          while (stop < PLASMA_RAMP.length - 1 && PLASMA_RAMP[stop][0] < energy) stop += 1;
          const [e0, r0, g0, b0] = PLASMA_RAMP[stop - 1], [e1, r1, g1, b1] = PLASMA_RAMP[stop];
          const f = Math.min(1, Math.max(0, (energy - e0) / (e1 - e0)));
          const edge = Math.min(1, (1 - r) / .16);
          const i = (y * SIZE * PLASMA_CORE_FRAMES + frame * SIZE + x) * 4;
          image.data[i] = Math.round(r0 + (r1 - r0) * f);
          image.data[i + 1] = Math.round(g0 + (g1 - g0) * f);
          image.data[i + 2] = Math.round(b0 + (b1 - b0) * f);
          image.data[i + 3] = Math.round(255 * edge * edge * (3 - 2 * edge));
        }
      }
    }
    ctx.putImageData(image, 0, 0);
    for (let frame = 0; frame < PLASMA_CORE_FRAMES; frame++) canvas.add(frame, 0, frame * SIZE, 0, SIZE, SIZE);
  });
}
