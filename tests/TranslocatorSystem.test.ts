import { describe, expect, it, vi } from 'vitest';
import { TranslocatorSystem, type TranslocatorActor, type TranslocatorWorldPort } from '../src/systems/TranslocatorSystem';
import { UTILITY_CONFIGS, type TranslocatorUtilityConfig } from '../src/loadout/LoadoutConfig';
import type { TranslocatorUseState } from '../src/loadout/TranslocatorUseState';

function world(overrides: Partial<TranslocatorUtilityConfig> = {}) {
  const config = { ...UTILITY_CONFIGS.TRANSLOCATOR, ...overrides } as TranslocatorUtilityConfig;
  const actors = new Map<string, TranslocatorActor>([['p', { id: 'p', kind: 'player', x: 50, y: 50,
    radius: 12, alive: true, surface: true, revision: 0 }]]);
  const pucks = new Map<number, {x: number; y: number}>();
  let nextId = 0;
  const projectile = { spawnPuck: vi.fn((r: {x: number; y: number}) => { pucks.set(++nextId, {x: r.x, y: r.y}); return nextId; }),
    getPuckPosition: (id: number) => pucks.get(id) ?? null,
    consumePuck: vi.fn((id: number) => pucks.delete(id)) };
  const combat = { isAlive: (id: string) => actors.get(id)?.alive ?? false, applyDamage: vi.fn() };
  const published = new Map<string, TranslocatorUseState | null>();
  const network = { getPlayerColor: () => 0xffffff, broadcastTranslocatorFlash: vi.fn(), broadcastExplosionEffect: vi.fn(),
    broadcastPortalCollapse: vi.fn(), publishTranslocatorUseState: (id: string, s: TranslocatorUseState | null) => published.set(id, s) };
  const port: TranslocatorWorldPort = {
    getActors: () => [...actors.values()], canOccupy: vi.fn(() => true),
    transferActor: vi.fn((a, x, y) => actors.set(a.id, { ...actors.get(a.id)!, x, y, revision: a.revision + 1 })),
    isFriendly: (owner, target) => owner === target || target.startsWith('friend'),
    // General combat permits self damage. The telefrag must narrow that permission.
    canDamage: (owner, target) => owner === target || target.startsWith('enemy'), collapseEnemy: vi.fn(),
  };
  const system = new TranslocatorSystem({ getPlayer: (id: string) => actors.get(id) } as never, projectile, combat as never, network);
  system.bindWorld(port);
  const add = (id: string, x: number, y: number, extra: Partial<TranslocatorActor> = {}) => {
    actors.set(id, { id, x, y, kind: id.startsWith('enemy') ? 'enemy' : 'player', radius: 12,
      alive: true, surface: true, revision: 0, ...extra });
  };
  const throwPuck = (id = 'p', now = 1000) => {
    expect(system.handleUse(id, 0, 0, 0, now, { utilityChargeFraction: 1 }, config)).toBe('thrown');
    pucks.set(system.getActivePuckId(id)!, {x: 250, y: 50});
    return system.getUseState(id)!.useId;
  };
  return { system, config, actors, pucks, projectile, combat, published, port, network, add, throwPuck };
}

