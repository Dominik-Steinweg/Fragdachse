import type * as Phaser from 'phaser';
import { getPipelineAssetForTexture, type PipelineClip } from '../config/pipelineAssets';
import type { EnergyConeState } from '../systems/EnergyConeState';

type ClipSource = (name: string) => Pick<PipelineClip, 'frames' | 'markers' | 'frameRate'> | undefined;

/** The wind-up reaches the `strike` pose at this share of the windup and holds it until the impulse. */
const WINDUP_READY_SHARE = 0.75;

/**
 * Texture frame of the energy cone pose, or null when no cone pose applies. The alien has no cast
 * clip: the wind-up half of `claw` (frames 0..strike) stretches over the windup, and the strike
 * half plays from `hitAt` at the clip's own frame rate. Pure presentation of host timestamps.
 */
export function energyConeClipFrame(state: EnergyConeState | undefined, now: number, clip: ClipSource): number | null {
  const attack = state?.attack;
  if (!state || !attack || state.phase === 'none') return null;
  const claw = clip('claw');
  if (!claw?.frames.length) return null;
  const last = claw.frames.length - 1;
  const strike = Math.min(last, Math.max(0, claw.markers?.strike ?? Math.floor(last / 2)));
  if (now < attack.hitAt) {
    const progress = Math.max(0, Math.min(1, (now - attack.startedAt) / Math.max(1, attack.hitAt - attack.startedAt)));
    return claw.frames[Math.round(Math.min(1, progress / WINDUP_READY_SHARE) * strike)];
  }
  const frameMs = 1000 / Math.max(1, claw.frameRate ?? 24);
  const index = strike + Math.floor((now - attack.hitAt) / frameMs);
  // After the strike half the pose ends; the walking clip resumes.
  return index > last ? null : claw.frames[index];
}

export function syncEnemyEnergyConeAnimation(sprite: Phaser.GameObjects.Sprite, texture: string,
  state: EnergyConeState | undefined, now: number, blocked: boolean): boolean {
  if (blocked) return false;
  const clips = getPipelineAssetForTexture(texture)?.clips;
  const frame = energyConeClipFrame(state, now, name => clips?.find(c => c.name === name));
  if (frame === null) return false;
  if (sprite.anims.isPlaying) sprite.anims.stop();
  sprite.setFrame(frame);
  return true;
}
