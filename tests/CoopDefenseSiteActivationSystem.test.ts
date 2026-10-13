import { describe, expect, it } from 'vitest';
import { getArenaMetricsProfile } from '../src/config';
import { CoopDefenseSiteActivationSystem } from '../src/systems/CoopDefenseSiteActivationSystem';
import { resolveWorldMetrics, worldCellCenter } from '../src/world/WorldMetrics';

describe('CoopDefenseSiteActivationSystem', () => {
  const metrics = resolveWorldMetrics(getArenaMetricsProfile('coop_defense', 'ARENA'));
  const site = { id: 'near-1', gridX: 10, gridY: 8, radiusCells: 3 };
  const center = worldCellCenter(metrics, site.gridX, site.gridY);

  it('activates a site permanently once an eligible player enters its clearing', () => {
    const system = new CoopDefenseSiteActivationSystem([site], metrics);
    const inside = { playerId: 'p1', x: center.x + 32, y: center.y, eligible: true };

    system.hostUpdate(0, true, [inside]);
    expect(system.isSiteActivated('near-1')).toBe(false);
    system.hostUpdate(0, false, [{ ...inside, eligible: false }]);
    expect(system.isSiteActivated('near-1')).toBe(false);
    system.hostUpdate(0, false, [{ ...inside, x: center.x + 10 * 32 }]);
    expect(system.isSiteActivated('near-1')).toBe(false);

    system.hostUpdate(0, false, [inside]);
    expect(system.isSiteActivated('near-1')).toBe(true);
    system.hostUpdate(300_000, false, []);
    expect(system.isSiteActivated('near-1')).toBe(true);
    expect(system.isSiteActivated('unknown')).toBe(false);
  });

  it.each([209_999, 210_000, 210_010])('only activates before closure at round time %s', enteredAt => {
    const system = new CoopDefenseSiteActivationSystem([site], metrics, new Map([[site.id, 210_000]]));
    const inside = { playerId: 'p1', ...center, eligible: true };
    system.hostUpdate(10_000, true, [inside]);
    system.hostUpdate(209_990, false, []);
    system.hostUpdate(enteredAt - 209_990, false, [inside]);
    expect(system.isSiteActivated(site.id)).toBe(enteredAt < 210_000);
    system.hostUpdate(300_000, false, [inside]);
    expect(system.isSiteActivated(site.id)).toBe(enteredAt < 210_000);
  });

  it('has no time limit without an objective deadline', () => {
    const system = new CoopDefenseSiteActivationSystem([site], metrics);
    system.hostUpdate(300_000, false, [{ playerId: 'p1', ...center, eligible: true }]);
    expect(system.isSiteActivated(site.id)).toBe(true);
  });
});
