import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({}));
import { MolotovUpgradeSystem, type MolotovPlayerRead } from '../src/systems/MolotovUpgradeSystem';
import type { GroundFireCellOptions, GroundFireContact } from '../src/effects/FireSystem';
import type { ActiveBurnSource } from '../src/combat/rules/BurnStateMachine';
import { resolveMolotovFireEffect } from '../src/loadout/resolveMolotovFireEffect';
import { resolvedMolotov } from './MolotovTestHelper';

function fixture() {
  const effect = resolveMolotovFireEffect(resolvedMolotov());
  const player = { id: 'owner', x: 100, y: 100, positionRevision: 0, getCollisionRadius: () => 2 };
  let players: MolotovPlayerRead[] = [player];
  let alive = true, burrowed = false;
  const contact: GroundFireContact = { sourceKey: 'zone:1', ownerId: player.id, x: 100, y: 100,
    damagePerTick: 0, allowTeamDamage: false, sourceId: 'ground_fire.molotov',
    visualStyle: 'normal', damageTarget: 'all', firewalker: effect.firewalker };
  const collectContacts = vi.fn((_x: number, _y: number, _r: number, _now: number) => [contact]);
  const refresh = vi.fn((_fx: number, _fy: number, _tx: number, _ty: number, _options: GroundFireCellOptions, _now: number) => {});
  const chunks = { hostCreateFireChunkBurst: vi.fn() };
  const system = new MolotovUpgradeSystem(() => players, () => alive, () => burrowed,
    { collectContacts, hostRefreshGroundCellsAlongSegment: refresh }, chunks);
  return { system, player, contact, effect, collectContacts, refresh, chunks,
    setAlive: (value: boolean) => { alive = value; },
    setBurrowed: (value: boolean) => { burrowed = value; },
    leave: () => { players = []; } };
}

describe('Molotov host reactions', () => {
  it('refreshes rather than stacks the buff, including while standing still', () => {
    const f = fixture(), duration = f.effect.firewalker!.durationMs;
    f.system.hostUpdate(100);
    expect(f.system.isActive('owner', 100)).toBe(true);
    f.refresh.mockClear();
    f.system.hostUpdate(200);
    expect(f.refresh).toHaveBeenCalled();
    const options = f.refresh.mock.calls[0][4];
    expect(options).toMatchObject({ ownerId: 'owner', durationMs: f.effect.firewalker!.trailDurationMs,
      damagePerTick: f.effect.firewalker!.trailDamagePerTick, burn: f.effect.firewalker!.burn });
    expect(options).not.toHaveProperty('firewalker');
    expect(options).not.toHaveProperty('wildfire');
    f.collectContacts.mockReturnValue([]);
    f.system.hostUpdate(200 + duration - 1);
    expect(f.system.isActive('owner', 200 + duration - 1)).toBe(true);
    f.refresh.mockClear();
    f.system.hostUpdate(200 + duration);
    expect(f.system.isActive('owner', 200 + duration)).toBe(false);
    expect(f.refresh).not.toHaveBeenCalled();
  });

  it.each(['foreign', 'ordinary', 'chunks', 'player-trail'])('does not activate from %s fire', kind => {
    const f = fixture();
    if (kind === 'foreign') f.contact.ownerId = 'teammate';
    else f.contact.firewalker = undefined;
    f.system.hostUpdate(100);
    expect(f.system.isActive('owner', 100)).toBe(false);
    expect(f.refresh).not.toHaveBeenCalled();
  });

  it('accepts owner-tagged enemy wildfire and catches a thin trail crossed between updates', () => {
    const f = fixture();
    f.contact.sourceId = 'ground_fire.wildfire';
    f.collectContacts.mockImplementation(x => x >= 140 && x <= 156 ? [f.contact] : []);
    f.system.hostUpdate(100);
    f.player.x = 220;
    f.system.hostUpdate(110);
    expect(f.system.isActive('owner', 110)).toBe(true);
    expect(f.refresh.mock.calls[0][0]).toBeGreaterThanOrEqual(140);
    expect(f.refresh.mock.calls.at(-1)?.[2]).toBe(220);
    for (let i = 1; i < f.refresh.mock.calls.length; i++)
      expect(f.refresh.mock.calls[i][0]).toBe(f.refresh.mock.calls[i - 1][2]);
  });

  it('starts at the teleport destination without activating from crossed fire', () => {
    const f = fixture();
    f.system.hostUpdate(100);
    f.collectContacts.mockReturnValue([]);
    f.refresh.mockClear();
    f.player.x = 500; f.player.positionRevision++;
    f.system.hostUpdate(110);
    expect(f.refresh.mock.calls.every(call => call[0] === 500 && call[2] === 500)).toBe(true);
    f.system.clear();
    f.player.x = 100; f.system.hostUpdate(200);
    f.collectContacts.mockImplementation(x => x > 150 && x < 300 ? [f.contact] : []);
    f.player.x = 500; f.player.positionRevision++;
    f.system.hostUpdate(210);
    expect(f.system.isActive('owner', 210)).toBe(false);
  });

  it.each(['death', 'leave', 'clear'])('clears the status on %s', reason => {
    const f = fixture();
    f.system.hostUpdate(100);
    f.collectContacts.mockReturnValue([]);
    if (reason === 'death') f.setAlive(false);
    if (reason === 'leave') f.leave();
    if (reason === 'clear') f.system.clear();
    f.system.hostUpdate(101);
    expect(f.system.isActive('owner', 101)).toBe(false);
  });

  it('does not lay a surface trail while burrowed', () => {
    const f = fixture(); f.system.hostUpdate(100); f.refresh.mockClear();
    f.setBurrowed(true); f.system.hostUpdate(101);
    expect(f.refresh).not.toHaveBeenCalled();
    expect(f.system.isActive('owner', 101)).toBe(false);
  });

  it('uses the captured owner and live runtime source key even after the original zone expires', () => {
    const f = fixture();
    const source = { attackerId: 'owner', sourceKey: 'zone:1', sourceId: 'ground_fire.molotov',
      stackCount: 1 } as ActiveBurnSource;
    const facts = { ownerId: 'owner', sourceKey: 'zone:1', burst: f.effect.wildfire!.deathBurst! };
    f.system.handleEnemyDeath('enemy', 200, 100, [source, { ...source, attackerId: 'other', sourceKey: 'zone:2' }], 100, facts);
    expect(f.chunks.hostCreateFireChunkBurst).toHaveBeenCalledExactlyOnceWith(
      'owner', 200, 100, facts.burst, 'molotov-death:owner:enemy', 100);
    for (const burns of [[], [{ ...source, attackerId: 'other' }], [{ ...source, sourceKey: 'zone:2' }]])
      f.system.handleEnemyDeath('enemy2', 200, 100, burns, 101, facts);
    f.system.handleEnemyDeath('enemy3', 200, 100, [source], 101);
    expect(f.chunks.hostCreateFireChunkBurst).toHaveBeenCalledTimes(1);
  });
});
