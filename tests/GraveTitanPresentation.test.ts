import { describe, expect, it } from 'vitest';
import { clawFrameIndex, meleeLiftProfile, type EnemyClawAttack } from '../src/systems/EnemyClawAttack';
import { GRAVE_TITAN_IMPACT, graveTitanImpact } from '../src/effects/graveTitan/graveTitanImpactGeometry';
import { GRAVE_FIREFLIES, fireflyShot, graveFireflyPose, graveGlowLevel, graveOrbPose, launchedGraveLights, spentFireflies,
  type GraveFireflyAmmoPose, type GraveOrbPose } from '../src/effects/graveTitan/graveLightModel';
import { volleyCastFrameIndex, VOLLEY_CAST_RISE_MS, VOLLEY_CAST_SETTLE_MS } from '../src/animations/EnemyVolleyAnimation';
import { EMPTY_ENEMY_VOLLEY_STATE, type EnemyVolleyState } from '../src/systems/EnemyVolleyState';

const ATTACK: EnemyClawAttack = {
  attackId: 'titan:1', weaponId: 'GRAVE_TITAN_SLAM', startedAt: 1_000, strikeAt: 2_080, hitAt: 2_300, endsAt: 3_200,
  angle: 0, range: 230, arcDegrees: 110,
};
const MARKERS = { strike: 12, impact: 15 };
const SITE = { x: 500, y: 400, size: 112, crownX: 493, crownY: 400 };
/** 30 fireflies feed 10 shots; each rests on its own orbit point. */
const FIREFLIES = 30, SHOTS = 10;
const orbitX = (index: number) => SITE.x + 150 * Math.cos(index), orbitY = (index: number) => SITE.y + 150 * Math.sin(index);

function orbOf(shot: number, state: EnemyVolleyState, seen: number, now: number): GraveOrbPose {
  return graveOrbPose(shot, SHOTS, SITE, state, seen, now, { x: 0, y: 0, size: 0, intensity: 0 });
}

function pose(index: number, state: EnemyVolleyState, seen: number, now: number): GraveFireflyAmmoPose {
  return graveFireflyPose(index, FIREFLIES, SHOTS, SITE, state, seen, orbitX(index), orbitY(index), now, { x: 0, y: 0, alpha: 0, glow: 0, gathered: 0 });
}

