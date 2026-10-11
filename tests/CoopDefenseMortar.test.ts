import { describe, expect, it, vi } from 'vitest';
import { getCoopDefenseEnemyConfig, normalizeMortarConfig, resolveCoopDefenseEnemyConfigs } from '../src/config/coopDefenseEnemies';
import { CoopDefenseMortarSystem } from '../src/systems/CoopDefenseMortarSystem';
import { CoopDefenseMortarStrikeSystem } from '../src/systems/CoopDefenseMortarStrikeSystem';
import { CompositeEnemySpecialMovementSource } from '../src/systems/CompositeEnemySpecialMovementSource';
import { EnemyAiTargetCatalog } from '../src/systems/EnemyAiTargetCatalog';
import type { EnemyEntity } from '../src/entities/EnemyEntity';
import type { SyncedPlaceableRock } from '../src/types';
import { applyHostileAreaStrikeDamage } from '../src/systems/hostileAreaStrikeDamage';
import { computeRadialDamage } from '../src/utils/radialDamage';
import { EnemyFlowFieldService } from '../src/systems/EnemyFlowFieldService';
import { findMortarLocalPositions, type MortarNavigation } from '../src/systems/MortarLocalPositions';
import * as mortarPositions from '../src/systems/MortarLocalPositions';
import type { CombatGeometryPort } from '../src/combat/CombatCapabilities';
import { UTILITY_CONFIGS, WEAPON_CONFIGS, type PlaceableTurretUtilityConfig } from '../src/loadout/LoadoutConfig';
import { getCoopDefenseConstructionDefinition } from '../src/config/coopDefenseConstructions';

const config = getCoopDefenseEnemyConfig('mortar-badger').mortar!;
function openField(water: { gridX: number; gridY: number }[] = []) {
  return new EnemyFlowFieldService({ seed: 1, rocks: [], trees: [], tracks: [], dirt: [], powerUpPedestals: [], water }, [],
    { cols: 96, rows: 96, cellSize: 32, arenaOffsetX: -1552, arenaOffsetY: -1552 },
    { goalMode: 'dynamic', dynamicGoalCells: [{ gridX: 70, gridY: 48 }] });
}
function fixture(options: { navigation?: MortarNavigation; hasLineOfSight?: CombatGeometryPort['hasLineOfSight']; bases?: ConstructorParameters<typeof CoopDefenseMortarSystem>[4] } = {}) {
  const enemy = { id: 'mortar', kind: 'mortar-badger', faction: 'hostile', sprite: { active: true, x: 0, y: 0 },
    getHp: () => 45, getMoveSpeed: () => 60, getCollisionRadius: () => 15,
    getAttackWeapons: () => [{ weapon: { config: WEAPON_CONFIGS.MORTAR_BADGER_BITE } }],
    faceAngle: vi.fn(), pauseAttackMovement: vi.fn(), stopMovement: vi.fn() } as unknown as EnemyEntity;
  const enemies = [enemy];
  const players = [{ id: 'player', active: true, x: config.preferredRangeMinPx, y: 0 }];
  const rocks: SyncedPlaceableRock[] = [];
  let targetAlive = true;
  const catalog = new EnemyAiTargetCatalog();
  catalog.updateTargets([{ kind: 'player', id: 'player', x: players[0].x, y: 0,
    resolvePosition: () => ({ x: players[0].x, y: players[0].y }), isTargetable: () => targetAlive }]);
  const impact = vi.fn();
  const hasLineOfSight = vi.fn(options.hasLineOfSight ?? (() => true));
  const query = vi.fn((x: number, y: number, radius: number, visit: (rock: SyncedPlaceableRock) => void) => rocks.forEach(rock => {
    if (Math.hypot(rock.gridX - x, rock.gridY - y) <= radius) visit(rock);
  }));
  const strikes = new CoopDefenseMortarStrikeSystem({ impact });
  const mortar = new CoopDefenseMortarSystem({ getAllEnemies: () => enemies },
    { getAllPlayers: () => players } as never, { isAlive: () => true, hasLineOfSight, canDamageTarget: () => true },
    catalog, options.bases ?? null,
    { forEachRuntimeRockInRadius: query, getRuntimeRock: id => rocks.find(rock => rock.id === id), getCarrierBaseId: () => undefined,
    getWorldPointForCell: (x, y) => ({ x, y }) }, strikes, options.navigation);
  const snapshot = () => [...mortar.getSnapshot(), ...strikes.getSnapshot()];
  const update = (now: number) => { mortar.hostUpdate(now); strikes.hostUpdate(now); };
  return { mortar, strikes, impact, enemy, enemies, players, rocks, catalog, snapshot, update, hasLineOfSight, query,
    destroyTarget: () => { targetAlive = false; } };
}

