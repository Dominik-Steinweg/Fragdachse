import { describe, expect, it } from 'vitest';
import { ReinforcementMatrixSystem } from '../src/systems/ReinforcementMatrixSystem';

describe('reinforcement matrix field', () => {
  it('uses the strongest overlapping damage reduction once', () => {
    const system = new ReinforcementMatrixSystem();
    system.spawnMatrix('inspector', 0, 0, 30, 5_000, 0.5, 0.2, 0x4fd6ff, 1_000);
    system.spawnMatrix('ally', 5, 0, 30, 5_000, 0.25, 0.2, 0x4fd6ff, 1_000);

    const footprint = { x: 0, y: 0, width: 20, height: 20 };
    expect(system.getDamageReductionForFootprint(footprint, 2_000)).toBe(0.5);
    expect(system.getDamageMultiplierForFootprint(footprint, 2_000)).toBe(0.5);
  });

  it('recognizes a large target when its footprint overlaps the field', () => {
    const system = new ReinforcementMatrixSystem();
    system.spawnMatrix('inspector', 0, 0, 10, 5_000, 0.5, 0.2, 0x4fd6ff, 1_000);

    // The center is outside the radius, but the left edge overlaps it.
    const largeTarget = { x: 15, y: 0, width: 20, height: 20 };
    expect(Math.hypot(largeTarget.x, largeTarget.y)).toBeGreaterThan(10);
    expect(system.getOverlappingMatrices(largeTarget, 2_000)).toHaveLength(1);
    expect(system.getDamageMultiplierForFootprint(largeTarget, 2_000)).toBe(0.5);
  });

  it('does not treat the empty gap of a concave target as collision surface', () => {
    const system = new ReinforcementMatrixSystem();
    system.spawnMatrix('inspector', 0, 0, 8, 5_000, 0.5, 0.2, 0x4fd6ff, 1_000);

    const concaveTarget = {
      x: 0,
      y: 0,
      width: 100,
      height: 32,
      parts: [
        { x: -40, y: 0, width: 20, height: 32 },
        { x: 40, y: 0, width: 20, height: 32 },
      ],
    };
    expect(system.getOverlappingMatrices(concaveTarget, 2_000)).toEqual([]);
  });

  it('expires and synchronizes the complete field state', () => {
    const host = new ReinforcementMatrixSystem();
    host.spawnMatrix('inspector', 100, 120, 220, 6_000, 0.5, 0.2, 0x4fd6ff, 10_000);

    const client = new ReinforcementMatrixSystem();
    client.syncFromSnapshot(host.getNetSnapshot());
    expect(client.getActiveMatrices()).toMatchObject([{
      ownerId: 'inspector',
      radius: 220,
      damageReduction: 0.5,
      vulnerabilityBonus: 0.2,
      expiresAt: 16_000,
    }]);
    expect(client.update(16_000)).toHaveLength(1);
    expect(client.getActiveMatrices()).toEqual([]);
  });
});
