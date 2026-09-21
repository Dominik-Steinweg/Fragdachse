import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', async () => {
  const phaser = (await import('../fakeArenaRenderScene')).createFakePhaserModule();
  return { ...phaser, Math: { ...phaser.Math, Angle: { ...phaser.Math.Angle,
    Wrap: (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle)),
  } } };
});
import { EnemyManager } from '../../src/entities/EnemyManager';
import { resolveCoopDefenseEnemyConfigs } from '../../src/config/coopDefenseEnemies';
import { healthBarTestScene } from '../healthBarTestScene';
import { FlowFieldCoordinator } from '../../src/systems/flowfield/FlowFieldCoordinator';
import { InlineFlowFieldRunner } from '../../src/systems/flowfield/FlowFieldRunner';
import { createFlowFieldTuning } from '../../src/systems/flowfield/FlowFieldSources';
import { EnemyFlowFieldService } from '../../src/systems/EnemyFlowFieldService';
import { EnemyAiTargetCatalog } from '../../src/systems/EnemyAiTargetCatalog';
import { EnemyIntentSystem } from '../../src/systems/navigation/EnemyIntentSystem';
import type { NavigationObstacle } from '../../src/systems/navigation/NavigationGeometry';
import { navigationTestWorld } from '../navigationTestWorld';
import { CoopDefenseEnemyAttackSystem } from '../../src/systems/CoopDefenseEnemyAttackSystem';
import { CoopDefenseEnemyAbilitySystem } from '../../src/systems/CoopDefenseEnemyAbilitySystem';
import { CoopDefenseEnemyCombatPositioningSystem } from '../../src/systems/CoopDefenseEnemyCombatPositioningSystem';
import { getCoopDefenseEnemyConfig, type CoopDefenseEnemyKind } from '../../src/config/coopDefenseEnemies';

