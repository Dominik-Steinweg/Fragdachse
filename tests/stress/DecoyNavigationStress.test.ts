import { describe, expect, it } from 'vitest';
import { decoyTargetHarness, resolvedDecoy } from '../DecoyTestHelper';

describe('Decoy shared navigation under multiplayer load', () => {
  it('bounds fields by twelve decoys and clearance profiles, shares them across 1200 enemies and releases all', () => {
    const h = decoyTargetHarness();
    for (let i = 0; i < 1200; i++) h.enemy(`e${i}`, { x: 112 + i % 4 * 32, clearanceCells: i % 2 });
    const decoys = Array.from({ length: 12 }, (_, i) => h.spawn({ ownerId: `p${i}`,
      position: { x: 240 + i % 3 * 32, y: 176 + Math.floor(i / 3) * 32 }, config: resolvedDecoy() }));
    h.step();
    const fields = () => Object.keys(h.coordinator.getDiagnostics().fields).filter(id => id.startsWith('decoy:'));
    expect(fields()).toHaveLength(24);
    for (const enemy of h.enemies) expect(h.targets.getTarget(enemy.id)).not.toBeNull();
    expect(new Set(h.enemies.map(enemy => h.targets.getMovementField(enemy.id))).size).toBeLessThanOrEqual(24);
    for (let i = 0; i < 10; i++) { h.step(); for (const enemy of h.enemies) h.targets.usedTarget(enemy.id); }
    expect(fields()).toHaveLength(24);
    const total = decoys.reduce((sum, decoy) => sum + h.end(decoy.id), 0);
    expect(total).toBe(1200); expect(fields()).toEqual([]);
    h.close();
  });
});
