import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => {
  class Rectangle {
    constructor(
      public x = 0,
      public y = 0,
      public width = 0,
      public height = 0,
    ) {}

    get left(): number { return this.x; }
    get right(): number { return this.x + this.width; }
    get top(): number { return this.y; }
    get bottom(): number { return this.y + this.height; }
    get centerX(): number { return this.x + this.width / 2; }
    get centerY(): number { return this.y + this.height / 2; }
  }

  return {
    Geom: { Rectangle },
    Math: { Clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)) },
  };
});

import { GROUND_FIRE_CELL_SIZE } from '../src/effects/FireSystem';
import { ARENA_MAP_GRID_CHANGED_EVENT } from '../src/scenes/arena/ArenaEvents';
import { WorldGeometryBinding, type WorldGeometryBindingInput } from '../src/world/WorldGeometryBinding';

const CELL = 64;

type GroundBlockedResolver = ((bounds: { centerX: number; centerY: number }) => boolean) | null;

/**
 * Die scene-langlebigen Geometrie-Consumer.
 *
 * Genau diese Objekte ueberleben jeden World-Wechsel, deshalb teilen World A und World B sie sich
 * im Test so, wie sie es zur Laufzeit tun.
 */
function createSceneScopedCollaborators() {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const scene = {
    physics: { world: { setBounds: vi.fn() } },
    game: {
      events: {
        on(name: string, callback: (event: unknown) => void) {
          if (!listeners.has(name)) listeners.set(name, new Set());
          listeners.get(name)!.add(callback);
        },
        off(name: string, callback: (event: unknown) => void) {
          listeners.get(name)?.delete(callback);
        },
      },
    },
  };

  const fire = {
    groundBlocked: null as GroundBlockedResolver,
    setGroundResolversCalls: 0,
    setGroundResolvers(blocked: GroundBlockedResolver) {
      this.groundBlocked = blocked;
      this.setGroundResolversCalls += 1;
    },
  };

  const playerManager = {
    worldGeometry: undefined as unknown,
    layout: undefined as unknown,
    setVisualsEnabledResolver: vi.fn(),
    setWorldGeometry(value: unknown) { this.worldGeometry = value; },
    setLayout(value: unknown) { this.layout = value; },
  };

  const combatSystem = {
    worldMetrics: undefined as unknown,
    arenaObstacles: undefined as unknown,
    baseManager: undefined as unknown,
    setWorldMetrics(value: unknown) { this.worldMetrics = value; },
    setArenaObstacles(rocks: unknown, trunks: unknown) { this.arenaObstacles = [rocks, trunks]; },
    setBaseObstacles: vi.fn(),
    setBaseManager(value: unknown) { this.baseManager = value; },
    getObstacleIndex: () => ({}),
  };

  const decoySystem = {
    worldMetrics: undefined as unknown,
    setWorldMetrics(value: unknown) { this.worldMetrics = value; },
    setObstacleGroups: vi.fn(),
  };

  const projectileRuntime = {
    rockGroup: undefined as unknown,
    setRockGroup(value: unknown) { this.rockGroup = value; },
    setBaseGroup: vi.fn(),
    setObstacleIndex: vi.fn(),
  };

  const hostPhysics = {
    worldMetrics: undefined as unknown,
    movementBlockedResolver: null as ((gridX: number, gridY: number) => boolean) | null,
    setRockGroup: vi.fn(),
    setBaseGroup: vi.fn(),
    setWorldMetrics(value: unknown) { this.worldMetrics = value; },
    setMovementBlockedCellResolver(value: ((gridX: number, gridY: number) => boolean) | null) {
      this.movementBlockedResolver = value;
    },
  };

  const leafBlower = {
    layout: undefined as unknown,
    setTerrainMaterialLayout(value: unknown) { this.layout = value; },
  };

  const lighting = {
    occluderIndex: undefined as unknown,
    setOccluderIndex(value: unknown) { this.occluderIndex = value; },
  };

  return {
    listeners,
    scene,
    fire,
    playerManager,
    combatSystem,
    decoySystem,
    projectileRuntime,
    hostPhysics,
    leafBlower,
    lighting,
    emitGridChange(event: Record<string, unknown>): void {
      for (const listener of [...(listeners.get(ARENA_MAP_GRID_CHANGED_EVENT) ?? [])]) listener(event);
    },
  };
}

type SceneScoped = ReturnType<typeof createSceneScopedCollaborators>;

