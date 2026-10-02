import type { GpuVfxSpawnSpec } from '../../effects/gpu/GpuVfxSpawnSpec';

export type DeathFollowSample = Pick<GpuVfxSpawnSpec, 'x' | 'y' | 'vx' | 'vy' | 'lifeMs' | 'alphaStart' | 'scaleStart' | 'stretchStart'>;

/** Main death fragments use CubicInOut. Fixed initial mass prevents camera jumps when slots retire.
 * Pure absolute-time sampling gives the same camera on direct seek, playback and export. */
export function deathFollowCenter(samples: readonly DeathFollowSample[], timeMs: number): { x: number; y: number } {
  let x = 0, y = 0, mass = 0;
  for (const s of samples) {
    const t = Math.max(0, Math.min(1, timeMs / s.lifeMs));
    const ease = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
    const weight = s.alphaStart * s.scaleStart ** 2 * s.stretchStart;
    x += (s.x + s.vx * s.lifeMs / 1000 * ease) * weight;
    y += (s.y + s.vy * s.lifeMs / 1000 * ease) * weight;
    mass += weight;
  }
  return mass > 0 ? { x: x / mass, y: y / mass } : { x: 0, y: 0 };
}
