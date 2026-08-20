import { describe, expect, it } from 'vitest';
import { EnemyFlowFieldService } from '../src/systems/EnemyFlowFieldService';
import { resolveEnemySmokeConfusion, type EnemySmokeConfusionState } from '../src/systems/EnemySmokeConfusion';

describe('EnemyManager smoke confusion', () => {
  it('keeps one deterministic valid-neighbor direction for the interval and clears it outside smoke', () => {
    const smoke = {
      getActiveCloudIdAt: (_x: number, _y: number, _now: number, preferred?: number) => preferred ?? 9,
    };
    const flowField = {
      forEachReachableNeighbor: (_x: number, _y: number, visitor: (x: number, y: number, direction: number) => void) => {
        for (let direction = 0; direction < EnemyFlowFieldService.NEIGHBOR_DIRECTIONS.length; direction += 1) {
          visitor(0, 0, direction);
        }
      },
    };
    const states = new Map<string, EnemySmokeConfusionState>();
    const resolve = (now: number, smokeSystem = smoke) => resolveEnemySmokeConfusion(
      states,
      'enemy-a',
      100,
      100,
      smokeSystem,
      flowField,
      2,
      2,
      { x: 1, y: 0 },
      now,
    );

    const first = resolve(1000);
    const state = states.get('enemy-a')!;
    const second = resolve(1100);

    expect(first).not.toBeNull();
    expect(second).toEqual(first);
    expect(state.expiresAt).toBeGreaterThanOrEqual(1500);
    expect(state.expiresAt).toBeLessThanOrEqual(1800);
    expect(Math.hypot(state.direction.x, state.direction.y)).toBeCloseTo(1);
    expect(EnemyFlowFieldService.NEIGHBOR_DIRECTIONS.some(([x, y]) => {
      const length = Math.hypot(x, y);
      return Math.abs(state.direction.x - x / length) < 0.0001
        && Math.abs(state.direction.y - y / length) < 0.0001;
    })).toBe(true);

    const outsideSmoke = { getActiveCloudIdAt: () => null };
    expect(resolve(1200, outsideSmoke)).toBeNull();
    expect(states.has('enemy-a')).toBe(false);
  });
});