/** Baut ein Binding fuer eine World, deren einziger Fels auf `rockCell` liegt. */
function createBinding(
  shared: SceneScoped,
  rockCell: { gridX: number; gridY: number } | null,
  onDestroy?: (binding: WorldGeometryBinding) => void,
): WorldGeometryBinding {
  const rockBounds = rockCell
    ? {
      left: rockCell.gridX * CELL,
      top: rockCell.gridY * CELL,
      right: (rockCell.gridX + 1) * CELL,
      bottom: (rockCell.gridY + 1) * CELL,
    }
    : null;
  const rockProxy = rockBounds ? { active: true, getBounds: () => rockBounds } : null;

  const input = {
    scene: shared.scene,
    world: {
      definition: null,
      metrics: { offsetX: 0, offsetY: 0, widthPx: 640, heightPx: 640 },
    },
    layout: [],
    bases: [],
    arena: {
      rockGroup: {},
      trunkGroup: {},
      trunkBodies: [],
      rockPhysicsProxies: rockProxy ? [rockProxy] : [],
      rockGrid: {
        getIndex: (gridX: number, gridY: number) => (
          rockCell && gridX === rockCell.gridX && gridY === rockCell.gridY ? 0 : -1
        ),
      },
    },
    placement: { getAllRuntimeRocks: () => [] },
    baseManager: null,
    presentationRequired: true,
    playerManager: shared.playerManager,
    combatSystem: shared.combatSystem,
    decoySystem: shared.decoySystem,
    projectileRuntime: shared.projectileRuntime,
    hostPhysics: shared.hostPhysics,
    fireSystem: shared.fire,
    leafBlower: shared.leafBlower,
    lighting: shared.lighting,
    isCaptureTheBeer: false,
    getBarrierCellBlocked: () => false,
    ...(onDestroy ? { onDestroy } : {}),
  } as unknown as WorldGeometryBindingInput;

  return new WorldGeometryBinding(input);
}

/** Fragt den aktuell installierten Brandhindernis-Resolver fuer eine World-Zelle. */
function isFireCellBlocked(shared: SceneScoped, gridX: number, gridY: number): boolean {
  const resolver = shared.fire.groundBlocked;
  if (!resolver) return false;
  return resolver({
    centerX: gridX * CELL + GROUND_FIRE_CELL_SIZE * 0.5,
    centerY: gridY * CELL + GROUND_FIRE_CELL_SIZE * 0.5,
  });
}