describe('Grave Titan presentation', () => {
  it('holds the impact pose for the authored time and still ends on the last clip frame', () => {
    expect(clawFrameIndex(ATTACK, ATTACK.hitAt + 100, 22, MARKERS, 120)).toBe(MARKERS.impact);
    expect(clawFrameIndex(ATTACK, ATTACK.hitAt + 130, 22, MARKERS, 120)).toBeGreaterThanOrEqual(MARKERS.impact);
    expect(clawFrameIndex(ATTACK, ATTACK.endsAt, 22, MARKERS, 120)).toBe(21);
    expect(clawFrameIndex(ATTACK, ATTACK.strikeAt, 22, MARKERS, 120)).toBe(MARKERS.strike);
  });

  it('rears towards the camera over the windup, crashes down at the hit and settles to rest', () => {
    expect(meleeLiftProfile(ATTACK, ATTACK.startedAt)).toBe(0);
    expect(meleeLiftProfile(ATTACK, ATTACK.strikeAt)).toBeCloseTo(1, 5);
    expect(meleeLiftProfile(ATTACK, ATTACK.hitAt)).toBeLessThanOrEqual(0);
    expect(meleeLiftProfile(ATTACK, ATTACK.hitAt + 120)).toBeLessThan(0);
    expect(meleeLiftProfile(ATTACK, ATTACK.endsAt)).toBe(0);
  });

  it('strikes a stomp all around its body and lands a slam on its paws ahead', () => {
    const stomp = graveTitanImpact(0, 0, 1, 360, 300);
    expect(stomp).toEqual({ x: 0, y: 0, radius: 300, stomp: true });
    const slam = graveTitanImpact(0, 0, 0, 110, 220);
    expect(slam.stomp).toBe(false);
    expect(slam.x).toBeCloseTo(GRAVE_TITAN_IMPACT.pawReachPx);
    expect(slam.y).toBeCloseTo(0);
    expect(slam.radius).toBeCloseTo(220 - GRAVE_TITAN_IMPACT.pawReachPx);
  });

  it('feeds every shot from its own group of ordinary fireflies that glow up and fuse into a shot-sized orb', () => {
    expect(Array.from({ length: FIREFLIES }, (_, index) => fireflyShot(index, FIREFLIES, SHOTS)))
      .toEqual(Array.from({ length: FIREFLIES }, (_, index) => Math.floor(index / 3)));
    expect(spentFireflies(0, FIREFLIES, SHOTS)).toBe(0);
    expect(spentFireflies(3, FIREFLIES, SHOTS)).toBe(9);
    expect(spentFireflies(SHOTS, FIREFLIES, SHOTS)).toBe(FIREFLIES);

    const charging: EnemyVolleyState = { revision: 1, chargeStartAt: 1_000, fireAt: 2_600, endedAt: 0, rechargedAt: 0, shotsFired: 0 };
    const at = (share: number) => 1_000 + 1_600 * share;
    expect(pose(4, EMPTY_ENEMY_VOLLEY_STATE, 0, 1_000)).toEqual({ x: orbitX(4), y: orbitY(4), alpha: 1, glow: 0, gathered: 0 });
    expect(orbOf(1, EMPTY_ENEMY_VOLLEY_STATE, 0, 1_000).size).toBe(0);

    // Flown in: gathered over the grave and glowing, no orb yet.
    const flown = pose(4, charging, 0, at(GRAVE_FIREFLIES.flyInShare));
    expect(flown).toMatchObject({ alpha: 1, gathered: 1 });
    expect(flown.glow).toBeGreaterThan(0.4);
    expect(Math.hypot(flown.x - SITE.crownX, flown.y - SITE.crownY)).toBeLessThanOrEqual(GRAVE_FIREFLIES.crownOuter * 1.1);
    expect(orbOf(1, charging, 0, at(GRAVE_FIREFLIES.flyInShare)).size).toBe(0);

    // Fusing: the firefly fades into an orb that grows smoothly...
    const half = (GRAVE_FIREFLIES.flyInShare + GRAVE_FIREFLIES.fuseEnd) / 2;
    const fusing = pose(4, charging, 0, at(half)), growing = orbOf(1, charging, 0, at(half));
    expect(fusing.alpha).toBeGreaterThan(0);
    expect(fusing.alpha).toBeLessThan(1);
    expect(growing.size).toBeGreaterThan(0);
    expect(growing.size).toBeLessThan(GRAVE_FIREFLIES.orbSize);
    // ...to the size of a flying shot by the end of the fuse, where the firefly has vanished into it.
    const fused = pose(4, charging, 0, at(GRAVE_FIREFLIES.fuseEnd)), full = orbOf(1, charging, 0, at(GRAVE_FIREFLIES.fuseEnd));
    expect(fused.alpha).toBe(0);
    expect(Math.hypot(fused.x - full.x, fused.y - full.y)).toBeLessThan(1e-6);
    expect(full.size).toBeCloseTo(GRAVE_FIREFLIES.orbSize, 5);
    expect(full.intensity).toBeCloseTo(GRAVE_FIREFLIES.orbIntensity, 5);

    // Three shots seen: their orbs are gone, the next orb still waits.
    expect(orbOf(2, charging, 3, 2_800).size).toBe(0);
    expect(orbOf(3, charging, 3, 2_800).size).toBeGreaterThan(GRAVE_FIREFLIES.orbSize * 0.8);
    expect(pose(9, charging, 3, 2_800).alpha).toBe(0);

    const ended: EnemyVolleyState = { ...charging, revision: 2, endedAt: 3_400, rechargedAt: 13_400, shotsFired: SHOTS };
    expect(launchedGraveLights(ended, 0, SHOTS)).toBe(SHOTS);
    // Spent fireflies return dark, one by one: the first early in the pause, the last near its end.
    const firstBack = 3_400 + 10_000 / (FIREFLIES + 1) + GRAVE_FIREFLIES.riseMs;
    expect(pose(0, ended, SHOTS, 3_500).alpha).toBe(0);
    expect(pose(0, ended, SHOTS, firstBack)).toMatchObject({ alpha: 1, glow: 0 });
    expect(pose(FIREFLIES - 1, ended, SHOTS, firstBack).alpha).toBe(0);
    expect(pose(FIREFLIES - 1, ended, SHOTS, 13_400 + GRAVE_FIREFLIES.riseMs))
      .toEqual({ x: orbitX(29), y: orbitY(29), alpha: 1, glow: 0, gathered: 0 });

    // A cancelled gather never launched anything: the orbs come apart and the fireflies fly home.
    const cancelled: EnemyVolleyState = { ...charging, revision: 2, endedAt: 2_400, rechargedAt: 12_400, shotsFired: 0 };
    expect(orbOf(1, cancelled, 0, 2_400 + GRAVE_FIREFLIES.returnMs).size).toBe(0);
    expect(pose(4, cancelled, 0, 2_400 + GRAVE_FIREFLIES.returnMs)).toMatchObject({ alpha: 1, glow: 0, gathered: 0 });
  });

  it('stokes the fissure glow through the gather, spends it with the salvo and flashes it on a hit', () => {
    const charging: EnemyVolleyState = { revision: 1, chargeStartAt: 1_000, fireAt: 1_800, endedAt: 0, rechargedAt: 0, shotsFired: 0 };
    const rest = graveGlowLevel(EMPTY_ENEMY_VOLLEY_STATE, null, 1_000);
    expect(graveGlowLevel(charging, null, 1_400)).toBeGreaterThan(rest);
    expect(graveGlowLevel(charging, null, 1_900)).toBeGreaterThan(graveGlowLevel(charging, null, 1_400));
    const spent: EnemyVolleyState = { ...charging, revision: 2, endedAt: 2_600, rechargedAt: 12_600, shotsFired: 10 };
    expect(graveGlowLevel(spent, null, 2_700)).toBeLessThan(rest);
    expect(graveGlowLevel(EMPTY_ENEMY_VOLLEY_STATE, ATTACK, ATTACK.hitAt + 20)).toBeGreaterThan(rest);
  });

  it('raises the gather gesture early, holds it until the first shot releases it and settles afterwards', () => {
    const state: EnemyVolleyState = { revision: 1, chargeStartAt: 1_000, fireAt: 2_600, endedAt: 0, rechargedAt: 0, shotsFired: 0 };
    expect(volleyCastFrameIndex(state, 900, 12, 8)).toBeNull();
    expect(volleyCastFrameIndex(state, 1_000, 12, 8)).toBe(0);
    expect(volleyCastFrameIndex(state, 1_000 + VOLLEY_CAST_RISE_MS, 12, 8)).toBe(7);
    expect(volleyCastFrameIndex(state, 2_599, 12, 8)).toBe(7);
    expect(volleyCastFrameIndex(state, 2_600, 12, 8)).toBe(8);
    expect(volleyCastFrameIndex(state, 2_600 + VOLLEY_CAST_SETTLE_MS, 12, 8)).toBeNull();
  });
});
