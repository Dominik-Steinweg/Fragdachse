import { vi } from 'vitest';

// Same headless boundary as FireControlProjectileRoute / TurretBaseWeaponMatrix.
// Production geometry is retained so M2 can test real blocked flight segments.
vi.mock('phaser', async () => {
  const phaser = (await import('./fakeArenaRenderScene')).createFakePhaserModule() as unknown as typeof import('phaser');
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const root = require.resolve('phaser/package.json').replace(/package\.json$/, '');
  return { ...phaser, Geom: { ...phaser.Geom,
    Line: require(root + 'src/geom/line/Line.js'),
    Rectangle: require(root + 'src/geom/rectangle/Rectangle.js'),
    Intersects: require(root + 'src/geom/intersects/index.js'),
  } };
});

import { TurretSystem, toLocalTurretFireSource, type AutomatedTurret, type TurretFireSource } from '../src/systems/TurretSystem';
import { fireControlCopySourceId } from '../src/systems/fireControl/FireControlSnapshot';
import { UTILITY_CONFIGS, WEAPON_CONFIGS, type UtilityConfig } from '../src/loadout/LoadoutConfig';
import { WorldProjectileRuntime } from '../src/projectile/WorldProjectileRuntime';
import { ProjectileIdentityScope } from '../src/projectile/ProjectileIdentityScope';
import type { ProjectileSpawnRequest } from '../src/projectile/ProjectileSpawnRequest';
import { AutomatedWeaponExecutionAdapter } from '../src/world/AutomatedWeaponExecutionAdapter';
import { WorldWeaponExecutionRuntime } from '../src/world/WorldWeaponExecutionRuntime';
import { PlayerUtilityActionRuntime } from '../src/world/PlayerUtilityActionRuntime';
import { HostHeldActionSystem } from '../src/systems/HostHeldActionSystem';
import { createPresentation, createTechnicalPhysicsBinding } from './ProjectileRuntimeTestHelper';

/** Synthetic geometry/readiness, deliberately independent of authored balance values. */
export function fireControlConstruction(overrides: Partial<AutomatedTurret> = {}): AutomatedTurret {
  return { id: 7, ownerId: 'inspector', ownerColor: 0xffffff, x: 0, y: 0, angle: 0,
    weaponId: 'TURRET_MG', targetRange: 500, cooldownMs: 1000, muzzleOffset: 0, ...overrides };
}

/** Provider input only: this does not simulate activation or a deployment owner. */
export function fireControlCopy(original: AutomatedTurret, parallel = false): TurretFireSource {
  const id = fireControlCopySourceId(1, 0);
  return { ...original, id, x: 300, identityId: original.id, visualId: id, fireState: 'active',
    sequenceKey: parallel ? id : original.id, ...(parallel ? { sequenceSeedKey: original.id } : {}) };
}

export function createFireControlSourceFixture() {
  let constructions: readonly AutomatedTurret[] = [];
  let sources: readonly TurretFireSource[] = [];
  let enemies = [{ id: 'enemy', x: 150, y: 100 }];
  const system = new TurretSystem({ getAllPlayers: () => [] } as never,
    { isAlive: () => true, isBurrowed: () => false, canDamageTarget: () => true } as never);
  const fire = vi.fn(), angles = vi.fn();
  system.setTurretProvider(() => constructions, angles);
  system.setFireSourceProvider(() => sources);
  system.setEnemyTargetProvider(() => enemies);
  system.setFireHandler(fire);
  return { system, fire, angles,
    set(constructionList: readonly AutomatedTurret[], fireSources = constructionList.map(toLocalTurretFireSource)) {
      constructions = constructionList; sources = fireSources;
    },
    setEnemies(next: typeof enemies) { enemies = next; },
    tick(now: number, deltaMs = 16) {
      const config = UTILITY_CONFIGS.SPORE_TURRET;
      if (config.type !== 'placeable_turret') throw new Error('Expected turret fixture config');
      system.hostUpdate(now, config, WEAPON_CONFIGS.SPORES, deltaMs);
    },
    destroy() { system.setFireSourceProvider(null); system.setTurretProvider(null, null);
      system.setEnemyTargetProvider(null); system.setFireHandler(null); },
  };
}

