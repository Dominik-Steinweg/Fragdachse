import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', async () => {
  const phaser = (await import('../fakeArenaRenderScene')).createFakePhaserModule();
  class Line { constructor(public x1 = 0, public y1 = 0, public x2 = 0, public y2 = 0) {}
    setTo(x1: number, y1: number, x2: number, y2: number) { Object.assign(this, { x1, y1, x2, y2 }); return this; } }
  return { ...phaser, Utils: { Array: { Shuffle: <T>(values: T[]) => values } },
    Math: { ...phaser.Math, Distance: { ...phaser.Math.Distance, Squared: (a: number, b: number, c: number, d: number) => (a - c) ** 2 + (b - d) ** 2 } },
    Geom: { ...phaser.Geom, Line } };
});
import type { CombatSource } from '../../src/combat/CombatScope';
import { WorldCombatCore } from '../../src/combat/WorldCombatCore';
import { EnemyManager } from '../../src/entities/EnemyManager';
import { EnemyMovementStatusSystem } from '../../src/systems/EnemyMovementStatusSystem';
import { COOP_DEFENSE_ENEMY_KINDS, resolveCoopDefenseEnemyConfigs } from '../../src/config/coopDefenseEnemies';
import { healthBarTestScene } from '../healthBarTestScene';
import { fakeEntity } from '../fakeEntity';

/** Real combat core: the spore cloud tick path of a reactive prop. */
function fixture() {
  const now = 1_000;
  const scene = healthBarTestScene().scene, kind = COOP_DEFENSE_ENEMY_KINDS[0];
  const configs = resolveCoopDefenseEnemyConfigs(1);
  configs[kind] = { ...configs[kind], isBoss: false, glow: undefined, deathSpawns: [], imageKey: 'test-enemy' };
  const enemies = new EnemyManager(scene, configs);
  const players = new Map(['p1', 'p2'].map((id, i) => {
    const entity = fakeEntity({ id, x: 100 + i * 20, y: 100, color: 0xffffff });
    Object.assign(entity, { body: { enable: true } });
    return [id, entity];
  }));
  const playerManager = { getPlayer: (id: string) => players.get(id), getAllPlayers: () => [...players.values()] };
  const combat = new WorldCombatCore(playerManager as never, { isHost: () => true, getPlayerProfile: playerManager.getPlayer,
    areTeammates: () => true, getLocalPlayerId: () => 'p1', isEnemyPair: () => true, broadcastEffect() {},
    broadcastAudioFeedback: vi.fn() } as never);
  combat.bindPlayerVitalsScope({ worldRevision: 7400, runtimeGeneration: 1 });
  combat.bindHostExecutionSources({ nowMs: () => now, random: () => 0.25 });
  for (const id of players.keys()) combat.initPlayer(id);
  combat.setEnemyManager(enemies);
  combat.setMovementStatusPort(new EnemyMovementStatusSystem());
  const spawn = (x: number, y: number) => {
    const enemy = enemies.hostSpawnAtWorld(x, y, kind);
    (enemy.sprite.body as { halfWidth?: number }).halfWidth = enemy.getStatusVisualTarget().bodySize / 2;
    return enemy;
  };
  const playerSource = (id: string): CombatSource => ({
    gameplaySource: { kind: 'player', id }, attribution: { kind: 'player', id },
    allegiance: { ownerId: id, kind: 'player', allowTeamDamage: false },
    authoredSourceId: 'environment.spore_puffball', origin: 'ground',
  });
  const cloud = (source: CombatSource, slow = 0.4) => combat.applyAoeDamage(110, 100, 100, 4, source.allegiance.ownerId, false, {
    category: 'damage_over_time', damageKind: 'ground', source, sourceId: source.authoredSourceId,
    damageBasis: { kind: 'source-resolved', amount: 4, sourceFactors: [] }, baseDamageMult: 0, allowCritical: false,
    enemySlowFraction: slow, enemySlowDurationMs: 700, playerSlowFraction: slow, playerSlowDurationMs: 700,
  });
  return { combat, enemies, spawn, now, playerSource, cloud, destroy: () => enemies.destroy() };
}

describe('reactive prop follow-up damage on a real combat core', () => {
  it('keeps the side of an enemy that triggered the pod and died since: players are hit, hostile enemies spared', () => {
    const f = fixture();
    const trigger = f.spawn(600, 100);
    const bystander = f.spawn(130, 110);
    const source: CombatSource = {
      gameplaySource: { kind: 'enemy', id: trigger.id }, attribution: { kind: 'enemy', id: trigger.id },
      allegiance: { ownerId: trigger.id, kind: 'enemy', factionId: 'hostile', allowTeamDamage: false },
      authoredSourceId: 'environment.spore_puffball', origin: 'ground',
    };
    f.enemies.hostRemoveWithoutKill(trigger.id);
    const hpBefore = f.combat.getHP('p1');
    const bystanderBefore = bystander.getHp();
    f.cloud(source);
    expect(f.combat.getHP('p1')).toBeLessThan(hpBefore);
    expect(bystander.getHp()).toBe(bystanderBefore);
    expect(f.combat.getPlayerMovementFactor('p1', f.now + 100)).toBeCloseTo(0.6);
    f.destroy();
  });

  it('slows and damages only the enemies of a player owner, never the owner or a teammate', () => {
    const f = fixture();
    const enemy = f.spawn(140, 100);
    const before = enemy.getHp();
    f.cloud(f.playerSource('p1'));
    expect(enemy.getHp()).toBe(before - 4);
    expect(f.combat.getEnemyMovementFactor(enemy.id, f.now + 100)).toBeCloseTo(0.6);
    expect(f.combat.getPlayerMovementFactor('p1', f.now + 100)).toBe(1);
    expect(f.combat.getPlayerMovementFactor('p2', f.now + 100)).toBe(1);
    expect(f.combat.getPlayerMovementFactor('p1', f.now + 800)).toBe(1);
    f.destroy();
  });
});
