import { describe, expect, it } from 'vitest';
import { EnemyAiTargetCatalog } from '../src/systems/EnemyAiTargetCatalog';
import { getFirestarterFactionTargets } from '../src/systems/firestarterAlliedTargeting';

describe('firestarter faction targets', () => {
  it('keeps player and hostile groups separate and ranks hostile density before distance', () => {
    const catalog = new EnemyAiTargetCatalog();
    let targetable = true;
    catalog.updateTargets([
      { kind: 'player', id: 'player', x: 50, y: 0 },
      { kind: 'armed-base', id: 'base', x: 60, y: 0 },
      { kind: 'armed-construct', id: 'construct', x: 70, y: 0 },
      { kind: 'hostile-enemy', id: 'near', x: 100, y: 0 },
      { kind: 'hostile-enemy', id: 'a', x: 400, y: 0 },
      { kind: 'hostile-enemy', id: 'b', x: 420, y: 0, isTargetable: () => targetable },
    ]);
    const select = (faction: 'hostile' | 'allied') => getFirestarterFactionTargets({ faction, sprite: { x: 0, y: 0 } }, catalog, 50);
    expect(select('hostile')).toEqual([{ x: 50, y: 0 }]);
    expect(select('allied')).toEqual([{ x: 400, y: 0 }, { x: 420, y: 0 }, { x: 100, y: 0 }]);
    targetable = false;
    expect(select('allied')).toEqual([{ x: 100, y: 0 }, { x: 400, y: 0 }]);
    catalog.clear(); expect(select('allied')).toEqual([]);
  });
});