describe('Translocator use lifetime', () => {
  it('throws without cooldown and accepts the immediate next press, then consumes once', () => {
    const w = world(); const use = w.throwPuck();
    expect(w.system.getUseState('p')?.phase).toBe('puck');
    expect(w.system.followup('p', use, 1001)).toBe('teleported');
    expect(w.actors.get('p')).toMatchObject({x: 250, y: 50});
    expect(w.projectile.consumePuck).toHaveBeenCalledTimes(1);
    expect(w.system.getUseState('p')).toMatchObject({phase: 'cooldown', cooldownUntil: 1001 + w.config.cooldown});
    expect(w.system.followup('p', use, 1002)).toBe('blocked');
    w.system.update(1001 + w.config.cooldown);
    expect(w.system.getUseState('p')).toBeNull();
  });
  it('retains the puck and use when the destination cannot contain the actor', () => {
    const w = world(); const use = w.throwPuck();
    vi.mocked(w.port.canOccupy).mockReturnValue(false);
    expect(w.system.followup('p', use, 1002)).toBe('blocked');
    expect(w.system.getUseState('p')?.useId).toBe(use);
    expect(w.projectile.consumePuck).not.toHaveBeenCalled();
  });
  it('damages only intersecting hostile bodies through the normal authored damage boundary', () => {
    const w = world(); const use = w.throwPuck();
    w.add('enemy-touch', 250 + w.config.telefragRadius + 12, 50);
    w.add('enemy-out', 250 + w.config.telefragRadius + 12.01, 50);
    w.add('friend', 250, 50);
    w.system.followup('p', use, 1001);
    expect(w.combat.applyDamage).toHaveBeenCalledTimes(1);
    expect(w.combat.applyDamage).toHaveBeenCalledWith('enemy-touch', w.config.telefragDamage, false,
      'p', 'environment.telefrag', expect.any(Object), { sourceSlot: 'utility', basis: { kind: 'authored', amount: w.config.telefragDamage } });
  });
  it.each(['manual', 'expiry', 'death'] as const)('closes and collapses exactly once on %s', reason => {
    const w = world({portalEnabled: 1, collapseSlowFraction: 0.4, collapseRadius: 400});
    const use = w.throwPuck();
    expect(w.system.followup('p', use, 1001)).toBe('opened');
    w.add('enemy-both', 150, 50);
    const pair = w.system.getPortalPairs()[0];
    let end = 1010;
    if (reason === 'manual') w.system.followup('p', use, end);
    if (reason === 'expiry') { end = pair.expiresAt; w.system.update(end); }
    if (reason === 'death') { w.actors.set('p', {...w.actors.get('p')!, alive: false}); w.system.update(end); }
    w.system.update(end + 1);
    w.system.followup('p', use, end + 2);
    expect(w.system.getPortalPairs()).toHaveLength(0);
    expect(w.port.collapseEnemy).toHaveBeenCalledTimes(1);
    expect(w.network.broadcastPortalCollapse).toHaveBeenCalledTimes(1);
    expect(w.system.getUseState('p')).toMatchObject({phase: 'cooldown', cooldownUntil: end + w.config.cooldown});
  });
  it('ends lost pucks and preserves the cooldown across death and respawn', () => {
    const w = world(); w.throwPuck(); w.pucks.clear(); w.system.update(1010);
    w.actors.set('p', {...w.actors.get('p')!, alive: false}); w.system.update(1011);
    w.actors.set('p', {...w.actors.get('p')!, alive: true});
    expect(w.system.handleUse('p', 0, 0, 0, 1012, undefined, w.config)).toBe('blocked');
    expect(w.system.getUseState('p')).toMatchObject({cooldownUntil: 1010 + w.config.cooldown});
  });
  it('freezes deployment values at the throw and clears teardown without collapse', () => {
    const w = world({portalEnabled: 1, collapseSlowFraction: 0.4}); const use = w.throwPuck();
    const duration = w.config.portalDurationMs;
    Object.assign(w.config, {portalDurationMs: 1, portalEnabled: 0});
    expect(w.system.followup('p', use, 1001)).toBe('opened');
    expect(w.system.getPortalPairs()[0].expiresAt).toBe(1001 + duration);
    w.system.clear(); w.system.clear();
    expect(w.network.broadcastPortalCollapse).not.toHaveBeenCalled();
    expect(w.system.getUseState('p')).toBeNull();
  });
  it('requires separate endpoints, catches opening overlaps and gates the initial owner', () => {
    const w = world({portalEnabled: 1}); const use = w.throwPuck();
    w.pucks.set(w.system.getActivePuckId('p')!, {x: 60, y: 50});
    expect(w.system.followup('p', use, 1001)).toBe('blocked');
    w.pucks.set(w.system.getActivePuckId('p')!, {x: 250, y: 50});
    w.add('friend', 250, 55); w.add('friend-burrow', 250, 55, {surface: false});
    w.system.followup('p', use, 1002);
    expect(w.actors.get('p')).toMatchObject({x: 250, y: 50});
    expect(w.actors.get('friend')).toMatchObject({x: 50, y: 55});
    expect(w.actors.get('friend-burrow')).toMatchObject({x: 250, y: 55});
    w.system.transferActors(1003);
    expect(w.actors.get('friend')).toMatchObject({x: 50, y: 55});
  });
  it('keeps a boss at its entrance when its full body does not fit the exit', () => {
    const w = world({portalEnabled: 1}); const use = w.throwPuck();
    w.system.followup('p', use, 1001);
    w.add('enemy-boss', 50, 50, {radius: 80});
    vi.mocked(w.port.canOccupy).mockImplementation(actor => actor.radius < 80);
    w.system.transferActors(1002);
    expect(w.actors.get('enemy-boss')).toMatchObject({x: 50, y: 50, revision: 0});
    expect(w.system.getPortalPairs()).toHaveLength(1);
  });
  it('presents ordinary portal closure once but never turns cleanup into a collapse', () => {
    const w = world({portalEnabled: 1}); const use = w.throwPuck();
    w.system.followup('p', use, 1001); w.system.followup('p', use, 1002);
    expect(w.network.broadcastPortalCollapse).toHaveBeenCalledTimes(1);
    expect(w.port.collapseEnemy).not.toHaveBeenCalled();
    w.system.clear();
    expect(w.network.broadcastPortalCollapse).toHaveBeenCalledTimes(1);
  });
  it('renews available buffs, including weaker effects, and ends own effects on death', () => {
    const w = world({portalEnabled: 1, phaseMoveSpeedBonus: 0.3, phaseHpRegenPerSecond: 30});
    const use = w.throwPuck(); w.add('friend', 250, 50); w.system.followup('p', use, 1001);
    expect(w.system.getMoveSpeedBonus('friend', 1002)).toBe(0.3);
    w.system.removePlayer('p');
    w.add('owner2', 50, 50); Object.assign(w.config, {phaseMoveSpeedBonus: 0.1, phaseHpRegenPerSecond: 0});
    const second = w.throwPuck('owner2', 1100);
    w.actors.set('friend', {...w.actors.get('friend')!, x: 250, y: 50});
    w.system.followup('owner2', second, 1101);
    expect(w.system.getMoveSpeedBonus('friend', 1102)).toBe(0.1);
    expect(w.system.getHpRegen('friend', 1102)).toBe(30);
    w.actors.set('friend', {...w.actors.get('friend')!, alive: false}); w.system.update(1103);
    expect(w.system.getMoveSpeedBonus('friend', 1104)).toBe(0);
    expect(w.system.getHpRegen('friend', 1104)).toBe(0);
  });
});
