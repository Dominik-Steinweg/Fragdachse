import { describe, it, expect } from 'vitest';
import { navigationTestWorld } from './navigationTestWorld';
import { BreachSearch } from '../src/systems/navigation/BreachPlanner';
import type { NavigationObstacle } from '../src/systems/navigation/NavigationGeometry';
import { COOP_DEFENSE_ENEMY_KINDS, getCoopDefenseEnemyConfig } from '../src/config/coopDefenseEnemies';
import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import type { EnemyEntity } from '../src/entities/EnemyEntity';
import type { CoopDefenseEnemyKind as EnemyKind } from '../src/config/coopDefenseEnemies';

function enemy(kind: EnemyKind = 'rabid-badger', id = 'enemy', x = 32, y = 128): EnemyEntity {
  const config = getCoopDefenseEnemyConfig(kind);
  return { id, kind, faction: 'hostile', sprite: { active: true, x, y },
    getSize: () => config.size, getMoveSpeed: () => config.moveSpeed,
    getAttackWeapons: () => config.weapons.map(w => ({ ...w, weapon: { config: WEAPON_CONFIGS[w.weaponId] } })),
  } as unknown as EnemyEntity;
}
const rect = (id: string, left: number, top: number, right: number, bottom: number, kind: NavigationObstacle['kind'] = 'rock'): NavigationObstacle =>
  ({ id, kind, shape: 'rect', left, top, right, bottom });
function settle(world: ReturnType<typeof navigationTestWorld>, enemies: EnemyEntity[], now = 0) {
  world.intents.update(enemies, now); world.flush(); world.intents.update(enemies, now + 1);
}

