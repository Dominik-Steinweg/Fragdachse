import { FlamethrowerUpgradeSystem } from '../../src/systems/FlamethrowerUpgradeSystem';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', async () => {
  const phaser = (await import('../fakeArenaRenderScene')).createFakePhaserModule();
  class Rectangle {
    left: number; right: number; top: number; bottom: number; centerX: number; centerY: number;
    constructor(x: number, y: number, w: number, h: number) {
      this.left = x; this.right = x + w; this.top = y; this.bottom = y + h;
      this.centerX = x + w / 2; this.centerY = y + h / 2;
    }
  }
  class Line {
    constructor(public x1 = 0, public y1 = 0, public x2 = 0, public y2 = 0) {}
    setTo(x1: number, y1: number, x2: number, y2: number) { Object.assign(this, { x1, y1, x2, y2 }); return this; }
    static Length(l: Line) { return Math.hypot(l.x2 - l.x1, l.y2 - l.y1); }
  }
  return { ...phaser, Utils: { Array: { Shuffle: (values: unknown[]) => values } },
    Geom: { ...phaser.Geom as object, Rectangle, Line } };
});
import { WorldCombatCore } from '../../src/combat/WorldCombatCore';
import { EnemyManager } from '../../src/entities/EnemyManager';
import { FireSystem } from '../../src/effects/FireSystem';
import { MolotovUpgradeSystem } from '../../src/systems/MolotovUpgradeSystem';
import { COOP_DEFENSE_ENEMY_KINDS, resolveCoopDefenseEnemyConfigs } from '../../src/config/coopDefenseEnemies';
import { resolveMolotovFireEffect } from '../../src/loadout/resolveMolotovFireEffect';
import { resolvedMolotov } from '../MolotovTestHelper';
import { healthBarTestScene } from '../healthBarTestScene';
import { fakeEntity } from '../fakeEntity';

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.restoreAllMocks(); });

function fixture() {
  let now = 1000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const scene = healthBarTestScene().scene;
  const kind = COOP_DEFENSE_ENEMY_KINDS[0], configs = resolveCoopDefenseEnemyConfigs(1);
  configs[kind] = { ...configs[kind], glow: undefined, deathSpawns: [], imageKey: 'test-enemy' };
  const enemies = new EnemyManager(scene, configs);
  cleanups.push(() => enemies.destroy());
  const enemy = enemies.hostSpawnAtWorld(300, 300, kind);
  const player = fakeEntity({ id: 'owner', x: 150, y: 100, color: 0xffffff });
  const players = { getPlayer: (id: string) => id === 'owner' ? player : undefined, getAllPlayers: () => [player] };
  const network = { isHost: () => true, getPlayerProfile: players.getPlayer, isEnemyPair: () => true,
    broadcastEffect: vi.fn(), broadcastKill: vi.fn(), recordPlayerDamage: vi.fn(), recordWeaponHit: vi.fn(), recordWeaponDamage: vi.fn() };
  const combat = new WorldCombatCore(players as never, network as never);
  combat.bindPlayerVitalsScope({ worldRevision: 8000, runtimeGeneration: 1 });
  combat.bindHostExecutionSources({ nowMs: () => now, random: () => 0.25 });
  combat.initPlayer('owner'); combat.setEnemyManager(enemies);
  const fire = new FireSystem(scene);
  const chunks = { hostCreateFireChunkBurst: vi.fn() };
  const system = new MolotovUpgradeSystem(() => [], () => true, () => false, fire, chunks);
  const effect = { ...resolveMolotovFireEffect(resolvedMolotov()), lingerDuration: 50 };
  fire.hostCreateZone(300, 300, effect, 'owner');
  const contact = fire.collectContacts(300, 300, 1, now)[0];
  const burn = (damage = contact.burn!.damagePerTick) => combat.applyBurnHit(enemy.id, 'owner',
    contact.burn!.durationMs, damage, contact.sourceKey, contact.sourceId, 'ground_fire');
  const move = () => enemies.hostUpdateMovement(null, null, null, null, false, now, 16, fire,
    (id, at) => combat.getActiveBurnSources(id, at));
  const death = vi.fn((id, x, y, burns, _visual, _target, facts) => system.handleEnemyDeath(id, x, y, burns, now, facts));
  combat.setEnemyDeathCallback(death);
  return { combat, enemies, enemy, fire, chunks, system, effect, contact, burn, move, death,
    setNow: (value: number) => { now = value; } };
}

