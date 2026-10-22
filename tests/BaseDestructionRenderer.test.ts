import { describe, expect, it, vi } from 'vitest';
import type * as Phaser from 'phaser';
import {
  buildBaseDestructionPlan,
  getBaseDestructionBlast,
} from '../src/effects/BaseDestructionPlan';
import type { BaseSpec } from '../src/arena/BaseRegistry';
import { BaseDestructionRenderer } from '../src/effects/BaseDestructionRenderer';

vi.mock('phaser', () => ({}));

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
  role: 'main',
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

  it('lets a spawn structure burst without cell explosions, fire chunks or ground fire', () => {
    const calls: string[] = [];
    const renderer = new BaseDestructionRenderer({} as Phaser.Scene, {
      playExplosion: () => calls.push('explosion'),
      playExplosionSound: () => calls.push('sound'),
      playFireChunks: () => calls.push('chunks'),
      onFireChunksLanded: () => calls.push('ground-fire'),
    });
    const spawnArea = { outlet: 'south', minGridX: 11, minGridY: 11, widthCells: 1, heightCells: 1, x: 0, y: 0, mouth: [] } as const;
    const freed: number[] = [];
    renderer.play({ ...BASE_SPEC, role: 'spawn-point', spawnArea }, (cellIndex) => freed.push(cellIndex));

    expect(calls).toEqual(['sound']);
    expect(freed).toEqual([0, 1, 2, 3]);
  });

  it('is deterministic and resolves one non-damaging blast around the whole base', () => {
    expect(buildBaseDestructionPlan(BASE_SPEC)).toEqual(buildBaseDestructionPlan(BASE_SPEC));

    const blast = getBaseDestructionBlast(BASE_SPEC);
    expect(blast.force).toBeGreaterThan(0);
    expect(blast.radius).toBeGreaterThan(64);
    expect(blast.durationMs).toBeGreaterThan(0);
  });
});
