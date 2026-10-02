import { GPU_VFX_DEATH_MORPH_FRAME_IDS, GPU_VFX_DEATH_MORPH_VARIANT_FRAME_IDS, type GpuVfxFrameId as GpuVfxFrameIdType } from './GpuVfxAtlas';

/**
 * Stabile IDs fuer die wenigen GPU-seitigen Framefolgen. Die Definition bleibt absichtlich
 * kleiner als Phasers allgemeines Animationssystem: eine benannte, vorgewaermte Framefolge; das
 * einzelne Spawn-Spec bestimmt nur, ob sie benutzt wird und wie lange ihr One-Shot lebt.
 */
export const GpuVfxFrameAnimationId = {
  DeathDisintegration: 0,
  DeathDisintegrationB: 1,
  DeathDisintegrationC: 2,
  DeathDisintegrationD: 3,
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
    // DeathMorphFrames legt den zeitlichen Verlauf fest und der Atlas backt die Uebergaenge.
    // Phaser verteilt diese fein abgestuften Frames gleichmaessig ueber die Member-Animation.
    frames: GPU_VFX_DEATH_MORPH_FRAME_IDS,
  },
  ...GPU_VFX_DEATH_MORPH_VARIANT_FRAME_IDS.slice(1).map((frames, index) => ({
    id: (index + 1) as GpuVfxFrameAnimationId, name: `death-disintegration-${index + 1}`, frames,
  })),
];

export const DEATH_FRAME_ANIMATION_IDS = [GpuVfxFrameAnimationId.DeathDisintegration,
  GpuVfxFrameAnimationId.DeathDisintegrationB, GpuVfxFrameAnimationId.DeathDisintegrationC,
  GpuVfxFrameAnimationId.DeathDisintegrationD] as const;

export function getGpuVfxFrameAnimation(
  id: GpuVfxFrameAnimationId,
): GpuVfxFrameAnimationSpec {
  const animation = GPU_VFX_FRAME_ANIMATIONS[id];
  if (!animation || animation.id !== id) {
    throw new Error(`[GpuVfxFrameAnimations] Unbekannte Animation ${id}.`);
  }
  return animation;
}