describe('Combat movement and hidden-player pursuit', () => {
  function combatWorld(kind: CoopDefenseEnemyKind = 'rabid-badger',
    world: Pick<ReturnType<typeof navigationTestWorld>, 'catalog' | 'intents' | 'field' | 'flush' | 'destroy'> = navigationTestWorld()) {
    const scene = healthBarTestScene().scene;
    const manager = new EnemyManager(scene, resolveCoopDefenseEnemyConfigs(1));
    manager.setNavigationIntents(world.intents);
    const unit = manager.hostSpawnAtWorld(64, 128, kind);
    const player = { id: 'p', x: 96, y: 128, active: true };
    let buried = false, sight = true;
    const players = { getAllPlayers: () => [player], getPlayer: () => player } as unknown as ConstructorParameters<typeof CoopDefenseEnemyAttackSystem>[1];
    const combat = { isAlive: () => true, isBurrowed: () => buried, canDamageTarget: () => true,
      hasClearLineOfFire: () => sight, hasLineOfSight: () => sight } as unknown as ConstructorParameters<typeof CoopDefenseEnemyAttackSystem>[3];
    const shots = vi.fn((_config: { id: string }) => true);
    const attacks = new CoopDefenseEnemyAttackSystem(manager, players, null, combat,
      { fire: shots }, () => [], null, null, world.catalog);
    attacks.setIntents(world.intents);
    const positioning = new CoopDefenseEnemyCombatPositioningSystem(manager, players, combat,
      () => true, () => true, world.catalog);
    const observe = (now: number) => {
      world.catalog.updateTargets([{ kind: 'player', ...player,
        isTargetable: () => !buried, canRetainMemory: () => true }]);
      world.intents.update([unit], now); world.flush(); world.intents.update([unit], now);
    };
    const move = (now: number, special?: { getMovementOverride: () => { vx: number; vy: number } }, usePositioning = false) => {
      if (usePositioning) positioning.hostUpdate();
      manager.hostUpdateMovement(world.field, world.field, world.field, null, false, now, 16,
        null, null, null, null, usePositioning ? positioning : null, special, null, null, attacks);
    };
    return { world, scene, players, combat, manager, unit, player, attacks, positioning, shots, observe, move,
      bury: () => { buried = true; }, blockSight: () => { sight = false; },
      destroy: () => { manager.destroy(); world.destroy(); } };
  }

  it('holds position and facing through repeated cooldowns without consuming attacks in the movement pass', () => {
    const w = combatWorld();
    const weapon = w.unit.getAttackWeapons()[0].weapon;
    w.observe(0);
    for (let now = 0; now <= weapon.config.cooldown * 4 + 2000; now += 16) {
      w.observe(now);
      const shotsBeforeMovement = w.shots.mock.calls.length;
      w.move(now);
      expect(w.shots).toHaveBeenCalledTimes(shotsBeforeMovement);
      expect(w.unit.getDesiredVelocity()).toEqual({ vx: 0, vy: 0 });
      expect(w.unit.getAimAngle()).toBeCloseTo(0);
      w.attacks.hostUpdate(16, now);
    }
    expect(w.shots.mock.calls.length).toBeGreaterThanOrEqual(2);
    w.destroy();
  });

  it('releases the hold on blocked sight or lost range and follows again', () => {
    const w = combatWorld();
    w.observe(0); w.move(0);
    expect(w.manager.getMovementFeedback(w.unit.id)?.waitReason).toBe('attack');
    w.blockSight();
    expect(w.attacks.getCombatMovement(w.unit, 1)).toBeNull();
    w.player.x = 224; w.player.y = 192;
    w.observe(200); w.move(200);
    expect(Math.hypot(...Object.values(w.unit.getDesiredVelocity()))).toBeGreaterThan(0);
    w.destroy();
  });

  it('lets configured retreat and exclusive movement override holding while retreat still faces the target', () => {
    const w = combatWorld('pyro-badger');
    const positioning = getCoopDefenseEnemyConfig('pyro-badger').combatPositioning!;
    w.player.x = 64 + positioning.preferredDistancePx - positioning.toleranceP - 10;
    w.observe(0); w.move(0, undefined, true);
    expect(w.unit.getDesiredVelocity().vx).toBeLessThan(0);
    expect(w.unit.getAimAngle()).toBeCloseTo(0);
    w.move(16, { getMovementOverride: () => ({ vx: 0, vy: 120 }) }, true);
    expect(w.unit.getDesiredVelocity()).toEqual({ vx: 0, vy: 120 });
    expect(w.unit.getAimAngle()).toBeCloseTo(Math.PI / 2);
    w.destroy();
  });

  it('uses simulation time to keep the firing direction during a moving attack', () => {
    const w = combatWorld();
    w.unit.faceAngle(Math.PI / 2);
    w.unit.pauseAttackMovement(100, 0.5, 200);
    w.unit.setDesiredVelocity(50, 0, 150);
    expect(w.unit.getAimAngle()).toBeCloseTo(Math.PI / 2);
    w.unit.setDesiredVelocity(50, 0, 301);
    expect(w.unit.getAimAngle()).toBeCloseTo(0);
    w.destroy();
  });

  it('walks to the last observed position and waits despite continuing underground movement', () => {
    const w = combatWorld();
    w.player.x = 208; w.observe(0); w.bury();
    for (let step = 1; step <= 200; step++) {
      w.player.x = 32 + step % 100; w.player.y = 32;
      w.observe(step * 16); w.move(step * 16); w.attacks.hostUpdate(16, step * 16);
      const velocity = w.unit.getDesiredVelocity();
      if (step === 1) expect(velocity.vx).toBeGreaterThan(0);
      w.unit.setPosition(w.unit.sprite.x + velocity.vx * 0.016, w.unit.sprite.y + velocity.vy * 0.016);
    }
    expect(Math.hypot(w.unit.sprite.x - 208, w.unit.sprite.y - 128)).toBeLessThanOrEqual(24);
    expect(w.unit.getDesiredVelocity()).toEqual({ vx: 0, vy: 0 });
    expect(w.world.intents.get(w.unit.id)).toBeNull();
    expect(w.shots).not.toHaveBeenCalled();
    w.destroy();
  });

  it('preserves the movement pause and facing owned by a special windup even without an attack target', () => {
    const w = combatWorld('inferno-colossus');
    w.player.x = 224; w.observe(100);
    w.unit.setSpecialAction('void-molotov-windup', 500);
    w.unit.faceAngle(Math.PI / 2);
    w.unit.pauseAttackMovement(100, 0, 400);
    w.blockSight(); w.move(200);
    expect(w.unit.getDesiredVelocity()).toEqual({ vx: 0, vy: 0 });
    expect(w.unit.getAimAngle()).toBeCloseTo(Math.PI / 2);
    w.destroy();
  });

  it('announces the actual molotov windup on host and client and suppresses weapons until the throw', () => {
    const w = combatWorld('inferno-colossus');
    const config = getCoopDefenseEnemyConfig(w.unit.kind).voidMolotov!;
    const spawnProjectile = vi.fn();
    const ability = new CoopDefenseEnemyAbilitySystem(w.manager, w.players, { spawnProjectile },
      w.combat as ConstructorParameters<typeof CoopDefenseEnemyAbilitySystem>[3], null,
      {} as ConstructorParameters<typeof CoopDefenseEnemyAbilitySystem>[5], null,
      { hostRefreshGroundCellsAlongSweptCircle: vi.fn() } as unknown as ConstructorParameters<typeof CoopDefenseEnemyAbilitySystem>[7],
      { broadcastTranslocatorFlash: vi.fn() }, w.world.catalog);
    w.attacks.setActionBlockedChecker(id => ability.blocksRegularAttacks(id));
    const clientScene = healthBarTestScene().scene;
    const client = new EnemyManager(clientScene, resolveCoopDefenseEnemyConfigs(1));
    const hostCircles = vi.spyOn(w.scene.add, 'circle');
    const clientCircles = vi.spyOn(clientScene.add, 'circle');
    const tick = (now: number) => {
      w.observe(now); w.move(now, undefined, true);
      ability.hostUpdate(now); w.attacks.hostUpdate(16, now);
      w.manager.syncHostVisuals();
      client.applySnapshot(w.manager.getNetSnapshot()); client.updateClientInterpolation(1);
    };
    try {
      w.player.x = w.unit.sprite.x + (config.minRange + config.maxRange) / 2;
      tick(1000);
      const start = 1000 + config.cooldownMs;
      tick(start);
      const hostRing = hostCircles.mock.results.at(-1)!.value;
      const clientRing = clientCircles.mock.results.at(-1)!.value;
      const startScale = hostRing.scaleX;
      w.shots.mockClear();
      for (const elapsed of [0, config.windupMs / 2, config.windupMs - 1]) {
        tick(start + elapsed);
        expect(w.unit.getSpecialAction()).toBe('void-molotov-windup');
        expect(client.getEnemy(w.unit.id)!.getSpecialAction()).toBe('void-molotov-windup');
        expect(w.unit.getDesiredVelocity()).toEqual({ vx: 0, vy: 0 });
        expect(w.unit.getAttackMovementSpeedFactor(start + elapsed)).toBe(0);
        for (const ring of [hostRing, clientRing]) {
          expect(ring.active && ring.visible).toBe(true);
          expect(ring.alpha).toBeGreaterThan(0);
          expect(ring.depth).toBeGreaterThan(w.unit.sprite.depth);
          // The warning must remain outside the rotated square silhouette until release.
          expect(ring.scaleX).toBeGreaterThan(Math.SQRT2);
        }
        expect(spawnProjectile).not.toHaveBeenCalled();
        expect(w.shots).not.toHaveBeenCalled();
      }
      expect(hostRing.scaleX).toBeLessThan(startScale);
      tick(start + config.windupMs);
      expect(spawnProjectile).toHaveBeenCalledTimes(1);
      expect(w.unit.getSpecialAction()).toBe('none');
      expect(client.getEnemy(w.unit.id)!.getSpecialAction()).toBe('none');
      expect(hostRing.active || clientRing.active).toBe(false);
    } finally { ability.clear(); client.destroy(); w.destroy(); }
  });

  it.each([0, 8])('the colossus approaches into flame range, holds and resumes pursuit with %i frames of field latency', resultDelay => {
    const config = getCoopDefenseEnemyConfig('inferno-colossus');
    const metrics = { cols: 129, rows: 33, cellSize: 16, pointOffset: 0, arenaOffsetX: 0, arenaOffsetY: 0 };
    const runner = new InlineFlowFieldRunner(resultDelay === 0);
    const coordinator = new FlowFieldCoordinator({ metrics, tuning: createFlowFieldTuning(), runner,
      staticKind: new Uint8Array(metrics.cols * metrics.rows), bases: [], activeBaseIds: new Set(),
      obstacleCellProvider: () => [], geometryProvider: () => ({ left: 0, top: 0, right: 2048, bottom: 512, obstacles: [] }),
      navTickIntervalMs: 100 });
    const field = EnemyFlowFieldService.fromView(coordinator.registerField('player', { goalMode: 'dynamic', bodyRadius: config.size / 2 }));
    const catalog = new EnemyAiTargetCatalog(), intents = new EnemyIntentSystem(coordinator, catalog);
    let frame = 0, pendingFrames = 0, readyFrames = 0;
    const dt = 16;
    const w = combatWorld('inferno-colossus', { catalog, intents, field,
      flush: () => {
        if (resultDelay && frame % resultDelay === 0) runner.flush();
        coordinator.advance(dt);
      },
      destroy: () => { intents.clear(); coordinator.destroy(); },
    });
    const positioning = config.combatPositioning!;
    const holdDistance = positioning.preferredDistancePx + positioning.toleranceP;
    const flame = w.unit.getAttackWeapons().find(attack => attack.weapon.config.fire.type === 'flamethrower')!.weapon.config;
    const rockets = w.unit.getAttackWeapons().find(attack => attack.salvo)!.weapon.config;
    const initialDistance = (rockets.range + Math.max(flame.range, holdDistance)) / 2;
    expect(holdDistance).toBeLessThan(flame.range);
    w.player.x = w.unit.sprite.x + initialDistance;
    const startX = w.unit.sprite.x;
    let advancedWithRocketShot = false;
    const tick = () => {
      const now = ++frame * dt;
      w.observe(now);
      const route = intents.get(w.unit.id)?.navigation;
      pendingFrames += Number(route?.status === 'pending'); readyFrames += Number(route?.status === 'ready');
      w.move(now, undefined, true);
      const shotsBefore = w.shots.mock.calls.length;
      w.attacks.hostUpdate(dt, now);
      const velocity = w.unit.getDesiredVelocity();
      advancedWithRocketShot ||= velocity.vx > 0 && w.shots.mock.calls.slice(shotsBefore).some(call => call[0].id === rockets.id);
      const nx = w.unit.sprite.x + velocity.vx * dt / 1000, ny = w.unit.sprite.y + velocity.vy * dt / 1000;
      expect(coordinator.getGeometry()!.canMove(w.unit.sprite.x, w.unit.sprite.y, nx, ny, w.unit.getSize() / 2)).toBe(true);
      w.unit.setPosition(nx, ny);
      (w.unit.sprite.body as any).setVelocity(velocity.vx, velocity.vy);
      return Math.hypot(w.player.x - w.unit.sprite.x, w.player.y - w.unit.sprite.y);
    };
    try {
      const approachFrames = Math.ceil(initialDistance / (config.moveSpeed * dt / 1000)) * 3;
      for (let step = 0; step < approachFrames; step++) tick();
      expect(w.unit.sprite.x).toBeGreaterThan(startX);
      expect(Math.hypot(w.player.x - w.unit.sprite.x, w.player.y - w.unit.sprite.y)).toBeLessThanOrEqual(holdDistance);
      expect(w.unit.getDesiredVelocity()).toEqual({ vx: 0, vy: 0 });
      expect(readyFrames).toBeGreaterThan(0);
      if (resultDelay) expect(pendingFrames).toBeGreaterThan(0);
      const firedIds = w.shots.mock.calls.map(call => call[0].id);
      expect(advancedWithRocketShot).toBe(true);
      expect(firedIds).toContain(rockets.id);
      expect(firedIds).toContain(flame.id);

      const heldX = w.unit.sprite.x;
      for (let step = 0; step < 30; step++) tick();
      expect(w.unit.sprite.x).toBe(heldX);
      w.player.x += positioning.preferredDistancePx;
      for (let step = 0; step < approachFrames; step++) tick();
      expect(w.unit.sprite.x).toBeGreaterThan(heldX);
      expect(w.unit.getDesiredVelocity()).toEqual({ vx: 0, vy: 0 });

      const closerHeldX = w.unit.sprite.x;
      w.player.x = closerHeldX + positioning.preferredDistancePx / 2;
      for (let step = 0; step < 30; step++) tick();
      expect(w.unit.sprite.x).toBe(closerHeldX);
      expect(w.unit.getDesiredVelocity()).toEqual({ vx: 0, vy: 0 });

      w.blockSight();
      w.player.x = closerHeldX + holdDistance - 1;
      w.observe(++frame * dt); w.positioning.hostUpdate();
      expect(w.positioning.getMovementOverride(w.unit.id)).toBeNull();
      for (let step = 0; step < 15; step++) tick();
      expect(w.unit.sprite.x).toBeGreaterThan(closerHeldX);
    } finally { w.destroy(); }
  });
});

