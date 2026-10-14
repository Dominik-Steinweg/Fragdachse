import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', async () => (await import('./fakeArenaRenderScene')).createFakePhaserModule());
import raw from '../src/config/dawn/elites.json';
import { DAWN_ELITE_CONFIG, validateDawnEliteConfig } from '../src/config/dawn/elites';
import { DAWN_ELITE_AFFIX_IDS, type DawnEliteAffixId } from '../src/dawn/contracts/DawnContentIds';
import { rollDawnElite } from '../src/systems/DawnEliteRules';
import { EnemyManager } from '../src/entities/EnemyManager';
import { resolveCoopDefenseEnemyConfigs } from '../src/config/coopDefenseEnemies';
import { healthBarTestScene } from './healthBarTestScene';
import { encodeEnemyUpsert, decodeEnemyUpserts } from '../src/network/enemySnapshotCodec';

function setup(affix?: DawnEliteAffixId) {
  const configs = resolveCoopDefenseEnemyConfigs(1);
  configs['rabid-badger'] = { ...configs['rabid-badger'], glow: undefined, imageKey: 'test-enemy', deathSpawns: [] };
  const manager = new EnemyManager(healthBarTestScene().scene, configs), explosion = vi.fn();
  let seed = 0;
  if (affix) {
    while (rollDawnElite({ roundSeed: seed, threat: 10 }, 'wave', 'e1') !== affix) {
      if (++seed > 100000) throw new Error('No affix seed');
    }
    manager.bindDawnElites({ roundSeed: seed, threat: 10 }, explosion);
  }
  const enemy = manager.hostSpawnAtWorld(100, 100, 'rabid-badger', { originId: 'wave' });
  return { manager, enemy, configs, explosion, seed };
}

describe('Dawn elite authored rules', () => {
  it('validates every threat, known affix, weight and effect parameter', () => {
    expect(() => validateDawnEliteConfig(raw)).not.toThrow();
    const invalid = [
      (c: any) => c.chanceByThreat.pop(),
      (c: any) => c.chanceByThreat[0] = NaN,
      (c: any) => c.chanceByThreat[1] = -1,
      (c: any) => c.chanceByThreat[9] = 2,
      (c: any) => c.chanceByThreat[9] = 0,
      (c: any) => c.affixes.unknown = c.affixes.swift,
      (c: any) => delete c.affixes.shielding,
      (c: any) => Object.values(c.affixes).forEach((a: any) => a.weight = 0),
      (c: any) => c.affixes.swift.speedMultiplier = 0,
      (c: any) => c.affixes.armored.damageReduction = 1,
      (c: any) => c.affixes.volatile.minDamage = c.affixes.volatile.damage + 1,
      (c: any) => c.affixes.regenerating.maxHpFractionPerSecond = Infinity,
      (c: any) => c.affixes.shielding.radiusPx = -1,
    ];
    for (const mutate of invalid) { const c = structuredClone(raw); mutate(c); expect(() => validateDawnEliteConfig(c)).toThrow(); }
  });

  it('is reproducible, independent of call order and respects zero chances/weights', () => {
    const context = { roundSeed: 381, threat: 10 }, ids = Array.from({ length: 400 }, (_, i) => 'e' + i.toString(36));
    const first = ids.map(id => rollDawnElite(context, 'wave-a', id));
    expect(ids.slice().reverse().map(id => rollDawnElite(context, 'wave-a', id)).reverse()).toEqual(first);
    expect(ids.map(id => rollDawnElite({ ...context, roundSeed: 382 }, 'wave-a', id))).not.toEqual(first);
    expect(ids.map(id => rollDawnElite(context, 'wave-b', id))).not.toEqual(first);
    expect(new Set(first)).toEqual(new Set([undefined, ...DAWN_ELITE_AFFIX_IDS]));
    const config = structuredClone(raw);
    config.chanceByThreat.fill(0);
    expect(ids.every(id => rollDawnElite(context, 'wave-a', id, config) === undefined)).toBe(true);
    config.chanceByThreat.fill(1);
    for (const id of DAWN_ELITE_AFFIX_IDS) config.affixes[id].weight = id === 'armored' ? 1 : 0;
    expect(ids.every(id => rollDawnElite(context, 'wave-a', id, config) === 'armored')).toBe(true);
  });

  it('includes elite effects in the Dawn content handshake hash', async () => {
    const original = (await import('../src/config/dawn/dawnContent')).DAWN_CONTENT_HASH;
    const changed = structuredClone(raw); changed.affixes.swift.speedMultiplier += 0.1;
    vi.resetModules();
    vi.doMock('../src/config/dawn/elites.json', () => ({ default: changed }));
    try { expect((await import('../src/config/dawn/dawnContent')).DAWN_CONTENT_HASH).not.toBe(original); }
    finally { vi.doUnmock('../src/config/dawn/elites.json'); vi.resetModules(); }
  }, 30000);
});

