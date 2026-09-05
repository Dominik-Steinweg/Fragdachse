import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { WorldParticipation } from '../src/world/WorldParticipation';
import {
  WORLD_PRESENTATION_SURFACES,
  allowsWorldPresentationSurface,
  resolveWorldPresentation,
} from '../src/world/WorldPresentation';

/**
 * World Simulation und World Presentation sind getrennt.
 *
 * Ein Host kann eine Shared World autoritativ simulieren, ohne an ihr teilzunehmen – dann
 * entsteht bei ihm keine lokale World-Presentation. Und Presentation darf Simulation beobachten,
 * aber niemals deren Voraussetzung sein.
 */

const ALL_PARTICIPATIONS: readonly WorldParticipation[] =
  ['none', 'joining', 'interactive', 'observer', 'leaving'];

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('World Presentation – haengt an der Teilnahme, nicht an der Simulation', () => {
  it('erzeugt ohne Teilnahme keine einzige Darstellungsflaeche', () => {
    // Der Zielzustand aus dem Konzept: Shared World aktiv, Host simuliert, Host stellt nichts dar.
    const hostWithoutParticipation = resolveWorldPresentation({
      participation: 'none',
      worldActive: true,
    });
    expect(hostWithoutParticipation.required).toBe(false);
    expect(hostWithoutParticipation.surfaces).toEqual([]);
    for (const surface of WORLD_PRESENTATION_SURFACES) {
      expect(allowsWorldPresentationSurface(hostWithoutParticipation, surface), surface).toBe(false);
    }
  });

  it('gibt einem teilnehmenden Peer die vollen Flaechen', () => {
    for (const participation of ['interactive', 'observer', 'joining', 'leaving'] as const) {
      const requirement = resolveWorldPresentation({ participation, worldActive: true });
      expect(requirement.required, participation).toBe(true);
      // Auch wer nur zusieht oder noch laedt, braucht Terrain, Kamera und HUD.
      expect(requirement.surfaces, participation).toEqual(WORLD_PRESENTATION_SURFACES);
    }
  });

  it('stellt ohne laufende World-Instanz nichts dar', () => {
    for (const participation of ALL_PARTICIPATIONS) {
      const requirement = resolveWorldPresentation({ participation, worldActive: false });
      expect(requirement.required, participation).toBe(false);
      expect(requirement.surfaces, participation).toEqual([]);
    }
  });

  it('benennt die Flaechen, die eine World-Darstellung ausmachen', () => {
    // Die Liste ist der Vertrag: genau das darf ohne Teilnahme nicht entstehen.
    expect([...WORLD_PRESENTATION_SURFACES].sort()).toEqual([
      'aim', 'localPlayerVisuals', 'terrainSurfaces', 'worldCamera',
      'worldHud', 'worldOverlays', 'worldSprites',
    ]);
  });
});

