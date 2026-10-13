import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', async () => {
  const phaser = (await import('./fakeArenaRenderScene')).createFakePhaserModule();
  return { ...phaser, Math: { ...phaser.Math, Angle: { ...phaser.Math.Angle,
    Wrap: (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle)),
  } } };
});
import { EnemyManager } from '../src/entities/EnemyManager';
import { getCoopDefenseEnemyConfig, normalizeEnemyFleeConfig } from '../src/config/coopDefenseEnemies';
import { createDawnScavengerPort } from '../src/dawn/runtime/DawnScavengerPort';
import { DAWN_M3_ASSET_KEYS } from '../src/dawn/contracts/DawnContentIds';
import { getWalkingSheetForStaticTexture } from '../src/animations/BadgerAnimations';
import { healthBarTestScene } from './healthBarTestScene';
import { navigationTestWorld } from './navigationTestWorld';
import type { NavigationObstacle } from '../src/systems/navigation/NavigationGeometry';

function fixture(obstacles: NavigationObstacle[] = []) {
  const world = navigationTestWorld(obstacles);
  const scene = healthBarTestScene().scene;
  const sprite = scene.add.sprite;
  scene.add.sprite = (x: number, y: number, key: string) => {
    const object = sprite(x, y).setTexture(key);
    object.setTint = (tint: number) => { object.tint = tint; return object; };
    return object;
  };
  const manager = new EnemyManager(scene);
  manager.setNavigationIntents(world.intents);
  let active = true;
  const port = createDawnScavengerPort(manager, () => active);
  const events = vi.fn();
  const detach = port.onOutcome(events);
  const step = (now: number, locked = false) => {
    const enemies = manager.getAllEnemies();
    world.intents.update(enemies, now); world.flush(); world.intents.update(enemies, now);
    manager.hostUpdateMovement(world.field, world.field, world.field, null, locked, now, 16);
    for (const enemy of manager.getAllEnemies()) {
      const v = enemy.getDesiredVelocity();
      const x = enemy.sprite.x + v.vx * .016, y = enemy.sprite.y + v.vy * .016;
      expect(world.geometry().canMove(enemy.sprite.x, enemy.sprite.y, x, y, enemy.getSize() / 2)).toBe(true);
      enemy.sprite.x = x; enemy.sprite.y = y;
    }
  };
  return { world, scene, manager, port, events, detach, step, deactivate: () => { active = false; },
    destroy: () => { manager.destroy(); world.destroy(); } };
}

