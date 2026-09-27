import type * as Phaser from 'phaser';
import { getPipelineAssetForTexture } from '../config/pipelineAssets';
import { clawFrameIndex, type EnemyClawAttack } from '../systems/EnemyClawAttack';

export function syncEnemyClawAnimation(sprite: Phaser.GameObjects.Sprite, staticTexture: string, attack: EnemyClawAttack, now: number): boolean {
  const asset = getPipelineAssetForTexture(staticTexture);
  const clip = asset?.clips.find(clip => clip.name === 'claw') as {
    frames: readonly number[]; markers?: { strike: number; impact: number };
  } | undefined;
  if (!clip?.markers || !asset) return false;
  if (sprite.anims.isPlaying) sprite.anims.stop();
  const index = clawFrameIndex(attack, now, clip.frames.length, clip.markers);
  sprite.setFrame(clip.frames[index]);
  return true;
}
