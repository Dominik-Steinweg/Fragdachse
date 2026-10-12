import { afterEach, describe, expect, it, vi } from 'vitest';
import * as enemyConfig from '../src/config/coopDefenseEnemies';
import { CoopDefenseFirestarterSystem } from '../src/systems/CoopDefenseFirestarterSystem';
import { EnemyAiTargetCatalog } from '../src/systems/EnemyAiTargetCatalog';
import { CompositeEnemySpecialMovementSource } from '../src/systems/CompositeEnemySpecialMovementSource';
import { resolveEnemyWeaponFirePayloads } from '../src/systems/AlliedEnemyEffects';
import { resolveDetonation, type DetonationEffectSink } from '../src/systems/DetonationResolver';
import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import { AutomatedWeaponExecutionAdapter } from '../src/world/AutomatedWeaponExecutionAdapter';
import { WeaponFireExecutor } from '../src/loadout/WeaponFireExecutor';
import { encodeEnemyUpsert, decodeEnemyUpserts } from '../src/network/enemySnapshotCodec';
import { PROJECTILE_STYLES } from '../src/network/projectileSnapshotCodec';
import type { EnemyEntity } from '../src/entities/EnemyEntity';
import type { ProjectileDetonableSample } from '../src/projectile/ProjectileGameplayPort';

const authored = enemyConfig.getCoopDefenseEnemyConfig('firestarter-badger');
const config = authored.firestarter!;
afterEach(() => vi.restoreAllMocks());

function fixture() {
  const enemy = { id: 'e1', kind: 'firestarter-badger', faction: 'hostile', sprite: { active: true, x: 0, y: 0 },
    getHp: () => 300, isBurrowed: () => false, isAttackMovementPaused: () => false,
    faceAngle: vi.fn(), stopMovement: vi.fn(), setSpecialAction: vi.fn() } as unknown as EnemyEntity;
  const enemies = [enemy];
  const player = { kind: 'player' as const, id: 'p1', x: config.lance.rangePx / 2, y: 0, isTargetable: () => true };
  const catalog = new EnemyAiTargetCatalog(); catalog.updateTargets([player]);
  const balls: ProjectileDetonableSample[] = [];
  const fire = vi.fn(() => true), hasClearLineOfFire = vi.fn(() => true);
  const system = new CoopDefenseFirestarterSystem({ getAllEnemies: () => enemies }, { hasClearLineOfFire },
    { fire, fireGauss: () => false }, { readDetonableProjectiles: visit => balls.forEach(visit) }, catalog);
  return { enemy, enemies, player, catalog, balls, fire, system, hasClearLineOfFire };
}

