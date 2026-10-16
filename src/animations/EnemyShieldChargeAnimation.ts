import type * as Phaser from 'phaser';
import { getPipelineAssetForTexture, type PipelineClip } from '../config/pipelineAssets';
import type { ShieldChargeState } from '../systems/ShieldChargeState';
import { leapClipFrame } from './leapPresentation';

type ClipSource = (name: string) => Pick<PipelineClip, 'frames' | 'markers'> | undefined;

/** The ready pose is reached in this share of the windup and then held until the run. */
const WINDUP_READY_SHARE = 0.4;
/** Recover holds the exhausted pose and lifts the shield in the last share of the window. */
const RECOVER_RAISE_SHARE = 0.3;
const CHARGE_FRAME_MS = 45;

/**
 * Texture frame for the replicated charge phase, or null when no charge clip applies (no state,
 * phase none, or an asset without these clips). Pure presentation of host timestamps.
 */
export function shieldChargeClipFrame(state: ShieldChargeState | undefined, now: number, clip: ClipSource): number | null {
  const lane = state?.lane;
  if (!state || !lane || state.phase === 'none') return null;
  // A leap is one clip: crouch until `launch`, airborne until `land`, then the recovery tail.
  const leap = clip('leap');
  if (leap?.frames.length) {
    return state.phase === 'windup' ? leapClipFrame(leap, 'crouch', lane.startedAt, lane.runAt, now)
      : state.phase === 'run' ? leapClipFrame(leap, 'air', lane.runAt, lane.runEndsAt, now)
        : leapClipFrame(leap, 'land', lane.runEndsAt, lane.recoverUntil, now);
  }
  if (state.phase === 'windup') {
    const windup = clip('windup');
    if (!windup?.frames.length) return null;
    const ready = Math.min(windup.frames.length - 1, windup.markers?.ready ?? windup.frames.length - 1);
    const progress = clamp01((now - lane.startedAt) / Math.max(1, lane.runAt - lane.startedAt));
    return windup.frames[Math.round(clamp01(progress / WINDUP_READY_SHARE) * ready)];
  }
  if (state.phase === 'run') {
    const charge = clip('charge');
    if (!charge?.frames.length) return null;
    const index = Math.floor(Math.max(0, now - lane.runAt) / CHARGE_FRAME_MS) % charge.frames.length;
    return charge.frames[index];
  }
  const recover = clip('recover');
  if (!recover?.frames.length) return null;
  const last = recover.frames.length - 1;
  const raise = Math.min(last, Math.max(0, recover.markers?.raise ?? last));
  const progress = clamp01((now - lane.runEndsAt) / Math.max(1, lane.recoverUntil - lane.runEndsAt));
  const index = progress < 1 - RECOVER_RAISE_SHARE
    ? Math.round(progress / (1 - RECOVER_RAISE_SHARE) * raise)
    : raise + Math.round((progress - (1 - RECOVER_RAISE_SHARE)) / RECOVER_RAISE_SHARE * (last - raise));
  return recover.frames[Math.min(last, index)];
}

export function syncEnemyShieldChargeAnimation(sprite: Phaser.GameObjects.Sprite, texture: string,
  state: ShieldChargeState | undefined, now: number, blocked: boolean): boolean {
  if (blocked) return false;
  const clips = getPipelineAssetForTexture(texture)?.clips;
  const frame = shieldChargeClipFrame(state, now, name => clips?.find(c => c.name === name));
  if (frame === null) return false;
  if (sprite.anims.isPlaying) sprite.anims.stop();
  sprite.setFrame(frame);
  return true;
}

function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
