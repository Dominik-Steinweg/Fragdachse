import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WorldTargetingRuntime } from '../../src/world/WorldTargetingRuntime';

/** Dauerhafte Layer-Grenzen; die Legacy-Ausnahme bleibt bewusst schrumpfbar. */
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

const WORLD_ACTIVITY_ROOTS = ['src/activity', 'src/world'];

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
  it('hält Domain-Schichten vom Transport-Singleton und World-Owner vom Scene-Context frei', () => {
    const domainFiles = DOMAIN_ROOTS.flatMap(listTypeScriptFiles);
    const singletonOffenders = domainFiles
      .filter((path) => /from ['"][^'"]*network\/bridge['"]/.test(read(path)));

    expect(singletonOffenders).toEqual([]);

    const ownerOffenders = WORLD_ACTIVITY_ROOTS
      .flatMap(listTypeScriptFiles)
      .filter((path) => /from ['"][^'"]*(?:ArenaContext|NetworkBridge|network\/bridge)['"]/.test(read(path)));

    expect(ownerOffenders).toEqual([]);
  });

  it('begrenzt direkte NetworkBridge-Consumer auf die schrumpfbare Legacy-Allowlist', () => {
    const consumers = DOMAIN_ROOTS
      .flatMap(listTypeScriptFiles)
      .filter((path) => /import[^;]*\bNetworkBridge\b[^;]*from ['"][^'"]*network\/NetworkBridge['"]/.test(read(path)));

    expect(consumers.filter((path) => !LEGACY_NETWORK_BRIDGE_CONSUMERS.has(path))).toEqual([]);
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

  it('hält den Player-Relationship-Port aus dem Transport-Port heraus', () => {
    const source = read('src/world/WorldPlayerGameplayRuntime.ts');
    const networkPort = source.match(
      /export interface WorldPlayerGameplayNetworkPort \{[\s\S]*?\n\}/,
    )?.[0] ?? '';

    expect(networkPort).not.toMatch(/\brelationship\b/i);
  });

  it('lässt niedrigstufige Homing-Bindings außerhalb der ArenaScene', () => {
    const scene = read('src/scenes/ArenaScene.ts');

    expect(scene).not.toMatch(/\.\s*setHoming[A-Z]\w*\s*\(/);
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
