import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({}));
vi.mock('../src/effects/EffectUtils', () => ({ registerGraphicsObject: vi.fn() }));
vi.mock('../src/scenes/arena/TunnelEndpointVisual', () => ({
  TUNNEL_HOLE_DIAMETER: 32, TUNNEL_VISUAL_DEPTH: 1, TunnelEndpointVisual: class {},
}));
vi.mock('../src/network/bridge', () => ({ bridge: {
  isHost: vi.fn(() => false),
  getConnectedPlayerIds: vi.fn(() => ['local', 'ally']),
  getLatestGameState: vi.fn(() => ({ players: { ally: { turretControl: { turretId: 7, revision: 1 } } } })),
} }));

import { bridge } from '../src/network/bridge';
import { createArenaPlacementPorts } from '../src/scenes/arena/ArenaRuntimeAdapters';
import { PlacementPreviewRenderer } from '../src/scenes/arena/PlacementPreviewRenderer';
import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
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

describe('fire control placeholder rendering', () => {
  it('draws the data geometry without sprites, distinguishes failure and clears on cancellation', () => {
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
    const preview: FireControlPlacementPreview = { kind: 'fire_control_relay', valid: true,
      playerX: 20, playerY: 30, pointX: 80, pointY: 90, rangePx: 240,
      originals: [{ id: 7, x: 10, y: 15 }], ghosts: [{ x: 100, y: 110, constructionId: 'machine_gun_turret', weaponId: 'TURRET_MG' }] };
    const range = objects[0];
    renderer.renderPlacementPreview(true, preview, true, false);
    expect(range.strokeCircle.mock.calls.map(call => call.slice(0, 2))).toEqual([[20, 30], [80, 90], [10, 15], [100, 110]]);
    expect(range.strokeCircle).toHaveBeenCalledWith(20, 30, preview.rangePx);
    expect(range.strokeRect).toHaveBeenCalledTimes(1);
    expect(scene.add.image).not.toHaveBeenCalled();
    const validColor = range.lineStyle.mock.calls[0][1];
    renderer.renderPlacementPreview(true, { ...preview, valid: false, reason: 'placement', ghosts: [] }, true, false);
    expect(range.lineStyle.mock.lastCall![1]).not.toBe(validColor);
    renderer.syncPlaceableUtilityHint(true, preview, true, false);
    range.clear.mockClear(); range.strokeCircle.mockClear(); range.strokeRect.mockClear();
    renderer.renderPlacementPreview(true, undefined, true, false);
    expect(range.clear).toHaveBeenCalledOnce();
    expect(range.strokeCircle).not.toHaveBeenCalled();
    expect(range.strokeRect).not.toHaveBeenCalled();
  });
});