describe('Physical neighbor snapshot', () => {
  function steer(applied: number, desired: number, absent: 'none' | 'burrowed' | 'inactive' = 'none') {
    const world = navigationTestWorld();
    const manager = new EnemyManager(healthBarTestScene().scene, resolveCoopDefenseEnemyConfigs(1));
    manager.setNavigationIntents(world.intents);
    const unit = manager.hostSpawnAtWorld(64, 128, 'rabid-badger');
    const blocker = manager.hostSpawnAtWorld(94, 128, 'rabid-badger');
    blocker.faction = 'allied'; blocker.setDesiredVelocity(desired, 0);
    (blocker.sprite.body as any).setVelocity(applied, 0);
    if (absent === 'burrowed') blocker.setBurrowed(true);
    if (absent === 'inactive') blocker.sprite.active = false;
    world.catalog.updateTargets([{ kind: 'player', id: 'p', x: 224, y: 128 }]);
    world.intents.update([unit], 0); world.flush(); world.intents.update([unit], 100);
    manager.hostUpdateMovement(world.field, world.field, world.field, null, false, 100, 16);
    const result = manager.getMovementFeedback(unit.id)!;
    manager.destroy(); world.destroy(); return result;
  }
  it.each(['burrowed', 'inactive'] as const)('does not avoid a %s neighbor', absent => {
    expect(steer(0, 0, absent).neighborsVisited).toBe(0);
    expect(steer(0, 0).neighborsVisited).toBe(1);
  });
  it.each([0, 15, -300, 300])('uses applied velocity %i independently of an outdated movement wish', applied => {
    const forward = steer(applied, 400), backward = steer(applied, -400);
    expect(forward.vx).toBe(backward.vx);
    expect(forward.vy).toBe(backward.vy);
  });
});