describe('mortar behavior and deferred execution', () => {
  it.each([0, Math.PI / 2, -Math.PI / 2, Math.PI * 0.7])('captures the muzzle socket and holds fixed aim at angle %s', angle => {
    const f = fixture();
    f.enemy.sprite.x = 137; f.enemy.sprite.y = -41;
    f.players[0].x = f.enemy.sprite.x + Math.cos(angle) * config.preferredRangeMinPx;
    f.players[0].y = f.enemy.sprite.y + Math.sin(angle) * config.preferredRangeMinPx;
    f.update(0);
    const shot = f.snapshot()[0];
    expect(vi.mocked(f.enemy.faceAngle).mock.lastCall![0]).toBeCloseTo(angle);
    expect(shot.sourceX).toBeCloseTo(f.enemy.sprite.x + Math.cos(angle) * config.muzzleForwardPx!);
    expect(shot.sourceY).toBeCloseTo(f.enemy.sprite.y + Math.sin(angle) * config.muzzleForwardPx!);
    f.players[0].x += 300; f.players[0].y -= 200;
    f.update(shot.launchAt - 1);
    expect(vi.mocked(f.enemy.faceAngle).mock.lastCall![0]).toBeCloseTo(angle);
    expect(f.snapshot()).toEqual([shot]);
    f.update(shot.launchAt);
    expect(f.strikes.getSnapshot()).toEqual([shot]);
  });

  it('publishes a fixed point immediately and preserves identity through launch and one impact', () => {
    const f = fixture();
    f.update(0);
    const shot = f.snapshot()[0];
    expect(shot).toMatchObject({ targetX: f.players[0].x, armedAt: 0, launchAt: config.windupMs });
    expect(f.mortar.blocksRegularAttacks(f.enemy.id)).toBe(true);
    expect(f.mortar.getMovementOverride(f.enemy, 0)).toEqual({ vx: 0, vy: 0 });
    expect(f.enemy.pauseAttackMovement).toHaveBeenCalledWith(0, 0, config.windupMs);
    f.players[0].x += 100;
    f.destroyTarget();
    f.update(shot.launchAt);
    expect(f.mortar.getSnapshot()).toEqual([]);
    expect(f.snapshot()).toEqual([shot]);
    expect(f.mortar.blocksRegularAttacks(f.enemy.id)).toBe(false);
    f.update(shot.impactAt - 1);
    expect(f.impact).not.toHaveBeenCalled();
    f.update(shot.impactAt);
    f.update(shot.impactAt + 1);
    expect(f.impact).toHaveBeenCalledOnce();
    expect(f.impact.mock.calls[0][0].snapshot).toEqual(shot);
  });

  it.each([-1, 0, 1])('death at launchAt %+d ms respects the exact commit boundary before behavior updates', offset => {
    const f = fixture(); f.update(0);
    const shot = f.snapshot()[0];
    f.mortar.handleKilled({ id: f.enemy.id }, shot.launchAt + offset);
    f.enemies.length = 0;
    f.update(shot.impactAt);
    f.update(shot.impactAt + 1);
    expect(f.impact).toHaveBeenCalledTimes(offset < 0 ? 0 : 1);
    expect(f.snapshot()).toEqual([]);
  });

  it('keeps a launched strike after source removal, with its captured faction and provenance', () => {
    const f = fixture(); f.update(0);
    const shot = f.snapshot()[0]; f.update(shot.launchAt);
    f.mortar.handleKilled({ id: f.enemy.id }, shot.launchAt + 1);
    f.enemies.length = 0; f.update(shot.impactAt);
    expect(f.impact).toHaveBeenCalledOnce();
    expect(f.impact.mock.calls[0][0].source).toMatchObject({
      actor: { kind: 'enemy', id: f.enemy.id }, allegiance: { ownerId: f.enemy.id, factionId: 'hostile' },
    });
  });

  it('projects only presentation fields and clears windups and flight at teardown', () => {
    const f = fixture(); f.update(0);
    expect(Object.keys(f.snapshot()[0]).sort()).toEqual([
      'id', 'sourceEnemyId', 'sourceX', 'sourceY', 'targetX', 'targetY', 'radius', 'armedAt', 'launchAt', 'impactAt', 'faction',
    ].sort());
    f.enemies.push({ ...f.enemy, id: 'second' } as EnemyEntity);
    f.update(config.windupMs);
    expect(f.mortar.getSnapshot()).toHaveLength(1);
    expect(f.strikes.getSnapshot()).toHaveLength(1);
    f.mortar.clear(); f.strikes.clear();
    f.enemies.length = 0; f.update(config.windupMs + config.flightMs);
    expect(f.snapshot()).toEqual([]); expect(f.impact).not.toHaveBeenCalled();
  });

  it('blocks new windups near living players, but never interrupts an active windup', () => {
    const f = fixture();
    f.players[0].x = config.minRangePx - 1; f.update(0);
    expect(f.snapshot()).toEqual([]);
    f.players[0].x = config.preferredRangeMinPx; f.update(config.reevaluateIntervalMs);
    const shot = f.snapshot()[0];
    f.enemy.getHp = () => 1;
    f.players[0].x = 1; f.update(shot.launchAt - 1);
    expect(f.snapshot()).toEqual([shot]);
    f.update(shot.impactAt); expect(f.impact).toHaveBeenCalledOnce();
  });

  it('never targets indestructible constructs or natural rocks outside the Placement catalog', () => {
    const f = fixture(); f.catalog.clear(); f.players.length = 0;
    f.rocks.push({ id: 1, kind: 'rock', hp: 100, gridX: config.preferredRangeMinPx, gridY: 0, indestructible: true } as SyncedPlaceableRock,
      { id: 2, kind: 'pedestal', hp: 100, gridX: config.preferredRangeMinPx, gridY: 0, constructionId: 'medic_pedestal' } as SyncedPlaceableRock);
    f.update(0); expect(f.snapshot()).toEqual([]);
    f.rocks.push({ id: 3, kind: 'rock', hp: 100, gridX: config.preferredRangeMinPx, gridY: 0 } as SyncedPlaceableRock);
    f.update(config.reevaluateIntervalMs); expect(f.snapshot()).toHaveLength(1);
  });

  it('uses overlap as a soft weight penalty, including already launched strikes', () => {
    const f = fixture(); f.update(0);
    f.update(config.windupMs);
    f.catalog.updateTargets([
      { kind: 'decoy', id: 'a', x: config.preferredRangeMinPx, y: 0 },
      { kind: 'decoy', id: 'b', x: 0, y: config.preferredRangeMinPx },
    ]);
    f.enemies.push({ ...f.enemy, id: 'second' } as EnemyEntity);
    f.update(config.windupMs + 1);
    expect(f.mortar.getSnapshot()[0]).toMatchObject({ targetX: 0, targetY: config.preferredRangeMinPx });
    f.catalog.updateTargets([{ kind: 'decoy', id: 'a', x: config.preferredRangeMinPx, y: 0 }]);
    f.enemies.push({ ...f.enemy, id: 'third' } as EnemyEntity);
    f.update(config.windupMs + 2);
    expect(f.mortar.getSnapshot().find(s => s.sourceEnemyId === 'third')).toMatchObject({ targetX: config.preferredRangeMinPx });
  });

  it('starts the next windup no earlier than impact plus recovery', () => {
    const f = fixture(); f.update(0); const first = f.snapshot()[0];
    f.update(first.launchAt); f.update(first.impactAt);
    f.update(first.impactAt + config.postImpactDelayMs - 1); expect(f.snapshot()).toEqual([]);
    f.update(first.impactAt + config.postImpactDelayMs);
    const second = f.snapshot()[0];
    expect(second.launchAt - first.launchAt).toBeGreaterThanOrEqual(config.windupMs + config.flightMs + config.postImpactDelayMs);
  });

  it('allied mortars without hostile targets never wind up against players or constructs', () => {
    const f = fixture(); f.enemy.faction = 'allied'; f.update(0); f.update(config.windupMs);
    expect(f.snapshot()).toEqual([]); expect(f.mortar.getMovementOverride(f.enemy, 0)).toBeNull();
  });

  it('allied windups ignore nearby players, freeze the target and capture owner credit before launch', () => {
    const f = fixture(); f.enemy.faction = 'allied'; f.enemy.ownerId = 'necromancer';
    f.players[0].x = 0;
    const target = { ...f.enemy, id: 'hostile', kind: 'zombie-badger', faction: 'hostile',
      sprite: { active: true, x: config.preferredRangeMinPx, y: 0 },
      isBurrowed: () => false, isBoss: () => false } as EnemyEntity;
    f.enemies.push(target); f.update(0);
    const shot = f.snapshot()[0];
    expect(shot).toMatchObject({ faction: 'allied', targetX: config.preferredRangeMinPx });
    expect(f.mortar.blocksRegularAttacks(f.enemy.id)).toBe(true);
    target.sprite.x = 1; f.enemy.ownerId = 'changed-owner';
    f.update(shot.launchAt - 1); expect(f.snapshot()).toEqual([shot]);
    f.update(shot.launchAt); f.enemies.length = 0; f.update(shot.impactAt);
    expect(f.impact.mock.calls[0][0].source).toMatchObject({
      attribution: { kind: 'player', id: 'necromancer' },
      allegiance: { ownerId: f.enemy.id, factionId: 'allied' },
    });
  });

  it('composes movement overrides in order, preserving the first non-null override', () => {
    const f = fixture(); const timebomb = { getMovementOverride: vi.fn(() => ({ vx: 7, vy: 9 })) };
    const composite = new CompositeEnemySpecialMovementSource([timebomb, f.mortar]);
    f.update(0); expect(composite.getMovementOverride(f.enemy, 0)).toEqual({ vx: 7, vy: 9 });
    timebomb.getMovementOverride.mockReturnValue(null as never);
    expect(composite.getMovementOverride(f.enemy, 0)).toEqual({ vx: 0, vy: 0 });
  });

  it('validates required ranges and numbers and copies the resolved ability configuration', () => {
    expect(() => normalizeMortarConfig({ ...config, preferredRangeMinPx: config.minRangePx })).toThrow();
    expect(() => normalizeMortarConfig({ ...config, maxDamage: NaN })).toThrow();
    expect(() => normalizeMortarConfig({ ...config, flightMs: undefined } as never)).toThrow();
    expect(normalizeMortarConfig({ ...config, muzzleForwardPx: undefined })!.muzzleForwardPx).toBe(0);
    for (const value of [-1, NaN, Infinity])
      expect(() => normalizeMortarConfig({ ...config, muzzleForwardPx: value })).toThrow('muzzleForwardPx');
    for (const value of [0, -1, 1.5, NaN, Infinity, undefined])
      expect(() => normalizeMortarConfig({ ...config, alliedTargetCandidateLimit: value } as never)).toThrow('alliedTargetCandidateLimit');
    for (const value of [-1, 1.1, NaN, Infinity, undefined])
      expect(() => normalizeMortarConfig({ ...config, alliedBossWeight: value } as never)).toThrow('alliedBossWeight');
    const resolved = resolveCoopDefenseEnemyConfigs(1)['mortar-badger'].mortar!;
    expect(resolved).toEqual(config); expect(resolved).not.toBe(config);
    expect(resolved.targetWeights).not.toBe(config.targetWeights);
  });

  it('routes radial construction and rock multipliers independently, including rock immunity', () => {
    const f = fixture(); f.update(0);
    const shot = f.snapshot()[0];
    for (const rockMult of [config.rockDamageMult, 0]) {
      const commits = vi.fn(() => ({ actualDamage: 1, remainingIntegrity: 1, becameDestroyed: false }));
      const distance = config.impactRadiusPx / 2;
      const damage = computeRadialDamage(distance, shot.radius, config.maxDamage, { minDamage: config.minDamage });
      const train = vi.fn();
      applyHostileAreaStrikeDamage({ x: shot.targetX, y: shot.targetY, radius: shot.radius,
        maxDamage: config.maxDamage, minDamage: config.minDamage, attackerId: f.enemy.id,
        sourceId: 'enemy.mortar', includeSelf: false, aoe: { baseDamageMult: 0 }, friendlyBaseDamageMult: 0,
        rockDamageMult: rockMult, constructionDamageMult: config.constructionDamageMult, trainDamageMult: 0,
      }, { combat: { applyAoeDamage: vi.fn() }, bases: null, damageBase: vi.fn(),
        environment: { forEachActiveRock: visit => {
          visit(1, shot.targetX + distance, shot.targetY); visit(2, shot.targetX + distance, shot.targetY);
        }, resolveRockDamage: (_id, value) => value, applyRockDamage: commits, onRockDestroyed: vi.fn() },
        isConstruction: id => id === 2, trainSegments: [{ x: shot.targetX, y: shot.targetY }], damageTrain: train,
      });
      expect(commits).toHaveBeenCalledWith(2, Math.round(damage * config.constructionDamageMult), f.enemy.id);
      if (rockMult > 0) expect(commits).toHaveBeenCalledWith(1, Math.round(damage * rockMult), f.enemy.id);
      else expect(commits.mock.calls.every(([id]) => id === 2)).toBe(true);
      expect(train).not.toHaveBeenCalled();
    }
  });
});

