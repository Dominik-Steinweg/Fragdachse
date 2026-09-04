import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WorldTargetingRuntime } from '../../src/world/WorldTargetingRuntime';

/** Fachliche Schichten bleiben vom Modul-Singleton des Transports getrennt. */
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

/**
 * Übergangs-Allowlist für die noch nicht portierten Legacy-Systeme.
 * Sie darf schrumpfen, aber kein neuer direkter Consumer darf unbemerkt hinzukommen.
 */
const LEGACY_NETWORK_BRIDGE_CONSUMERS = new Set([
  'src/effects/EffectSystem.ts',
  'src/systems/BurrowSystem.ts',
  'src/systems/CombatSystem.ts',
  'src/systems/DecoySystem.ts',
  'src/systems/EnergyShieldSystem.ts',
  'src/systems/HostPhysicsSystem.ts',
  'src/systems/InputSystem.ts',
]);

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

describe('World gameplay composition – dauerhafte Grenzen', () => {
  it('hält fachliche Schichten frei vom Netzwerk-Singleton', () => {
    const offenders = DOMAIN_ROOTS
      .flatMap(listTypeScriptFiles)
      .filter((path) => read(path).includes("network/bridge'"));

    expect(offenders).toEqual([]);
  });

  it('begrenzt direkte NetworkBridge-Consumer auf die schrumpfbare Legacy-Allowlist', () => {
    const consumers = DOMAIN_ROOTS
      .flatMap(listTypeScriptFiles)
      .filter((path) => /import[^;]*\bNetworkBridge\b[^;]*from ['"][^'"]*network\/NetworkBridge['"]/.test(read(path)));

    expect(consumers.filter((path) => !LEGACY_NETWORK_BRIDGE_CONSUMERS.has(path))).toEqual([]);
  });

  it('hält World-Owner unabhängig von ArenaContext und Transport', () => {
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
    }
  });

  it('hält den WorldRuntimeContext frei von Activity- und Simulationszustand', () => {
    const source = read('src/world/WorldRuntimeContext.ts');
    const start = source.indexOf('export interface WorldRuntimeContext {');
    const end = source.indexOf('\n}', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const fields = [...source.slice(start, end).matchAll(/^ {2}readonly ([a-zA-Z][a-zA-Z0-9]*)[?]?:/gm)]
      .map((match) => match[1]);
    const forbidden = /enemy|boss|objective|mission|encounter|respawn|round|activity|spawnExecutor|director|powerUp/i;

    expect(fields.every((field) => !forbidden.test(field))).toBe(true);
  });

  it('trennt Player-Relationship- und Transport-Port fachlich', () => {
    const loadout = read('src/loadout/LoadoutManager.ts');
    const activation = read('src/world/PlayerWeaponActivationRuntime.ts');
    const ultimate = read('src/world/PlayerUltimateBehaviorRuntime.ts');
    const worldPlayer = read('src/world/WorldPlayerGameplayRuntime.ts');
    const relationship = read('src/world/PlayerRelationshipPort.ts');
    const networkPortStart = worldPlayer.indexOf('export interface WorldPlayerGameplayNetworkPort');
    const networkPortEnd = worldPlayer.indexOf('interface WorldPlayerGameplaySystems');

    expect(loadout).not.toContain('NetworkBridge');
    expect(activation).not.toContain('NetworkBridge');
    expect(ultimate).not.toContain('NetworkBridge');
    expect(worldPlayer).not.toContain('NetworkBridge');
    expect(networkPortStart).toBeGreaterThanOrEqual(0);
    expect(worldPlayer.slice(networkPortStart, networkPortEnd)).not.toMatch(/relationship/);
    expect(worldPlayer).toContain('PlayerRelationshipPort');
    expect(ultimate).toContain('PlayerRelationshipPort');
    expect(relationship).toContain('interface PlayerRelationshipPort');
  });

  it('hält Activity- und Homing-Bindings an der World-Combat-Grenze', () => {
    const combat = read('src/world/WorldCombatGameplayBinding.ts');
    const composition = read('src/scenes/arena/ArenaWorldCombatComposition.ts');
    const scene = read('src/scenes/ArenaScene.ts');

    expect(combat).toContain('readonly isCoopMission: () => boolean');
    expect(combat).toContain('updateActivityBindings(): void');
    expect(combat).toContain('clearActivityBindings(): void');
    expect(composition).toContain('isCoopMission: () => flow.isCoopMissionActivity()');
    expect(combat).toContain('setHomingTargetProvider');
    expect(composition).toContain('isHomingTargetValid:');
    expect(scene).not.toContain('setHomingTargetProvider');
    expect(scene).not.toContain('setHomingLineOfFireChecker');
    expect(scene).not.toContain('setHomingTargetValidityChecker');
  });

  it('führt Combat-Reaktionen über den typisierten Player-Combat-Port', () => {
    const integration = read('src/world/PlayerCombatIntegrationPort.ts');
    const combat = read('src/world/WorldCombatGameplayBinding.ts');

    expect(integration).toContain('export interface PlayerCombatReactionPort');
    expect(integration).toContain('readonly reactions: PlayerCombatReactionPort');
    expect(combat).toContain('playerCombat.reactions.handleDirectAk47EnemyHit');
    expect(combat).toContain('getPlayerCombatIntegration()?.reactions.handleEnemyDeath');
    expect(combat).not.toContain('.item.rollDirectPrimaryHitEffects');
    expect(combat).not.toContain('.item.handlePlayerDamageTaken');
  });

  it('räumt World-Target-Systeme am Owner-Teardown idempotent auf', () => {
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
