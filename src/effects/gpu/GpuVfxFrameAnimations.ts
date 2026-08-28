import { GpuVfxFrameId, type GpuVfxFrameId as GpuVfxFrameIdType } from './GpuVfxAtlas';

/**
 * Stabile IDs fuer die wenigen GPU-seitigen Framefolgen. Die Definition bleibt absichtlich
 * kleiner als Phasers allgemeines Animationssystem: eine benannte, vorgewaermte Framefolge; das
 * einzelne Spawn-Spec bestimmt nur, ob sie benutzt wird und wie lange ihr One-Shot lebt.
 */
export const GpuVfxFrameAnimationId = {
  DeathDisintegration: 0,
} as const;

export type GpuVfxFrameAnimationId =
  (typeof GpuVfxFrameAnimationId)[keyof typeof GpuVfxFrameAnimationId];

export const GPU_VFX_NO_FRAME_ANIMATION = -1;

export interface GpuVfxFrameAnimationSpec {
  readonly id: GpuVfxFrameAnimationId;
  readonly name: string;
  readonly frames: readonly GpuVfxFrameIdType[];
}

export const GPU_VFX_FRAME_ANIMATIONS: readonly GpuVfxFrameAnimationSpec[] = [
  {
    id: GpuVfxFrameAnimationId.DeathDisintegration,
    name: 'death-disintegration',
    // Acht gleich lange Frames ueber die Member-Lifetime. Der Zuschnitt ist an `positionEase`
    // CubicIn der Death-Fragmente gekoppelt: bei t = 0.5 sind erst 12,5 % der Flugstrecke
    // zurueckgelegt, die sichtbare Flugphase ist also die zweite Haelfte. Genau dort liegen
    // Dust, FineDust, Haze und Vapor.
    frames: [
      GpuVfxFrameId.DeathMorphCompact,
      GpuVfxFrameId.DeathMorphFrayed,
      GpuVfxFrameId.DeathMorphPorous,
      GpuVfxFrameId.DeathMorphFragmented,
      GpuVfxFrameId.DeathMorphDust,
      GpuVfxFrameId.DeathMorphFineDust,
      GpuVfxFrameId.DeathMorphHaze,
      GpuVfxFrameId.DeathMorphVapor,
    ],
  },
];

export function getGpuVfxFrameAnimation(
  id: GpuVfxFrameAnimationId,
): GpuVfxFrameAnimationSpec {
  const animation = GPU_VFX_FRAME_ANIMATIONS[id];
  if (!animation || animation.id !== id) {
    throw new Error(`[GpuVfxFrameAnimations] Unbekannte Animation ${id}.`);
  }
  return animation;
}