describe('local mortar siege policy', () => {
  it('I: prefers reachable cover and starts windup only after reaching the station', () => {
    const field = openField();
    const f = fixture({ navigation: field, hasLineOfSight: (_sx, _sy, _x, y) => y > -config.localSearchRadiusPx / 3 });
    f.update(0);
    expect(f.snapshot()).toEqual([]);
    expect(f.mortar.getMovementOverride(f.enemy, 0)!.vy).toBeLessThan(0);
    for (let now = 50; now <= 10000 && !f.mortar.getSnapshot().length; now += 50) {
      const velocity = f.mortar.getMovementOverride(f.enemy, now)!;
      f.enemy.sprite.x += velocity.vx * 0.05; f.enemy.sprite.y += velocity.vy * 0.05;
      f.update(now);
    }
    expect(f.mortar.getSnapshot()).toHaveLength(1);
    expect(f.enemy.sprite.y).toBeLessThan(-config.localSearchRadiusPx / 3);
    field.destroy();
  });

  it('J: rejects a small cover gain that requires a long walk and worsens range', () => {
    const field = openField();
    const f = fixture({ navigation: field, hasLineOfSight: (_sx, _sy, x) => x < config.localSearchRadiusPx * 0.9 });
    f.players[0].x = config.maxRangePx - field.getCellSize();
    f.update(0);
    expect(f.mortar.getSnapshot()).toHaveLength(1);
    expect(f.mortar.getMovementOverride(f.enemy, 0)).toEqual({ vx: 0, vy: 0 });
    field.destroy();
  });

  it('K: allows a substantial improvement to take longer than impact plus recovery', () => {
    const field = openField();
    let cover = false;
    const f = fixture({ navigation: field, hasLineOfSight: (_sx, _sy, _x, y) => !cover || y > -config.localSearchRadiusPx * 0.9 });
    f.players.push({ ...f.players[0], id: 'b', y: 20 }, { ...f.players[0], id: 'c', y: -20 });
    f.update(0); const shot = f.snapshot()[0];
    cover = true; f.update(shot.launchAt);
    expect(f.mortar.getMovementOverride(f.enemy, shot.launchAt)!.vy).toBeLessThan(0);
    f.update(shot.impactAt + config.postImpactDelayMs);
    expect(f.mortar.getSnapshot()).toEqual([]); // time alone never authorizes firing mid-route.
    for (let now = shot.impactAt + config.postImpactDelayMs + 50; now < 18000 && !f.mortar.getSnapshot().length; now += 50) {
      const velocity = f.mortar.getMovementOverride(f.enemy, now)!;
      f.enemy.sprite.x += velocity.vx * 0.05; f.enemy.sprite.y += velocity.vy * 0.05; f.update(now);
    }
    expect(f.mortar.getSnapshot()).toHaveLength(1);
    expect(f.enemy.sprite.y).toBeLessThan(-config.localSearchRadiusPx * 0.9 + config.positionArrivalTolerancePx);
    field.destroy();
  });

  it.each([1, 3])('J/K: weighs a 350 px walk against cover from %s threats with authored defaults', threatCount => {
    // Isolate the decision from candidate sampling; navigation is covered separately below.
    const walk = 350;
    const candidates = vi.spyOn(mortarPositions, 'findMortarLocalPositions').mockReturnValue([
      { x: 0, y: 0, travelDistance: 0, path: [] },
      { x: 0, y: -walk, travelDistance: walk, path: [{ x: 0, y: -walk }] },
    ]);
    try {
      const f = fixture({ hasLineOfSight: (_sx, _sy, _x, y) => y === 0 });
      for (let i = 1; i < threatCount; i++) f.players.push({ ...f.players[0], id: `threat-${i}` });
      const gain = threatCount * (config.coverQualityWeight + config.exposurePenaltyWeight);
      const requiredGain = walk * config.movementCostPerPx + config.minRepositionImprovement;
      if (threatCount === 1) expect(gain).toBeLessThan(requiredGain);
      else expect(gain).toBeGreaterThan(requiredGain);
      f.update(0);
      if (threatCount === 1) {
        expect(f.mortar.getSnapshot()).toHaveLength(1);
        expect(f.mortar.getMovementOverride(f.enemy, 0)).toEqual({ vx: 0, vy: 0 });
      } else {
        expect(f.mortar.getSnapshot()).toEqual([]);
        expect(f.mortar.getMovementOverride(f.enemy, 0)!.vy).toBeLessThan(0);
      }
    } finally { candidates.mockRestore(); }
  });

  it('L/N: keeps a good station after THUMP and also fires when every station is open', () => {
    for (const visible of [false, true]) {
      const field = openField();
      const f = fixture({ navigation: field, hasLineOfSight: () => visible });
      f.update(0); const first = f.snapshot()[0];
      expect(first).toBeDefined();
      f.hasLineOfSight.mockClear(); f.update(first.launchAt);
      expect(f.hasLineOfSight).toHaveBeenCalled();
      expect(f.mortar.getMovementOverride(f.enemy, first.launchAt)).toEqual({ vx: 0, vy: 0 });
      f.update(first.impactAt + config.postImpactDelayMs);
      expect(f.mortar.getSnapshot()).toHaveLength(1);
      field.destroy();
    }
  });

  it('M: topology changes cannot interrupt windup but expose the next decision', () => {
    const field = openField();
    let destroyed = false;
    vi.spyOn(field, 'getTopologyVersion').mockImplementation(() => destroyed ? 2 : 1);
    const f = fixture({ navigation: field, hasLineOfSight: (_sx, _sy, _x, y) => destroyed && y > -config.localSearchRadiusPx / 3 });
    f.update(0); const shot = f.snapshot()[0];
    destroyed = true; f.hasLineOfSight.mockClear(); f.update(shot.launchAt - 1);
    expect(f.snapshot()).toEqual([shot]); expect(f.hasLineOfSight).not.toHaveBeenCalled();
    expect(f.mortar.getMovementOverride(f.enemy, shot.launchAt - 1)).toEqual({ vx: 0, vy: 0 });
    f.update(shot.launchAt);
    expect(f.strikes.getSnapshot()).toEqual([shot]);
    expect(f.hasLineOfSight).toHaveBeenCalled();
    expect(f.mortar.getMovementOverride(f.enemy, shot.launchAt)!.vy).toBeLessThan(0);
    field.destroy();
  });

  it('O/P: treats construct danger separately from geometry and uses its real range', () => {
    const definition = getCoopDefenseConstructionDefinition('rocket_turret');
    if (definition.kind !== 'turret') throw new Error('Expected a weapon construction');
    const f = fixture({ hasLineOfSight: (sx, _sy, _x, _y, skip, carrier, clearance, purpose) => {
      expect(purpose).toBe('directFire'); expect(clearance).toBe(0); expect(carrier).toBeUndefined();
      // The same world object can occlude another source; its own line must skip itself.
      if (sx === definition.targetRange * 0.75) { expect(skip).toBe(1); return true; }
      expect(skip).toBeUndefined(); return false;
    } });
    f.rocks.push({ id: 1, kind: 'turret', constructionId: 'rocket_turret', turretWeaponId: definition.weaponId,
      gridX: definition.targetRange * 0.75, gridY: 0, hp: 100 } as SyncedPlaceableRock);
    f.update(0);
    expect(f.hasLineOfSight.mock.calls.some(call => call[4] === 1)).toBe(true);
    expect(f.hasLineOfSight.mock.calls.some(call => call[4] === undefined)).toBe(true);
    const distant = fixture(); distant.players.length = 0; distant.catalog.clear();
    distant.rocks.push({ ...f.rocks[0], gridX: definition.targetRange + 1 });
    distant.update(0);
    expect(distant.hasLineOfSight).not.toHaveBeenCalled();
    expect(distant.mortar.getSnapshot()).toHaveLength(1);
  });

  it('H/G: spaces slowly outside bite range, gives bite back to AttackSystem, and never cancels windup', () => {
    const field = openField(); const f = fixture({ navigation: field });
    f.players[0].x = config.minRangePx * 2 / 3; f.update(0);
    expect(f.mortar.getSnapshot()).toEqual([]);
    expect(f.mortar.getMovementOverride(f.enemy, 0)).toEqual({ vx: -f.enemy.getMoveSpeed() * config.spacingSpeedFactor, vy: 0 });
    expect(f.mortar.blocksRegularAttacks(f.enemy.id)).toBe(false);
    f.players[0].x = WEAPON_CONFIGS.MORTAR_BADGER_BITE.range; f.update(1);
    expect(f.mortar.getMovementOverride(f.enemy, 1)).toBeNull();
    f.players[0].x = config.preferredRangeMinPx; f.update(config.reevaluateIntervalMs);
    const shot = f.mortar.getSnapshot()[0];
    f.players[0].x = 1; f.update(shot.launchAt - 1);
    expect(f.mortar.getSnapshot()).toEqual([shot]);
    expect(f.mortar.getMovementOverride(f.enemy, shot.launchAt - 1)).toEqual({ vx: 0, vy: 0 });
    field.destroy();
  });

  it('Q: applies radius and Top-N before LoS, caches the expensive search between events', () => {
    const field = openField(); const f = fixture({ navigation: field });
    for (let id = 0; id < config.maxCoverThreats * 3; id++) f.rocks.push({ id, kind: 'turret', hp: 100,
      gridX: config.preferredRangeMinPx + id, gridY: 0, targetRange: config.maxRangePx, turretWeaponId: 'TURRET_ROCKET_BURST' } as SyncedPlaceableRock);
    f.rocks.push({ ...f.rocks[0], id: 999, gridX: config.threatScanRadiusPx * 2 });
    f.update(0);
    const sources = new Set(f.hasLineOfSight.mock.calls.map(call => `${call[0]}:${call[1]}`));
    expect(sources.size).toBeLessThanOrEqual(config.maxCoverThreats);
    expect([...sources].some(source => source.startsWith(`${config.threatScanRadiusPx * 2}:`))).toBe(false);
    expect(f.hasLineOfSight.mock.calls.length).toBeLessThanOrEqual((1 + config.positionCandidateRings * config.positionCandidateDirections) * config.maxCoverThreats);
    f.hasLineOfSight.mockClear(); f.query.mockClear();
    for (let now = 1; now < Math.min(config.windupMs, config.threatCheckIntervalMs); now++) f.update(now);
    expect(f.hasLineOfSight).not.toHaveBeenCalled(); expect(f.query).not.toHaveBeenCalled();
    field.destroy();
  });

  it('does no tactical search before reaching the siege activation area', () => {
    const field = openField(); const f = fixture({ navigation: field });
    const neighbors = vi.spyOn(field, 'hasWalkableCircleLine');
    f.players[0].x = config.maxRangePx + config.coverSearchActivationMarginPx + 1; f.update(0);
    expect(neighbors).not.toHaveBeenCalled(); expect(f.hasLineOfSight).not.toHaveBeenCalled();
    expect(f.mortar.getMovementOverride(f.enemy, 0)).toBeNull();
    f.players[0].x = config.maxRangePx; f.update(config.threatCheckIntervalMs);
    expect(neighbors).toHaveBeenCalled(); field.destroy();
  });

  it('couples targets and stations so a lower-value target can win through substantially better cover', () => {
    const field = openField();
    const f = fixture({ navigation: field, hasLineOfSight: (_sx, _sy, _x, y) => y > -config.localSearchRadiusPx * 0.85 });
    f.players.push({ ...f.players[0], id: 'b', y: 20 }, { ...f.players[0], id: 'c', y: -20 });
    const stronger = { id: 1, kind: 'turret', hp: 100, gridX: 0, gridY: config.preferredRangeMinPx } as SyncedPlaceableRock;
    const weaker = { id: 2, kind: 'rock', hp: 100, gridX: config.preferredRangeMinPx, gridY: -config.localSearchRadiusPx } as SyncedPlaceableRock;
    f.rocks.push(stronger, weaker);
    f.update(0);
    expect(f.mortar.getSnapshot()).toEqual([]);
    for (let now = 50; now < 12000 && !f.mortar.getSnapshot().length; now += 50) {
      const velocity = f.mortar.getMovementOverride(f.enemy, now)!;
      f.enemy.sprite.x += velocity.vx * 0.05; f.enemy.sprite.y += velocity.vy * 0.05; f.update(now);
    }
    expect(f.mortar.getSnapshot()[0]).toMatchObject({ targetX: weaker.gridX, targetY: weaker.gridY });
    field.destroy();
  });

  it('invalidates a cached approach on target death, significant threat movement and obstacle generation', () => {
    const field = openField(); let generation = 0;
    const f = fixture({ navigation: field, bases: { getBasesByFaction: () => [], getBase: () => undefined, getObstacleGeneration: () => generation },
      hasLineOfSight: (_sx, _sy, _x, y) => y > -config.localSearchRadiusPx / 3 });
    f.update(0); expect(f.mortar.getSnapshot()).toEqual([]);
    f.hasLineOfSight.mockClear(); f.update(1); expect(f.hasLineOfSight).not.toHaveBeenCalled();
    generation++; f.update(2); expect(f.hasLineOfSight).toHaveBeenCalled();
    f.hasLineOfSight.mockClear(); f.players[0].y += config.threatChangeDistancePx;
    f.update(2 + config.threatCheckIntervalMs); expect(f.hasLineOfSight).toHaveBeenCalled();
    f.destroyTarget(); f.update(3 + config.threatCheckIntervalMs);
    expect(f.mortar.getMovementOverride(f.enemy, 3 + config.threatCheckIntervalMs)).toBeNull();
    field.destroy();
  });

  it('treats armed bases/outposts as live ranged sources and exempts their own carrier', () => {
    const field = openField();
    let alive = true;
    const base = { id: 'outpost', getHp: () => alive ? 100 : 0, isInert: () => false,
      getNearestSurfacePoint: () => ({ x: config.minRangePx + 10, y: 0 }),
      getTurrets: () => [{ id: 'roof', x: config.minRangePx + 100, y: 0,
        targetRange: (UTILITY_CONFIGS.SPORE_TURRET as PlaceableTurretUtilityConfig).placeable.targetRange }] };
    const f = fixture({ navigation: field, bases: { getBasesByFaction: () => [base] as never, getBase: () => base as never, getObstacleGeneration: () => 0 } });
    f.update(0);
    const calls = f.hasLineOfSight.mock.calls.filter(call => call[5] === base.id);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every(call => call[7] === 'directFire')).toBe(true);
    alive = false; const shot = f.snapshot()[0]; f.update(shot.launchAt);
    f.hasLineOfSight.mockClear(); f.update(shot.impactAt + config.postImpactDelayMs);
    expect(f.hasLineOfSight.mock.calls.some(call => call[5] === base.id)).toBe(false);
    field.destroy();
  });

  it.each([0.5, 1, 2])('P: uses the base turret runtime range at its boundary (range factor %s)', factor => {
    const targetRange = (UTILITY_CONFIGS.SPORE_TURRET as PlaceableTurretUtilityConfig).placeable.targetRange * factor;
    for (const offset of [-1, 1]) {
      const base = { id: 'outpost', getHp: () => 100, isInert: () => false,
        getNearestSurfacePoint: () => ({ x: config.preferredRangeMinPx, y: 0 }),
        getTurrets: () => [{ id: 'roof', x: targetRange + offset, y: 0, targetRange }] };
      const f = fixture({ bases: { getBasesByFaction: () => [base] as never,
        getBase: () => base as never, getObstacleGeneration: () => 0 } });
      f.players.length = 0; f.catalog.clear(); f.update(0);
      if (offset > 0) {
        expect(f.hasLineOfSight).not.toHaveBeenCalled();
        expect(f.mortar.getSnapshot()).toHaveLength(1);
        expect(f.mortar.getMovementOverride(f.enemy, 0)).toEqual({ vx: 0, vy: 0 });
      } else if (targetRange + offset < config.minRangePx) {
        expect(f.mortar.getSnapshot()).toEqual([]);
        expect(f.mortar.getMovementOverride(f.enemy, 0)!.vx).toBeLessThan(0);
      } else {
        expect(f.hasLineOfSight).toHaveBeenCalled();
      }
    }
  });

  it('rejects invalid search budgets and non-finite tactical tuning at the config boundary', () => {
    for (const key of ['localSearchRadiusPx', 'movementCostPerPx', 'spacingSpeedFactor', 'threatCheckIntervalMs'] as const) {
      expect(() => normalizeMortarConfig({ ...config, [key]: NaN })).toThrow();
    }
    expect(() => normalizeMortarConfig({ ...config, maxCoverThreats: 1.5 })).toThrow();
    expect(() => normalizeMortarConfig({ ...config, topTargetCandidates: 0 })).toThrow();
    expect(() => normalizeMortarConfig({ ...config, spacingSpeedFactor: 1.1 })).toThrow();
    expect(() => normalizeMortarConfig({ ...config, preferredRangeMaxPx: config.maxRangePx + 1 })).toThrow();
  });

  it('uses local topology connectivity and body clearance, including detours and sealed pockets', () => {
    const wall = Array.from({ length: 11 }, (_, i) => ({ gridX: 51, gridY: 43 + i }));
    for (const closed of [false, true]) {
      const water = closed ? Array.from({ length: 96 }, (_, gridY) => ({ gridX: 51, gridY })) : wall;
      const field = openField(water);
      const tiny = findMortarLocalPositions({ x: 1, y: 1 }, 15,
        { ...config, localSearchRadiusPx: 1, positionArrivalTolerancePx: 0.01 }, field);
      expect(tiny.every(point => Math.hypot(point.x - 1, point.y - 1) <= 1)).toBe(true);
      const positions = findMortarLocalPositions({ x: 0, y: 0 }, 15, config, field);
      expect(positions[0]).toMatchObject({ x: 0, y: 0, travelDistance: 0, path: [] });
      expect(positions.length).toBeLessThanOrEqual(1 + config.positionCandidateRings * config.positionCandidateDirections);
      const behind = positions.filter(point => point.x > 128);
      if (closed) expect(behind).toEqual([]);
      else expect(behind.some(point => point.travelDistance > Math.hypot(point.x, point.y))).toBe(true);
      for (const position of positions) {
        let from = { x: 0, y: 0 };
        for (const point of position.path) {
          expect(field.hasWalkableCircleLine(from.x, from.y, point.x, point.y, 15)).toBe(true); from = point;
        }
      }
      field.destroy();
    }
  });
});
