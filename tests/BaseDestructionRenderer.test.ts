import { describe, expect, it } from 'vitest';
import {
  buildBaseDestructionPlan,
  getBaseDestructionBlast,
} from '../src/effects/BaseDestructionPlan';
import type { BaseSpec } from '../src/arena/BaseRegistry';

const BASE_SPEC: BaseSpec = {
  id: 'test-base',
  cells: [
    { gridX: 10, gridY: 10 },
    { gridX: 11, gridY: 10 },
    { gridX: 10, gridY: 11 },
    { gridX: 11, gridY: 11 },
  ],
  region: {
    minGridX: 10,
    maxGridX: 11,
    minGridY: 10,
    maxGridY: 11,
  },
  hpMax: 100,
  turrets: [],
  powerUpPedestals: [],
};

describe('BaseDestructionRenderer plan', () => {
  it('stagger-explodes every base cell and creates exactly four burning chunks per cell', () => {
    const plan = buildBaseDestructionPlan(BASE_SPEC);

    expect(plan).toHaveLength(BASE_SPEC.cells.length);
    expect(new Set(plan.map((step) => step.cellIndex)).size).toBe(BASE_SPEC.cells.length);
    expect(plan.every((step) => step.chunkTargets.length === 4)).toBe(true);
    expect(plan[0]?.delayMs).toBe(0);
    const gaps = plan.slice(1).map((step, index) => step.delayMs - plan[index].delayMs);
    expect(gaps.every((gap) => gap >= 48 && gap <= 96)).toBe(true);
    expect(new Set(gaps).size).toBeGreaterThan(1);
  });

  it('is deterministic and resolves one non-damaging blast around the whole base', () => {
    expect(buildBaseDestructionPlan(BASE_SPEC)).toEqual(buildBaseDestructionPlan(BASE_SPEC));

    const blast = getBaseDestructionBlast(BASE_SPEC);
    expect(blast.force).toBeGreaterThan(0);
    expect(blast.radius).toBeGreaterThan(64);
    expect(blast.durationMs).toBeGreaterThan(0);
  });
});
