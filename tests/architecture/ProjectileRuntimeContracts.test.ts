import { readFileSync } from 'node:fs';
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

  it('keeps Hydra split authority in the world owner with an explicit next-stage queue', () => {
    const binding = read('src/projectile/ProjectilePhysicsBinding.ts');
    const runtime = read('src/projectile/WorldProjectileRuntime.ts');

    expect(binding).not.toContain('trySplitHydraProjectile');
    expect(binding).toContain('queueHydraSplit');
    expect(runtime).toContain('pendingNextStageSpawns');
    expect(runtime).toContain('readyAfterCompletedStages');
  });

  it('routes Phaser world contacts through the World-owned interaction authority', () => {
    const binding = read('src/projectile/ProjectilePhysicsBinding.ts');
    const runtime = read('src/projectile/WorldProjectileRuntime.ts');
    const contactStageStart = binding.indexOf('private setupProjectileColliders');
    const contactStageEnd = binding.indexOf('private shouldUseContinuousRockCollision');
    const contactStage = binding.slice(contactStageStart, contactStageEnd);

    expect(binding).toContain('reportPhysicsContact');
    expect(binding).not.toContain('onRockHit');
    expect(binding).not.toContain('onBaseHit');
    expect(binding).not.toContain('onSupportImpact');
    expect(binding).not.toContain('onTrainHit');
    expect(contactStage).not.toContain('queueProjectileExplosion');
    expect(contactStage).not.toContain('applyBaseHit');
    expect(runtime).toContain('private reportPhysicsContact');
    expect(runtime).toContain('resolveRockPhysicsContact');
    expect(runtime).toContain('resolveBasePhysicsContact');
    expect(runtime).toContain('resolveTrainPhysicsContact');
  });

  it('uses one World candidate authority and keeps Physics independent of presentation style', () => {
    const processor = read('src/projectile/ProjectileCollisionProcessor.ts');
    const binding = read('src/projectile/ProjectilePhysicsBinding.ts');
    const runtime = read('src/projectile/WorldProjectileRuntime.ts');

    expect(processor).toContain('resolveWorldImpact');
    expect(processor).not.toContain("candidate.target.kind === 'projectile' ? 'ignored' : 'consumed'");
    expect(binding).not.toContain('cfg.projectileStyle ===');
    expect(runtime).toContain('resolvedWorldContacts');
    expect(runtime).toContain('projectileTargetPhysicalKey(candidate.target)');
  });

  it('keeps presentation, replica and replication state world-scoped', () => {
    const runtime = read('src/projectile/WorldProjectileRuntime.ts');
    const composition = read('src/scenes/arena/ArenaWorldCombatComposition.ts');
    const presentation = read('src/projectile/ProjectilePresentationRuntime.ts');

    expect(runtime).toContain('private readonly clientReplica = new ProjectileClientReplica();');
    expect(runtime).toContain('private projectileReplicationAdapter: ProjectileReplicationAdapter | null = null;');
    expect(runtime).toContain('readonly presentation: ProjectilePresentationRuntime;');
    expect(composition).toContain('const presentation = new ProjectilePresentationRuntime(input.scene);');
    expect(composition).toContain('physicsBinding: new ProjectilePhysicsBinding(input.scene, presentation)');
    expect(presentation).not.toContain('ProjectileRuntimeRecord');
    expect(presentation).not.toContain('ProjectilePhysicsBinding');
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
});
