import { readdirSync, readFileSync } from 'node:fs';
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

/** Fachliche Runtime-/Domain-Schichten; ihr Netzwerkzugriff laeuft ueber Ports der Composition. */
const DOMAIN_ROOTS = [
  'src/activity',
  'src/effects',
  'src/entities',
  'src/loadout',
  'src/powerups',
  'src/systems',
  'src/train',
  'src/world',
];

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function listTypeScriptFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(resolve(process.cwd(), root), { withFileTypes: true })) {
    const path = `${root}/${entry.name}`;
    if (entry.isDirectory()) files.push(...listTypeScriptFiles(path));
    else if (entry.name.endsWith('.ts')) files.push(path);
  }
  return files;
}

describe('Phase 10B.6 – World gameplay composition', () => {
  it('keeps WorldTrainRuntime behind a fachlich grouped network port', () => {
    const train = read('src/world/WorldTrainRuntime.ts');
    expect(train).toContain('export interface WorldTrainNetworkPort');
    expect(train).not.toContain("from '../network/bridge'");
    expect(train).not.toContain('NetworkBridge');
    expect(train).not.toMatch(/\bbridge\b/);
  });

  it('keeps every domain layer free of the network bridge singleton module', () => {
    // Kein fachliches System importiert das Modul-Singleton `network/bridge`. Der Zugang zum
    // Transportsubstrat haengt ausschliesslich an den expliziten Composition-/Adapter-Grenzen.
    const offenders = DOMAIN_ROOTS
      .flatMap(listTypeScriptFiles)
      .filter((path) => read(path).includes("network/bridge'"));
    expect(offenders).toEqual([]);
  });

  it('pins the frozen set of legacy consumers that still take a concrete NetworkBridge', () => {
    // Die im Arena-Runtime-Refactor migrierten Owner-Grenzen nutzen kleine fachliche Ports und
    // kennen NetworkBridge nicht (siehe folgenden Contract). Aeltere Kernsysteme bekommen NetworkBridge
    // weiterhin per Constructor-Injection von der Composition-Grenze. Diese Menge ist bewusst
    // eingefroren: ein neuer Consumer muss hier sichtbar werden, statt das Muster still
    // auszuweiten, und ein wegportierter Consumer faellt hier ebenfalls auf.
    const concreteConsumers = DOMAIN_ROOTS
      .flatMap(listTypeScriptFiles)
      .filter((path) => (
        /import[^;]*\bNetworkBridge\b[^;]*from ['"][^'"]*network\/NetworkBridge['"]/.test(read(path))
      ))
      .sort();
    expect(concreteConsumers).toEqual([
      'src/effects/EffectSystem.ts',
      'src/systems/BurrowSystem.ts',
      'src/systems/CombatSystem.ts',
      'src/systems/DecoySystem.ts',
      'src/systems/EnergyShieldSystem.ts',
      'src/systems/HostPhysicsSystem.ts',
      'src/systems/InputSystem.ts',
    ]);
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

  it('keeps the Loadout/Ability core transport-agnostic and uses a domain relationship port', () => {
    const loadout = read('src/loadout/LoadoutManager.ts');
    const activation = read('src/world/PlayerWeaponActivationRuntime.ts');
    const ultimate = read('src/world/PlayerUltimateBehaviorRuntime.ts');
    const worldPlayer = read('src/world/WorldPlayerGameplayRuntime.ts');
    const relationship = read('src/world/PlayerRelationshipPort.ts');
    const worldPlayerNetworkPortStart = worldPlayer.indexOf('export interface WorldPlayerGameplayNetworkPort');
    const worldPlayerNetworkPortEnd = worldPlayer.indexOf('interface WorldPlayerGameplaySystems');
    const worldPlayerNetworkPort = worldPlayer.slice(worldPlayerNetworkPortStart, worldPlayerNetworkPortEnd);

    expect(loadout).not.toContain('NetworkBridge');
    expect(loadout).not.toContain('ShieldBuffSystem');
    expect(activation).not.toContain('NetworkBridge');
    expect(ultimate).not.toContain('NetworkBridge');
    expect(ultimate).not.toContain('PlayerUltimateBehaviorNetworkPort');
    expect(worldPlayer).not.toContain('NetworkBridge');
    expect(worldPlayerNetworkPort).not.toContain('relationship');
    expect(worldPlayer).not.toContain('network.teams');
    expect(ultimate).not.toContain('network.teams');
    expect(worldPlayer).toContain('PlayerRelationshipPort');
    expect(ultimate).toContain('PlayerRelationshipPort');
    expect(relationship).toContain('interface PlayerRelationshipPort');
  });

  it('binds relationship and ShieldBuff through separate semantic boundaries', () => {
    const playerComposition = read('src/scenes/arena/ArenaWorldPlayerComposition.ts');
    const combatComposition = read('src/scenes/arena/ArenaWorldCombatComposition.ts');
    const playerNetworkStart = playerComposition.indexOf('network: {');
    const relationshipStart = playerComposition.indexOf('relationship: {');

    expect(relationshipStart).toBeGreaterThanOrEqual(0);
    expect(playerNetworkStart).toBeGreaterThan(relationshipStart);
    expect(combatComposition).toContain('bindPlayerShieldBuffPort');
    expect(combatComposition).toContain('bindShieldBuffPort');
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
      'new WorldWeaponExecutionRuntime',
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
    expect(build).toContain('worldRuntime.bind(weaponExecution);');
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

  it('besitzt die Homing-Target-Aufloesung an der World-Combat-Grenze', () => {
    const combat = read('src/world/WorldCombatGameplayBinding.ts');
    const composition = read('src/scenes/arena/ArenaWorldCombatComposition.ts');
    const scene = read('src/scenes/ArenaScene.ts');
    for (const provider of [
      'setHomingTargetProvider',
      'setHomingLineOfFireChecker',
      'setHomingTargetValidityChecker',
    ]) {
      expect(combat, provider).toContain(provider);
      expect(scene, provider).not.toContain(provider);
    }
    expect(combat).toContain('o.playerManager.getAllPlayers()');
    expect(combat).toContain('o.decoySystem.getHostTargets()');
    expect(combat).toContain('o.getEnemyManager()?.getAllEnemies()');
    expect(combat).toContain("o.baseManager?.getBasesByFaction('hostile')");
    expect(combat).toContain('o.getPlayerCombatIntegration()?.state.isBurrowed');
    expect(combat).not.toContain('WorldPlayerGameplaySystems');
    expect(combat).not.toContain('getPlayerSystems');
    expect(combat).toContain('o.combatSystem.canDamageTarget');
    expect(combat).toContain('o.combatSystem.hasClearLineOfFire');
    expect(composition).toContain('isHomingTargetValid:');
    expect(composition).toContain('enemyAiTargetCatalog');
    expect(composition).toContain('getSpawnContext:');
    expect(combat).toContain('playerManager.setSpawnContextProvider(options.getSpawnContext)');
    expect(scene).not.toContain('setSpawnContextProvider(');
  });

  it('führt Combat-Reaktionen über den typisierten Player-Combat-Port aus', () => {
    const integration = read('src/world/PlayerCombatIntegrationPort.ts');
    const combat = read('src/world/WorldCombatGameplayBinding.ts');
    const runtime = read('src/world/WorldPlayerGameplayRuntime.ts');

    expect(integration).toContain('export interface PlayerCombatReactionPort');
    expect(integration).toContain('readonly reactions: PlayerCombatReactionPort');
    expect(combat).toContain('playerCombat.reactions.handleDirectAk47EnemyHit');
    expect(combat).toContain('o.getPlayerCombatIntegration()?.reactions.handleEnemyDeath');
    expect(combat).toContain('o.getPlayerCombatIntegration()?.reactions.handlePlayerDeath');
    expect(combat).toContain('o.getPlayerCombatIntegration()?.reactions.resolveProjectile');
    expect(combat).not.toContain('.item.rollDirectPrimaryHitEffects');
    expect(combat).not.toContain('.item.handlePlayerDamageTaken');
    expect(combat).not.toContain('.flamethrower');
    expect(combat).not.toContain('.weaponReaction');
    expect(combat).not.toContain('.negev');
    expect(runtime).toContain('reactions: {');
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
