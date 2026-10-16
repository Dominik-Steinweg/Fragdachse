import type * as Phaser from 'phaser';
import { getPipelineAssetForTexture, type PipelineClip } from '../config/pipelineAssets';
import type { KaboomtulaState } from '../systems/KaboomtulaState';
import { leapClipFrame } from './leapPresentation';

type ClipSource = (name: string) => Pick<PipelineClip, 'frames' | 'markers' | 'frameRate'> | undefined;

/** The crouch before take-off: the spider keeps running through the telegraph and only dips at its end. */
const POUNCE_CROUCH_MS = 140;
/** Follow-through of the spit after the web left the fangs (presentation only). */
const SPIT_TAIL_MS = 220;

function stretch(frames: readonly number[], from: number, to: number, startAt: number, endAt: number, now: number): number {
  const progress = Math.max(0, Math.min(1, (now - startAt) / Math.max(1, endAt - startAt)));
  return frames[Math.round(from + (to - from) * progress)]!;
}

/**
 * Texture frame of a Kabummtula, or null when the ordinary walk sheet applies. Every clip follows
 * the replicated host timeline: `alert` over the threat pause, the `leap` crouch right before the
 * launch, its airborne span over the flight and its landing tail over the recovery, `claw` (spit)
 * with its impact marker on the moment the web leaves. Missing clips fall back to the walk sheet.
 */
export function kaboomtulaClipFrame(state: KaboomtulaState, now: number, clip: ClipSource): number | null {
  switch (state.phase) {
    case 'alert': {
      const alert = clip('alert');
      if (!alert?.frames.length) return null;
      return stretch(alert.frames, 0, alert.frames.length - 1, state.startedAt, state.endsAt, now);
    }
    case 'pounce': {
      const leap = clip('leap');
      const crouchAt = Math.max(state.startedAt, state.endsAt - POUNCE_CROUCH_MS);
      if (!leap?.frames.length || now < crouchAt) return null;
      return leapClipFrame(leap, 'crouch', crouchAt, state.endsAt, now);
    }
    case 'leap': {
      const leap = clip('leap'), jump = state.leap;
      if (!leap?.frames.length || !jump) return null;
      return leapClipFrame(leap, 'air', jump.takeoffAt, jump.landAt, now);
    }
    case 'recover': {
      const leap = clip('leap');
      if (!leap?.frames.length) return null;
      return leapClipFrame(leap, 'land', state.startedAt, state.endsAt, now);
    }
    case 'spit': {
      const spit = clip('claw');
      if (!spit?.frames.length) return null;
      const last = spit.frames.length - 1;
      const impact = Math.min(last, Math.max(0, spit.markers?.impact ?? Math.round(last * 0.6)));
      if (now < state.endsAt) return stretch(spit.frames, 0, impact, state.startedAt, state.endsAt, now);
      if (now >= state.endsAt + SPIT_TAIL_MS) return null;
      return stretch(spit.frames, impact, last, state.endsAt, state.endsAt + SPIT_TAIL_MS, now);
    }
    default: return null;
  }
}

export function syncEnemyKaboomtulaAnimation(sprite: Phaser.GameObjects.Sprite, texture: string,
  state: KaboomtulaState, now: number, blocked: boolean): boolean {
  if (blocked) return false;
  const clips = getPipelineAssetForTexture(texture)?.clips;
  const frame = kaboomtulaClipFrame(state, now, name => clips?.find(c => c.name === name));
  if (frame === null) return false;
  if (sprite.anims.isPlaying) sprite.anims.stop();
  sprite.setFrame(frame);
  return true;
}