describe('Shared strategic intent and demolition permission', () => {
  it('continues safe pursuit while a moving player makes the next field pending', () => {
    const world = navigationTestWorld(), unit = enemy();
    world.catalog.updateTargets([{ kind: 'player', id: 'runner', x: 224, y: 128 }]);
    settle(world, [unit]);
    for (let step = 1; step <= 8; step++) {
      world.catalog.updateTargets([{ kind: 'player', id: 'runner', x: 224, y: 128 + step * 8 }]);
      world.intents.update([unit], step * 120);
      const route = world.intents.get(unit.id)!.navigation;
      expect(route.status).toBe('pending');
      const point = route.status === 'pending' ? route.continuation : undefined;
      expect(point).toBeDefined();
      expect(point!.x).toBeGreaterThan(unit.sprite.x);
      expect(world.geometry().canMove(unit.sprite.x, unit.sprite.y, point!.x, point!.y, unit.getSize() / 2)).toBe(true);
      expect(world.intents.getBreach(unit.id)).toBeNull();
      expect(world.intents.allowsAttack(unit.id, 'obstacle', 'any', 'all')).toBe(false);
      expect(world.intents.allowsAttack(unit.id, 'player', 'runner', 'all')).toBe(true);
      world.flush();
    }
    world.destroy();
  });

  it.each(COOP_DEFENSE_ENEMY_KINDS)('keeps authored primary intent and body-safe attack goals for %s', kind => {
    const world = navigationTestWorld([rect('base:main', 176, 96, 208, 160, 'base')],
      [{ id: 'main', isGoalSource: true, cellCoords: Int32Array.of(12, 8) }]);
    const unit = enemy(kind, kind, 64, 128), config = getCoopDefenseEnemyConfig(kind);
    world.catalog.updateTargets([{ kind: 'player', id: 'player', x: 64, y: 48 }]);
    settle(world, [unit]);
    const intent = world.intents.get(unit.id);
    const siege = config.movementTarget === 'bases';
    expect(intent?.target).toEqual(siege ? { kind: 'base', id: 'main' } : { kind: 'player', id: 'player' });
    expect(intent?.navigation.status).toBe('ready');
    expect(world.intents.allowsAttack(unit.id, 'base', 'main', 'all')).toBe(siege);
    expect(world.intents.allowsAttack(unit.id, 'player', 'player', 'all')).toBe(!siege);
    expect(world.intents.getBreach(unit.id)).toBeNull();
    const field = world.intents.getField(unit.id)!;
    for (const goal of field.getGoalCells()) {
      const point = field.gridToWorld(goal.gridX, goal.gridY)!;
      expect(world.geometry().isFree(point.x, point.y, config.size / 2)).toBe(true);
    }
    world.intents.clear();
    expect(world.intents.get(unit.id)).toBeNull();
    expect(world.intents.allowsAttack(unit.id, 'base', 'main', 'all')).toBe(false);
    world.destroy();
  });

  it('retains a safe corner route but drops it for new geometry or a different target', () => {
    const world = navigationTestWorld([rect('corner', 96, 64, 144, 192)]), unit = enemy();
    world.catalog.updateTargets([{ kind: 'player', id: 'runner', x: 224, y: 128 }]); settle(world, [unit]);
    world.catalog.updateTargets([{ kind: 'player', id: 'runner', x: 224, y: 144 }]); world.intents.update([unit], 200);
    const route = world.intents.get(unit.id)!.navigation;
    expect(route.status).toBe('pending');
    expect(route.status === 'pending' && route.continuation).toBeTruthy();
    expect(route.status === 'pending' && route.directGoalConnection).not.toBe(true);
    expect(world.intents.allowsAttack(unit.id, 'player', 'runner', 'all')).toBe(false);
    world.catalog.updateTargets([{ kind: 'player', id: 'other', x: 224, y: 144 }]); world.intents.update([unit], 201);
    const replacement = world.intents.get(unit.id)!.navigation;
    expect(replacement.status === 'pending' && replacement.continuation).toBeUndefined();
    world.catalog.updateTargets([{ kind: 'player', id: 'runner', x: 224, y: 144 }]);
    world.snapshot.obstacles.push(rect('sealed', 96, 0, 144, 64)); world.coordinator.invalidateGeometry();
    world.intents.update([unit], 202);
    const changed = world.intents.get(unit.id)!.navigation;
    expect(changed.status === 'pending' && changed.continuation).toBeUndefined();
    world.destroy();
  });

  it('prefers a freely reachable player immediately over a previously enclosed player', () => {
    const world = navigationTestWorld(); const e = enemy();
    world.catalog.updateTargets([{ kind: 'player', id: 'enclosed', x: 208, y: 128 }]);
    settle(world, [e]); expect(world.intents.get(e.id)?.target?.id).toBe('enclosed');
    world.snapshot.obstacles.push(rect('wall', 112, 0, 128, 256, 'barrier')); world.coordinator.invalidateGeometry();
    world.catalog.updateTargets([{ kind: 'player', id: 'enclosed', x: 208, y: 128 }, { kind: 'player', id: 'free', x: 32, y: 224 }]);
    settle(world, [e], 50);
    expect(world.intents.get(e.id)?.target?.id).toBe('free');
    expect(world.intents.getBreach(e.id)).toBeNull(); world.destroy();
  });

  it('never grants a player hunter with an all-mode bite incidental base damage', () => {
    const world = navigationTestWorld([rect('base:main', 80, 80, 112, 112, 'base')],
      [{ id: 'main', isGoalSource: true, cellCoords: Int32Array.of(6, 6) }]);
    const e = enemy(); world.catalog.updateTargets([{ kind: 'player', id: 'player', x: 224, y: 128 }]);
    settle(world, [e]);
    expect(world.intents.get(e.id)?.reason).toBe('player');
    expect(world.intents.allowsAttack(e.id, 'base', 'main', 'all')).toBe(false);
    expect(world.intents.allowsAttack(e.id, 'player', 'player', 'all')).toBe(true); world.destroy();
  });

  it('keeps siege intent and admits only explicit anti-player side weapons', () => {
    const world = navigationTestWorld([rect('base:main', 176, 96, 208, 160, 'base')],
      [{ id: 'main', isGoalSource: true, cellCoords: Int32Array.of(12, 8) }]);
    const e = enemy('grave-titan', 'boss', 48, 128);
    world.catalog.updateTargets([{ kind: 'player', id: 'player', x: 48, y: 48 }]); settle(world, [e]);
    expect(world.intents.get(e.id)?.reason).toBe('siege');
    expect(world.intents.allowsAttack(e.id, 'player', 'player', 'all')).toBe(false);
    expect(world.intents.allowsAttack(e.id, 'player', 'player', 'players')).toBe(true); world.destroy();
  });

  it('does not plan demolition while work is pending or when any free detour exists', () => {
    const world = navigationTestWorld([rect('rock:0', 112, 64, 144, 192)]); const e = enemy();
    world.intents.setObstacleIntegrityResolver(() => 1);
    world.catalog.updateTargets([{ kind: 'player', id: 'player', x: 224, y: 128 }]);
    world.intents.update([e], 0);
    expect(world.intents.get(e.id)?.navigation.status).toBe('pending');
    expect(world.intents.allowsAttack(e.id, 'obstacle', '0', 'all')).toBe(false);
    settle(world, [e]); expect(world.intents.getBreach(e.id)).toBeNull(); world.destroy();
  });

  it('withdraws a shared breach order immediately when geometry changes', () => {
    const world = navigationTestWorld([rect('rock:0', 112, 0, 144, 256)]), enemies = [enemy(), enemy('rabid-badger', 'second', 48, 128)];
    world.intents.setObstacleIntegrityResolver(() => 10);
    world.catalog.updateTargets([{ kind: 'player', id: 'player', x: 224, y: 128 }]); settle(world, enemies);
    for (let i = 0; i < 30 && world.intents.getBreach(enemies[0].id)?.status !== 'ready'; i++) settle(world, enemies, i * 100);
    expect(world.intents.getBreach(enemies[0].id)?.status).toBe('ready');
    expect(world.intents.getBreach(enemies[0].id)).toBe(world.intents.getBreach(enemies[1].id));
    expect(world.intents.allowsAttack(enemies[0].id, 'obstacle', '0', 'all')).toBe(true);
    world.snapshot.obstacles.length = 0; world.coordinator.invalidateGeometry();
    expect(world.intents.allowsAttack(enemies[0].id, 'obstacle', '0', 'all')).toBe(false);
    settle(world, enemies, 4000); expect(world.intents.getBreach(enemies[0].id)).toBeNull(); world.destroy();
  });

  it('finishes an opening while the enclosed target moves within the same goal region', () => {
    const world = navigationTestWorld([rect('rock:0', 112, 0, 144, 256)]), unit = enemy();
    world.intents.setObstacleIntegrityResolver(() => 10);
    let ready = false;
    for (let step = 0; step < 30 && !ready; step++) {
      world.catalog.updateTargets([{ kind: 'player', id: 'moving', x: 224, y: step % 2 ? 176 : 80 }]);
      settle(world, [unit], step * 100);
      ready = world.intents.getBreach(unit.id)?.status === 'ready';
    }
    expect(ready).toBe(true);
    expect(world.intents.getBreach(unit.id)?.nextBlocker).toBe('rock:0');
    world.catalog.updateTargets([{ kind: 'player', id: 'moving', x: 48, y: 224 }]);
    world.intents.update([unit], 3100);
    expect(world.intents.allowsAttack(unit.id, 'obstacle', '0', 'all')).toBe(false);
    settle(world, [unit], 3200);
    expect(world.intents.get(unit.id)?.navigation.status).toBe('ready');
    expect(world.intents.getBreach(unit.id)).toBeNull();
    world.destroy();
  });
});

