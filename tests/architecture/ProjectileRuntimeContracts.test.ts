import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function valueImports(source: string): string[] {
  return [...source.matchAll(/^import\s+(?!type\s)[\s\S]*?from\s+'([^']+)'/gm)]
    .map(([, specifier]) => specifier);
}

describe('Projectile Runtime – final ownership ratchets', () => {
  it('removes the historical owner and record names from productive code', () => {
    const source = [
      read('src/projectile/WorldProjectileRuntime.ts'),
      read('src/projectile/ProjectilePhysicsBinding.ts'),
      read('src/projectile/ProjectileStore.ts'),
      read('src/systems/CombatSystem.ts'),
    ].join('\n');

    expect(source).not.toContain('ProjectileManager');
    expect(source).not.toContain('TrackedProjectile');
    expect(source).not.toContain('getActiveProjectiles');
    expect(source).not.toContain('getProjectileById');
    expect(source).not.toContain('ProjectileStoreAccess');
    expect(read('src/types.ts')).not.toContain('ProjectileRuntimeRecord');
    expect(source).not.toContain('spawnProjectileConfig');
  });

  it('keeps the Phaser binding free of network, client-owner, presentation and wall-clock state', () => {
    const binding = read('src/projectile/ProjectilePhysicsBinding.ts');
    const imports = valueImports(binding);

    expect(imports).not.toContain('./ProjectileClientReplica');
    expect(imports).not.toContain('./ProjectileReplicationAdapter');
    expect(imports).not.toContain('./ProjectilePresentationRuntime');
    expect(imports.some((specifier) => specifier.includes('/effects/'))).toBe(false);
    expect(imports.some((specifier) => specifier.includes('/audio/'))).toBe(false);
    expect(imports.some((specifier) => specifier.includes('/network/'))).toBe(false);
    expect(binding).not.toContain('Date.now');
  });

  it('keeps the technical physics contract free of projectile lifecycle and runtime records', () => {
    const binding = read('src/projectile/ProjectilePhysicsBinding.ts');
    for (const forbidden of [
      'ProjectileRuntimeRecord', 'ProjectileRuntimeOwnerPort', 'ProjectileExternalInteractionAccess',
      'ProjectileExplosionRequest', 'ProjectileBurnAugment', 'ProjectileCombatPort',
    ]) expect(binding).not.toContain(forbidden);
  });

  it('keeps presentation, replica and replication state world-scoped', () => {
    const runtime = read('src/projectile/WorldProjectileRuntime.ts');
    const composition = read('src/scenes/arena/ArenaWorldCombatComposition.ts');
    const presentation = read('src/projectile/ProjectilePresentationRuntime.ts');
    const replica = read('src/projectile/ProjectileClientReplica.ts');
    const replication = read('src/projectile/ProjectileReplicationAdapter.ts');

    expect(runtime).toContain('private readonly clientReplica = new ProjectileClientReplica();');
    expect(runtime).toContain('private projectileReplicationAdapter: ProjectileReplicationAdapter | null = null;');
    expect(runtime).toContain('readonly presentation: ProjectilePresentationRuntime;');
    expect(composition).toContain('const presentation = new ProjectilePresentationRuntime(input.scene);');
    expect(composition).toContain('physicsBinding: new ProjectilePhysicsBinding(input.scene)');
    expect(presentation).not.toContain('ProjectileRuntimeRecord');
    expect(presentation).not.toContain('ProjectilePhysicsBinding');
    expect(replica).not.toContain('CombatSystem');
    expect(replica).not.toContain('WorldProjectileRuntime');
    expect(replication).not.toContain('WorldProjectileRuntime');
  });

  it('keeps combat and execution on semantic projectile ports', () => {
    const combat = read('src/systems/CombatSystem.ts');
    const execution = read('src/world/AutomatedWeaponExecutionAdapter.ts');
    const utility = read('src/world/PlayerUtilityActionRuntime.ts');
    const enemyAbility = read('src/systems/CoopDefenseEnemyAbilitySystem.ts');

    expect(combat).not.toContain('ProjectileRuntimeRecord');
    expect(combat).not.toContain('ProjectilePhysicsBinding');
    expect(combat).not.toContain('getActiveProjectiles');
    expect(combat).not.toContain('projectileStyle');
    expect(execution).not.toContain('ProjectilePhysicsBinding');
    expect(execution).toContain('ProjectileSpawnPort');
    expect(utility).toContain('readonly projectileSpawn: ProjectileSpawnPort;');
    expect(enemyAbility).toContain('private readonly projectileSpawn: ProjectileSpawnPort');
  });

  it('keeps World consumers on narrow boundary capabilities instead of the concrete runtime', () => {
    const boundary = read('src/projectile/ProjectileBoundaryPorts.ts');
    const geometry = read('src/world/WorldGeometryBinding.ts');
    const train = read('src/world/WorldTrainRuntime.ts');
    const combat = read('src/world/WorldCombatGameplayBinding.ts');

    expect(boundary).toContain('export interface ProjectileGeometryBindingPort');
    expect(boundary).toContain('export interface ProjectileTrainBindingPort');
    expect(boundary).toContain('export interface ProjectileWorldImpactBindingPort');
    expect(boundary).toContain('export interface ProjectileLifecycleEventsBindingPort');
    expect(boundary).toContain('export interface ProjectileTimeFieldBindingPort');
    expect(boundary).toContain('export interface ProjectileHomingBindingPort');
    expect(boundary).toContain('export interface ProjectileSwarmReactionPort');

    for (const consumer of [geometry, train, combat]) {
      expect(consumer).not.toContain("from '../projectile/WorldProjectileRuntime'");
      expect(consumer).not.toContain("from '../../projectile/WorldProjectileRuntime'");
    }
    expect(geometry).toContain('ProjectileGeometryBindingPort');
    expect(geometry).toContain('projectileGeometry');
    expect(train).toContain('ProjectileTrainBindingPort');
    expect(train).toContain('projectileTrain');
    expect(combat).toContain('ProjectileLifecycleEventsBindingPort');
    expect(combat).toContain('ProjectileWorldImpactBindingPort');
    expect(combat).not.toContain('readonly projectileRuntime:');
    expect(combat).not.toContain('o.projectileRuntime.');
  });

  it('keeps one final homing/time-field seam and no presentation compatibility facade', () => {
    const homing = read('src/entities/ProjectileHomingController.ts');
    const runtime = read('src/projectile/WorldProjectileRuntime.ts');
    const boundary = read('src/projectile/ProjectileBoundaryPorts.ts');
    const seamSources = `${homing}\n${runtime}\n${boundary}`;

    for (const legacyMethod of [
      'setTargetProvider(', 'setLineOfFireChecker(', 'setTargetValidityChecker(',
      'setTimeBubbleFactorProvider(', 'setHomingTargetProvider(', 'setHomingLineOfFireChecker(',
    ]) expect(seamSources).not.toContain(legacyMethod);
    expect(boundary).toContain('setProjectileTimeFieldPort(');
    expect(boundary).toContain('setProjectileTargetQueryPort(');
    expect(boundary).toContain('setLineOfFireReadPort(');
    expect(existsSync(resolve(process.cwd(), 'src/projectile/ProjectilePresentationPort.ts'))).toBe(false);
  });

  it('keeps ProjectileImpactSource as a bounded stable DTO instead of a universal context', () => {
    const gameplay = read('src/projectile/ProjectileGameplayPort.ts');
    expect(gameplay).toContain('this DTO is not a');
    expect(gameplay).toContain('universal impact context');
  });

  it('keeps mutable Runtime records private to Projectile internals and the World owner', () => {
    const consumerPaths = [
      'src/world/WorldCombatGameplayBinding.ts',
      'src/world/WorldGeometryBinding.ts',
      'src/world/WorldTrainRuntime.ts',
      'src/scenes/arena/ArenaWorldGameplayComposition.ts',
      'src/scenes/arena/HostUpdateCoordinator.ts',
      'src/scenes/arena/RendererBundle.ts',
      'src/scenes/arena/ArenaRuntimeAdapters.ts',
    ];
    for (const path of consumerPaths) {
      expect(read(path), path).not.toContain('ProjectileRuntimeRecord');
    }

    const runtime = read('src/projectile/WorldProjectileRuntime.ts');
    const store = read('src/projectile/ProjectileStore.ts');
    const physics = read('src/projectile/ProjectilePhysicsBinding.ts');
    expect(runtime.match(/new ProjectileStore\(/g) ?? []).toHaveLength(1);
    expect(store).toContain('private readonly records: ProjectileRuntimeRecord[]');
    expect(physics).not.toContain('new ProjectileStore(');
  });

  it('keeps the final non-authoritative boundaries free of domain mutation ownership', () => {
    const replica = read('src/projectile/ProjectileClientReplica.ts');
    const presentation = read('src/projectile/ProjectilePresentationRuntime.ts');
    const replication = read('src/projectile/ProjectileReplicationAdapter.ts');

    for (const source of [replica, presentation, replication]) {
      expect(source).not.toContain('applyDamage');
      expect(source).not.toContain('resolveDirectImpact');
      expect(source).not.toContain('ProjectileRuntimeRecord');
    }
    expect(replica).toContain('Nichtautoritativer');
    expect(presentation).toContain('keine Gameplay-Entscheidung');
    expect(replication).toContain('liest nur die schmale Client-Projektion');
  });
});
