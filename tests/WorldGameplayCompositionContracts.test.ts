import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WorldTargetingRuntime } from '../src/world/WorldTargetingRuntime';

const NEWLINE = String.fromCharCode(10);
const COMPOSITION_PATHS = [
  'src/scenes/arena/ArenaWorldGameplayComposition.ts',
  'src/scenes/arena/ArenaWorldEnvironmentComposition.ts',
  'src/scenes/arena/ArenaWorldPlayerComposition.ts',
  'src/scenes/arena/ArenaWorldCombatComposition.ts',
  'src/scenes/arena/ArenaWorldConstructionComposition.ts',
];

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('Phase 10B.6 – World gameplay composition', () => {
  it('keeps WorldTrainRuntime behind a fachlich grouped network port', () => {
    const train = read('src/world/WorldTrainRuntime.ts');
    expect(train).toContain('export interface WorldTrainNetworkPort');
    expect(train).not.toContain("from '../network/bridge'");
    expect(train).not.toContain('NetworkBridge');
    expect(train).not.toMatch(/\bbridge\b/);
  });

  it('keeps new World owners independent from ArenaContext and the network bridge', () => {
    for (const path of [
      'src/world/WorldTargetingRuntime.ts',
      'src/world/WorldPlayerGameplayRuntime.ts',
      'src/world/WorldCombatGameplayBinding.ts',
      'src/world/WorldSupportGameplayRuntime.ts',
      'src/activity/CaptureTheBeerActivityRuntime.ts',
    ]) {
      const source = read(path);
      expect(source, path).not.toContain('ArenaContext');
      expect(source, path).not.toContain('NetworkBridge');
      expect(source, path).not.toMatch(/from ['"].*network\/bridge['"]/);
      expect(source, path).not.toMatch(/\bbridge\b/);
    }
  });

  it('leaves the remaining World gameplay graph to focused owners', () => {
    const coordinator = read('src/scenes/arena/ArenaLifecycleCoordinator.ts');
    // Phase 10C: Der konkrete Graph entsteht an der World-Gameplay-Composition-Grenze; der Flow
    // ruft sie genau einmal und kennt weder Owner-Konstruktoren noch ihre Verdrahtung.
    const build = COMPOSITION_PATHS.map(read).join(NEWLINE);
    const buildCall = coordinator.indexOf('composeArenaWorldGameplay({');
    expect(buildCall).toBeGreaterThan(0);
    for (const owner of [
      'new WorldGeometryBinding',
      'new WorldTargetingRuntime',
      'new WorldTrainRuntime',
      'new WorldPlayerGameplayRuntime',
      'new WorldCombatGameplayBinding',
      'new WorldPowerUpRuntime',
      'new ConstructionWorldRuntime',
      'new WorldSupportGameplayRuntime',
      'new PersistentBaseWorldMaterializer',
    ]) {
      expect(coordinator, `${owner} leaked back into the flow`).not.toContain(owner);
      expect(build, owner).toContain(owner);
    }
    for (const legacyConstructor of [
      'new ReinforcementMatrixSystem',
      'new EnergyInjectorSystem',
      'new TargetStatusSystem',
      'new ResourceSystem',
      'new TeslaDomeSystem',
      'new TurretSystem',
      'new DetonationSystem',
      'new ArmageddonSystem',
      'new AirstrikeSystem',
      'new GuardianSpiritSystem',
      'new RepairDroneSystem',
      'new SlimeTrailSystem',
      'new FlamethrowerUpgradeSystem',
      'new WeaponUpgradeSystem',
      'new Ak47StrategicTargetSystem',
    ]) {
      expect(build, legacyConstructor).not.toContain(legacyConstructor);
    }
    expect(build).toContain('worldRuntime.bind(playerGameplayRuntime);');
    expect(build).toContain('worldRuntime.bind(combatGameplayBinding);');
    expect(build).toContain('worldRuntime.bind(supportGameplayRuntime);');
    expect(build).not.toContain('new CaptureTheBeerSystem');

    const teardownStart = coordinator.indexOf('\n  tearDownArena(');
    const teardownEnd = coordinator.indexOf('\n  private ', teardownStart);
    expect(teardownStart).toBeGreaterThan(0);
    const teardown = coordinator.slice(teardownStart, teardownEnd);
    for (const migratedCleanup of [
      'this.ctx.combatSystem.set',
      'this.ctx.projectileManager.set',
      'this.ctx.decoySystem.set',
      'this.ctx.decoySystem.clearAll',
      'this.ctx.timeBubbleSystem?.destroyAll',
      'this.ctx.resourceSystem?.',
      'this.ctx.loadoutManager?.',
      'this.ctx.translocatorSystem?.',
      'this.ctx.tunnelSystem?.',
      'this.ctx.detonationSystem?.',
      'this.ctx.armageddonSystem?.',
      'this.ctx.airstrikeSystem?.',
    ]) {
      expect(teardown, migratedCleanup).not.toContain(migratedCleanup);
    }
  });

  it('liest den Coop-Activity-State dynamisch und besitzt das Barrier-Projection-API', () => {
    const combat = read('src/world/WorldCombatGameplayBinding.ts');
    const coordinator = read('src/scenes/arena/ArenaLifecycleCoordinator.ts');
    const composition = COMPOSITION_PATHS.map(read).join(NEWLINE);
    expect(combat).not.toContain('readonly isCoopMission: boolean');
    expect(combat).toContain('readonly isCoopMission: () => boolean');
    expect(combat).toContain('updateActivityBindings(): void');
    expect(combat).toContain('clearActivityBindings(): void');
    // Die Composition fragt den Flow nach der laufenden Activity; der Flow selbst beantwortet sie
    // aus dem Activity-Lifecycle und materialisiert dafuer kein Kampfsystem.
    expect(composition).toContain('isCoopMission: () => flow.isCoopMissionActivity()');
    expect(coordinator).toContain('isCoopMissionActivity: () => this.worldLifecycle.activity.is(\'coop-mission\')');
    expect(coordinator).toContain('this.worldCombatGameplayBinding?.updateActivityBindings()');
    expect(coordinator).toContain('this.worldCombatGameplayBinding?.clearActivityBindings()');
  });

  it('clears target systems exactly at World-owner teardown', () => {
    const runtime = new WorldTargetingRuntime();

    runtime.systems.reinforcementMatrix.spawnMatrix('p1', 0, 0, 20, 1_000, 0.2, 0.1, 0xffffff, 0);
    runtime.systems.energyInjector.setFocusTarget('p1', { targetType: 'enemy', targetId: 'e1' }, 1_000, 0);
    runtime.systems.targetStatus.applyVulnerability({ targetType: 'enemy', targetId: 'e1' }, 1_000, 0);

    expect(runtime.systems.reinforcementMatrix.getNetSnapshot()).toHaveLength(1);
    expect(runtime.systems.energyInjector.getNetFocusSnapshot(0)).toHaveLength(1);
    expect(runtime.systems.targetStatus.getSnapshot(0)).toHaveLength(1);

    runtime.destroy();
    runtime.destroy();

    expect(runtime.systems.reinforcementMatrix.getNetSnapshot()).toHaveLength(0);
    expect(runtime.systems.energyInjector.getNetFocusSnapshot(0)).toHaveLength(0);
    expect(runtime.systems.targetStatus.getSnapshot(0)).toHaveLength(0);
  });
});
