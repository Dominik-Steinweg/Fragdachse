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

  /**
   * Der Aufruf ist verbrauchend: er leert die gesammelten Removals und HP-Änderungen und
   * zählt den Full-Resync-Zyklus weiter. Wer ihn öfter als einmal pro Net-Tick aufruft,
   * wirft genau die Deltas weg, die er nicht verschickt – die Gegenseite sieht dann bis zum
   * nächsten Full-Snapshot einen veralteten Stand.
   */
  it('reports each change exactly once, so it must be called once per network tick', () => {
    const registry = new RockRegistry(layoutWithOneRock());

    registry.applyDamage(0, 10);
    const first = registry.getNetSnapshot();
    expect(first?.upserts).toContainEqual({ id: 0, hp: ROCK_HP_MAX - 10 });

    // Zweiter Aufruf ohne neue Änderung: nichts mehr zu melden.
    expect(registry.getNetSnapshot()).toBeNull();

    registry.remove(0);
    const removalSnapshot = registry.getNetSnapshot();
    expect(removalSnapshot?.removals).toContain(0);

    // Die Removal selbst wird genau einmal gemeldet; danach folgt nur noch der
    // HP-0-Grabstein, bis auch der im Cache steht.
    expect(registry.getNetSnapshot()?.removals ?? []).not.toContain(0);
    expect(registry.getNetSnapshot()).toBeNull();
  });
});