describe('Navigation authority across lifetime and faction changes', () => {
  it('drops a missing player immediately, including inside the decision interval', () => {
    const world = navigationTestWorld(), enemies = Array.from({ length: 30 }, (_, index) => enemy('rabid-badger', `e${index}`));
    world.catalog.updateTargets([{ kind: 'player', id: 'player', x: 224, y: 128 }]);
    settle(world, enemies);
    world.catalog.updateTargets([]); world.intents.update(enemies, 2);
    for (const e of enemies) {
      expect(world.intents.get(e.id)).toBeNull();
      expect(world.intents.allowsAttack(e.id, 'player', 'player', 'all')).toBe(false);
    }
    world.destroy();
  });

  it('uses only an observed position through smoke and grants no new attack on memory', () => {
    const world = navigationTestWorld(), e = enemy(); let visible = true;
    world.intents.setPerception(() => visible);
    world.catalog.updateTargets([{ kind: 'player', id: 'player', x: 208, y: 128 }]); settle(world, [e]);
    visible = false;
    world.catalog.updateTargets([{ kind: 'player', id: 'player', x: 208, y: 224 }]); settle(world, [e], 200);
    expect(world.intents.get(e.id)).toMatchObject({ reason: 'memory', target: null, point: { x: 208, y: 128 }, attackContext: 'none' });
    expect(world.intents.allowsAttack(e.id, 'player', 'player', 'all')).toBe(false);
    e.sprite.x = 208; e.sprite.y = 128; world.intents.update([e], 400);
    expect(world.intents.get(e.id)).toBeNull(); world.destroy();
  });

  it('does not reinterpret a known enclosed player as a missing player with base fallback', () => {
    const world = navigationTestWorld([rect('barrier', 112, 0, 144, 256, 'barrier'), rect('base:main', 64, 48, 96, 80, 'base')],
      [{ id: 'main', isGoalSource: true, cellCoords: Int32Array.of(5, 4) }]), e = enemy();
    world.catalog.updateTargets([{ kind: 'player', id: 'player', x: 224, y: 128 }]); settle(world, [e]);
    expect(world.intents.get(e.id)?.reason).toBe('player');
    expect(world.intents.allowsAttack(e.id, 'base', 'main', 'all')).toBe(false); world.destroy();
  });

  it('does not share destruction rights between allied units of different owners', () => {
    const world = navigationTestWorld([rect('rock:0', 112, 0, 144, 256)]);
    const allies = [enemy(), enemy('rabid-badger', 'second', 48, 128)];
    allies.forEach((ally, index) => { ally.faction = 'allied'; Object.defineProperty(ally, 'ownerId', { value: `owner-${index}` }); });
    world.intents.setObstacleIntegrityResolver(ally => ally.ownerId === 'owner-0' ? 10 : null);
    for (let step = 0; step < 60; step++) {
      world.intents.update(allies, step * 100);
      for (const ally of allies) world.intents.routeAlly(ally, 'shared-destination', { x: 224, y: 128 }, 24);
      world.flush();
    }
    expect(world.intents.getBreach(allies[0].id)?.status).toBe('ready');
    expect(world.intents.allowsAttack(allies[0].id, 'obstacle', '0', 'all')).toBe(true);
    expect(world.intents.allowsAttack(allies[1].id, 'obstacle', '0', 'all')).toBe(false);
    expect(world.intents.getBreach(allies[1].id)?.status).toBe('no-solution');
    world.destroy();
  });

  it('shares an allied opening and revokes it when the destruction right changes', () => {
    const world = navigationTestWorld([rect('rock:0', 112, 0, 144, 256)]);
    const allies = [enemy(), enemy('rabid-badger', 'second', 48, 128)];
    for (const ally of allies) ally.faction = 'allied';
    let permitted = true;
    world.intents.setObstacleIntegrityResolver(() => permitted ? 10 : null);
    for (let step = 0; step < 40; step++) {
      world.intents.update(allies, step * 100);
      for (const ally of allies) world.intents.routeAlly(ally, 'owner', { x: 224, y: 128 }, 24);
      world.flush();
    }
    expect(world.intents.getBreach(allies[0].id)?.status).toBe('ready');
    expect(world.intents.getBreach(allies[0].id)).toBe(world.intents.getBreach(allies[1].id));
    expect(world.intents.allowsAttack(allies[0].id, 'obstacle', '0', 'all')).toBe(true);
    permitted = false;
    expect(world.intents.allowsAttack(allies[0].id, 'obstacle', '0', 'all')).toBe(false);
    expect(world.intents.getBreachAttackPoint(allies[0].id)).toBeNull();
    world.destroy();
  });
});

