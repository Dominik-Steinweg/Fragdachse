import { describe, expect, it } from 'vitest';
import { selectHopLanding, type HopLandingQuery } from '../src/systems/enemyHopLanding';

const WEIGHTS = { progress: 1, heal: 1.4, deviation: 0.25, crowd: 0.3 };

/** Open field, goal far east; route cost is the straight distance to the goal. */
function query(overrides: Partial<HopLandingQuery> = {}): HopLandingQuery {
  const goal = { x: 1000, y: 0 };
  return {
    x: 0, y: 0, radius: 15, steering: goal,
    originCost: 1000, costAt: (x, y) => Math.hypot(goal.x - x, goal.y - y),
    isFree: () => true, canMove: () => true, healValue: () => 0, crowdAt: () => 0,
    distances: [104, 82, 36], fanSteps: 7, fanHalfAngleRad: 65 * Math.PI / 180, jitter: 0,
    weights: WEIGHTS, minProgressShare: 0.35, maxRegressPx: 24, forceProgress: false,
    ...overrides,
  };
}

describe('hop landing selection', () => {
  it('advances straight along the route when nothing needs healing', () => {
    const landing = selectHopLanding(query())!;
    expect(landing.x).toBe(104);
    expect(landing.y).toBe(0);
    expect(landing.progress).toBeGreaterThan(100);
  });

  it('never lands on blocked ground or across a wall', () => {
    // A wall at x = 50 that bodies may not cross, and a blocked pond south-east.
    const isFree = (x: number, y: number) => !(x > 20 && y > 20 && y < 120);
    const canMove = (_ax: number, _ay: number, bx: number) => bx < 50;
    for (const jitter of [-0.5, -0.2, 0, 0.3, 0.5]) {
      const landing = selectHopLanding(query({ isFree, canMove, jitter, steering: { x: 0, y: -1000 }, originCost: null }));
      expect(landing).not.toBeNull();
      expect(isFree(landing!.x, landing!.y)).toBe(true);
      expect(canMove(0, 0, landing!.x)).toBe(true);
    }
    expect(selectHopLanding(query({ isFree: () => false }))).toBeNull();
  });

  it('rejects a landing the route cannot continue from', () => {
    const landing = selectHopLanding(query({ costAt: (x, y) => (y === 0 ? null : Math.hypot(1000 - x, y)) }))!;
    expect(landing.y).not.toBe(0);
  });

  it('detours to an injured group but loses at most the regress budget', () => {
    // A group off to the side of the route: worth a detour.
    const group = { x: 30, y: -110 };
    const healValue = (x: number, y: number) => (Math.hypot(x - group.x, y - group.y) < 60 ? 1 : 0);
    const landing = selectHopLanding(query({ healValue }))!;
    expect(landing.heal).toBeGreaterThan(0);
    expect(landing.progress).toBeGreaterThanOrEqual(-24);
    // A group straight behind the body is out of the fan and the regress budget: the route wins.
    const behind = selectHopLanding(query({ healValue: (x) => (x < -60 ? 1 : 0) }))!;
    expect(behind.heal).toBe(0);
    expect(behind.progress).toBeGreaterThan(0);
  });

  it('ignores heal value when anti-loitering forces an advance', () => {
    const healValue = (x: number, y: number) => (y < -50 ? 1 : 0);
    const free = selectHopLanding(query({ healValue }))!;
    const forced = selectHopLanding(query({ healValue, forceProgress: true }))!;
    expect(free.heal).toBeGreaterThan(0);
    expect(forced.progress).toBeGreaterThan(free.progress);
    expect(forced.progress).toBeGreaterThanOrEqual(0.35 * 104);
  });

  it('treats crowding as a penalty, not a stall, and decides deterministically', () => {
    const crowded = selectHopLanding(query({ crowdAt: () => 3 }));
    expect(crowded).not.toBeNull();
    const busyAhead = selectHopLanding(query({ crowdAt: (x, y) => (Math.abs(y) < 5 ? 2 : 0) }))!;
    expect(Math.abs(busyAhead.y)).toBeGreaterThan(0);
    expect(selectHopLanding(query({ jitter: 0.37 }))).toEqual(selectHopLanding(query({ jitter: 0.37 })));
  });
});
