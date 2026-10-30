import type * as Phaser from 'phaser';
import { getPipelineAssetForTexture, type PipelineClip } from '../config/pipelineAssets';
import type { EnemyHeatBurstState } from '../systems/EnemyHeatBurstState';

type ClipSource = (name: string) => Pick<PipelineClip, 'frames' | 'markers' | 'frameRate'> | undefined;

/** A spit gesture is one burst per salvo: flames within this window belong to the running one. */
const SPIT_RETRIGGER_MS = 400;

function clipFrameMs(clip: Pick<PipelineClip, 'frameRate'>, fallbackFps: number): number {
  return 1000 / Math.max(1, clip.frameRate ?? fallbackFps);
}

/**
 * Texture frame of the meltdown recoil, or null when ordinary clips apply. The `burst` clip is placed
 * on the replicated timeline so its `blast` marker lands on the burst: the lead-in (the body ducks)
 * runs while the warning ends; the body leaves with the burst. Sheets without `burst` show no recoil.
 * Pure presentation of host state.
 */
export function heatBurstClipFrame(state: EnemyHeatBurstState, now: number, clip: ClipSource): number | null {
  const burst = clip('burst');
  if (!burst?.frames.length || state.burstAt <= 0) return null;
  const last = burst.frames.length - 1;
  const blast = Math.min(last, Math.max(0, burst.markers?.blast ?? Math.round(last * 0.3)));
  const frameMs = clipFrameMs(burst, 24);
  if (now < state.burstAt - blast * frameMs) return null;
  const index = blast + Math.floor((now - state.burstAt) / frameMs);
  return index >= 0 && index <= last ? burst.frames[index]! : null;
}

/** Entity-lifetime presentation of the spit gesture; started locally by the first flame of a burst. */
export class EnemySpitPlayback {
  private startedAt = Number.NEGATIVE_INFINITY;

  /** A new flame of this body appeared; the gesture restarts only for a new burst. */
  flame(now: number): void {
    if (now - this.startedAt > SPIT_RETRIGGER_MS) this.startedAt = now;
  }

  /** Texture frame of the `spit` clip: its `release` marker meets the first flame. */
  frame(clip: Pick<PipelineClip, 'frames' | 'markers' | 'frameRate'> | undefined, now: number): number | null {
    if (!clip?.frames.length || !Number.isFinite(this.startedAt)) return null;
    const last = clip.frames.length - 1;
    const release = Math.min(last, Math.max(0, clip.markers?.release ?? Math.round(last * 0.35)));
    const index = release + Math.floor((now - this.startedAt) / clipFrameMs(clip, 24));
    if (index > last) { this.startedAt = Number.NEGATIVE_INFINITY; return null; }
    return clip.frames[Math.max(0, index)]!;
  }
}

/** Plays the recoil (priority) or the spit gesture; false when ordinary clips apply. */
export function syncEnemyHeatBurstAnimation(sprite: Phaser.GameObjects.Sprite, texture: string, state: EnemyHeatBurstState,
  spit: EnemySpitPlayback, now: number, blocked: boolean): boolean {
  if (blocked) return false;
  const clips = getPipelineAssetForTexture(texture)?.clips;
  const clip: ClipSource = name => clips?.find(c => c.name === name);
  const frame = heatBurstClipFrame(state, now, clip) ?? spit.frame(clip('spit'), now);
  if (frame === null) return false;
  if (sprite.anims.isPlaying) sprite.anims.stop();
  sprite.setFrame(frame);
  return true;
}
