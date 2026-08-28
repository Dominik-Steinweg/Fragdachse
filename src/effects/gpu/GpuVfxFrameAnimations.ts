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
    /*
     * Phaser verteilt die Frames gleichmaessig ueber die Member-Lifetime, es gibt also keine
     * Frame-eigene Dauer. Die Gewichtung entsteht deshalb ueber Wiederholungen: jeder Eintrag ist
     * ein Sechzehntel der Lifetime, `setAnimations` legt fuer jede Wiederholung einen eigenen
     * Slot an.
     *
     * Zuschnitt bei den nominellen 1350 ms Lifetime:
     *   0–338 ms    Compact, Frayed   – erkennbare Fragment-Silhouette
     *   338–506 ms  Porous, Fragmented – die Silhouette bricht auf
     *   506–675 ms  Dust, FineDust    – wenige herausbrechende Koerner
     *   675–1181 ms Haze x6           – die tragende halbtransparente Staubwolke
     *   1181–1350 ms Vapor x2         – duenner Auslauf
     *
     * Die Haze-Phase ist bewusst die laengste: sie ist der eigentliche Zielzustand des Effekts,
     * waehrend die kornigen Frames nur der Uebergang dorthin sind.
     */
    frames: [
      GpuVfxFrameId.DeathMorphCompact,
      GpuVfxFrameId.DeathMorphCompact,
      GpuVfxFrameId.DeathMorphFrayed,
      GpuVfxFrameId.DeathMorphFrayed,
      GpuVfxFrameId.DeathMorphPorous,
      GpuVfxFrameId.DeathMorphFragmented,
      GpuVfxFrameId.DeathMorphDust,
      GpuVfxFrameId.DeathMorphFineDust,
      GpuVfxFrameId.DeathMorphHaze,
      GpuVfxFrameId.DeathMorphHaze,
      GpuVfxFrameId.DeathMorphHaze,
      GpuVfxFrameId.DeathMorphHaze,
      GpuVfxFrameId.DeathMorphHaze,
      GpuVfxFrameId.DeathMorphHaze,
      GpuVfxFrameId.DeathMorphVapor,
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
