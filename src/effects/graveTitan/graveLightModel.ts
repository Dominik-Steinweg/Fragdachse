import { enemyVolleyChargeAt, enemyVolleyPhaseAt, type EnemyVolleyState } from '../../systems/EnemyVolleyState';
import { meleeLiftProfile, type EnemyClawAttack } from '../../systems/EnemyClawAttack';

/**
 * The Grave Titan's ammunition made visible: its own ordinary fireflies, several per salvo shot.
 * Ready, they swarm loosely around it like any boss presence. The gather pulls them into a crown
 * over the grave where they visibly start to glow; every shot takes the next group with it (the
 * plasma flies out of their place in the crown); during the pause the spent fireflies rise again
 * one by one out of the lantern holes, dark as before. Pure presentation of the replicated volley
 * timeline plus the number of shots this client has seen launch.
 */
export const GRAVE_FIREFLIES = {
  /** Crown over the grave: radii (world px) of the gathered swarm and its spin (rad/s). */
  crownInner: 20, crownOuter: 66, crownSpin: 2.2,
  /** The crown draws this much tighter by the first shot. */
  crownTighten: 0.1,
  /** Share of the gather spent flying in (staggered per firefly); afterwards the crown burns brighter. */
  flyInShare: 0.6, flyInStagger: 0.35,
  /** Glow (0..1) once a firefly has flown in; full glow at the first shot. */
  flownInGlow: 0.45,
  /** A refilled firefly rises out of a lantern hole at this share of the body radius and drifts to its orbit. */
  holeShare: 0.6, riseMs: 900,
  /** Fireflies that never launched (cancelled or cut salvo) drift back to their orbit and cool down. */
  returnMs: 900,
} as const;

export interface GraveFireflyAmmoPose {
  x: number;
  y: number;
  /** 0 = hidden (launched, not yet refilled). */
  alpha: number;
  /** Charge glow 0..1 over the ordinary firefly. */
  glow: number;
  /** 0..1 how far it has left its swarm orbit for the crown. */
  gathered: number;
}

export interface GraveFireflySite {
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

/** Shots already launched by the current cycle: seen shots, or the replicated count after its end. */
export function launchedGraveLights(state: EnemyVolleyState, seenLaunches: number, shots: number): number {
  const ended = state.revision > 0 && state.endedAt > 0 ? state.shotsFired : 0;
  return Math.max(0, Math.min(shots, Math.max(seenLaunches, ended)));
}

/** Salvo shot fed by firefly `index` of `fireflies`; shots take their fireflies in index order. */
export function fireflyShot(index: number, fireflies: number, shots: number): number {
  return Math.min(shots - 1, Math.floor(index * shots / Math.max(1, fireflies)));
}

/** Fireflies spent by the first `launchedShots` shots: indices below this count. */
export function spentFireflies(launchedShots: number, fireflies: number, shots: number): number {
  if (launchedShots <= 0) return 0;
  return launchedShots >= shots ? fireflies : Math.ceil(launchedShots * fireflies / shots);
}

function crownPose(index: number, fireflies: number, site: GraveFireflySite, now: number, tighten: number,
  out: { x: number; y: number }): void {
  const fx = GRAVE_FIREFLIES;
  const angle = index * 2.39996 + now / 1000 * fx.crownSpin * (index % 3 === 0 ? -1 : 1);
  const radius = (fx.crownInner + (fx.crownOuter - fx.crownInner) * Math.sqrt((index + 0.5) / fireflies))
    * (1 - fx.crownTighten * tighten) * (0.9 + 0.2 * hash(index, 7));
  out.x = site.crownX + Math.cos(angle) * radius;
  out.y = site.crownY + Math.sin(angle) * radius;
}

const crown = { x: 0, y: 0 };

/**
 * Pose of firefly `index` of `fireflies` feeding a salvo of `shots` at `now`, starting from its
 * ordinary swarm position (`orbitX`, `orbitY`); `out` is reused.
 */
export function graveFireflyPose(index: number, fireflies: number, shots: number, site: GraveFireflySite,
  state: EnemyVolleyState, seenLaunches: number, orbitX: number, orbitY: number, now: number,
  out: GraveFireflyAmmoPose): GraveFireflyAmmoPose {
  const fx = GRAVE_FIREFLIES;
  out.x = orbitX; out.y = orbitY; out.alpha = 1; out.glow = 0; out.gathered = 0;
  if (state.revision === 0) return out;
  const phase = enemyVolleyPhaseAt(state, now);
  const spent = spentFireflies(launchedGraveLights(state, seenLaunches, shots), fireflies, shots);
  if (phase === 'charge' || phase === 'fire') {
    if (index < spent) { out.alpha = 0; return out; }
    const charge = enemyVolleyChargeAt(state, now);
    const flyStart = hash(index, 6) * fx.flyInStagger;
    const pull = ease((charge / fx.flyInShare - flyStart) / (1 - fx.flyInStagger));
    const burn = ease((charge - fx.flyInShare) / (1 - fx.flyInShare));
    crownPose(index, fireflies, site, now, burn, crown);
    out.x = orbitX + (crown.x - orbitX) * pull;
    out.y = orbitY + (crown.y - orbitY) * pull;
    out.glow = fx.flownInGlow * pull + (1 - fx.flownInGlow) * burn;
    out.gathered = pull;
    return out;
  }
  if (state.endedAt <= 0 || now < state.endedAt) return out;
  if (index >= spent) {
    // Never launched: drift back from the crown to the orbit and cool down.
    const back = ease((now - state.endedAt) / fx.returnMs);
    if (back >= 1) return out;
    crownPose(index, fireflies, site, now, 1, crown);
    out.x = crown.x + (orbitX - crown.x) * back;
    out.y = crown.y + (orbitY - crown.y) * back;
    out.glow = 1 - back;
    out.gathered = 1 - back;
    return out;
  }
  // Launched: hidden until its turn in the pause, then it rises out of a lantern hole.
  const pause = Math.max(1, state.rechargedAt - state.endedAt);
  const refillAt = state.endedAt + pause * (index + 1) / (spent + 1);
  if (now < refillAt) { out.alpha = 0; return out; }
  const rise = ease((now - refillAt) / fx.riseMs);
  if (rise >= 1) return out;
  graveFireflyHole(index, site, crown);
  out.x = crown.x + (orbitX - crown.x) * rise;
  out.y = crown.y + (orbitY - crown.y) * rise;
  out.alpha = rise;
  return out;
}

/** Lantern hole a firefly rises out of (refill, and the swarm's first appearance). */
export function graveFireflyHole(index: number, site: Pick<GraveFireflySite, 'x' | 'y' | 'size'>, out: { x: number; y: number }): void {
  const angle = hash(index, 5) * Math.PI * 2, hole = site.size * 0.5 * GRAVE_FIREFLIES.holeShare;
  out.x = site.x + Math.cos(angle) * hole;
  out.y = site.y + Math.sin(angle) * hole;
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
