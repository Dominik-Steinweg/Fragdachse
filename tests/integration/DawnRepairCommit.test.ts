import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', async () => {
  const { createFakePhaserModule } = await import('../fakeArenaRenderScene');
  return createFakePhaserModule();
});
import { ArenaPersistentBaseSession } from '../../src/scenes/arena/ArenaPersistentBaseSession';
import { PersistentBaseRoomSession } from '../../src/persistentBase/PersistentBaseRoomSession';
import { bridge } from '../../src/network/bridge';
import type { PersistentPlayerBaseContribution } from '../../src/persistentBase/PersistentBaseTypes';

afterEach(() => vi.restoreAllMocks());

describe('Dawn repair decision at the host contribution commit', () => {
  it.each([
    { dawn: true, outcome: 'commit' as const, level: 1, count: 3 },
    { dawn: true, outcome: 'commit' as const, level: 2, count: 8 },
    { dawn: true, outcome: 'commit' as const, level: 3, count: 10 },
    { dawn: false, outcome: 'commit' as const, level: 3, count: 0 },
    { dawn: true, outcome: 'rollback' as const, level: 3, count: 10 },
  ])('publishes complete owner contributions for %j', ({ dawn, outcome, level, count }) => {
    vi.spyOn(bridge, 'isHost').mockReturnValue(true);
    vi.spyOn(bridge, 'getActivityDescriptor').mockReturnValue({ parameters: dawn ? { dawn: {} } : {} } as never);
    const session = new PersistentBaseRoomSession();
    const identity = { worldRevision: 1, activityRevision: 2 };
    const initial: PersistentPlayerBaseContribution[] = ['host', 'guest'].map((ownerId, owner) => ({
      schemaVersion: 1, ownerId, revision: 4,
      constructions: Array.from({ length: 5 }, (_, index) => ({
        persistentId: `${owner}-${index}`, tool: { kind: 'construction', id: 'rocket_turret' },
        relativeGridX: index, relativeGridY: owner, placementOrder: index, angle: 0,
      })),
    }));
    initial.forEach(c => session.contributions.offerContribution(c));
    session.beginTransaction(identity);
    initial.forEach((c, owner) => c.constructions.forEach((b, i) => session.contributions.registerRestored(c.ownerId, b, owner * 5 + i)));
    const arena = Object.create(ArenaPersistentBaseSession.prototype) as ArenaPersistentBaseSession;
    Object.assign(arena, { session, world: { getWorldRuntime: () => ({ materialization: { placement: {
      hasRuntimeRock: () => false,
    } } }) } });
    const published = vi.spyOn(arena, 'publishConfirmedPersistentBaseContributions').mockImplementation(() => {});
    vi.spyOn(arena, 'persistCurrentCommittedPersistentBaseRewards').mockImplementation(() => {});
    vi.spyOn(arena, 'publishPersistentBaseRewardSessionState').mockImplementation(() => {});
    arena.applyRoundOutcome(outcome, { ...identity, activityRevision: 99 }, level);
    expect(session.hasOpenTransaction).toBe(true);
    expect(published).toHaveBeenLastCalledWith([]);
    arena.applyRoundOutcome(outcome, identity, level);
    const result = session.contributions.getContributions();
    expect(result.flatMap(c => c.constructions)).toHaveLength(count);
    expect(published).toHaveBeenLastCalledWith(outcome === 'commit' ? result : []);
    expect(result.map(c => c.revision)).toEqual(outcome === 'commit' ? [5, 5] : [4, 4]);
    arena.applyRoundOutcome(outcome, identity, level);
    expect(published).toHaveBeenLastCalledWith([]);
    expect(session.contributions.getContributions()).toEqual(result);
  });
});
