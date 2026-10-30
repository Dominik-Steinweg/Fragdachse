import { enemyVolleyChargeAt, enemyVolleyPhaseAt, type EnemyVolleyState } from '../../systems/EnemyVolleyState';
import { meleeLiftProfile, type EnemyClawAttack } from '../../systems/EnemyClawAttack';

/**
 * The Grave Titan's ammunition made visible: one grave light per salvo shot. Ready lights circle
 * slowly over its back; the gather pulls them into a fast crown over the grave; every shot launches
 * the next light (the plasma flies out of it); during the pause the launched lights rise again one
 * by one out of the lantern holes. Pure presentation of the replicated volley timeline plus the
 * number of shots this client has seen launch.
 */
export const GRAVE_LIGHTS = {
  /** Orbit radii over the back as a share of the body diameter. */
  orbitMin: 0.55, orbitMax: 0.95,
  orbitSpeedMin: 0.35, orbitSpeedMax: 0.6,
  /** Crown radius over the grave (world px) and its spin while gathering (rad/s). */
  crownRadius: 52, crownSpin: 3.6,
  /** A refilled light rises out of a lantern hole at this share of the body radius and drifts to its orbit. */
  holeShare: 0.6, riseMs: 700,
  /** Lights that never launched (cancelled or cut salvo) drift back to their orbit. */
  returnMs: 520,
  size: 6.4, chargedSize: 7.2,
  intensity: 1, chargedIntensity: 1.2,
} as const;

export interface GraveLightPose {
  x: number;
  y: number;
  /** 0 = hidden (launched, not yet refilled). */
  alpha: number;
  size: number;
  intensity: number;
}

export interface GraveLightSite {
  readonly x: number;
  readonly y: number;
  /** Body diameter (collision size). */
  readonly size: number;
  /** Where the crown gathers (the lid centre). */
  readonly crownX: number;
  readonly crownY: number;
}