describe('Dawn scavenger', () => {
  it('spawns N host-owned non-combatants with an optional escape destination and origin', () => {
    const f = fixture();
    try {
      const target = { x: 200, y: 128 };
      const ids = f.port.spawn({ count: 3, position: { x: 100, y: 128 }, escapeTarget: target, originId: 'future-site' });
      expect(new Set(ids).size).toBe(3);
      for (const id of ids) {
        const enemy = f.manager.getEnemy(id)!;
        expect(enemy.originId).toBe('future-site');
        expect(enemy.escapeTarget).toEqual(target);
        expect(enemy.getAttackWeapons()).toEqual([]);
      }
      target.x = 10;
      expect(f.manager.getEnemy(ids[0])!.escapeTarget!.x).toBe(200);
      expect(() => f.port.spawn({ count: 1.5, position: { x: 1, y: 2 } })).toThrow();
      expect(() => f.port.spawn({ count: 1, position: { x: NaN, y: 2 } })).toThrow();
      f.deactivate();
      expect(f.port.spawn({ count: 1, position: { x: 100, y: 100 } })).toEqual([]);
    } finally { f.destroy(); }
  });

  it('runs away from a nearby player, never authorizes attacks and disappears at the arena edge', () => {
    const f = fixture();
    try {
      const [id] = f.port.spawn({ count: 1, position: { x: 128, y: 128 } });
      const enemy = f.manager.getEnemy(id)!;
      f.world.catalog.updateTargets([{ kind: 'player', id: 'p', x: 100, y: 128 }]);
      f.step(0, true);
      expect(enemy.getDesiredVelocity()).toEqual({ vx: 0, vy: 0 });
      f.step(16);
      expect(enemy.sprite.x).toBeGreaterThan(128);
      expect(f.world.intents.get(id)?.attackContext).toBe('none');
      expect(f.world.intents.allowsAttack(id, 'player', 'p', 'all')).toBe(false);
      for (let i = 2; i < 200 && f.manager.getEnemy(id); i++) f.step(i * 16);
      expect(f.manager.getEnemy(id)).toBeUndefined();
      expect(f.events).toHaveBeenCalledTimes(1);
      expect(f.events.mock.calls[0][0]).toMatchObject({ enemyId: id, outcome: 'escaped' });
      expect(f.manager.getNetSnapshot().r).toContain(Number.parseInt(id.slice(1), 36));
    } finally { f.destroy(); }
  });

  it('routes around a wall to an explicit exit, without attacking the wall', () => {
    const f = fixture([{ id: 'wall', kind: 'rock', shape: 'rect', left: 120, right: 136, top: 0, bottom: 170 }]);
    try {
      const [id] = f.port.spawn({ count: 1, position: { x: 70, y: 100 }, escapeTarget: { x: 205, y: 100 } });
      for (let i = 0; i < 500 && f.manager.getEnemy(id); i++) f.step(i * 16);
      expect(f.manager.getEnemy(id)).toBeUndefined();
      expect(f.events).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'escaped' }));
    } finally { f.destroy(); }
  });

  it('publishes a kill once, but removal and teardown never masquerade as kills or escapes', () => {
    const f = fixture();
    try {
      const ids = f.port.spawn({ count: 3, position: { x: 128, y: 128 }, originId: 'site' });
      f.manager.applyDamage(ids[0], 10000);
      f.manager.applyDamage(ids[0], 10000);
      f.manager.hostRemoveWithoutKill(ids[1]);
      expect(f.events).toHaveBeenCalledTimes(1);
      expect(f.events.mock.calls[0][0]).toMatchObject({ enemyId: ids[0], originId: 'site', outcome: 'killed' });
      f.detach();
      f.manager.applyDamage(ids[2], 10000);
      expect(f.events).toHaveBeenCalledTimes(1);
    } finally { f.destroy(); }
  });

  it('uses tinted walking placeholder art, or the contracted asset when loaded', () => {
    const f = fixture();
    try {
      const textureKey = getWalkingSheetForStaticTexture(DAWN_M3_ASSET_KEYS.scavenger)?.textureKey ?? DAWN_M3_ASSET_KEYS.scavenger;
      vi.spyOn(f.scene.textures, 'exists').mockImplementation((key: unknown) => key !== textureKey);
      const [id] = f.port.spawn({ count: 1, position: { x: 128, y: 128 } });
      const placeholder = f.manager.getEnemy(id)!;
      expect(placeholder.sprite.tint).not.toBe(0xffffff);
      vi.spyOn(f.scene.textures, 'exists').mockReturnValue(true);
      const [artId] = f.port.spawn({ count: 1, position: { x: 128, y: 128 } });
      expect(f.manager.getEnemy(artId)!.sprite.texture.key).toBe(textureKey);
    } finally { f.destroy(); }
  });

  it('rejects invalid flee tuning and unknown scrap definitions', () => {
    const config = getCoopDefenseEnemyConfig('dawn-scavenger').flee!;
    expect(normalizeEnemyFleeConfig(config)).toEqual(config);
    expect(() => normalizeEnemyFleeConfig({ ...config, arrivalRadiusPx: NaN })).toThrow();
    expect(() => normalizeEnemyFleeConfig({ ...config, scrapPickupDefId: 'NUKE' })).toThrow();
    expect(() => normalizeEnemyFleeConfig({ ...config, scrapPickupDefId: 'constructor' })).toThrow();
  });
});
