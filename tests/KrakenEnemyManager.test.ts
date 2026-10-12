import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', async () => (await import('./fakeArenaRenderScene')).createFakePhaserModule());
import { EnemyManager } from '../src/entities/EnemyManager';
import { resolveCoopDefenseEnemyConfigs } from '../src/config/coopDefenseEnemies';
import { KRAKEN_BOSS_DEFAULTS } from '../src/config/krakenBoss';
import { healthBarTestScene } from './healthBarTestScene';
import { WaterGeometry } from '../src/arena/WaterGeometry';
import { resolveCoopDefenseWorldMetrics, worldCellCenter } from '../src/world/WorldMetrics';

function setup() {
  const configs = resolveCoopDefenseEnemyConfigs(1), base = { ...configs['rabid-badger'], glow: undefined, imageKey: 'test-enemy', deathSpawns: [] };
  configs.kraken = { ...base, krakenBoss: KRAKEN_BOSS_DEFAULTS, size: 128, maxHp: 1000 };
  configs.egg = { ...base, size: 20, maxHp: 20, krakenEgg: { assetId: 'egg', stationary: true, drops: false, necromancy: false, countsForEncounter: false, navigation: false } };
  const { scene } = healthBarTestScene(), existing = scene.physics.add.existing;
  scene.physics.add.existing = (object: any) => { existing(object); object.body.setImmovable = (v: boolean) => { object.body.immovable = v; }; };
  const manager = new EnemyManager(scene, configs);
  manager.bindCombatIdentity({ worldRevision: 8, runtimeGeneration: 2 }, 3);
  const metrics = resolveCoopDefenseWorldMetrics(30, 30), center = worldCellCenter(metrics, 10, 10);
  const water = new WaterGeometry(Array.from({ length: 100 }, (_, i) => ({ gridX: 5 + i % 10, gridY: 5 + Math.floor(i / 10) })), metrics);
  manager.setWorldMetrics(metrics); manager.setWaterGeometry(water);
  const reservation = { worldRevision: 8, activityRevision: 3, topologyRevision: 1, reservationId: 'r', habitatId: 'pond', waterAnchorId: 'center', bodyRadiusPx: 64, ...center };
  const habitat = { revalidate: () => true } as never;
  return { manager, metrics, center, reservation, habitat };
}
describe('Kraken Entity/Manager boundary', () => {
  it('allows only a current habitat permit to bypass dry projection and keeps one boss identity', () => {
    const f = setup();
    expect(() => f.manager.hostSpawnAtWorld(f.center.x, f.center.y, 'kraken')).toThrow(/habitat/);
    expect(f.manager.hostSpawnAtHabitat('kraken', { ...f.reservation, activityRevision: 1 }, f.habitat)).toBeNull();
    const boss = f.manager.hostSpawnAtHabitat('kraken', f.reservation, f.habitat)!;
    const enemy = f.manager.getEnemy(boss.id)!, port = f.manager.getKrakenEntityPort(() => false);
    expect(port.readBoss(boss)).toMatchObject({ ...f.center, alive: true });
    expect(enemy.getAttackWeapons()).toEqual([]);
    port.setBodyTargetability(boss, { revision: 1, effectiveAt: 100, mode: 'hidden' });
    expect(enemy.isBodyTargetable()).toBe(false); expect(enemy.suppressBodyDotTicks()).toBe(true);
    // Canonical commits remain available to a separately validated tentacle contact.
    f.manager.applyDamage(boss.id, 10); expect(enemy.getHp()).toBe(990);
    port.setMovement(boss, 'water-approach', { x: f.center.x + 10, y: f.center.y });
    f.manager.hostUpdateMovement(null, null, null, null, false, 100, 16);
    expect(enemy.sprite.x).toBe(f.center.x + 10); expect(enemy.body.moves).toBe(false);
    expect(enemy.getKnockbackFactor()).toBe(0);
    port.setMovement(boss, 'land', null);
    expect(enemy.isOrdinaryMovementEnabled()).toBe(true); expect(f.manager.getCombatTargetRef(boss.id)).toEqual(boss);
    f.manager.destroy();
  });
  it('keeps eggs stationary, destructible and outside encounter/reward accounting', () => {
    const f = setup(), point = worldCellCenter(f.metrics, 22, 22);
    expect(f.manager.hostSpawnKrakenEggAtWorld(f.center.x, f.center.y, 'egg', 'wave', () => true)).toBeNull();
    const egg = f.manager.hostSpawnKrakenEggAtWorld(point.x, point.y, 'egg', 'wave', () => true)!;
    expect(f.manager.hasActiveEnemyOrigin('wave')).toBe(false);
    egg.setDesiredVelocity(200, 0); expect(egg.getDesiredVelocity()).toEqual({ vx: 0, vy: 0 });
    const result = f.manager.applyDamage(egg.id, 100)!;
    expect(result.died).toBe(true); expect(f.manager.hasEnemy(egg.id)).toBe(false);
    expect(result.outcome).toMatchObject({ transition: { kind: 'dead', facts: { rewardEligible: false } } });
    f.manager.destroy();
  });
});
