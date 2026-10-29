import type * as Phaser from 'phaser';
import { getPipelineAssetForTexture, type PipelineClip } from '../config/pipelineAssets';
import { enemyPounceAirProgress, enemyPouncePhaseAt, type EnemyPounceState } from '../systems/EnemyPounceState';
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

/** Take-off signal of a pouncing body: void glow, light share and coil, each 0..1. */
export interface PounceMenace {
  readonly glow: number;
  readonly light: number;
  readonly coil: number;
}

const NO_MENACE: PounceMenace = Object.freeze({ glow: 0, light: 0, coil: 0 });
/** Quiet build-up while aiming; the lock carries the real rise. */
const MENACE_AIM_GLOW = 0.25;
const MENACE_TAKEOFF_GLOW = 0.85;
/** Short flicker on top of the rise during the crouch, so the take-off moment reads. */
const MENACE_CROUCH_PULSE = 0.15;
const MENACE_CROUCH_PULSE_MS = 90;
const MENACE_LANDED_GLOW = 0.2;

const smooth = (t: number): number => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };

/**
 * The body announces its own take-off instead of a lane across the ground: a void glow that swells
 * quietly while aiming, rises through the lock with a short flicker in the crouch, and dies away
 * in the air and the recovery; the body coils (shrinks slightly) towards the take-off.
 */
export function pounceMenace(state: EnemyPounceState, now: number): PounceMenace {
  const pounce = state.pounce;
  const phase = enemyPouncePhaseAt(state, now);
  const landing = pounce?.landing;
  if (!pounce || phase === 'idle') return NO_MENACE;
  if (phase === 'aim' || !landing) {
    return { glow: MENACE_AIM_GLOW * smooth((now - pounce.aimAt) / Math.max(1, pounce.lockAt - pounce.aimAt)), light: 0, coil: 0 };
  }
  if (phase === 'lock') {
    const lockFrom = Math.min(pounce.lockAt, landing.takeoffAt);
    const rise = smooth((now - lockFrom) / Math.max(1, landing.takeoffAt - lockFrom));
    const crouch = now >= landing.takeoffAt - POUNCE_CROUCH_MS
      ? MENACE_CROUCH_PULSE * (0.5 + 0.5 * Math.sin(now * Math.PI * 2 / MENACE_CROUCH_PULSE_MS)) : 0;
    return { glow: MENACE_AIM_GLOW + (MENACE_TAKEOFF_GLOW - MENACE_AIM_GLOW) * rise + crouch, light: 0.35 + 0.65 * rise, coil: rise };
  }
  if (phase === 'air') {
    const progress = enemyPounceAirProgress(landing, now);
    return { glow: MENACE_TAKEOFF_GLOW + (MENACE_LANDED_GLOW - MENACE_TAKEOFF_GLOW) * progress, light: 1 - progress, coil: 0 };
  }
  const settle = (now - landing.landAt) / Math.max(1, landing.recoverUntil - landing.landAt);
  return { glow: MENACE_LANDED_GLOW * (1 - smooth(settle)), light: 0, coil: 0 };
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
