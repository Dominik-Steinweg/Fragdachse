import { describe, expect, it, vi } from 'vitest';
import { AdrenalineEssenceBinding, type EssenceBindingPorts } from '../../src/adrenalineEssence/AdrenalineEssenceBinding';
import type { EssencePlayerSnapshot } from '../../src/adrenalineEssence/AdrenalineEssenceTypes';
import type { PrimaryHitAdrenalineRewardFact } from '../../src/combat/PrimaryHitReward';
import { ResourceSystem } from '../../src/systems/ResourceSystem';
import type { ActivityDescriptor } from '../../src/world/ActivityDescriptor';
import { ActivityRuntimeHost } from '../../src/world/ActivityRuntimeHost';
import { WorldRuntime } from '../../src/world/WorldRuntime';
import type { WorldRuntimeContext } from '../../src/world/WorldRuntimeContext';

const descriptor = (activityRevision = 1): ActivityDescriptor => ({
  activityRevision, worldRevision: 21, kind: 'coop-mission', definitionId: 'activity:test',
});

function fact(activityRevision: number | null = 1, id = 'hit', createdAt = 0): PrimaryHitAdrenalineRewardFact {
  return {
    id, outcomeId: id, worldRevision: 21, activityRevision, runtimeGeneration: 1,
    creatorId: 'a', authoredValue: 1.75, resolvedValue: 3.5, origin: { x: 0, y: 0 }, createdAt, seed: 19,
    source: {
      gameplaySource: { kind: 'player', id: 'a' }, attribution: { kind: 'player', id: 'a' },
      allegiance: { ownerId: 'a', kind: 'player' }, origin: 'direct', authoredSourceId: 'weapon:test', sourceSlot: 'weapon1',
    },
    target: { kind: 'enemy', id: 'target', scope: { worldRevision: 21, runtimeGeneration: 1 }, instance: { ...(activityRevision === null ? {} : { activityRevision }), entityGeneration: 1 } },
    intent: {
      branchId: 'primary', gainBasis: { playerId: 'a', multiplier: 2 },
      components: [{ kind: 'weapon-hit', amount: 1.75, appliedModifiers: ['weapon-build'] }],
      scope: { worldRevision: 21, activityRevision, runtimeGeneration: 1 },
    },
  };
}

function fixture(isHost = true, spread = false) {
  const resources = new ResourceSystem();
  resources.initPlayer('a');
  resources.drainAdrenaline('a', resources.getMaxAdrenaline('a'), 0);
  resources.setAdrenalineGainMultiplierResolver(() => 7);
  const gains = vi.fn();
  resources.addAdrenalineGainObserver(gains);
  const players = new Map<string, Omit<EssencePlayerSnapshot, 'adrenaline' | 'maxAdrenaline'>>([['a', {
    playerId: 'a', lifeRevision: 1, participationRevision: 1, interactive: true, alive: true,
    collectible: true, accessGroup: { kind: 'coop' }, x: 0, y: 0,
  }]]);
  const rewardSinks = new Set<(reward: PrimaryHitAdrenalineRewardFact) => void>();
  const burrowObservers = new Set<(id: string) => void>();
  const presentation = { sync: vi.fn(), clear: vi.fn(), destroy: vi.fn() };
  const time = { now: 0, ready: true };
  const ports: EssenceBindingPorts = {
    isHost, now: () => time.now, servicesReady: () => time.ready,
    getPlayers: () => [...players.values()].map(player => ({
      ...player, adrenaline: resources.getAdrenaline(player.playerId), maxAdrenaline: resources.getMaxAdrenaline(player.playerId),
    })),
    // The lifecycle cases share one constrained landing point. Network cases also exercise separated ground.
    resolveGroundPoint: candidate => spread ? candidate : { x: 0, y: 0 }, hasLineOfSight: () => true,
    commitResolvedGain: (id, value) => ({
      creditedValue: resources.commitResolvedAdrenalineGain(id, value), resourceRevision: resources.getAdrenalineRevision(id),
    }),
    bindRewardSink: sink => { rewardSinks.add(sink); return () => { rewardSinks.delete(sink); }; },
    observeBurrow: observer => { burrowObservers.add(observer); return () => { burrowObservers.delete(observer); }; },
    accessGroupFor: () => ({ kind: 'coop' }), localPlayerId: () => 'a', isLocallyVisible: () => true,
    resourceRevisionFor: id => resources.getAdrenalineRevision(id), createPresentation: () => presentation,
  };
  return { resources, gains, players, rewardSinks, burrowObservers, ports, presentation, time };
}

