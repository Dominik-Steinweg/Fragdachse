import { describe, expect, it } from 'vitest';
import { ROCK_HP_MAX, ROCK_NET_FULL_SNAPSHOT_INTERVAL_TICKS } from '../src/config';
import { RockRegistry } from '../src/arena/RockRegistry';
import type { ArenaLayout } from '../src/types';

function layoutWithOneRock(): ArenaLayout {
  return { rocks: [{} as ArenaLayout['rocks'][number] ] } as ArenaLayout;
}

describe('RockRegistry', () => {
  it('keeps destroyed rocks in later full snapshots as HP-zero tombstones', () => {
    const registry = new RockRegistry(layoutWithOneRock());

    registry.applyDamage(0, ROCK_HP_MAX);
    registry.remove(0);
    const destructionSnapshot = registry.getNetSnapshot();

    expect(destructionSnapshot?.upserts).toContainEqual({ id: 0, hp: 0 });
    expect(destructionSnapshot?.removals).toContain(0);

    for (let tick = 0; tick < ROCK_NET_FULL_SNAPSHOT_INTERVAL_TICKS; tick += 1) {
      registry.getNetSnapshot();
    }

    const recoveredFullSnapshot = registry.getNetSnapshot();
    expect(recoveredFullSnapshot?.full).toBe(true);
    expect(recoveredFullSnapshot?.upserts).toContainEqual({ id: 0, hp: 0 });
  });
});