import { describe, expect, it } from 'vitest';
import { clawFrameIndex, meleeLiftProfile, type EnemyClawAttack } from '../src/systems/EnemyClawAttack';
import { graveTitanImpactGeometry } from '../src/effects/graveTitan/graveTitanImpactGeometry';
import { graveLightPose, launchedGraveLights, type GraveLightPose } from '../src/effects/graveTitan/graveLightModel';
import { volleyCastFrameIndex, VOLLEY_CAST_SETTLE_MS } from '../src/animations/EnemyVolleyAnimation';
import { EMPTY_ENEMY_VOLLEY_STATE, type EnemyVolleyState } from '../src/systems/EnemyVolleyState';

const ATTACK: EnemyClawAttack = {
  attackId: 'titan:1', weaponId: 'GRAVE_TITAN_SLAM', startedAt: 1_000, strikeAt: 2_080, hitAt: 2_300, endsAt: 3_200,
  angle: 0, range: 230, arcDegrees: 110,
};
const MARKERS = { strike: 12, impact: 15 };
const SITE = { x: 500, y: 400, size: 112, crownX: 493, crownY: 400 };

function pose(index: number, state: EnemyVolleyState, seen: number, now: number): GraveLightPose {
  return graveLightPose(index, 10, SITE, state, seen, now, { x: 0, y: 0, alpha: 0, size: 0, intensity: 0 });
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

  it('cracks the ground ahead of a slam and all around a stomp, deterministically', () => {
    const slam = graveTitanImpactGeometry(0, 0, 0, 110, 230, 7);
    expect(slam.x).toBeGreaterThan(0);
    for (const crack of slam.cracks) for (const point of crack) {
      expect(point.x).toBeGreaterThan(0);
      expect(Math.hypot(point.x, point.y)).toBeLessThan(230 * 1.2);
    }
    expect(graveTitanImpactGeometry(0, 0, 0, 110, 230, 7)).toEqual(slam);

    const stomp = graveTitanImpactGeometry(0, 0, 0, 360, 150, 3);
    expect(stomp.x).toBe(0);
    const quadrants = new Set(stomp.cracks.map(crack => {
      const end = crack[crack.length - 1];
      return `${Math.sign(end.x)}${Math.sign(end.y)}`;
    }));
    expect(quadrants.size).toBe(4);
  });

  it('gathers the grave lights into a crown, launches one per seen shot and refills them during the pause', () => {
    const charging: EnemyVolleyState = { revision: 1, chargeStartAt: 1_000, fireAt: 1_800, endedAt: 0, rechargedAt: 0, shotsFired: 0 };
    const ready = pose(0, EMPTY_ENEMY_VOLLEY_STATE, 0, 1_000);
    expect(Math.hypot(ready.x - SITE.x, ready.y - SITE.y)).toBeGreaterThan(40);
    const gathered = pose(0, charging, 0, 1_799);
    expect(Math.hypot(gathered.x - SITE.crownX, gathered.y - SITE.crownY)).toBeLessThan(32);
    expect(gathered.intensity).toBeGreaterThan(ready.intensity);

    expect(pose(2, charging, 3, 1_900).alpha).toBe(0);
    expect(pose(3, charging, 3, 1_900).alpha).toBe(1);

    const ended: EnemyVolleyState = { ...charging, revision: 2, endedAt: 2_700, rechargedAt: 12_700, shotsFired: 10 };
    expect(launchedGraveLights(ended, 0, 10)).toBe(10);
    // The first launched light returns first; the last one only near the end of the pause.
    expect(pose(0, ended, 10, 2_800).alpha).toBe(0);
    expect(pose(0, ended, 10, 2_700 + 10_000 / 11 + 300).alpha).toBeGreaterThan(0);
    expect(pose(9, ended, 10, 2_700 + 10_000 / 11 + 300).alpha).toBe(0);
    expect(pose(9, ended, 10, 12_700 + 800).alpha).toBe(1);

    const cancelled: EnemyVolleyState = { ...charging, revision: 2, endedAt: 1_500, rechargedAt: 11_500, shotsFired: 0 };
    expect(pose(4, cancelled, 0, 1_600).alpha).toBe(1);
  });

  it('plays the gather gesture up to its release marker and settles after the first shot', () => {
    const state: EnemyVolleyState = { revision: 1, chargeStartAt: 1_000, fireAt: 1_800, endedAt: 0, rechargedAt: 0, shotsFired: 0 };
    expect(volleyCastFrameIndex(state, 900, 12, 8)).toBeNull();
    expect(volleyCastFrameIndex(state, 1_000, 12, 8)).toBe(0);
    expect(volleyCastFrameIndex(state, 1_799, 12, 8)).toBe(7);
    expect(volleyCastFrameIndex(state, 1_800, 12, 8)).toBe(8);
    expect(volleyCastFrameIndex(state, 1_800 + VOLLEY_CAST_SETTLE_MS, 12, 8)).toBeNull();
  });
});