describe('Dawn elites at the authoritative enemy boundary', () => {
  it('leaves campaign enemies and summoned player allies ordinary', () => {
    const campaign = setup(), dawn = setup('swift');
    expect(campaign.enemy.eliteAffixId).toBeUndefined();
    const ally = dawn.manager.hostSpawnAllyAtWorld(200, 200, 'rabid-badger', 'p0', 0xffffff);
    expect(ally.eliteAffixId).toBeUndefined();
    campaign.manager.destroy(); dawn.manager.destroy();
  });

  it('makes swift enemies faster alongside movement modifiers, with visual-only enlargement', () => {
    const { manager, enemy, configs } = setup('swift');
    enemy.setMoveSpeedMultiplier(0.5);
    expect(enemy.getMoveSpeed()).toBeCloseTo(configs[enemy.kind].moveSpeed * 0.5 * DAWN_ELITE_CONFIG.affixes.swift.speedMultiplier);
    expect(enemy.getVisualSize()).toBeGreaterThan(enemy.getSize());
    expect(enemy.getCollisionRadius()).toBeCloseTo(enemy.getSize() / 2);
    enemy.setDashScale(0.6);
    expect(enemy.getCollisionRadius()).toBeCloseTo(enemy.getSize() * 0.6 / 2);
    manager.destroy();
  });

  it('reduces committed damage and reports the actual HP loss for armor', () => {
    const { manager, enemy } = setup('armored'), before = enemy.getHp();
    const expected = 10 * (1 - DAWN_ELITE_CONFIG.affixes.armored.damageReduction);
    expect(manager.applyDamage(enemy.id, 10)?.outcome).toMatchObject({ actualDamage: expected, hpLost: expected });
    expect(enemy.getHp()).toBe(before - expected); manager.destroy();
  });

  it('regenerates through host HP support, caps at max HP and pauses with the activity', () => {
    const { manager, enemy } = setup('regenerating');
    manager.applyDamage(enemy.id, enemy.getMaxHp() / 2);
    const before = enemy.getHp();
    manager.hostUpdateMovement(null, null, null, null, true, 1000, 1000);
    expect(enemy.getHp()).toBe(before);
    manager.hostUpdateMovement(null, null, null, null, false, 2000, 1000);
    expect(enemy.getHp()).toBeCloseTo(before + enemy.getMaxHp() * DAWN_ELITE_CONFIG.affixes.regenerating.maxHpFractionPerSecond);
    manager.hostUpdateMovement(null, null, null, null, false, 100000, 100000);
    expect(enemy.getHp()).toBe(enemy.getMaxHp()); manager.destroy();
  });

  it('shields nearby hostiles once, never itself, and stops on burrow, distance or removal', () => {
    const { manager, enemy: shield } = setup('shielding');
    const targets = [];
    // Spawn until an ordinary recipient exists; use the actual host assignment.
    for (let i = 0; i < 40; i++) {
      const e = manager.hostSpawnAtWorld(100, 100, 'rabid-badger', { originId: 'wave' });
      if (!e.eliteAffixId) { targets.push(e); break; }
    }
    const target = targets[0]!; target.setHp(200, 200);
    const reduction = DAWN_ELITE_CONFIG.affixes.shielding.damageReduction;
    expect(manager.applyDamage(target.id, 10)?.outcome).toMatchObject({ hpLost: 10 * (1 - reduction) });
    expect(manager.applyDamage(shield.id, 10)?.outcome).toMatchObject({ hpLost: 10 });
    shield.setBurrowed(true);
    expect(manager.applyDamage(target.id, 10)?.outcome).toMatchObject({ hpLost: 10 });
    shield.setBurrowed(false); shield.sprite.x += DAWN_ELITE_CONFIG.affixes.shielding.radiusPx + 1;
    expect(manager.applyDamage(target.id, 10)?.outcome).toMatchObject({ hpLost: 10 });
    manager.hostRemoveWithoutKill(shield.id);
    expect(manager.applyDamage(target.id, 10)?.outcome).toMatchObject({ hpLost: 10 });
    manager.destroy();
  });

  it('explodes exactly once on committed death, never on removal or a rescued lethal hit', () => {
    const { manager, enemy, explosion } = setup('volatile');
    manager.setLethalDamageGuard(() => ({ kind: 'rescue', healing: 10 }));
    manager.applyDamage(enemy.id, enemy.getMaxHp() * 2);
    expect(explosion).not.toHaveBeenCalled();
    manager.setLethalDamageGuard(null);
    const death = manager.applyDamage(enemy.id, 20)!;
    expect(explosion).toHaveBeenCalledTimes(1);
    expect(explosion).toHaveBeenCalledWith(enemy.id, 100, 100, expect.objectContaining({
      damageTarget: 'player-side', radius: DAWN_ELITE_CONFIG.affixes.volatile.radiusPx,
      maxDamage: DAWN_ELITE_CONFIG.affixes.volatile.damage,
    }));
    manager.completeCombatDeath(death.outcome); expect(explosion).toHaveBeenCalledTimes(1);
    manager.destroy();
    const removed = setup('volatile'); removed.manager.hostRemoveWithoutKill(removed.enemy.id);
    expect(removed.explosion).not.toHaveBeenCalled(); removed.manager.destroy();
  });

  it.each(DAWN_ELITE_AFFIX_IDS)('replicates %s on initial/full refresh and preserves it across position deltas', affix => {
    const host = setup(affix), client = new EnemyManager(healthBarTestScene().scene, host.configs);
    host.manager.requestFullNetSnapshot(); const snapshot = host.manager.getNetSnapshot();
    client.applySnapshot(JSON.parse(JSON.stringify(snapshot)));
    const remote = client.getEnemy(host.enemy.id)!;
    expect(remote.eliteAffixId).toBe(affix);
    expect(remote.sprite.displayWidth).toBe(host.enemy.sprite.displayWidth);
    const u: (number | string)[] = []; encodeEnemyUpsert(u, { id: remote.id, x: 110, y: 120 });
    client.applySnapshot({ c: 1, u, r: [] });
    expect(client.getEnemy(remote.id)?.eliteAffixId).toBe(affix);
    client.destroy(); host.manager.destroy();
  });

  it('rejects unknown affixes without losing subsequent codec entries', () => {
    const u: (number | string)[] = [];
    encodeEnemyUpsert(u, { id: 'e1', eliteAffixId: 'invalid' as DawnEliteAffixId });
    encodeEnemyUpsert(u, { id: 'e2', eliteAffixId: 'shielding' });
    expect(decodeEnemyUpserts(u)).toEqual([{ id: 'e1' }, { id: 'e2', eliteAffixId: 'shielding' }]);
  });
});