describe('Continuous pursuit across field updates', () => {
  it('keeps a safe corner continuation during repeated distant geometry changes', () => {
    const metrics = { cols: 49, rows: 33, cellSize: 16, pointOffset: 0, arenaOffsetX: 0, arenaOffsetY: 0 };
    const obstacles: NavigationObstacle[] = [{ id: 'corner', kind: 'rock', shape: 'rect', left: 160, top: 96, right: 192, bottom: 240 }];
    const runner = new InlineFlowFieldRunner(false);
    const coordinator = new FlowFieldCoordinator({ metrics, tuning: createFlowFieldTuning(), runner,
      staticKind: new Uint8Array(metrics.cols * metrics.rows), bases: [], activeBaseIds: new Set(),
      obstacleCellProvider: () => [], geometryProvider: () => ({ left: 0, top: 0, right: 768, bottom: 512, obstacles }), navTickIntervalMs: 100 });
    const field = EnemyFlowFieldService.fromView(coordinator.registerField('player', { goalMode: 'dynamic', bodyRadius: 15 }));
    const catalog = new EnemyAiTargetCatalog(), intents = new EnemyIntentSystem(coordinator, catalog);
    const manager = new EnemyManager(healthBarTestScene().scene, resolveCoopDefenseEnemyConfigs(1));
    manager.setNavigationIntents(intents);
    const unit = manager.hostSpawnAtWorld(80, 192, 'rabid-badger');
    catalog.updateTargets([{ kind: 'player', id: 'runner', x: 320, y: 192 }]);
    intents.update([unit], 0); runner.setAutoFlush(true); coordinator.prepareNow(); intents.update([unit], 120);
    runner.setAutoFlush(false);
    let pauses = 0;
    for (let step = 0; step < 60; step++) {
      obstacles.push({ id: `far:${step}`, kind: 'rock', shape: 'circle', x: 650, y: 400, radius: 8 });
      coordinator.invalidateGeometry(); coordinator.advance(1000 / 60); intents.update([unit], 240 + step * 16);
      manager.hostUpdateMovement(field, field, field, null, false, 240 + step * 16, 1000 / 60);
      const { vx, vy } = unit.getDesiredVelocity();
      if (Math.hypot(vx, vy) < 1) pauses++;
      const nx = unit.sprite.x + vx / 60, ny = unit.sprite.y + vy / 60;
      expect(coordinator.getGeometry()!.canMove(unit.sprite.x, unit.sprite.y, nx, ny, unit.getSize() / 2)).toBe(true);
      unit.setPosition(nx, ny);
      expect(intents.allowsAttack(unit.id, 'obstacle', 'corner', 'all')).toBe(false);
    }
    expect(pauses).toBe(0);
    manager.destroy(); intents.clear(); coordinator.destroy();
  });

  it.each([0, 8])('approaches a blocking rock with continuous attack permission despite target motion and %i frames of result delay', resultDelay => {
    const metrics = { cols: 41, rows: 25, cellSize: 16, pointOffset: 0, arenaOffsetX: 0, arenaOffsetY: 0 };
    const obstacles: NavigationObstacle[] = [{ id: 'rock:0', kind: 'rock', shape: 'rect', left: 320, top: 0, right: 352, bottom: 384 }];
    const runner = new InlineFlowFieldRunner(resultDelay === 0);
    const coordinator = new FlowFieldCoordinator({ metrics, tuning: createFlowFieldTuning(),
      runner,
      staticKind: new Uint8Array(metrics.cols * metrics.rows), bases: [], activeBaseIds: new Set(),
      obstacleCellProvider: () => [], geometryProvider: () => ({ left: 0, top: 0, right: 640, bottom: 384, obstacles }),
      navTickIntervalMs: 100 });
    const field = EnemyFlowFieldService.fromView(coordinator.registerField('player', { goalMode: 'dynamic', bodyRadius: 15 }));
    const catalog = new EnemyAiTargetCatalog(), intents = new EnemyIntentSystem(coordinator, catalog);
    const manager = new EnemyManager(healthBarTestScene().scene, resolveCoopDefenseEnemyConfigs(1));
    manager.setNavigationIntents(intents);
    intents.setObstacleIntegrityResolver(() => 10);
    const unit = manager.hostSpawnAtWorld(64, 192, 'rabid-badger');
    const dt = 1000 / 60;
    let started = false, interruptions = 0, arrived = false;
    for (let step = 0; step < 360; step++) {
      catalog.updateTargets([{ kind: 'player', id: 'runner', x: 512, y: 192 + Math.sin(step / 12) * 80 }]);
      if (resultDelay && step % resultDelay === 0) runner.flush();
      coordinator.advance(dt); intents.update([unit], step * dt);
      manager.hostUpdateMovement(field, field, field, null, false, step * dt, dt);
      const attack = intents.getBreachAttackPoint(unit.id);
      if (started && !intents.allowsAttack(unit.id, 'obstacle', '0', 'all')) interruptions++;
      started ||= attack !== null;
      const { vx, vy } = unit.getDesiredVelocity();
      const nx = unit.sprite.x + vx * dt / 1000, ny = unit.sprite.y + vy * dt / 1000;
      expect(coordinator.getGeometry()!.canMove(unit.sprite.x, unit.sprite.y, nx, ny, unit.getSize() / 2)).toBe(true);
      unit.setPosition(nx, ny);
      const biteRange = Math.max(...unit.getAttackWeapons().map(weapon => weapon.weapon.config.range));
      arrived ||= !!attack && Math.hypot(unit.sprite.x - attack.x, unit.sprite.y - attack.y) <= biteRange;
    }
    expect(started).toBe(true);
    expect(arrived).toBe(true);
    expect(interruptions).toBe(0);
    manager.destroy(); intents.clear(); coordinator.destroy();
  });

  it('keeps actual enemy velocity while the player moves every frame and changes identity', () => {
    const metrics = { cols: 161, rows: 33, cellSize: 16, pointOffset: 0, arenaOffsetX: 0, arenaOffsetY: 0 };
    const coordinator = new FlowFieldCoordinator({ metrics, tuning: createFlowFieldTuning(),
      staticKind: new Uint8Array(metrics.cols * metrics.rows), bases: [], activeBaseIds: new Set(),
      obstacleCellProvider: () => [], geometryProvider: () => ({ left: 0, top: 0, right: 2560, bottom: 512, obstacles: [] }),
      navTickIntervalMs: 100 });
    const field = EnemyFlowFieldService.fromView(coordinator.registerField('player', { goalMode: 'dynamic', bodyRadius: 15 }));
    const catalog = new EnemyAiTargetCatalog(), intents = new EnemyIntentSystem(coordinator, catalog);
    const manager = new EnemyManager(healthBarTestScene().scene, resolveCoopDefenseEnemyConfigs(1));
    manager.setNavigationIntents(intents);
    const unit = manager.hostSpawnAtWorld(64, 128, 'void-stalker');
    let pendingFrames = 0, pauses = 0;
    const dt = 1000 / 60;
    for (let step = 0; step < 360; step++) {
      const x = 1000 + step * 3, y = 256 + Math.sin(step / 40) * 80;
      catalog.updateTargets([{ kind: 'player', id: step < 180 ? 'first' : 'replacement', x, y }]);
      coordinator.advance(dt); intents.update([unit], step * dt);
      manager.hostUpdateMovement(field, field, field, null, false, step * dt, dt);
      const route = intents.get(unit.id)!.navigation;
      if (route.status === 'pending') pendingFrames++;
      const { vx, vy } = unit.getDesiredVelocity();
      if (step > 6 && Math.hypot(vx, vy) < 1) pauses++;
      const nx = unit.sprite.x + vx * dt / 1000, ny = unit.sprite.y + vy * dt / 1000;
      expect(coordinator.getGeometry()!.canMove(unit.sprite.x, unit.sprite.y, nx, ny, unit.getSize() / 2)).toBe(true);
      unit.setPosition(nx, ny);
    }
    expect(pendingFrames).toBeGreaterThan(100);
    expect(pauses).toBe(0);
    expect(unit.sprite.x).toBeGreaterThan(400);
    expect(intents.get(unit.id)!.target!.id).toBe('replacement');
    manager.destroy(); intents.clear(); coordinator.destroy();
  });
});