describe('World Presentation – besitzt die Simulation nicht', () => {
  /** Module, die die autoritative Simulation tragen. */
  const SIMULATION_MODULES = [
    'src/systems/PlacementSystem.ts',
    'src/systems/CombatSystem.ts',
    'src/systems/HostPhysicsSystem.ts',
    'src/entities/PlayerManager.ts',
    'src/world/WorldRuntimeContext.ts',
    'src/world/WorldLifecycle.ts',
    'src/world/PlayerWorldRuntime.ts',
    'src/world/WorldParticipation.ts',
    'src/world/PlayerCapabilities.ts',
  ] as const;

  /** Verzeichnisse, die ausschliesslich Darstellung enthalten. */
  const PRESENTATION_PATHS = [/\/effects\//, /\/ui\//, /RendererBundle/, /\/scenes\//];

  it('laesst kein Simulationsmodul von Darstellung abhaengen', () => {
    for (const path of SIMULATION_MODULES) {
      const source = read(path);
      const imports = [...source.matchAll(/^import\s+(?!type\s)([\s\S]*?)from\s+'([^']+)'/gm)];
      for (const [, , specifier] of imports) {
        for (const presentation of PRESENTATION_PATHS) {
          expect(
            presentation.test(specifier),
            `${path} has a value dependency on presentation: ${specifier}`,
          ).toBe(false);
        }
      }
    }
  });

  it('haelt Darstellungssenken der Player-Runtime optional', () => {
    // `PlayerManager` ist Player Runtime. Sie darf Licht- und Brandeffekte bespielen, aber nicht
    // ohne sie unbrauchbar sein – sonst waere Presentation Voraussetzung der Simulation.
    const source = read('src/entities/PlayerManager.ts');
    expect(source).toContain('private lighting: LightingSystem | null = null;');
    expect(source).toContain('private burnGpu: EntityBurnGpuController | null = null;');
    expect(source).toContain('setLightingSystem(lighting: LightingSystem | null): void {');
    expect(source).toContain('setEntityBurnGpuController(controller: EntityBurnGpuController | null): void {');
  });

  it('fragt die Darstellungsentscheidung dort ab, wo sie hingehoert', () => {
    const coordinator = read('src/scenes/arena/ArenaLifecycleCoordinator.ts');
    const start = coordinator.indexOf('  getLocalWorldPresentation(): WorldPresentationRequirement {');
    expect(start, 'coordinator must resolve the local presentation').toBeGreaterThan(0);
    const body = coordinator.slice(start, coordinator.indexOf('\n  }', start));
    expect(body).toContain('participation: this.getWorldParticipation(bridge.getLocalPlayerId())');
    expect(body).toContain('worldActive: this.worldLifecycle.isActive()');

    // Die Weltkamera ist eine dieser Flaechen. Der Abgleich sitzt im world-scoped
    // Presentation-Frame-Owner, ueber den von der Scene durchgereichten Port.
    const frameBinding = read('src/world/WorldPresentationFrameBinding.ts');
    expect(frameBinding).toContain(
      "allowsWorldPresentationSurface(this.input.getLocalWorldPresentation(), 'worldCamera')",
    );
  });

  it('ordnet die generische Client-Projektion dem World-Presentation-Frame zu', () => {
    const scene = read('src/scenes/ArenaScene.ts');
    const runtime = read('src/scenes/arena/ArenaRuntime.ts');
    const frameBinding = read('src/world/WorldPresentationFrameBinding.ts');

    expect(scene).not.toContain('syncClientWorldSnapshotPresentation');
    expect(frameBinding).toContain('syncClientWorldPresentation(');
    expect(frameBinding).toContain('renderers.powerUp.sync(state.powerups);');
    expect(frameBinding).toContain('renderers.train?.render(');
    expect(runtime).toContain('presentationFrame?.syncClientWorldPresentation(');
  });

  it('trennt Projectile-Presentation von Host-Owner und Client-Replica', () => {
    const manager = read('src/entities/ProjectileManager.ts');
    const presentation = read('src/projectile/ProjectilePresentationRuntime.ts');
    const bundle = read('src/scenes/arena/RendererBundle.ts');
    const clientCoordinator = read('src/scenes/arena/ClientUpdateCoordinator.ts');

    const managerValueImports = [...manager.matchAll(/^import\s+(?!type\s)[\s\S]*?from\s+'([^']+)'/gm)]
      .map(([, specifier]) => specifier);
    expect(managerValueImports.some((specifier) => specifier.includes('/effects/'))).toBe(false);
    expect(manager).not.toMatch(/private (?:bullet|flame|bfg|tracer|muzzleFlash)Renderer/);
    expect(manager).not.toContain('private audioSystem');
    expect(presentation).not.toContain('TrackedProjectile');
    expect(presentation).not.toContain('ProjectileManager');
    expect(presentation).not.toContain('NetworkBridge');
    expect(bundle).toContain('pm.getPresentationRuntime().bindRenderers(');
    expect(bundle).not.toContain('pm.setBulletRenderer(');
    expect(clientCoordinator).toContain('getClientReplica().sync(state.projectiles)');
    expect(clientCoordinator).toContain('presentClientProjectileFrame(');
  });
});
