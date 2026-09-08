import { describe, expect, it } from 'vitest';
import { EnemyFlowFieldService } from '../src/systems/EnemyFlowFieldService';
import { resolveEnemySmokeConfusion, type EnemySmokeConfusionState } from '../src/systems/EnemySmokeConfusion';
import type { SmokePerceptionPort } from '../src/systems/SmokeRules';

const influence = { cloudId: 9, x: 100, y: 100, radius: 100, fraction: 0.5,
  retentionBias: 0, edgeFraction: 0.7, directionMinMs: 800, directionMaxMs: 1200 };

describe('EnemyManager smoke confusion', () => {
  it('steers only toward reachable neighbors and corrects an interval when a new obstacle blocks it', () => {
    let allowed = [0, 1];
    const flow = { forEachReachableNeighbor: (_x: number, _y: number, visit: (x: number, y: number, d: number) => void) => allowed.forEach(d => visit(0, 0, d)) };
    const states = new Map<string, EnemySmokeConfusionState>();
    const port: SmokePerceptionPort = { getConfusion: () => influence, canSee: () => true };
    const resolve = (now: number) => resolveEnemySmokeConfusion(states, 'e', 100, 100, port, flow, 0, 0, { x: 0, y: 0 }, now);
    resolve(100);
    const before = states.get('e')!.direction;
    allowed = allowed.filter(d => {
      const [x, y] = EnemyFlowFieldService.NEIGHBOR_DIRECTIONS[d];
      return Math.abs(x / Math.hypot(x, y) - before.x) > 0.001 || Math.abs(y / Math.hypot(x, y) - before.y) > 0.001;
    });
    resolve(101);
    expect(states.get('e')!.direction).not.toEqual(before);
    allowed = []; expect(resolve(102)).toBeNull();
  });

  it('increases dwell time with R1 without changing movement speed or trapping the only exit', () => {
    const flow = { forEachReachableNeighbor: (_x: number, _y: number, visit: (x: number, y: number, d: number) => void) =>
      EnemyFlowFieldService.NEIGHBOR_DIRECTIONS.forEach((_v, d) => visit(0, 0, d)) };
    const dwell = (fraction: number, retentionBias: number) => {
      let total = 0;
      for (let seed = 0; seed < 24; seed++) {
        const states = new Map<string, EnemySmokeConfusionState>();
        let x = 70, y = 0;
        const port: SmokePerceptionPort = { getConfusion: () => ({ ...influence, x: 0, y: 0, fraction, retentionBias }), canSee: () => true };
        for (let time = 0; time < 20000 && Math.hypot(x, y) <= 100; time += 80) {
          const direction = resolveEnemySmokeConfusion(states, `e${seed}`, x, y, port, flow, 0, 0, { x: 1, y: 0 }, time)!;
          expect(Math.hypot(direction.x, direction.y)).toBeCloseTo(1);
          x += direction.x * 8; y += direction.y * 8; total += 80;
        }
      }
      return total;
    };
    expect(dwell(0.8, 0.75)).toBeGreaterThan(dwell(0.5, 0));
    const onlyExit = { forEachReachableNeighbor: (_x: number, _y: number, visit: (x: number, y: number, d: number) => void) => visit(0, 0, 0) };
    const port: SmokePerceptionPort = { getConfusion: () => ({ ...influence, retentionBias: 0.75 }), canSee: () => true };
    expect(resolveEnemySmokeConfusion(new Map(), 'escape', 190, 100, port, onlyExit, 0, 0, { x: 1, y: 0 }, 0)).not.toBeNull();
  });
  it('keeps one deterministic valid-neighbor direction for the interval and clears it outside smoke', () => {
    const smoke: SmokePerceptionPort = { getConfusion: () => influence, canSee: () => true };
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
    expect(state.expiresAt).toBeGreaterThanOrEqual(1000 + influence.directionMinMs);
    expect(state.expiresAt).toBeLessThanOrEqual(1000 + influence.directionMaxMs);
    expect(Math.hypot(state.direction.x, state.direction.y)).toBeCloseTo(1);
    expect(EnemyFlowFieldService.NEIGHBOR_DIRECTIONS.some(([x, y]) => {
      const length = Math.hypot(x, y);
      return Math.abs(state.direction.x - x / length) < 0.0001
        && Math.abs(state.direction.y - y / length) < 0.0001;
    })).toBe(true);

    const outsideSmoke: SmokePerceptionPort = { getConfusion: () => null, canSee: () => true };
    expect(resolve(1200, outsideSmoke)).toBeNull();
    expect(states.has('enemy-a')).toBe(false);
  });

  it('chooses different seeded valid directions across intervals instead of always reversing', () => {
    const smoke: SmokePerceptionPort = { getConfusion: () => influence, canSee: () => true };
    const flowField = {
      forEachReachableNeighbor: (_x: number, _y: number, visitor: (x: number, y: number, direction: number) => void) => {
        for (let direction = 0; direction < EnemyFlowFieldService.NEIGHBOR_DIRECTIONS.length; direction += 1) {
          visitor(0, 0, direction);
        }
      },
    };
    const resolveSequence = () => {
      const states = new Map<string, EnemySmokeConfusionState>();
      const directions: Array<{ x: number; y: number }> = [];
      let now = 2_000;
      for (let interval = 0; interval < 8; interval += 1) {
        resolveEnemySmokeConfusion(
          states,
          'enemy-seeded',
          100,
          100,
          smoke,
          flowField,
          2,
          2,
          { x: 1, y: 0 },
          now,
        );
        const state = states.get('enemy-seeded')!;
        directions.push({ ...state.direction });
        now = state.expiresAt + 1;
      }
      return directions;
    };

    const first = resolveSequence();
    const second = resolveSequence();
    const validDirections = new Set(EnemyFlowFieldService.NEIGHBOR_DIRECTIONS.map(([x, y]) => {
      const length = Math.hypot(x, y);
      return `${x / length}:${y / length}`;
    }));

    expect(second).toEqual(first);
    expect(new Set(first.map(direction => `${direction.x}:${direction.y}`)).size).toBeGreaterThan(1);
    expect(first.every(direction => direction.x === -1 && direction.y === 0)).toBe(false);
    expect(first.every(direction => validDirections.has(`${direction.x}:${direction.y}`))).toBe(true);
  });
});