function hash(index: number, salt: number): number {
  const s = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function ease(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/** Lights already launched by the current cycle: seen shots, or the replicated count after its end. */
export function launchedGraveLights(state: EnemyVolleyState, seenLaunches: number, count: number): number {
  const ended = state.revision > 0 && state.endedAt > 0 ? state.shotsFired : 0;
  return Math.max(0, Math.min(count, Math.max(seenLaunches, ended)));
}

function orbitPose(index: number, site: GraveLightSite, now: number, out: { x: number; y: number }): void {
  const radius = site.size * (GRAVE_LIGHTS.orbitMin + hash(index, 1) * (GRAVE_LIGHTS.orbitMax - GRAVE_LIGHTS.orbitMin));
  const omega = (GRAVE_LIGHTS.orbitSpeedMin + hash(index, 2) * (GRAVE_LIGHTS.orbitSpeedMax - GRAVE_LIGHTS.orbitSpeedMin)) * (index % 2 ? -1 : 1);
  const angle = hash(index, 3) * Math.PI * 2 + now / 1000 * omega;
  const bob = Math.sin(now / 1000 * (0.7 + hash(index, 4)) + index) * site.size * 0.05;
  out.x = site.x + Math.cos(angle) * (radius + bob);
  out.y = site.y + Math.sin(angle) * (radius + bob) * 0.85;
}

function crownPose(index: number, count: number, site: GraveLightSite, now: number, charge: number, out: { x: number; y: number }): void {
  const angle = index / count * Math.PI * 2 + now / 1000 * GRAVE_LIGHTS.crownSpin;
  const radius = GRAVE_LIGHTS.crownRadius * (1 - 0.3 * charge);
  out.x = site.crownX + Math.cos(angle) * radius;
  out.y = site.crownY + Math.sin(angle) * radius;
}

const orbit = { x: 0, y: 0 }, crown = { x: 0, y: 0 };

/** Pose of grave light `index` of `count` at `now`; `out` is reused. */
export function graveLightPose(index: number, count: number, site: GraveLightSite, state: EnemyVolleyState, seenLaunches: number,
  now: number, out: GraveLightPose): GraveLightPose {
  orbitPose(index, site, now, orbit);
  out.x = orbit.x; out.y = orbit.y; out.alpha = 1; out.size = GRAVE_LIGHTS.size; out.intensity = GRAVE_LIGHTS.intensity;
  if (state.revision === 0) return out;
  const phase = enemyVolleyPhaseAt(state, now);
  const launched = launchedGraveLights(state, seenLaunches, count);
  if (phase === 'charge' || phase === 'fire') {
    if (index < launched) { out.alpha = 0; return out; }
    const charge = enemyVolleyChargeAt(state, now), pull = ease(charge);
    crownPose(index, count, site, now, charge, crown);
    out.x = orbit.x + (crown.x - orbit.x) * pull;
    out.y = orbit.y + (crown.y - orbit.y) * pull;
    out.size = GRAVE_LIGHTS.size + (GRAVE_LIGHTS.chargedSize - GRAVE_LIGHTS.size) * pull;
    out.intensity = GRAVE_LIGHTS.intensity + (GRAVE_LIGHTS.chargedIntensity - GRAVE_LIGHTS.intensity) * pull;
    return out;
  }
  if (state.endedAt <= 0 || now < state.endedAt) return out;
  if (index >= launched) {
    // Never launched: drift back from the crown to the orbit.
    const back = ease((now - state.endedAt) / GRAVE_LIGHTS.returnMs);
    if (back >= 1) return out;
    crownPose(index, count, site, now, 1, crown);
    out.x = crown.x + (orbit.x - crown.x) * back;
    out.y = crown.y + (orbit.y - crown.y) * back;
    out.size = GRAVE_LIGHTS.chargedSize + (GRAVE_LIGHTS.size - GRAVE_LIGHTS.chargedSize) * back;
    return out;
  }
  // Launched: hidden until its turn in the pause, then it rises out of a lantern hole.
  const pause = Math.max(1, state.rechargedAt - state.endedAt);
  const refillAt = state.endedAt + pause * (index + 1) / (launched + 1);
  if (now < refillAt) { out.alpha = 0; return out; }
  const rise = ease((now - refillAt) / GRAVE_LIGHTS.riseMs);
  if (rise >= 1) return out;
  const holeAngle = hash(index, 5) * Math.PI * 2, hole = site.size * 0.5 * GRAVE_LIGHTS.holeShare;
  const hx = site.x + Math.cos(holeAngle) * hole, hy = site.y + Math.sin(holeAngle) * hole;
  out.x = hx + (orbit.x - hx) * rise;
  out.y = hy + (orbit.y - hy) * rise;
  out.alpha = rise;
  out.size = GRAVE_LIGHTS.size * (0.4 + 0.6 * rise);
  return out;
}

const HIT_FLASH_MS = 260;

/**
 * Brightness of the grave light in the fissures: a quiet smoulder at rest, flaring up through the
 * gather to full strength at the first shot, spent after the salvo and recovering while the lights
 * refill; rearing for a melee strike stokes it and the hit flashes it. Pure presentation.
 */
export function graveGlowLevel(volley: EnemyVolleyState, attack: EnemyClawAttack | null, now: number): number {
  let level = 0.45;
  const phase = enemyVolleyPhaseAt(volley, now);
  if (phase === 'charge') level = 0.45 + 0.75 * enemyVolleyChargeAt(volley, now);
  else if (phase === 'fire') level = 1.2;
  else if (phase === 'recharge') level = 0.25 + 0.2 * Math.max(0, Math.min(1, (now - volley.endedAt) / Math.max(1, volley.rechargedAt - volley.endedAt)));
  if (attack && now < attack.endsAt) {
    level += 0.4 * Math.max(0, meleeLiftProfile(attack, now));
    const since = now - attack.hitAt;
    if (since >= 0 && since < HIT_FLASH_MS) level += 0.7 * (1 - since / HIT_FLASH_MS);
  }
  return Math.max(0, Math.min(1.4, level));
}
