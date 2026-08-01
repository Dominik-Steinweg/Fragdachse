import { describe, expect, it, vi } from 'vitest';

import { getCoopDefenseEnemyConfig } from '../src/config/coopDefenseEnemies';
import type { BaseManager } from '../src/entities/BaseManager';
import type { EnemyEntity } from '../src/entities/EnemyEntity';
import type { EnemyManager } from '../src/entities/EnemyManager';
import type { PlayerManager } from '../src/entities/PlayerManager';
import type { CombatSystem } from '../src/systems/CombatSystem';
import { CoopDefenseTimebombSystem } from '../src/systems/CoopDefenseTimebombSystem';
import type { EnemyFlowFieldService } from '../src/systems/EnemyFlowFieldService';
import type { EnemyStrategicTargetService } from '../src/systems/EnemyStrategicTargetService';
import type { FlamethrowerUpgradeSystem } from '../src/systems/FlamethrowerUpgradeSystem';
import type { PlacementSystem } from '../src/systems/PlacementSystem';

describe('Zeitbombendachs', () => {
  it('is configured as a light strategic multi-target enemy without a normal combat weapon', () => {
    const config = getCoopDefenseEnemyConfig('timebomb-badger');
    expect(config).toMatchObject({
      movementTarget: 'players-and-armed-constructs',
      knockbackFactor: 1.9,
      timebomb: {
        chaseSpeedMultiplier: 2,
        activationRadiusPx: 450,
        lineOfSightDurationMs: 400,
        fuseDistancePx: 48,
        fuseDurationMs: 2000,
      },
    });
    expect(config.weapons).toEqual([
      expect.objectContaining({ targetMode: 'rocks' }),
    ]);
  });

  it('locks after continuous sight, starts a fixed fuse only nearby, and detonates exactly once', () => {
    let enemyActive = true;
    const setSpecialAction = vi.fn();
    const stopMovement = vi.fn();
    const enemy = {
      id: 'e1',
      kind: 'timebomb-badger',
      faction: 'hostile',
      sprite: { active: true, x: 0, y: 0 },
      getHp: () => 45,
      getMoveSpeed: () => 112,
      setSpecialAction,
      stopMovement,
    } as unknown as EnemyEntity;
    const hostRemoveWithoutKill = vi.fn(() => {
      enemyActive = false;
      return null;
    });
    const enemyManager = {
      getHostileEnemies: () => enemyActive ? [enemy] : [],
      hostRemoveWithoutKill,
      getEnemy: () => enemyActive ? enemy : undefined,
    } as unknown as EnemyManager;
    const strategicTargets = {
      selectTarget: () => ({ kind: 'player', id: 'p0', x: 100, y: 0, goalCells: [] }),
      getPosition: () => ({ x: 100, y: 0 }),
    } as unknown as EnemyStrategicTargetService;
    const strategicFlow = {
      hasWalkableLine: () => true,
      worldToGrid: () => ({ gridX: 0, gridY: 0 }),
      findNearestReachableWorldPosition: () => ({ x: 0, y: 0 }),
    } as unknown as EnemyFlowFieldService;
    const combat = {
      hasLineOfSight: () => true,
      isAlive: () => true,
      isBurrowed: () => false,
      applyDamage: vi.fn(),
      applyBaseDamage: vi.fn(),
    } as unknown as CombatSystem;
    const fireChunks = { hostCreateFireChunkBurst: vi.fn() } as unknown as FlamethrowerUpgradeSystem;
    const playExplosion = vi.fn();
    const applyRadialImpulse = vi.fn();
    const applyBaseDamage = vi.fn();
    const sound = vi.fn();
    const system = new CoopDefenseTimebombSystem(
      enemyManager,
      { getAllPlayers: () => [] } as unknown as PlayerManager,
      {
        getBasesByFaction: () => [{
          id: 'outpost-1',
          role: 'outpost',
          getHp: () => 1_000,
          getTurrets: () => [{ id: 'turret-1' }],
          getNearestSurfacePoint: () => ({ x: 76, y: 0, distance: 16 }),
        }],
        applyDamage: applyBaseDamage,
      } as unknown as BaseManager,
      { getAllRuntimeRocks: () => [] } as unknown as PlacementSystem,
      combat,
      strategicTargets,
      strategicFlow,
      fireChunks,
      { playExplosion, applyRadialImpulse, damageConstruction: vi.fn(), sound },
    );

    system.hostUpdate(1_000);
    system.hostUpdate(1_399);
    expect(setSpecialAction).not.toHaveBeenCalledWith('timebomb-chase');
    system.hostUpdate(1_400);
    expect(setSpecialAction).toHaveBeenCalledWith('timebomb-chase');
    expect(sound).toHaveBeenCalledWith(expect.objectContaining({ type: 'timebomb-activate' }));

    enemy.sprite.x = 60;
    system.hostUpdate(1_401);
    expect(setSpecialAction).toHaveBeenCalledWith('timebomb-fuse', 3_401);
    expect(playExplosion).not.toHaveBeenCalled();
    system.hostUpdate(3_400);
    expect(playExplosion).not.toHaveBeenCalled();
    system.hostUpdate(3_401);
    system.hostUpdate(3_500);

    expect(hostRemoveWithoutKill).toHaveBeenCalledTimes(1);
    expect(playExplosion).toHaveBeenCalledTimes(1);
    expect(playExplosion).toHaveBeenCalledWith(60, 0, 168, 'timebomb');
    expect(applyRadialImpulse).toHaveBeenCalledTimes(1);
    expect(applyBaseDamage).toHaveBeenCalledWith('outpost-1', 222);
    expect(fireChunks.hostCreateFireChunkBurst).toHaveBeenCalledTimes(1);
    expect(sound).toHaveBeenCalledWith(expect.objectContaining({ type: 'timebomb-detonate' }));
  });

  it('keeps an individual sight lock when the shared flow field changes its preferred target', () => {
    let selectedTargetId = 'p0';
    const setSpecialAction = vi.fn();
    const enemy = {
      id: 'e-lock',
      kind: 'timebomb-badger',
      faction: 'hostile',
      sprite: { active: true, x: 0, y: 0 },
      getHp: () => 45,
      getMoveSpeed: () => 112,
      setSpecialAction,
      stopMovement: vi.fn(),
    } as unknown as EnemyEntity;
    const system = new CoopDefenseTimebombSystem(
      {
        getHostileEnemies: () => [enemy],
        getEnemy: () => enemy,
      } as unknown as EnemyManager,
      { getAllPlayers: () => [] } as unknown as PlayerManager,
      { getBasesByFaction: () => [] } as unknown as BaseManager,
      { getAllRuntimeRocks: () => [] } as unknown as PlacementSystem,
      {
        hasLineOfSight: () => true,
        isAlive: () => true,
        isBurrowed: () => false,
      } as unknown as CombatSystem,
      {
        selectTarget: () => ({
          kind: 'player',
          id: selectedTargetId,
          x: selectedTargetId === 'p0' ? 100 : 120,
          y: 0,
          goalCells: [],
        }),
        getPosition: (target: { id: string }) => ({
          x: target.id === 'p0' ? 100 : 120,
          y: 0,
        }),
      } as unknown as EnemyStrategicTargetService,
      {} as EnemyFlowFieldService,
      null,
      {
        playExplosion: vi.fn(),
        applyRadialImpulse: vi.fn(),
        damageConstruction: vi.fn(),
      },
    );

    system.hostUpdate(1_000);
    selectedTargetId = 'p1';
    system.hostUpdate(1_100);
    selectedTargetId = 'p0';
    system.hostUpdate(1_300);
    selectedTargetId = 'p1';
    system.hostUpdate(1_399);
    expect(setSpecialAction).not.toHaveBeenCalledWith('timebomb-chase');

    system.hostUpdate(1_400);
    expect(setSpecialAction).toHaveBeenCalledWith('timebomb-chase');
  });

  it('replaces stale chase waypoints instead of briefly steering backwards', () => {
    let hasDirectPath = false;
    const enemy = {
      id: 'e-path',
      kind: 'timebomb-badger',
      faction: 'hostile',
      sprite: { active: true, x: 0, y: 0 },
      getHp: () => 45,
      getMoveSpeed: () => 112,
      setSpecialAction: vi.fn(),
      stopMovement: vi.fn(),
    } as unknown as EnemyEntity;
    const findNextWorldPositionTowards = vi.fn((fromGridX: number) => ({
      x: (fromGridX + 1) * 10 + 5,
      y: 5,
    }));
    const system = new CoopDefenseTimebombSystem(
      {
        getHostileEnemies: () => [enemy],
        getEnemy: () => enemy,
      } as unknown as EnemyManager,
      { getAllPlayers: () => [] } as unknown as PlayerManager,
      { getBasesByFaction: () => [] } as unknown as BaseManager,
      { getAllRuntimeRocks: () => [] } as unknown as PlacementSystem,
      {
        hasLineOfSight: () => true,
        isAlive: () => true,
        isBurrowed: () => false,
      } as unknown as CombatSystem,
      {
        selectTarget: () => ({ kind: 'player', id: 'p0', x: 100, y: 0, goalCells: [] }),
        getPosition: () => ({ x: 100, y: 0 }),
      } as unknown as EnemyStrategicTargetService,
      {
        hasWalkableLine: () => hasDirectPath,
        worldToGrid: (x: number, y: number) => ({ gridX: Math.floor(x / 10), gridY: Math.floor(y / 10) }),
        findNextWorldPositionTowards,
      } as unknown as EnemyFlowFieldService,
      null,
      {
        playExplosion: vi.fn(),
        applyRadialImpulse: vi.fn(),
        damageConstruction: vi.fn(),
      },
    );

    system.hostUpdate(1_000);
    system.hostUpdate(1_400);
    expect(system.getMovementOverride(enemy, 1_401)?.vx).toBeGreaterThan(0);
    expect(findNextWorldPositionTowards).toHaveBeenCalledTimes(1);

    // Die direkte Linie wird kurz frei. Der alte Wegpunkt bei x=15 liegt inzwischen hinter x=20.
    enemy.sprite.x = 20;
    hasDirectPath = true;
    expect(system.getMovementOverride(enemy, 1_410)?.vx).toBeGreaterThan(0);
    hasDirectPath = false;
    expect(system.getMovementOverride(enemy, 1_420)?.vx).toBeGreaterThan(0);
    expect(findNextWorldPositionTowards).toHaveBeenCalledTimes(2);

    // Beim Eintritt in die aktuelle Wegpunktzelle wird sofort die naechste Zelle angefordert,
    // obwohl das regulaere 250-ms-Repath-Intervall noch nicht abgelaufen ist.
    enemy.sprite.x = 36;
    expect(system.getMovementOverride(enemy, 1_430)?.vx).toBeGreaterThan(0);
    expect(findNextWorldPositionTowards).toHaveBeenCalledTimes(3);
  });

  it('uses only the small pop path when killed normally', () => {
    const playExplosion = vi.fn();
    const sound = vi.fn();
    const applyDamage = vi.fn();
    const system = new CoopDefenseTimebombSystem(
      {} as EnemyManager,
      {
        getAllPlayers: () => [{ id: 'p0', sprite: { active: true, x: 0, y: 0 } }],
      } as unknown as PlayerManager,
      {} as BaseManager,
      {} as PlacementSystem,
      { isAlive: () => true, isBurrowed: () => false, applyDamage } as unknown as CombatSystem,
      {} as EnemyStrategicTargetService,
      {} as EnemyFlowFieldService,
      null,
      { playExplosion, applyRadialImpulse: vi.fn(), damageConstruction: vi.fn(), sound },
    );

    expect(system.handleKilled({
      id: 'e7',
      kind: 'timebomb-badger',
      x: 0,
      y: 0,
      size: 24,
      faction: 'hostile',
    }, 2_000)).toBe(true);
    expect(playExplosion).toHaveBeenCalledWith(0, 0, 42, 'timebomb_pop');
    expect(applyDamage).toHaveBeenCalledWith(
      'p0',
      2,
      false,
      'e7',
      'Zeitbomben-Verpuffung',
      { sourceX: 0, sourceY: 0 },
    );
    expect(sound).toHaveBeenCalledWith(expect.objectContaining({ type: 'timebomb-killed-pop' }));
  });
});