describe('WorldGeometryBinding – Lifetime-Symmetrie', () => {
  it('installiert die World-Sicht der scene-langlebigen Consumer', () => {
    const shared = createSceneScopedCollaborators();
    createBinding(shared, { gridX: 2, gridY: 2 });

    expect(shared.playerManager.worldGeometry).not.toBeNull();
    expect(shared.combatSystem.worldMetrics).not.toBeNull();
    expect(shared.decoySystem.worldMetrics).not.toBeNull();
    expect(shared.hostPhysics.worldMetrics).not.toBeNull();
    expect(shared.hostPhysics.movementBlockedResolver).not.toBeNull();
    expect(shared.leafBlower.layout).not.toBeNull();
    expect(shared.listeners.get(ARENA_MAP_GRID_CHANGED_EVENT)?.size).toBe(1);
    // Der Fels dieser World steht im Brandhindernisindex.
    expect(isFireCellBlocked(shared, 2, 2)).toBe(true);
    expect(shared.hostPhysics.movementBlockedResolver?.(2, 2)).toBe(true);
  });

  it('loest beim destroy() jede installierte Referenz wieder auf', () => {
    const shared = createSceneScopedCollaborators();
    const destroyed: WorldGeometryBinding[] = [];
    const binding = createBinding(shared, { gridX: 2, gridY: 2 }, (value) => { destroyed.push(value); });

    binding.destroy();

    expect(shared.playerManager.worldGeometry).toBeNull();
    expect(shared.combatSystem.worldMetrics).toBeNull();
    expect(shared.combatSystem.baseManager).toBeNull();
    expect(shared.decoySystem.worldMetrics).toBeNull();
    expect(shared.hostPhysics.worldMetrics).toBeNull();
    expect(shared.hostPhysics.movementBlockedResolver).toBeNull();
    expect(shared.leafBlower.layout).toBeNull();
    expect(shared.lighting.occluderIndex).toBeNull();
    expect(shared.fire.groundBlocked).toBeNull();
    expect(shared.listeners.get(ARENA_MAP_GRID_CHANGED_EVENT)?.size).toBe(0);
    expect(destroyed).toEqual([binding]);
  });

  it('ist idempotent und meldet den Teardown genau einmal', () => {
    const shared = createSceneScopedCollaborators();
    const destroyed: WorldGeometryBinding[] = [];
    const binding = createBinding(shared, { gridX: 2, gridY: 2 }, (value) => { destroyed.push(value); });

    binding.destroy();
    const resolverCallsAfterFirstDestroy = shared.fire.setGroundResolversCalls;
    expect(() => { binding.destroy(); }).not.toThrow();

    expect(destroyed).toEqual([binding]);
    expect(shared.fire.setGroundResolversCalls).toBe(resolverCallsAfterFirstDestroy);
  });

  it('laesst ein zerstoertes Binding die naechste World nicht mehr beeinflussen', () => {
    const shared = createSceneScopedCollaborators();
    const worldA = createBinding(shared, { gridX: 2, gridY: 2 });
    worldA.destroy();

    // World B kennt den Fels von A nicht.
    const worldB = createBinding(shared, { gridX: 7, gridY: 7 });
    expect(isFireCellBlocked(shared, 7, 7)).toBe(true);
    expect(isFireCellBlocked(shared, 2, 2)).toBe(false);
    expect(shared.hostPhysics.movementBlockedResolver?.(2, 2)).toBe(false);
    expect(shared.listeners.get(ARENA_MAP_GRID_CHANGED_EVENT)?.size).toBe(1);

    // Ein spaeter destroy()/setBase() von A raeumt B weder die Resolver noch den Listener weg.
    worldA.destroy();
    worldA.setBase('base-a', []);
    worldA.syncBaseObstacles();
    worldA.attachLightOccluders({ setLightOccluders: vi.fn() } as never, () => null);

    expect(shared.fire.groundBlocked).not.toBeNull();
    expect(isFireCellBlocked(shared, 7, 7)).toBe(true);
    expect(shared.hostPhysics.movementBlockedResolver?.(7, 7)).toBe(true);
    expect(shared.listeners.get(ARENA_MAP_GRID_CHANGED_EVENT)?.size).toBe(1);

    // Und das Grid-Event erreicht nur noch das lebende Binding.
    shared.emitGridChange({ reason: 'static_rock_destroyed', source: 'static_rock', obstacleId: 0 });
    expect(isFireCellBlocked(shared, 7, 7)).toBe(false);

    worldB.destroy();
    expect(shared.fire.groundBlocked).toBeNull();
    expect(shared.listeners.get(ARENA_MAP_GRID_CHANGED_EVENT)?.size).toBe(0);
  });

  it('laesst ein totes Binding den Occluder-Index der naechsten World nicht auf null setzen', () => {
    const shared = createSceneScopedCollaborators();

    const worldA = createBinding(shared, { gridX: 2, gridY: 2 });
    worldA.destroy();

    // World B installiert ihren eigenen scene-langlebigen Occluder-Index.
    const worldB = createBinding(shared, { gridX: 7, gridY: 7 });
    const materializationB = { setLightOccluders: vi.fn() };
    const indexB = worldB.attachLightOccluders(materializationB as never, () => null);
    expect(indexB).not.toBeNull();
    expect(shared.lighting.occluderIndex).toBe(indexB);
    expect(materializationB.setLightOccluders).toHaveBeenLastCalledWith(indexB);

    // Staler Aufruf auf dem toten Binding A darf Bs Index nicht mehr zuruecksetzen.
    const materializationA = { setLightOccluders: vi.fn() };
    expect(worldA.attachLightOccluders(materializationA as never, () => null)).toBeNull();

    expect(shared.lighting.occluderIndex).toBe(indexB);
    expect(materializationA.setLightOccluders).not.toHaveBeenCalled();
    expect(materializationB.setLightOccluders).toHaveBeenCalledTimes(1);

    // World B bleibt vollstaendig intakt.
    expect(isFireCellBlocked(shared, 7, 7)).toBe(true);
    expect(shared.hostPhysics.movementBlockedResolver?.(7, 7)).toBe(true);
    expect(shared.listeners.get(ARENA_MAP_GRID_CHANGED_EVENT)?.size).toBe(1);

    worldB.destroy();
    expect(shared.lighting.occluderIndex).toBeNull();
  });
});