describe('firestarter host decisions', () => {
  it('bursts the charge stock at its interval, then regenerates serially from the last consumption', () => {
    vi.spyOn(enemyConfig, 'getCoopDefenseEnemyConfig').mockReturnValue({ ...authored,
      firestarter: { ...config, lance: { ...config.lance, cooldownMs: 100 * config.charges.rechargeIntervalMs } } });
    const f = fixture(); f.system.hostUpdate(0); f.system.hostUpdate(config.lance.telegraphMs);
    const first = config.lance.telegraphMs + config.crossAttackGapMs;
    for (let i = 0; i < config.charges.maxCharges; i++) {
      const at = first + i * config.fireballIntervalMs;
      f.system.hostUpdate(at); f.system.hostUpdate(at); // Repeated evaluation never spends twice.
      if (i < config.charges.maxCharges - 1) f.system.hostUpdate(at + config.fireballIntervalMs - 1);
      expect(f.fire.mock.calls.filter(([weapon]) => (weapon as any).id === config.fireballWeaponId)).toHaveLength(i + 1);
    }
    const last = first + (config.charges.maxCharges - 1) * config.fireballIntervalMs;
    f.system.hostUpdate(last + config.fireballIntervalMs);
    expect(f.fire.mock.calls.filter(([weapon]) => (weapon as any).id === config.fireballWeaponId)).toHaveLength(config.charges.maxCharges);
    f.catalog.updateTargets([]);
    for (let restored = 1; restored <= config.charges.maxCharges; restored++) {
      const at = last + restored * config.charges.rechargeIntervalMs;
      expect(f.system.getChargeSnapshot(f.enemy.id, at - 1)?.availableCharges).toBe(restored - 1);
      f.system.hostUpdate(at);
      expect(f.system.getChargeSnapshot(f.enemy.id, at)?.availableCharges).toBe(restored);
    }
  });

  it('keeps the world point despite player and shooter movement; the current origin fires the full range', () => {
    const f = fixture(), target = { x: f.player.x, y: f.player.y };
    f.system.hostUpdate(0);
    expect(f.system.getMovementOverride(f.enemy)).toBeNull();
    f.player.y += 200; f.enemy.sprite.y = 80;
    f.system.hostUpdate(config.lance.telegraphMs - config.lance.commitMs - 1);
    expect(f.system.blocksDodge(f.enemy.id)).toBe(false);
    f.system.refreshPresentation(config.lance.telegraphMs - config.lance.commitMs - 1);
    expect(vi.mocked(f.enemy.setSpecialAction).mock.lastCall?.[3]).toBeCloseTo(Math.atan2(-80, target.x));
    f.system.hostUpdate(config.lance.telegraphMs - config.lance.commitMs);
    expect(f.system.blocksDodge(f.enemy.id)).toBe(true);
    expect(f.system.blocksRegularAttacks(f.enemy.id)).toBe(true);
    expect(new CompositeEnemySpecialMovementSource([f.system]).getMovementOverride(f.enemy, 0)).toEqual({ vx: 0, vy: 0 });
    f.system.hostUpdate(config.lance.telegraphMs);
    expect(f.fire).toHaveBeenCalledOnce();
    const [weapon, params] = f.fire.mock.calls[0] as any;
    expect(params).toMatchObject({ x: 0, y: 80, targetX: target.x, targetY: target.y });
    expect(params.angle).toBeCloseTo(Math.atan2(-80, target.x));
    const resolveHitscan = vi.fn(() => true);
    const executor = new WeaponFireExecutor({ resolveHitscan } as never);
    new AutomatedWeaponExecutionAdapter(executor, {} as never).fire(weapon, params);
    expect(resolveHitscan.mock.calls[0][0]).toMatchObject({ range: config.lance.rangePx, startX: 0, startY: 80 });
    expect(weapon.range).toBeGreaterThan(Math.hypot(target.x, target.y - 80));
  });

  it('prefers the closest predicted foreign ball and rejects obstructed and expiring candidates', () => {
    const f = fixture(), seconds = config.lance.telegraphMs / 1000;
    const tag = WEAPON_CONFIGS[config.fireballWeaponId].detonable!.tag;
    const ball = (id: number, y: number): ProjectileDetonableSample => ({ projectileId: id, ownerId: 'foreign', tag,
      x: f.player.x - 100 * seconds, y, vx: 100, vy: 0, allowCrossTeam: true });
    f.balls.push(ball(1, 40), ball(2, 12), { ...ball(3, 0), remainingLifetimeMs: config.lance.telegraphMs - 1 });
    f.hasClearLineOfFire.mockImplementation((_x: number, _y: number, _tx: number, ty: number) => ty !== 12);
    f.system.hostUpdate(0); f.player.y = 500;
    f.system.hostUpdate(config.lance.telegraphMs);
    expect(f.fire.mock.calls[0][1]).toMatchObject({ targetX: f.player.x, targetY: 40 });
  });

  it('respects line of sight for both attacks and the cross-attack gap after a lance', () => {
    const f = fixture(); f.hasClearLineOfFire.mockReturnValue(false); f.system.hostUpdate(0);
    expect(f.enemy.setSpecialAction).not.toHaveBeenCalled(); expect(f.fire).not.toHaveBeenCalled();
    f.hasClearLineOfFire.mockReturnValue(true); f.system.hostUpdate(1); f.system.hostUpdate(1 + config.lance.telegraphMs);
    const firedAt = 1 + config.lance.telegraphMs;
    f.system.hostUpdate(firedAt + config.crossAttackGapMs - 1); expect(f.fire).toHaveBeenCalledOnce();
    f.system.hostUpdate(firedAt + config.crossAttackGapMs); expect(f.fire).toHaveBeenCalledTimes(2);
    // The ball's own body width decides its corridor; the lance stays a hairline.
    const ballWeapon = WEAPON_CONFIGS[config.fireballWeaponId];
    expect(f.hasClearLineOfFire.mock.lastCall?.[4]).toMatchObject({
      clearanceRadius: ballWeapon.fire.type === 'projectile' ? ballWeapon.fire.projectileSize / 2 : NaN });
  });

  it.each(['death', 'prune', 'clear', 'allied'] as const)('cancels a pending telegraph on %s without firing', cause => {
    const f = fixture(); f.system.hostUpdate(0);
    if (cause === 'death') { f.system.handleKilled(f.enemy); f.enemies.length = 0; }
    if (cause === 'prune') f.enemies.length = 0;
    if (cause === 'clear') { f.system.clear(); f.enemies.length = 0; }
    if (cause === 'allied') (f.enemy as any).faction = 'allied';
    f.system.hostUpdate(config.lance.telegraphMs);
    expect(f.fire).not.toHaveBeenCalled(); expect(f.enemy.setSpecialAction).toHaveBeenLastCalledWith('none');
    expect(f.system.blocksDodge(f.enemy.id)).toBe(false); expect(f.system.blocksRegularAttacks(f.enemy.id)).toBe(false);
    expect(f.system.getChargeSnapshot(f.enemy.id, config.lance.telegraphMs)).toBeNull();
  });

  it('never initializes special attacks for an allied firestarter', () => {
    const f = fixture(); (f.enemy as any).faction = 'allied';
    f.system.hostUpdate(0); f.system.hostUpdate(100000);
    expect(f.fire).not.toHaveBeenCalled(); expect(f.enemy.setSpecialAction).not.toHaveBeenCalled();
  });
});

