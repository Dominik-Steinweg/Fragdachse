import { describe, expect, it, vi } from 'vitest';
import { resolveCoopDefenseCarryPresentationSnapshot } from '../src/scenes/arena/CoopDefenseCarryPresentation';
import type { SyncedCoopDefenseCarryState } from '../src/types';

const replicated: SyncedCoopDefenseCarryState = [{
  id: 'replicated',
  objectiveId: 'carry',
  x: 10,
  y: 20,
  holderId: null,
  state: 'spawned',
}];

describe('coop-defense carry presentation source', () => {
  it('reads the current authoritative carry state for every host presentation frame', () => {
    let authoritative: SyncedCoopDefenseCarryState = [{
      ...replicated[0],
      id: 'host-first',
      x: 100,
    }];
    const source = { getSnapshot: vi.fn(() => authoritative) };

    expect(resolveCoopDefenseCarryPresentationSnapshot(true, source, replicated))
      .toBe(authoritative);
    authoritative = [{ ...authoritative[0], id: 'host-current', x: 240 }];
    expect(resolveCoopDefenseCarryPresentationSnapshot(true, source, replicated))
      .toBe(authoritative);
    expect(source.getSnapshot).toHaveBeenCalledTimes(2);
  });

  it('uses only the replicated carry snapshot on clients', () => {
    const source = { getSnapshot: vi.fn(() => []) };

    expect(resolveCoopDefenseCarryPresentationSnapshot(false, source, replicated))
      .toBe(replicated);
    expect(source.getSnapshot).not.toHaveBeenCalled();
  });
});
