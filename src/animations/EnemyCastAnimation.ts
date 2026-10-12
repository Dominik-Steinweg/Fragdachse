import type * as Phaser from 'phaser';
import { getPipelineAssetForTexture, type PipelineClip } from '../config/pipelineAssets';
import { firestarterChargeProgress, sampleFirestarterCharge, type FirestarterChargeSample } from '../effects/FirestarterChargeProgress';

/** Entity-lifetime presentation only. No timers, scene listeners or replicated fields. */
export class EnemyCastPlayback {
  private charge: FirestarterChargeSample | null = null;
  private charging = false;
  private burst: { at: number; orb: boolean } | null = null;

  orb(now: number): void { if (!this.charging) this.burst = { at: now, orb: true }; }
  reset(): void { this.charge = null; this.charging = false; this.burst = null; }

  frame(clip: Pick<PipelineClip, 'frames' | 'markers'> | undefined, action: string, reported: number,
    now: number, telegraphMs: number, commitMs: number, blocked = false): number | null {
    const aim = clip?.markers?.aim, release = clip?.markers?.release;
    if (blocked || !clip || aim === undefined || release === undefined || aim < 1 || release <= aim || release >= clip.frames.length) {
      this.reset(); return null;
    }
    if (action === 'fire-lance-charge') {
      this.charge = sampleFirestarterCharge(this.charge, reported, now);
      this.charging = true; this.burst = null;
      const progress = firestarterChargeProgress(this.charge, now, telegraphMs);
      const commitAt = Math.max(.001, 1 - commitMs / telegraphMs);
      return clip.frames[Math.min(aim, Math.floor(Math.min(1, progress / commitAt) * aim))];
    }
    if (this.charging && action === 'none') this.burst = { at: now, orb: false };
    this.charging = false; this.charge = null;
    if (action !== 'none') { this.burst = null; return null; }
    if (!this.burst) return null;
    const elapsed = Math.max(0, now - this.burst.at), duration = this.burst.orb ? 140 : 200;
    if (elapsed >= duration) { this.burst = null; return null; }
    const first = this.burst.orb ? aim : release;
    return clip.frames[Math.min(clip.frames.length - 1, first + Math.floor(elapsed / duration * (clip.frames.length - first)))];
  }
}

export function syncEnemyCastAnimation(sprite: Phaser.GameObjects.Sprite, texture: string, playback: EnemyCastPlayback,
  action: string, reported: number, now: number, telegraphMs: number, commitMs: number, blocked: boolean): boolean {
  const clip = getPipelineAssetForTexture(texture)?.clips.find(c => c.name === 'cast');
  const frame = playback.frame(clip, action, reported, now, telegraphMs, commitMs, blocked);
  if (frame === null) return false;
  if (sprite.anims.isPlaying) sprite.anims.stop();
  sprite.setFrame(frame);
  return true;
}
