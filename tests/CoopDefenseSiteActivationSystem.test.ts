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

    system.hostUpdate(true, [inside]);
    expect(system.isSiteActivated('near-1')).toBe(false);
    system.hostUpdate(false, [{ ...inside, eligible: false }]);
    expect(system.isSiteActivated('near-1')).toBe(false);
    system.hostUpdate(false, [{ ...inside, x: center.x + 10 * 32 }]);
    expect(system.isSiteActivated('near-1')).toBe(false);

    system.hostUpdate(false, [inside]);
    expect(system.isSiteActivated('near-1')).toBe(true);
    system.hostUpdate(false, []);
    expect(system.isSiteActivated('near-1')).toBe(true);
    expect(system.isSiteActivated('unknown')).toBe(false);
  });
});