/** Real automatic weapon -> spawn -> projectile lifetime, with observable technical physics. */
export function createFireControlProjectileFixture() {
  let now = 1000;
  const physics = createTechnicalPhysicsBinding();
  const presentation = createPresentation();
  const projectiles = new WorldProjectileRuntime({ physicsBinding: physics.binding, presentation,
    identityScope: new ProjectileIdentityScope(1), hostNowMs: () => now });
  const spawn = vi.fn((request: ProjectileSpawnRequest) => projectiles.spawnProjectile(request));
  const projectileSpawn = { spawnProjectile: spawn };
  const execution = new WorldWeaponExecutionRuntime({ projectileSpawn, combatSystem: {
    resolveSafeHitscanStart() { throw new Error('Fire-control fixture supports projectile/flamethrower only'); },
    resolveImmediateAttack() { throw new Error('Unexpected immediate weapon'); },
  } });
  const weapons = new AutomatedWeaponExecutionAdapter(execution, projectileSpawn);
  return { physics, presentation, projectiles, spawn, weapons,
    get now() { return now; },
    advance(deltaMs: number) {
      now += deltaMs;
      for (const [id, handle] of physics.handles) {
        if (!handle.sprite.active || !handle.body.enable) continue;
        const { x: vx, y: vy } = handle.body.velocity;
        const x = handle.sprite.x + vx * deltaMs / 1000, y = handle.sprite.y + vy * deltaMs / 1000;
        handle.body.reset(x, y); physics.observe(id, x, y, vx, vy);
      }
      return projectiles.runHostProjectileStage(deltaMs, now);
    },
    destroy() { projectiles.destroy(); execution.destroy(); },
  };
}

/** Existing action/resource harness; M1 supplies the authored config and connects the utility port. */
export function createFireControlUtilityFixture(config: UtilityConfig) {
  let alive = true, attempt = 0;
  const projectile = createFireControlProjectileFixture();
  const cooldown = vi.fn(), inventory = vi.fn(), used = vi.fn(), noteUsed = vi.fn();
  const action = new PlayerUtilityActionRuntime({
    captureSmokeDamage: () => ({ sourceDamageMultiplier: 1 }), projectileSpawn: { spawnProjectile: projectile.spawn },
    combatSystem: {} as never,
    actor: { getPlayer: () => ({ x: 0, y: 0, color: 0xffffff }), canInteract: () => true,
      isAlive: () => alive, isUtilityBlocked: () => false },
    loadout: { getEquippedUtilityConfig: () => config, resolveUtilityConfig: (_p, c) => c, noteUtilityUsed: noteUsed },
    heldAction: new HostHeldActionSystem(), translocator: null, decoy: null, stinkCloud: null,
    gameAudioSystem: {} as never, dropBeer() {}, nukeStrike: () => false, placeable: null,
    network: { loadout: { publishUtilityCooldownUntil: cooldown, publishTemporaryUtilityInstances: inventory,
      publishHeldUtilityId() {} }, roundStats: { recordUtilityUsed: used, recordConstructionBuilt() {} } },
    isToolAuthorized: () => true, resolveToolUtilityConfig: () => config,
  });
  return { action, projectile, cooldown, inventory, used, noteUsed,
    setAlive(value: boolean) { alive = value; },
    place(now: number, x = 300, y = 0) {
      return action.execute({ category: 'utility', playerId: 'inspector', angle: 0, targetX: x, targetY: y,
        hostNowMs: now, attemptId: `placement-${++attempt}`, params: {} });
    },
    cast(now: number) {
      const heldActionId = `throw-${++attempt}`;
      action.startHeldAction('inspector', heldActionId, 'charged_throw', now);
      return action.execute({ category: 'utility', playerId: 'inspector', angle: 0, targetX: 300, targetY: 0,
        hostNowMs: now, attemptId: heldActionId, params: { heldActionId } });
    },
    destroy() { action.destroy(); projectile.destroy(); },
  };
}
