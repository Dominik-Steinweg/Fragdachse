import type { ProjectileExplosionConfig } from '../types';

/** Passive explosion appearance projection; never used to select a gameplay effect. */
export function projectExplosionCascadeAppearance(
  effect: ProjectileExplosionConfig,
  explosionIndex: number,
): Pick<ProjectileExplosionConfig, 'color' | 'visualStyle'> {
  const blend = explosionIndex <= 0 ? 0 : explosionIndex === 1 ? 0.28 : 0.68;
  const color = effect.color;
  const mix = (shift: number): number => Math.round(
    ((color! >> shift) & 0xff) + ((((0xff2418 >> shift) & 0xff) - ((color! >> shift) & 0xff)) * blend),
  );
  return {
    color: color === undefined || blend <= 0 ? color : (mix(16) << 16) | (mix(8) << 8) | mix(0),
    visualStyle: effect.visualStyle === 'mini_rocket' ? 'mini_rocket_cascade' : effect.visualStyle,
  };
}
