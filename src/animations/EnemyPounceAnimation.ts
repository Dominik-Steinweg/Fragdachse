import type * as Phaser from 'phaser';
import { getPipelineAssetForTexture, type PipelineClip } from '../config/pipelineAssets';
import { enemyPouncePhaseAt, type EnemyPounceState } from '../systems/EnemyPounceState';
import { leapClipFrame } from './leapPresentation';

type ClipSource = (name: string) => Pick<PipelineClip, 'frames' | 'markers' | 'frameRate'> | undefined;

/** The leap's crouch plays this long before take-off; the windup loop holds the aim stance before it. */
const POUNCE_CROUCH_MS = 160;

function stretch(frames: readonly number[], from: number, to: number, startAt: number, endAt: number, now: number): number {
  const progress = Math.max(0, Math.min(1, (now - startAt) / Math.max(1, endAt - startAt)));
  return frames[Math.round(from + (to - from) * progress)]!;
}

/**
 * Texture frame of a pouncing body, or null when ordinary clips apply. With `leap` (launch/land
 * markers) the looping `windup` holds the aim and lock, the leap crouch runs into the take-off, its
 * airborne span over the flight and its landing tail over the recovery. Sheets without `leap` (the
 * badger placeholder) stretch the `claw` lunge: lead-in to `strike` while aiming, `strike` → `impact`
 * in the air, the rest over the recovery. Pure presentation of host state.
 */
export function pounceClipFrame(state: EnemyPounceState, now: number, clip: ClipSource): number | null {
  const pounce = state.pounce;
  const phase = enemyPouncePhaseAt(state, now);
  if (!pounce || phase === 'idle') return null;
  const landing = pounce.landing;
  const takeoffAt = landing?.takeoffAt ?? pounce.lockAt;
  const leap = clip('leap');
  if (leap?.frames.length) {
    if (phase === 'air') return leapClipFrame(leap, 'air', landing!.takeoffAt, landing!.landAt, now);
    if (phase === 'recover') return leapClipFrame(leap, 'land', landing!.landAt, landing!.recoverUntil, now);
    const crouchAt = takeoffAt - POUNCE_CROUCH_MS;
    if (landing && now >= crouchAt) return leapClipFrame(leap, 'crouch', crouchAt, takeoffAt, now);
    const windup = clip('windup');
    if (!windup?.frames.length) return leap.frames[0]!;
    const frameMs = 1000 / Math.max(1, windup.frameRate ?? 12);
    return windup.frames[Math.floor(Math.max(0, now - pounce.aimAt) / frameMs) % windup.frames.length]!;
  }
  const claw = clip('claw');
  if (!claw?.frames.length) return null;
  const last = claw.frames.length - 1;
  const strike = Math.min(last, Math.max(0, claw.markers?.strike ?? Math.round(last * 0.4)));
  const impact = Math.min(last, Math.max(strike, claw.markers?.impact ?? Math.round(last * 0.6)));
  if (phase === 'air') return stretch(claw.frames, strike, impact, landing!.takeoffAt, landing!.landAt, now);
  if (phase === 'recover') return stretch(claw.frames, impact, last, landing!.landAt, landing!.recoverUntil, now);
  return stretch(claw.frames, 0, strike, pounce.aimAt, takeoffAt, now);
}

export function syncEnemyPounceAnimation(sprite: Phaser.GameObjects.Sprite, texture: string,
  state: EnemyPounceState, now: number, blocked: boolean): boolean {
  if (blocked) return false;
  const clips = getPipelineAssetForTexture(texture)?.clips;
  const frame = pounceClipFrame(state, now, name => clips?.find(c => c.name === name));
  if (frame === null) return false;
  if (sprite.anims.isPlaying) sprite.anims.stop();
  sprite.setFrame(frame);
  return true;
}
