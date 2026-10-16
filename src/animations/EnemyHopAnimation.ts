import type * as Phaser from 'phaser';
import { getPipelineAssetForTexture, type PipelineClip } from '../config/pipelineAssets';
import { enemyHopPhaseAt, type EnemyHopState } from '../systems/EnemyHopState';
import { leapClipFrame } from './leapPresentation';

type ClipSource = (name: string) => Pick<PipelineClip, 'frames' | 'markers' | 'frameRate'> | undefined;

/**
 * Texture frame of a hopping body, or null when ordinary clips apply: the `hop` clip follows the
 * replicated jump timeline (crouch to `launch`, flight to `land`, settle to the end), the looping
 * `channel` clip plays while the resting body holds heal links. Pure presentation of host state.
 */
export function hopClipFrame(state: EnemyHopState, now: number, clip: ClipSource): number | null {
  const jump = state.jump;
  const phase = enemyHopPhaseAt(state, now);
  if (jump && phase !== 'rest') {
    const hop = clip('hop');
    if (!hop?.frames.length) return null;
    return phase === 'crouch' ? leapClipFrame(hop, 'crouch', jump.crouchAt, jump.takeoffAt, now)
      : phase === 'air' ? leapClipFrame(hop, 'air', jump.takeoffAt, jump.landAt, now)
        : leapClipFrame(hop, 'land', jump.landAt, jump.settleUntil, now);
  }
  if (!state.links.length) return null;
  const channel = clip('channel');
  if (!channel?.frames.length) return null;
  const frameMs = 1000 / Math.max(1, channel.frameRate ?? 12);
  const index = Math.floor(Math.max(0, now - (jump?.settleUntil ?? 0)) / frameMs) % channel.frames.length;
  return channel.frames[index]!;
}

export function syncEnemyHopAnimation(sprite: Phaser.GameObjects.Sprite, texture: string,
  state: EnemyHopState, now: number, blocked: boolean): boolean {
  if (blocked) return false;
  const clips = getPipelineAssetForTexture(texture)?.clips;
  const frame = hopClipFrame(state, now, name => clips?.find(c => c.name === name));
  if (frame === null) return false;
  if (sprite.anims.isPlaying) sprite.anims.stop();
  sprite.setFrame(frame);
  return true;
}