describe('scoped essence composition', () => {
  it('replaces an Activity within the same World, detaches hooks and discards old value without affecting the new Activity', () => {
    const f = fixture();
    const host = new ActivityRuntimeHost(21);
    const first = new AdrenalineEssenceBinding(descriptor(), f.ports);
    host.attach(descriptor(), { destroy: vi.fn() });
    host.bindChild(first);
    first.prepare();
    const lateSink = [...f.rewardSinks][0];
    lateSink(fact());
    first.render(0);
    expect(first.getDiagnostics().gameplay?.activeValue).toBe(3.5);
    const second = new AdrenalineEssenceBinding(descriptor(2), f.ports);
    host.attach(descriptor(2), { destroy: vi.fn() });
    host.bindChild(second);
    second.prepare();
    lateSink(fact());
    for (const sink of f.rewardSinks) sink(fact(1, 'late-old'));
    expect(first.getDiagnostics().gameplay).toMatchObject({ activeValue: 0, lifecycleDiscardedValue: 3.5 });
    expect(second.getDiagnostics().gameplay?.activeValue).toBe(0);
    expect(f.rewardSinks.size).toBe(1);
    expect(f.burrowObservers.size).toBe(1);
    expect(f.presentation.destroy).toHaveBeenCalledTimes(1);
    for (const sink of f.rewardSinks) sink(fact(2, 'new'));
    second.updateHost(300);
    second.updateHost(600);
    expect(f.resources.getAdrenaline('a')).toBe(3.5);
    expect(f.gains).toHaveBeenCalledTimes(1);
    host.close();
    host.close();
    expect(f.rewardSinks.size).toBe(0);
    expect(f.burrowObservers.size).toBe(0);
  });

  it('adds immediate burrow cancellation without replacing existing lifecycle reactions', () => {
    const f = fixture();
    const beerDrop = vi.fn();
    f.burrowObservers.add(beerDrop);
    const activity = new AdrenalineEssenceBinding(descriptor(), f.ports);
    activity.prepare();
    for (const sink of f.rewardSinks) sink(fact());
    activity.updateHost(300);
    const oldTransfer = activity.runtime!.getState().transfers[0];
    f.time.now = 350;
    for (const observer of f.burrowObservers) observer('a');
    expect(beerDrop).toHaveBeenCalledOnce();
    expect(activity.runtime!.getState().transfers).toHaveLength(0);
    expect(activity.runtime!.getState().clusters[0]).toMatchObject({ x: oldTransfer.sourceX, value: 3.5 });
    expect(f.gains).not.toHaveBeenCalled();
    activity.destroy();
    expect(f.burrowObservers).toEqual(new Set([beerDrop]));
  });

  it('returns a disconnected collector flight and only credits a newly reserved life after reconnect', () => {
    const f = fixture();
    const activity = new AdrenalineEssenceBinding(descriptor(), f.ports);
    activity.prepare();
    for (const sink of f.rewardSinks) sink(fact());
    activity.updateHost(300);
    const first = activity.runtime!.getState().transfers[0];
    const originalPlayer = f.players.get('a')!;
    f.players.delete('a');
    activity.updateHost(350);
    expect(f.resources.getAdrenaline('a')).toBe(0);
    expect(activity.runtime!.getState().clusters[0].value).toBe(3.5);
    f.players.set('a', { ...originalPlayer, lifeRevision: 2, participationRevision: 2 });
    activity.updateHost(400);
    const second = activity.runtime!.getState().transfers[0];
    expect(second.id).not.toBe(first.id);
    expect(second.lifeRevision).toBe(2);
    activity.updateHost(600);
    expect(f.gains).toHaveBeenCalledOnce();
    expect(f.resources.getAdrenaline('a')).toBe(3.5);
    activity.destroy();
  });

  it('retains the last canonical team group for a fully attributed post-disconnect reward', () => {
    const f = fixture();
    f.players.set('a', { ...f.players.get('a')!, accessGroup: { kind: 'team', teamId: 'red' } });
    const activity = new AdrenalineEssenceBinding(descriptor(), {
      ...f.ports, accessGroupFor: id => f.players.get(id)?.accessGroup ?? null,
    });
    activity.updateHost(0);
    f.players.delete('a');
    f.resources.removePlayer('a');
    for (const sink of f.rewardSinks) sink(fact(1, 'after-disconnect', 100));
    expect(activity.runtime!.getState().clusters[0]).toMatchObject({ accessGroup: { kind: 'team', teamId: 'red' }, value: 3.5 });
    for (const sink of f.rewardSinks) sink({ ...fact(1, 'unknown-origin', 100), creatorId: 'unknown' });
    expect(activity.getDiagnostics().gameplay?.rewardCount).toBe(1);
    expect(f.gains).not.toHaveBeenCalled();
    activity.destroy();
  });

  it('keeps an already written arrival terminal when a resource observer starts burrow synchronously', () => {
    const f = fixture();
    const activity = new AdrenalineEssenceBinding(descriptor(), f.ports);
    activity.prepare();
    for (const sink of f.rewardSinks) sink(fact());
    activity.updateHost(300);
    f.resources.addAdrenalineGainObserver(() => {
      f.time.now = 500;
      for (const observer of f.burrowObservers) observer('a');
    });
    activity.updateHost(500);
    expect(f.resources.getAdrenaline('a')).toBe(3.5);
    expect(activity.getDiagnostics().gameplay).toMatchObject({ committedValue: 3.5, activeValue: 0, returnedValue: 0, conservationError: 0 });
    activity.destroy();
  });

  it('accounts actual arrival separately from discarded remainder when its resource observer ends the Activity', () => {
    const f = fixture();
    const activity = new AdrenalineEssenceBinding(descriptor(), f.ports);
    activity.prepare();
    for (const sink of f.rewardSinks) sink(fact());
    activity.updateHost(300);
    f.resources.commitResolvedAdrenalineGain('a', f.resources.getMaxAdrenaline('a') - 2);
    f.resources.addAdrenalineGainObserver(() => { activity.destroy(); });
    activity.updateHost(500);
    expect(activity.getDiagnostics().gameplay).toMatchObject({ committedValue: 2, activeValue: 0, lifecycleDiscardedValue: 1.5, conservationError: 0, cancellations: { teardown: 0 } });
    expect(f.resources.getAdrenaline('a')).toBe(f.resources.getMaxAdrenaline('a'));
  });

  it('deduplicates repeated network terminal receipts without replaying gain in JIP or mutating client resources', () => {
    const server = fixture(true, true);
    const client = fixture(false);
    const hostActivity = new AdrenalineEssenceBinding(descriptor(), server.ports);
    const clientActivity = new AdrenalineEssenceBinding(descriptor(), {
      ...client.ports, resourceRevisionFor: id => server.resources.getAdrenalineRevision(id),
    });
    hostActivity.prepare();
    for (const sink of server.rewardSinks) sink(fact());
    const fragments = hostActivity.runtime!.getState().clusters.length;
    expect(fragments).toBeGreaterThan(1);
    clientActivity.applySnapshot(hostActivity.getNetSnapshot(0, true));
    hostActivity.updateHost(300);
    clientActivity.applySnapshot(hostActivity.getNetSnapshot(300, false));
    hostActivity.updateHost(500);
    const terminal = hostActivity.getNetSnapshot(500, false)!;
    clientActivity.applySnapshot(terminal);
    clientActivity.applySnapshot(terminal);
    clientActivity.render(500);
    expect(client.presentation.sync.mock.calls.flatMap(call => call[1])).toHaveLength(fragments);
    clientActivity.applySnapshot(hostActivity.getNetSnapshot(550, false));
    clientActivity.render(550);
    expect(client.presentation.sync.mock.calls.flatMap(call => call[1])).toHaveLength(fragments);
    expect(client.resources.getAdrenaline('a')).toBe(0);
    expect(server.resources.getAdrenaline('a')).toBe(3.5);
    const joined = fixture(false);
    const joinedActivity = new AdrenalineEssenceBinding(descriptor(), joined.ports);
    joinedActivity.applySnapshot(hostActivity.getNetSnapshot(600, true));
    joinedActivity.render(600);
    expect(joined.presentation.sync).not.toHaveBeenCalled();
    hostActivity.destroy(); clientActivity.destroy(); joinedActivity.destroy();
  });

  it('delivers a recent arrival after a periodic full to existing clients without replaying it to a simultaneous late join', () => {
    const server = fixture();
    const existing = fixture(false);
    const joined = fixture(false);
    const hostActivity = new AdrenalineEssenceBinding(descriptor(), server.ports);
    const resourceRevisionFor = (id: string) => server.resources.getAdrenalineRevision(id);
    const existingActivity = new AdrenalineEssenceBinding(descriptor(), { ...existing.ports, resourceRevisionFor });
    const joinedActivity = new AdrenalineEssenceBinding(descriptor(), { ...joined.ports, resourceRevisionFor });
    hostActivity.prepare();
    for (const sink of server.rewardSinks) sink(fact());
    existingActivity.applySnapshot(hostActivity.getNetSnapshot(0, true));
    hostActivity.updateHost(300);
    existingActivity.applySnapshot(hostActivity.getNetSnapshot(300, false));
    existingActivity.render(300);
    hostActivity.updateHost(1000);
    const full = hostActivity.getNetSnapshot(1000, false)!;
    expect(full.full).toBe(true);
    expect(full.receipts).toEqual([]);
    existingActivity.applySnapshot(full);
    joinedActivity.applySnapshot(full);
    const followup = hostActivity.getNetSnapshot(1050, false)!;
    existingActivity.applySnapshot(followup);
    joinedActivity.applySnapshot(followup);
    existingActivity.render(1050);
    joinedActivity.render(1050);
    expect(existing.presentation.sync.mock.calls.flatMap(call => call[1])).toHaveLength(1);
    expect(joined.presentation.sync).not.toHaveBeenCalled();
    hostActivity.destroy(); existingActivity.destroy(); joinedActivity.destroy();
  });

  it('enables the explicit Lobby World lease without fabricating an Activity and destroys its remaining essence with the World', () => {
    const f = fixture();
    const world = new WorldRuntime({ descriptor: {
      worldRevision: 21, definitionId: 'world:lobby', seed: 1, generatorVersion: 1, layoutFingerprint: 'test-lobby',
    } } as WorldRuntimeContext);
    const binding = new AdrenalineEssenceBinding({ worldRevision: 21, activityRevision: null }, f.ports);
    world.bind(binding);
    binding.prepare();
    expect(world.activity.isAttached()).toBe(false);
    expect(world.activity.descriptor).toBeNull();
    const sink = [...f.rewardSinks][0];
    sink(fact(null, 'practice-hit'));
    binding.updateHost(300);
    binding.updateHost(600);
    expect(f.resources.getAdrenaline('a')).toBe(3.5);
    sink(fact(null, 'uncollected', 601));
    binding.render(601);
    world.destroy();
    world.destroy();
    sink(fact(null, 'late', 602));
    expect(binding.getDiagnostics().gameplay).toMatchObject({ activeValue: 0, committedValue: 3.5, lifecycleDiscardedValue: 3.5, rewardCount: 2 });
    expect(f.presentation.destroy).toHaveBeenCalledOnce();
    expect(f.rewardSinks.size).toBe(0);
    expect(world.activity.isAttached()).toBe(false);
  });

  it('isolates Lobby snapshots from match Activities and subsequent World instances', () => {
    const host = fixture();
    const lobby = new AdrenalineEssenceBinding({ worldRevision: 21, activityRevision: null }, host.ports);
    lobby.prepare();
    for (const sink of host.rewardSinks) sink(fact(null, 'lobby-hit'));
    const full = lobby.getNetSnapshot(0, true)!;
    const matchingClient = fixture(false);
    const sameLobby = new AdrenalineEssenceBinding({ worldRevision: 21, activityRevision: null }, matchingClient.ports);
    sameLobby.applySnapshot(full);
    sameLobby.render(0);
    expect(matchingClient.presentation.sync).toHaveBeenCalledOnce();
    for (const foreignScope of [{ worldRevision: 21, activityRevision: 1 }, { worldRevision: 22, activityRevision: null }]) {
      const remote = fixture(false);
      const binding = new AdrenalineEssenceBinding(foreignScope, remote.ports);
      binding.applySnapshot(full);
      binding.render(0);
      expect(remote.presentation.sync).not.toHaveBeenCalled();
      binding.destroy();
    }
    sameLobby.destroy(); lobby.destroy();
  });

  it('clears old presentation tails and lights before rendering a newly accessible team', () => {
    const f = fixture();
    let group: EssencePlayerSnapshot['accessGroup'] = { kind: 'team', teamId: 'red' };
    const binding = new AdrenalineEssenceBinding(descriptor(), { ...f.ports, accessGroupFor: () => group });
    binding.prepare();
    const sink = [...f.rewardSinks][0];
    sink(fact());
    binding.render(0);
    expect(f.presentation.clear).not.toHaveBeenCalled();
    group = { kind: 'team', teamId: 'blue' };
    sink(fact(1, 'blue-hit', 10));
    binding.render(10);
    expect(f.presentation.clear).toHaveBeenCalledOnce();
    expect(f.presentation.clear.mock.invocationCallOrder[0]).toBeLessThan(f.presentation.sync.mock.invocationCallOrder[1]);
    const visible = f.presentation.sync.mock.calls.at(-1)![0];
    expect(visible.clusters).toHaveLength(1);
    expect(visible.clusters[0].accessGroup).toEqual(group);
    group = null;
    binding.render(20);
    expect(f.presentation.clear).toHaveBeenCalledTimes(2);
    binding.destroy();
  });
});
