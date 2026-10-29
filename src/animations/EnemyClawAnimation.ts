import type * as Phaser from 'phaser';
import { getPipelineAssetForTexture } from '../config/pipelineAssets';
import { clawFrameIndex, type EnemyClawAttack } from '../systems/EnemyClawAttack';

type MarkedClip = { frames: readonly number[]; markers?: { strike: number; impact: number } };

/** Samples the weapon's authored clip (default `claw`); a sheet without it falls back to `claw`. */
export function syncEnemyClawAnimation(sprite: Phaser.GameObjects.Sprite, staticTexture: string, attack: EnemyClawAttack, now: number,
  clipName = 'claw', holdMs = 0): boolean {
  const asset = getPipelineAssetForTexture(staticTexture);
  const find = (name: string) => asset?.clips.find(clip => clip.name === name) as MarkedClip | undefined;
  const named = find(clipName);
  const clip = named?.markers ? named : find('claw');
  if (!clip?.markers || !asset) return false;
  if (sprite.anims.isPlaying) sprite.anims.stop();
  const index = clawFrameIndex(attack, now, clip.frames.length, clip.markers, holdMs);
  sprite.setFrame(clip.frames[index]);
  return true;
}
