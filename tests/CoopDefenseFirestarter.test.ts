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
import { FirestarterPositioning, hasFirestarterDirectLine } from '../src/systems/firestarterPositioning';
import type { EnemyDodgeRequestPort } from '../src/systems/CoopDefenseEnemyDodgeSystem';
import { ALLIED_COLOR } from '../src/config';

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
    const aim = enemyConfig.resolveFirestarterAim(config.muzzle, 0, 80, target.x, target.y);
    expect(vi.mocked(f.enemy.setSpecialAction).mock.lastCall?.[3]).toBeCloseTo(aim.angle);
    f.system.hostUpdate(config.lance.telegraphMs - config.lance.commitMs);
    expect(f.system.blocksDodge(f.enemy.id)).toBe(true);
    expect(f.system.blocksRegularAttacks(f.enemy.id)).toBe(true);
    expect(new CompositeEnemySpecialMovementSource([f.system]).getMovementOverride(f.enemy, 0)).toEqual({ vx: 0, vy: 0 });
    f.system.hostUpdate(config.lance.telegraphMs);
    expect(f.fire).toHaveBeenCalledOnce();
    const [weapon, params] = f.fire.mock.calls[0] as any;
    expect(params).toMatchObject({ x: 0, y: 80, targetX: target.x, targetY: target.y });
    expect(params.angle).toBeCloseTo(aim.angle);
    // The shot leaves the lance tip and still passes the fixed world point.
    expect(params.gameplayMuzzleOrigin.x).toBeCloseTo(aim.x); expect(params.gameplayMuzzleOrigin.y).toBeCloseTo(aim.y);
    expect(params.visualMuzzleOrigin).toEqual(params.gameplayMuzzleOrigin);
    const resolveHitscan = vi.fn(() => true);
    const executor = new WeaponFireExecutor({ resolveHitscan } as never);
    new AutomatedWeaponExecutionAdapter(executor, {} as never).fire(weapon, params);
    expect(resolveHitscan.mock.calls[0][0]).toMatchObject({ range: config.lance.rangePx, startX: aim.x, startY: aim.y });
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

  it('never targets players as an allied firestarter', () => {
    const f = fixture(); (f.enemy as any).faction = 'allied';
    f.system.hostUpdate(0); f.system.hostUpdate(100000);
    expect(f.fire).not.toHaveBeenCalled(); expect(f.enemy.setSpecialAction).not.toHaveBeenCalled();
  });

  it.each(['death', 'prune', 'clear'] as const)('cancels an allied telegraph on %s', cause => {
    const f = fixture(); (f.enemy as any).faction = 'allied';
    f.catalog.updateTargets([{ kind: 'hostile-enemy', id: 'hostile', x: 400, y: 0 }]);
    f.system.hostUpdate(0);
    expect(f.enemy.setSpecialAction).toHaveBeenLastCalledWith('fire-lance-charge', expect.any(Number), 0, expect.any(Number));
    if (cause === 'death') f.system.handleKilled(f.enemy);
    if (cause === 'clear') f.system.clear();
    f.enemies.length = 0; f.system.hostUpdate(config.lance.telegraphMs);
    expect(f.fire).not.toHaveBeenCalled(); expect(f.enemy.setSpecialAction).toHaveBeenLastCalledWith('none');
    expect(f.system.getChargeSnapshot(f.enemy.id, config.lance.telegraphMs)).toBeNull();
  });

  it('reacquires hostiles after conversion and uses allied lance, ball and foreign-ball combo payloads', () => {
    const f = fixture();
    f.system.hostUpdate(0);
    (f.enemy as any).faction = 'allied';
    f.catalog.updateTargets([f.player, { kind: 'hostile-enemy', id: 'hostile', x: 400, y: 0 }]);
    f.system.hostUpdate(config.lance.telegraphMs);
    expect(f.fire).not.toHaveBeenCalled();
    expect(f.enemy.setSpecialAction).toHaveBeenLastCalledWith('none');
    const start = config.lance.telegraphMs + 1;
    f.system.hostUpdate(start); f.system.hostUpdate(start + config.lance.telegraphMs);
    expect(f.fire.mock.calls[0][1]).toMatchObject({ targetX: 400, targetY: 0, ownerColor: ALLIED_COLOR });
    const ballAt = start + config.lance.telegraphMs + config.crossAttackGapMs;
    f.system.hostUpdate(ballAt);
    expect(f.fire.mock.calls[1][0]).toMatchObject({ id: config.fireballWeaponId,
      detonable: { explosion: { damageTarget: 'enemies', fireChunkBurst: { visualStyle: 'allied', damageTarget: 'enemies' } } } });
    f.balls.push({ projectileId: 1, ownerId: 'hostile-shooter', tag: WEAPON_CONFIGS[config.fireballWeaponId].detonable!.tag,
      allowCrossTeam: true, x: 410, y: 10 });
    const comboAt = ballAt + config.lance.cooldownMs + config.crossAttackGapMs;
    f.system.hostUpdate(comboAt); f.system.hostUpdate(comboAt + config.lance.telegraphMs);
    expect(f.fire.mock.lastCall?.[1]).toMatchObject({ targetX: 410, targetY: 10 });
  });

  it('uses the same lance sight and ball body corridor as an ally', () => {
    const f = fixture(); (f.enemy as any).faction = 'allied';
    f.catalog.updateTargets([{ kind: 'hostile-enemy', id: 'target', x: config.lance.rangePx / 2, y: 0 }]);
    f.hasClearLineOfFire.mockReturnValue(false); f.system.hostUpdate(0);
    expect(f.fire).not.toHaveBeenCalled(); expect(f.enemy.setSpecialAction).not.toHaveBeenCalled();
    f.hasClearLineOfFire.mockReturnValue(true); f.system.hostUpdate(1); f.system.hostUpdate(1 + config.lance.telegraphMs);
    f.hasClearLineOfFire.mockImplementation((_x, _y, _tx, _ty, opts) => opts.clearanceRadius === 0);
    f.system.hostUpdate(1 + config.lance.telegraphMs + config.crossAttackGapMs);
    expect(f.fire).toHaveBeenCalledOnce();
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
    encodeEnemyUpsert(wire, { id: 'e1', faction: 'allied', specialAction: 'fire-lance-charge', specialActionEndsAt: 900,
      gaussChargeProgress: 0.75, gaussAimAngle: 1.2 });
    expect(wire[5]).toBe(15); // Faction precedes the action; codes 0..14 were already deployed.
    expect(decodeEnemyUpserts(wire)[0]).toMatchObject({ faction: 'allied', specialAction: 'fire-lance-charge',
      specialActionEndsAt: 900, gaussChargeProgress: 0.75, gaussAimAngle: 1.2 });
    expect(enemyConfig.getCoopDefenseEnemyKindIndex('firestarter-badger'))
      .toBe(enemyConfig.getCoopDefenseEnemyKindIndex('mortar-badger') + 1);
  });

  it('aims an offset lance tip exactly through the fixed world point', () => {
    const socket = { forwardPx: 22, sidePx: 9 };
    for (const [tx, ty] of [[400, 0], [-300, 250], [5, -600]]) {
      const aim = enemyConfig.resolveFirestarterAim(socket, 10, 20, tx, ty);
      const tip = enemyConfig.resolveFirestarterMuzzle(socket, 10, 20, aim.angle);
      expect(tip.x).toBeCloseTo(aim.x); expect(tip.y).toBeCloseTo(aim.y);
      const miss = Math.abs(Math.cos(aim.angle) * (ty - aim.y) - Math.sin(aim.angle) * (tx - aim.x));
      expect(miss).toBeLessThan(1e-6);
    }
  });

  it('copies nested config and rejects invalid relationships and weapon roles', () => {
    const copy = enemyConfig.resolveCoopDefenseEnemyConfigs(1)['firestarter-badger'].firestarter!;
    expect(copy).toEqual(config); expect(copy.charges).not.toBe(config.charges); expect(copy.lance).not.toBe(config.lance);
    for (const bad of [
      { ...config, charges: { ...config.charges, maxCharges: 1.5 } },
      { ...config, lance: { ...config.lance, commitMs: config.lance.telegraphMs + 1 } },
      { ...config, lance: { ...config.lance, rangePx: NaN } },
      { ...config, fireballWeaponId: config.biteWeaponId },
      { ...config, muzzle: { forwardPx: -1, sidePx: 0 } },
      { ...config, muzzle: { forwardPx: 10, sidePx: NaN } },
      { ...config, positioning: { ...config.positioning, minDistancePx: config.positioning.maxDistancePx } },
      { ...config, positioning: { ...config.positioning, maxDistancePx: config.lance.rangePx + 1 } },
      { ...config, positioning: { ...config.positioning, reevaluateIntervalMs: config.positioning.minDwellMs + 1 } },
      { ...config, positioning: { ...config.positioning, movementCostPerPx: NaN } },
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

describe('firestarter local positioning', () => {
  function positioningFixture() {
    const f = fixture();
    f.player.x = (config.positioning.minDistancePx + config.positioning.maxDistancePx) / 2;
    // Deliberate test geometry, independent of the authored dodge tuning.
    const short = (config.positioning.maxDistancePx - config.positioning.minDistancePx) / 4;
    const dodge = {
      requestDodge: vi.fn(() => true), isDodging: vi.fn(() => false),
      getDodgeDistance: vi.fn((_id, mode) => mode === 'short' ? short : short * 2),
      canDodgeTo: vi.fn(() => true),
    } satisfies EnemyDodgeRequestPort;
    const planner = new FirestarterPositioning();
    const read = { readDetonableProjectiles: (visit: (ball: ProjectileDetonableSample) => void) => f.balls.forEach(visit) };
    const run = (now = 0) => planner.tryReposition(f.enemy, [f.player], config, read,
      { hasClearLineOfFire: f.hasClearLineOfFire }, dodge, now);
    return { ...f, dodge, short, read, run };
  }

  it('chooses a free side around blocked LoS, with a ball-width corridor, preferring short', () => {
    const f = positioningFixture();
    f.hasClearLineOfFire.mockImplementation((_x, y) => y > f.short / 2);
    expect(f.run()).toBe(true);
    expect(f.dodge.requestDodge).toHaveBeenCalledWith(f.enemy.id, { x: -0, y: 1 }, 'short', 0);
    const ball = WEAPON_CONFIGS[config.fireballWeaponId].fire;
    expect(f.hasClearLineOfFire.mock.calls.some(call => call[4]?.clearanceRadius === (ball.type === 'projectile' ? ball.projectileSize / 2 : NaN))).toBe(true);
  });

  it('uses long only when short cannot solve the geometry, never accepting a blocked movement path', () => {
    const f = positioningFixture();
    f.hasClearLineOfFire.mockImplementation((_x, y) => y > f.short * 1.5);
    expect(f.run()).toBe(true);
    expect(f.dodge.requestDodge.mock.lastCall?.[2]).toBe('long');
    const blocked = positioningFixture(); blocked.hasClearLineOfFire.mockImplementation((_x, y) => y > blocked.short / 2);
    blocked.dodge.canDodgeTo.mockReturnValue(false);
    expect(blocked.run()).toBe(false); expect(blocked.dodge.requestDodge).not.toHaveBeenCalled();
  });

  it('holds the chosen side across fluctuating LoS for the minimum dwell and stays put when current is good', () => {
    const f = positioningFixture(); f.hasClearLineOfFire.mockImplementation((_x, y) => y > f.short / 2);
    expect(f.run()).toBe(true);
    for (let now = config.positioning.reevaluateIntervalMs; now < config.positioning.minDwellMs; now += config.positioning.reevaluateIntervalMs) {
      f.hasClearLineOfFire.mockImplementation((_x, y) => y < -f.short / 2);
      expect(f.run(now)).toBe(false);
    }
    expect(f.dodge.requestDodge).toHaveBeenCalledOnce();
    expect(f.run(config.positioning.minDwellMs)).toBe(true);
    const settled = positioningFixture(); expect(settled.run()).toBe(false);
    expect(settled.dodge.requestDodge).not.toHaveBeenCalled();
  });

  it('keeps every accepted destination in the configured distance band', () => {
    for (const range of [config.positioning.minDistancePx, config.positioning.maxDistancePx, config.positioning.maxDistancePx + 10]) {
      const f = positioningFixture(); f.player.x = range;
      f.hasClearLineOfFire.mockImplementation((_x, y) => Math.abs(y) > f.short / 2);
      f.run();
      for (const [, direction, mode] of f.dodge.requestDodge.mock.calls) {
        const step = f.dodge.getDodgeDistance(f.enemy.id, mode);
        const distance = Math.hypot(f.player.x - direction.x * step, direction.y * step);
        expect(distance).toBeGreaterThanOrEqual(config.positioning.minDistancePx);
        expect(distance).toBeLessThanOrEqual(config.positioning.maxDistancePx);
      }
      if (range >= config.positioning.maxDistancePx) expect(f.dodge.requestDodge).not.toHaveBeenCalled();
    }
  });

  it('sidesteps an unwanted predicted ball and considers a desired combo behind cover', () => {
    const f = positioningFixture();
    f.balls.push({ projectileId: 1, ownerId: f.enemy.id, tag: WEAPON_CONFIGS[config.fireballWeaponId].detonable!.tag,
      allowCrossTeam: true, x: f.player.x / 3, y: 0 });
    expect(hasFirestarterDirectLine(f.enemy.id, f.enemy.sprite, f.player, config, f.read, { hasClearLineOfFire: f.hasClearLineOfFire })).toBe(false);
    expect(f.run()).toBe(true);
    const combo = positioningFixture();
    combo.balls.push({ ...f.balls[0], x: combo.player.x, y: config.comboRadiusPx / 2 });
    combo.hasClearLineOfFire.mockImplementation((_x, y, _tx, ty) => ty === 0 || y > combo.short / 2);
    expect(combo.run()).toBe(true); // Improves a clear direct shot to an accessible combo.
  });

  it('queues through the attack owner before starting a lance, then preserves its commit lock', () => {
    const f = positioningFixture();
    const system = new CoopDefenseFirestarterSystem({ getAllEnemies: () => f.enemies }, { hasClearLineOfFire: f.hasClearLineOfFire },
      { fire: f.fire, fireGauss: () => false }, f.read, f.catalog, f.dodge);
    f.hasClearLineOfFire.mockImplementation((_x, y) => y > f.short / 2);
    system.hostUpdate(0); expect(f.dodge.requestDodge).toHaveBeenCalledOnce();
    expect(f.enemy.setSpecialAction).not.toHaveBeenCalled();
    f.dodge.isDodging.mockReturnValue(true); f.hasClearLineOfFire.mockReturnValue(true);
    system.hostUpdate(1); expect(f.enemy.setSpecialAction).not.toHaveBeenCalled();
    f.dodge.isDodging.mockReturnValue(false); system.hostUpdate(2);
    system.hostUpdate(2 + config.lance.telegraphMs - config.lance.commitMs);
    expect(system.blocksDodge(f.enemy.id)).toBe(true);
    expect(f.dodge.requestDodge).toHaveBeenCalledOnce();
  });
});