describe('Budgeted object-based opening search', () => {
  it('places a large body within the actual center-based rock attack range', () => {
    const world = navigationTestWorld([rect('solid-top', 112, 0, 144, 96, 'barrier'),
      rect('door', 112, 96, 144, 160), rect('solid-bottom', 112, 160, 144, 256, 'barrier')], [], 26);
    const job = new BreachSearch({ version: { generation: 1, topology: 1, goal: 1, profile: 'large' },
      startIndex: 3 * 17 + 3, startRegion: 1, goals: [13 * 17 + 13], radius: 26, speed: 100,
      attackRange: 50, destructionSeconds: id => id === 'door' ? 1 : null }, world.metrics, world.geometry());
    let plan = job.step(0);
    for (let i = 0; i < 100 && plan.status === 'pending'; i++) plan = job.step(64);
    expect(plan.status).toBe('ready');
    expect(Math.hypot(plan.approach!.x - 128, plan.approach!.y - 128)).toBeLessThanOrEqual(50);
    world.destroy();
  });

  function search(obstacles: NavigationObstacle[], radius = 15) {
    const world = navigationTestWorld(obstacles, [], radius);
    const request = { version: { generation: 1, topology: 1, goal: 1, profile: 'body' },
      startIndex: 8 * 17 + 3, startRegion: 1, goals: [8 * 17 + 13], radius, speed: 100,
      destructionSeconds: (id: string) => id.startsWith('solid') ? null : id.startsWith('weak') ? 1 : 10 };
    const job = new BreachSearch(request, world.metrics, world.geometry());
    let result = job.step(0); expect(result.status).toBe('pending');
    for (let i = 0; i < 300 && result.status === 'pending'; i++) result = job.step(64);
    world.destroy(); return result;
  }
  it('charges logical objects once across multiple cells and layers', () => {
    const plan = search([rect('weak-front', 96, 0, 112, 128), rect('weak-front', 96, 128, 112, 256), rect('rear', 144, 0, 160, 256)]);
    expect(plan.status).toBe('ready'); expect(plan.nextBlocker).toBe('weak-front');
    expect(plan.openedObjects).toEqual(['weak-front', 'rear']);
    expect(plan.costSeconds).toBeGreaterThan(11); expect(plan.costSeconds).toBeLessThan(13);
  });
  it('opens both adjacent pieces when a boss cannot fit a one-piece opening', () => {
    const plan = search([rect('solid-top', 112, 0, 144, 80), rect('upper', 112, 80, 144, 128),
      rect('lower', 112, 128, 144, 176), rect('solid-bottom', 112, 176, 144, 256)], 34);
    expect(plan.status).toBe('ready'); expect(plan.openedObjects).toHaveLength(2);
  });
  it('chooses a non-base opening even when the base would be cheaper', () => {
    const plan = search([rect('weak-base', 112, 0, 144, 128, 'base'), rect('rock', 112, 128, 144, 256)]);
    expect(plan.status).toBe('ready'); expect(plan.openedObjects).not.toContain('weak-base');
  });
  it('uses a base only after exhausting alternatives, and reports true impossibility separately', () => {
    expect(search([rect('base', 112, 0, 144, 256, 'base')]).nextBlocker).toBe('base');
    expect(search([rect('solid', 112, 0, 144, 256, 'barrier')]).status).toBe('no-solution');
  });
});
