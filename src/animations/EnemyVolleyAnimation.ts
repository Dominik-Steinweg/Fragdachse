import type * as Phaser from 'phaser';
import { getPipelineAssetForTexture } from '../config/pipelineAssets';
import type { EnemyVolleyState } from '../systems/EnemyVolleyState';

/** After the first shot (or a cancelled gather) the cast settles back to rest over this time. */
export const VOLLEY_CAST_SETTLE_MS = 320;
/** The gesture rises at most this slowly and then holds its raised pose until the first shot. */
export const VOLLEY_CAST_RISE_MS = 700;

/**
 * Clip-local frame of the `cast` gesture: it rises towards the `release` marker early in the gather
 * and holds there, releases with the first shot and settles back afterwards; `null` outside that window.
 */
export function volleyCastFrameIndex(state: EnemyVolleyState, now: number, count: number, release: number): number | null {
  if (state.revision === 0 || now < state.chargeStartAt) return null;
  const cancelled = state.endedAt > 0 && state.endedAt < state.fireAt;
  const settleFrom = cancelled ? state.endedAt : state.fireAt;
  if (now < settleFrom) {
    const rise = Math.min(VOLLEY_CAST_RISE_MS, state.fireAt - state.chargeStartAt);
    const progress = (now - state.chargeStartAt) / Math.max(1, rise);
    return Math.min(release - 1, Math.floor(release * progress));
  }
  const t = (now - settleFrom) / VOLLEY_CAST_SETTLE_MS;
  if (t >= 1) return null;
  return Math.min(count - 1, Math.floor(release + (count - 1 - release) * t));
}

export function syncEnemyVolleyAnimation(sprite: Phaser.GameObjects.Sprite, staticTexture: string, state: EnemyVolleyState, now: number): boolean {
  const clip = getPipelineAssetForTexture(staticTexture)?.clips.find(candidate => candidate.name === 'cast') as {
    frames: readonly number[]; markers?: Record<string, number>;
  } | undefined;
  const release = clip?.markers?.release;
  if (!clip || release === undefined) return false;
  const index = volleyCastFrameIndex(state, now, clip.frames.length, release);
  if (index === null) return false;
  if (sprite.anims.isPlaying) sprite.anims.stop();
  sprite.setFrame(clip.frames[index]);
  return true;
}