describe('Molotov confirmed Combat integration', () => {
  it('lands existing chunks as ordinary fire, skips blocked cells and cancels pending landings on clear', () => {
    const f = fixture();
    const play = vi.fn();
    const chunks = new FlamethrowerUpgradeSystem(
      { getAllPlayers: () => [] } as never, null, { getTravelSamples: () => [] }, {} as never,
      { isAlive: () => true } as never, {} as never, f.fire, () => false, () => true,
      () => {}, (_id, _stat, value) => value, play,
    );
    const burst = f.effect.wildfire!.deathBurst!;
    chunks.hostCreateFireChunkBurst('owner', 700, 700, burst, 'test-chunks', 1000);
    const targets = play.mock.calls[0][2];
    expect(targets).toHaveLength(burst.count);
    for (const target of targets) expect(f.fire.collectContacts(target.x, target.y, 1, 1000)).toEqual([]);
    chunks.hostUpdate(1000 + burst.flightMs);
    for (const target of targets) {
      const contact = f.fire.collectContacts(target.x, target.y, 1, 1000 + burst.flightMs)[0];
      expect(contact).toMatchObject({ ownerId: 'owner', sourceId: burst.sourceId,
        burn: { durationMs: burst.burnDurationMs, damagePerTick: burst.burnDamagePerTick } });
      expect(contact.firewalker).toBeUndefined();
      expect(f.fire.getWildfireSourceInfo(contact.sourceKey)).toBeNull();
    }
    f.fire.setGroundResolvers(() => true);
    play.mockClear();
    chunks.hostCreateFireChunkBurst('owner', 900, 900, burst, 'blocked', 2000);
    expect(play).not.toHaveBeenCalled();
    f.fire.setGroundResolvers(() => false);
    chunks.hostCreateFireChunkBurst('owner', 1100, 1100, burst, 'cancelled', 2000);
    const cancelled = play.mock.calls[0][2];
    chunks.clear();
    chunks.hostUpdate(2000 + burst.flightMs);
    for (const target of cancelled) expect(f.fire.collectContacts(target.x, target.y, 1, 2000 + burst.flightMs)).toEqual([]);
  });
  it.each(['weapon', 'burn'] as const)('bursts once on a %s kill after the original zone has expired', cause => {
    const f = fixture();
    f.burn(cause === 'burn' ? 100000 : undefined); f.move();
    expect(f.enemies.isEnemyPanicking(f.enemy.id)).toBe(true);
    f.setNow(1100); f.fire.hostUpdate(1100);
    expect(f.fire.getWildfireSourceInfo(f.contact.sourceKey)).toBeNull();
    if (cause === 'weapon') f.combat.applyDamage(f.enemy.id, 100000, false, 'owner');
    else { f.setNow(1250); f.combat.updateBurnEffects(1250); }
    expect(f.chunks.hostCreateFireChunkBurst).toHaveBeenCalledTimes(1);
    expect(f.chunks.hostCreateFireChunkBurst.mock.calls[0][3]).toEqual(f.effect.wildfire!.deathBurst);
    expect(f.death.mock.calls[0][6]).toMatchObject({ sourceKey: f.contact.sourceKey, ownerId: 'owner' });
    expect(f.enemies.hasEnemy(f.enemy.id)).toBe(false);
    f.combat.applyDamage(f.enemy.id, 100000, false, 'owner');
    expect(f.chunks.hostCreateFireChunkBurst).toHaveBeenCalledTimes(1);
  });

  it('does not burst for an expired burn, administrative removal or a rescued lethal hit', () => {
    const f = fixture(); f.burn(); f.move();
    f.enemies.setLethalDamageGuard(() => ({ kind: 'rescue', healing: 10 }));
    f.combat.applyDamage(f.enemy.id, 100000, false, 'owner');
    expect(f.chunks.hostCreateFireChunkBurst).not.toHaveBeenCalled();
    f.enemies.setLethalDamageGuard(null);
    // Keep a stale panic record deliberately: the death reaction must validate live burns.
    f.setNow(1000 + f.contact.burn!.durationMs + 500);
    f.combat.applyDamage(f.enemy.id, 100000, false, 'owner');
    expect(f.chunks.hostCreateFireChunkBurst).not.toHaveBeenCalled();
    const other = f.enemies.hostSpawnAtWorld(300, 300, f.enemy.kind);
    f.enemies.hostRemoveWithoutKill(other.id);
    expect(f.chunks.hostCreateFireChunkBurst).not.toHaveBeenCalled();
  });

  it('retains owner-only Firewalker metadata on the enemy trail without spreading Wildfire', () => {
    const f = fixture(); f.burn(); f.move();
    f.enemy.sprite.setPosition(500, 300);
    f.setNow(1100); f.fire.hostUpdate(1100); f.move();
    const trail = f.fire.collectContacts(500, 300, 1, 1100);
    expect(trail.length).toBeGreaterThan(0);
    expect(trail.every(source => source.ownerId === 'owner' && source.firewalker?.durationMs === f.effect.firewalker!.durationMs)).toBe(true);
    expect(trail.every(source => f.fire.getWildfireSourceInfo(source.sourceKey) === null)).toBe(true);
  });
});
