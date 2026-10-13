import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({}));
vi.mock('../src/effects/EffectUtils', () => ({ registerGraphicsObject: vi.fn() }));
vi.mock('../src/scenes/arena/TunnelEndpointVisual', () => ({
  TUNNEL_HOLE_DIAMETER: 32, TUNNEL_VISUAL_DEPTH: 1, TunnelEndpointVisual: class {},
}));
const previewVisual = vi.hoisted(() => ({ update: vi.fn(), hide: vi.fn(), destroy: vi.fn() }));
vi.mock('../src/effects/fireControl/FireControlPlacementPreviewVisual', () => ({
  FireControlPlacementPreviewVisual: vi.fn(() => previewVisual),
}));
vi.mock('../src/network/bridge', () => ({ bridge: {
  isHost: vi.fn(() => false),
  getConnectedPlayerIds: vi.fn(() => ['local', 'ally']),
  getLocalPlayerId: () => 'local',
  getLatestGameState: vi.fn(() => ({ players: { ally: { turretControl: { turretId: 7, revision: 1 } } } })),
} }));

import { bridge } from '../src/network/bridge';
import { createArenaPlacementPorts } from '../src/scenes/arena/ArenaRuntimeAdapters';
import { PlacementPreviewRenderer } from '../src/scenes/arena/PlacementPreviewRenderer';
import { ArenaInputBindings } from '../src/scenes/arena/ArenaInputBindings';
import { resolveConstructionPlacementRange } from '../src/config/coopDefenseConstructions';
import { UTILITY_CONFIGS, WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import type { FireControlPlacementPreview } from '../src/types';

describe('fire control preview reads', () => {
  it.each([false, true])('joins local runtime rocks with carrier-filtered definitions and occupancy (host=%s)', host => {
    vi.mocked(bridge.isHost).mockReturnValue(host);
    const rock = { id: 7, ownerId: 'local', constructionId: 'machine_gun_turret', hp: 10, ownership: 'player-owned' };
    const turret = { id: 7, x: 80, y: 90, weaponId: 'TURRET_MG' };
    const ports = createArenaPlacementPorts({
      getWorldRuntime: () => ({ materialization: { placement: { getRuntimeRock: () => rock } } }),
      getWorldCombatGameplayBinding: () => ({ getTurretDefinitions: () => [turret, { ...turret, id: 'base:1' }] }),
      getWorldPlayerGameplayRuntime: () => ({ getTurretControlState: (id: string) => id === 'ally' ? { turretId: 7 } : undefined }),
      getWorldParticipation: () => 'interactive',
      getPlayerCapabilities: () => ({ canUseCombat: true }),
    } as never);
    expect(ports.getFireControlConstructions()).toEqual([{ id: 7, ownerId: 'local', baseOwned: false,
      constructionId: rock.constructionId, weaponId: turret.weaponId, weaponFireType: WEAPON_CONFIGS.TURRET_MG.fire.type,
      combatReady: true, manned: true, x: turret.x, y: turret.y }]);
    rock.hp = 0;
    expect(ports.getFireControlConstructions()[0].combatReady).toBe(false);
    rock.ownership = 'base-owned';
    expect(ports.getFireControlConstructions()[0].baseOwned).toBe(true);
  });

  it('produces a valid non-host copy preview without a construction runtime', () => {
    vi.mocked(bridge.isHost).mockReturnValue(false);
    const range = resolveConstructionPlacementRange();
    const rock = { id: 8, ownerId: 'local', constructionId: 'machine_gun_turret', hp: 10, ownership: 'player-owned' };
    const ports = createArenaPlacementPorts({
      getConstructionWorldRuntime: () => null,
      getWorldRuntime: () => ({ materialization: { placement: { getRuntimeRock: () => rock } } }),
      getWorldCombatGameplayBinding: () => ({ getTurretDefinitions: () => [{ id: rock.id, x: 80, y: 90, weaponId: 'TURRET_MG' }] }),
      getWorldParticipation: () => 'interactive',
      getPlayerCapabilities: () => ({ canUseCombat: true }),
      getWorldGeometryBinding: () => ({ getQueries: () => ({ resolveSafeGroundPoint: (x: number, y: number) => ({ x, y }) }) }),
    } as never);
    let pointerX = range;
    const bindings = new ArenaInputBindings({
      inputSystem: { isUtilityPlacementActive: () => true },
      actions: {
        getLocalPlayerId: () => 'local', getLocalPlayerPosition: () => ({ x: 0, y: 0 }),
        getLocalUtilityConfig: () => UTILITY_CONFIGS.FIRE_CONTROL_RELAY,
        getPointerWorldPoint: () => ({ x: pointerX, y: 0 }), getLocalInspectorTools: () => [], placement: ports,
      },
    } as never);
    expect(bindings.getLocalPlacementPreview()).toMatchObject({
      kind: 'fire_control_relay', valid: true, rangePx: range, originals: [{ id: rock.id }],
      ghosts: [{ constructionId: rock.constructionId }],
    });
    pointerX = range + .01;
    expect(bindings.getLocalPlacementPreview()).toMatchObject({ valid: false, reason: 'range', rangePx: range });
  });

  it('rejects missing geometry and any displaced safe point, forwarding clearance', () => {
    const resolveSafeGroundPoint = vi.fn((x: number, y: number, _radius: number) => ({ x, y }));
    const ports = createArenaPlacementPorts({
      getWorldGeometryBinding: () => ({ getQueries: () => ({ resolveSafeGroundPoint }) }),
    } as never);
    expect(ports.isFireControlPointFree(80, 90, 16)).toBe(true);
    expect(resolveSafeGroundPoint).toHaveBeenCalledWith(80, 90, 16);
    resolveSafeGroundPoint.mockReturnValue({ x: 80.001, y: 90 });
    expect(ports.isFireControlPointFree(80, 90, 16)).toBe(false);
    const unavailable = createArenaPlacementPorts({ getWorldGeometryBinding: () => null } as never);
    expect(unavailable.isFireControlPointFree(80, 90, 16)).toBe(false);
  });
});

describe('fire control placement preview rendering', () => {
  const setup = () => {
    const objects: Record<string, ReturnType<typeof vi.fn>>[] = [];
    const makeObject = () => {
      const object: Record<string, ReturnType<typeof vi.fn>> = {};
      for (const method of ['setDepth', 'setOrigin', 'setScrollFactor', 'setVisible', 'setStrokeStyle', 'setText',
        'clear', 'lineStyle', 'strokeCircle', 'strokeRect', 'destroy']) object[method] = vi.fn(() => object);
      objects.push(object);
      return object;
    };
    const scene = { add: { graphics: vi.fn(makeObject), text: vi.fn(makeObject), rectangle: vi.fn(makeObject),
      container: vi.fn(makeObject), image: vi.fn() }, time: { now: 0 } };
    const renderer = new PlacementPreviewRenderer(scene as never, {} as never);
    const [range, , invalid] = objects;
    vi.clearAllMocks();
    return { renderer, range, invalid, objects };
  };
  const preview: FireControlPlacementPreview = { kind: 'fire_control_relay', valid: true,
    playerX: 20, playerY: 30, pointX: 80, pointY: 90, rangePx: 240,
    originals: [{ id: 7, x: 10, y: 15 }], ghosts: [{ x: 100, y: 110, constructionId: 'machine_gun_turret', weaponId: 'TURRET_MG' }] };

  it('hands the preview to the visual and rings the placement range around the player', () => {
    const { renderer, range, invalid } = setup();
    renderer.renderPlacementPreview(true, preview, true, false);
    expect(previewVisual.update).toHaveBeenCalledWith(preview, 0, expect.any(Number));
    expect(range.strokeCircle).toHaveBeenCalledWith(20, 30, preview.rangePx);
    expect(invalid.strokeCircle).not.toHaveBeenCalled();
  });

  it('marks rejected placements at the cursor and reddens the range only for range failures', () => {
    const { renderer, range, invalid } = setup();
    renderer.renderPlacementPreview(true, preview, true, false);
    const validColor = range.lineStyle.mock.lastCall![1];
    renderer.renderPlacementPreview(true, { ...preview, valid: false, reason: 'placement' }, true, false);
    expect(range.lineStyle.mock.lastCall![1]).toBe(validColor);
    expect(invalid.strokeCircle).toHaveBeenCalledWith(80, 90, expect.any(Number));
    renderer.renderPlacementPreview(true, { ...preview, valid: false, reason: 'range' }, true, false);
    expect(range.lineStyle.mock.lastCall![1]).not.toBe(validColor);
  });

  it('hides the visual and clears the rings on cancellation', () => {
    const { renderer, range } = setup();
    renderer.renderPlacementPreview(true, preview, true, false);
    range.strokeCircle.mockClear();
    renderer.renderPlacementPreview(true, undefined, true, false);
    expect(previewVisual.hide).toHaveBeenCalled();
    expect(range.clear).toHaveBeenCalled();
    expect(range.strokeCircle).not.toHaveBeenCalled();
  });
});
