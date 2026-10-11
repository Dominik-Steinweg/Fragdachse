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

const config = getCoopDefenseEnemyConfig('mortar-badger').mortar!;
function fixture() {
  const enemy = { id: 'mortar', kind: 'mortar-badger', faction: 'hostile', sprite: { active: true, x: 0, y: 0 },
    getHp: () => 45, pauseAttackMovement: vi.fn(), stopMovement: vi.fn() } as unknown as EnemyEntity;
  const enemies = [enemy];
  const players = [{ id: 'player', active: true, x: config.preferredRangeMinPx, y: 0 }];
  const rocks: SyncedPlaceableRock[] = [];
  let targetAlive = true;
  const catalog = new EnemyAiTargetCatalog();
  catalog.updateTargets([{ kind: 'player', id: 'player', x: players[0].x, y: 0,
    resolvePosition: () => ({ x: players[0].x, y: players[0].y }), isTargetable: () => targetAlive }]);
  const impact = vi.fn();
  const strikes = new CoopDefenseMortarStrikeSystem({ impact });
  const mortar = new CoopDefenseMortarSystem({ getAllEnemies: () => enemies },
    { getAllPlayers: () => players } as never, { isAlive: () => true }, catalog, null,
    { getAllRuntimeRocks: () => rocks, getWorldPointForCell: (x, y) => ({ x, y }) }, strikes);
  const snapshot = () => [...mortar.getSnapshot(), ...strikes.getSnapshot()];
  const update = (now: number) => { mortar.hostUpdate(now); strikes.hostUpdate(now); };
  return { mortar, strikes, impact, enemy, enemies, players, rocks, catalog, snapshot, update,
    destroyTarget: () => { targetAlive = false; } };
}

describe('mortar behavior and deferred execution', () => {
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

  it('allied mortars never start a windup or block normal behavior', () => {
    const f = fixture(); f.enemy.faction = 'allied'; f.update(0); f.update(config.windupMs);
    expect(f.snapshot()).toEqual([]); expect(f.mortar.getMovementOverride(f.enemy, 0)).toBeNull();
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