describe('firestarter authored and replicated contracts', () => {
  it('uses append-only codes and roundtrips the telegraph progress and bearing', () => {
    // The orb style is a wire index too: appended after every deployed projectile style.
    expect(PROJECTILE_STYLES.indexOf('firestarter_orb')).toBe(PROJECTILE_STYLES.length - 1);
    expect(WEAPON_CONFIGS[config.fireballWeaponId].projectileStyle).toBe('firestarter_orb');
    const deployedActions = ['none', 'gauss-charge', 'phase-nuke', 'armageddon', 'timebomb-chase',
      'timebomb-fuse', 'void-molotov-windup', 'kraken-ink', 'kraken-eggs', 'kraken-dive',
      'kraken-submerged', 'kraken-surface', 'kraken-ashore', 'kraken-slam', 'kraken-spines'] as const;
    deployedActions.forEach((specialAction, code) => {
      const legacy: (string | number)[] = [];
      encodeEnemyUpsert(legacy, { id: 'e1', specialAction });
      expect(legacy[2]).toBe(code);
      expect(decodeEnemyUpserts(legacy)[0].specialAction).toBe(specialAction);
    });
    const wire: (string | number)[] = [];
    encodeEnemyUpsert(wire, { id: 'e1', specialAction: 'fire-lance-charge', specialActionEndsAt: 900,
      gaussChargeProgress: 0.75, gaussAimAngle: 1.2 });
    expect(wire[2]).toBe(15); // All codes 0..14 were already deployed.
    expect(decodeEnemyUpserts(wire)[0]).toMatchObject({ specialAction: 'fire-lance-charge',
      specialActionEndsAt: 900, gaussChargeProgress: 0.75, gaussAimAngle: 1.2 });
    expect(enemyConfig.getCoopDefenseEnemyKindIndex('firestarter-badger'))
      .toBe(enemyConfig.getCoopDefenseEnemyKindIndex('mortar-badger') + 1);
  });

  it('copies nested config and rejects invalid relationships and weapon roles', () => {
    const copy = enemyConfig.resolveCoopDefenseEnemyConfigs(1)['firestarter-badger'].firestarter!;
    expect(copy).toEqual(config); expect(copy.charges).not.toBe(config.charges); expect(copy.lance).not.toBe(config.lance);
    for (const bad of [
      { ...config, charges: { ...config.charges, maxCharges: 1.5 } },
      { ...config, lance: { ...config.lance, commitMs: config.lance.telegraphMs + 1 } },
      { ...config, lance: { ...config.lance, rangePx: NaN } },
      { ...config, fireballWeaponId: config.biteWeaponId },
    ]) expect(() => enemyConfig.normalizeFirestarterConfig(bad)).toThrow(/firestarter/);
  });

  it('only the lance can detonate firestarter balls, and fire payloads capture their faction', () => {
    const tag = WEAPON_CONFIGS[config.fireballWeaponId].detonable!.tag;
    expect(Object.values(WEAPON_CONFIGS).filter(w => w.detonator?.triggerTags.includes(tag)).map(w => w.id)).toEqual([config.lanceWeaponId]);
    for (const [faction, style, target] of [['hostile', 'void', 'players'], ['allied', 'allied', 'enemies']] as const) {
      const weapon = resolveEnemyWeaponFirePayloads(WEAPON_CONFIGS[config.fireballWeaponId], faction);
      const explosion = weapon.detonable!.explosion!;
      expect(explosion).toMatchObject({ damageTarget: target, burnOnHit: { visualStyle: style },
        fireChunkBurst: { damageTarget: target, visualStyle: style } });
      // Ground-fire zones are a generic detonable payload even though the firestarter scatters chunks instead.
      const zoneBase = WEAPON_CONFIGS[config.fireballWeaponId];
      const withZone = resolveEnemyWeaponFirePayloads({ ...zoneBase, detonable: { ...zoneBase.detonable!, explosion: {
        ...zoneBase.detonable!.explosion!, groundFire: { type: 'fire', radius: 40, lingerDuration: 500, damagePerTick: 1,
          burnDurationMs: 500, burnDamagePerTick: 1, sourceId: 'test' } } } }, faction);
      expect(withZone.detonable!.explosion!.groundFire).toMatchObject({ damageTarget: target, visualStyle: style });
      const sink: DetonationEffectSink = { resolveProjectileExplosion: vi.fn(), spawnComboEssence: vi.fn(),
        applyComboLightning: vi.fn(), applyAoeDamage: vi.fn(), applyRadialImpulse: vi.fn(),
        applyEnvironmentDamage: vi.fn(), playExplosion: vi.fn(), spawnDotArea: vi.fn(), resolveOwnerColor: () => undefined };
      const event = { projectileId: 1, x: 10, y: 20, projectileOwnerId: 'e1', detonatorOwnerId: 'e2', effect: weapon.detonable!, sourceId: weapon.detonable!.sourceId! };
      resolveDetonation(sink, event);
      expect(sink.resolveProjectileExplosion).toHaveBeenCalledExactlyOnceWith(event, explosion);
      expect(sink.spawnComboEssence).not.toHaveBeenCalled();
      expect(sink.playExplosion).not.toHaveBeenCalled(); // Shared payload already owns the visual.
      expect(sink.applyAoeDamage).toHaveBeenCalledWith(10, 20, weapon.detonable!.aoeRadius,
        weapon.detonable!.aoeDamage, 'e2', undefined, 1, undefined, weapon.detonable!.sourceId);
    }
  });
});
