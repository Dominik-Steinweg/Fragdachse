import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', async () => {
  const { createFakePhaserModule } = await import('./fakeArenaRenderScene');
  return {
    ...createFakePhaserModule(),
    Scenes: { Events: { POST_UPDATE: 'postupdate' } },
  };
});

vi.mock('../src/network/bridge', () => ({
  bridge: {
    getActiveGameMode: () => 'coop_defense',
    getLocalPlayerId: () => 'player_local',
    broadcastExplosionEffect: () => {},
  },
}));

import { RockGridIndex } from '../src/arena/RockGridIndex';
import { RockRegistry } from '../src/arena/RockRegistry';
import { RockVisualStateStore } from '../src/arena/rocks/RockVisualState';
import { generateArenaWithActiveMetrics } from './ArenaGeneratorTestHelper';
import {
  COOP_DEFENSE_MODE,
  COOP_DEFENSE_ENEMY_AIRSTRIKE_ATTACKER_ID,
  GRID_COLS,
  GRID_ROWS,
  applyArenaMetricsForMode,
} from '../src/config';
import { getCoopDefenseMapConfig } from '../src/config/coopDefenseMaps';
import { PowerUpSystem } from '../src/powerups/PowerUpSystem';
import { RockVisualHelper } from '../src/scenes/arena/RockVisualHelper';
import type { ArenaBuilderResult } from '../src/arena/ArenaBuilder';
import type { ArenaLayout, RockCell } from '../src/types';

describe('Dachs of Steel & Tutorial-Felsen Armor Drops', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('generates tutorial rocks and normal rocks without armorDropMult on Map 1 and Map 11', () => {
    for (const mapId of ['1', '11']) {
      const mapConfig = getCoopDefenseMapConfig(mapId);
      applyArenaMetricsForMode(
        COOP_DEFENSE_MODE,
        'ARENA',
        mapConfig.arenaWidthCells,
        mapConfig.arenaHeightCells,
      );
      const layout = generateArenaWithActiveMetrics(12345, mapConfig);
      expect(layout.rocks.length).toBeGreaterThan(0);
      for (const rock of layout.rocks) {
        expect((rock as unknown as { armorDropMult?: number }).armorDropMult).toBeUndefined();
      }
    }
  });

  it('PowerUpSystem.onRockDestroyed triggers standard ROCK_DESTROY drop table for any layout rock', () => {
    const layout: ArenaLayout = {
      seed: 42,
      rocks: [
        { gridX: 5, gridY: 5 },
        { gridX: 10, gridY: 10 },
      ],
      trees: [],
      tracks: [],
      dirt: [],
      powerUpPedestals: [],
    };

    const powerUpSystem = new PowerUpSystem(
      null as never,
      {
        damageEnemiesInRadius: vi.fn(),
        damagePlayersInRadius: vi.fn(),
        damageBasesInRadius: vi.fn(),
      } as never,
      layout,
    );

    const spawnSpy = vi.spyOn(powerUpSystem, 'spawnFromTable');

    // Normal rock at index 0
    powerUpSystem.onRockDestroyed(0);
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    expect(spawnSpy).toHaveBeenLastCalledWith('ROCK_DESTROY', expect.any(Number), expect.any(Number));

    // Tutorial rock at index 1
    powerUpSystem.onRockDestroyed(1);
    expect(spawnSpy).toHaveBeenCalledTimes(2);
    expect(spawnSpy).toHaveBeenLastCalledWith('ROCK_DESTROY', expect.any(Number), expect.any(Number));
  });

  describe('RockVisualHelper.handleDestroyedRock drop authorization', () => {
    function setupHelper(rocks: RockCell[]) {
      const layout: ArenaLayout = {
        seed: 1,
        rocks,
        trees: [],
        tracks: [],
        dirt: [],
        powerUpPedestals: [],
      };

      const rockRegistry = new RockRegistry(layout);
      const rockVisualStates = new RockVisualStateStore();
      const rockGroup = {
        add: vi.fn(),
        remove: vi.fn(),
      };
      const rockOverlaySurface = {
        refreshAll: vi.fn(),
        refreshRegions: vi.fn(),
      };
      const rockPhysicsProxies = rocks.map(() => ({ active: true, setVisible: vi.fn() }));
      const result = {
        rockPhysicsProxies,
        rockVisualStates,
        rockVisualSystem: { getDestructionSnapshot: () => null },
        rockGroup,
        rockGrid: new RockGridIndex([], { cols: GRID_COLS, rows: GRID_ROWS }),
        rockOverlaySurface,
      } as unknown as ArenaBuilderResult;

      const powerUpSystem = {
        onRockDestroyed: vi.fn(),
      };

      const classByPlayerId = new Map<string, string>([
        ['player_steel', 'dachs_of_steel'],
        ['player_nukem', 'dachs_nukem'],
        ['player_gadachs', 'inspector_gadachs'],
      ]);

      const coopDefensePlayerModifierSystem = {
        getClassId: (playerId: string) => classByPlayerId.get(playerId) ?? null,
      };

      const scene = {
        events: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), once: vi.fn() },
        textures: { exists: () => true },
        game: { events: { emit: vi.fn() } },
        add: {
          graphics: () => ({ setDepth: vi.fn().mockReturnThis() }),
          image: () => ({
            setDisplaySize: vi.fn().mockReturnThis(),
            setTint: vi.fn().mockReturnThis(),
            setAlpha: vi.fn().mockReturnThis(),
            setBlendMode: vi.fn().mockReturnThis(),
            setDepth: vi.fn().mockReturnThis(),
          }),
          rectangle: () => ({
            setDepth: vi.fn().mockReturnThis(),
            setOrigin: vi.fn().mockReturnThis(),
          }),
        },
      };

      const ctx = {
        arenaResult: result,
        currentLayout: layout,
        rockRegistry,
        powerUpSystem,
        coopDefensePlayerModifierSystem,
        placementSystem: {
          getRuntimeRock: () => undefined,
          getAllRuntimeRocks: () => [],
          removeRock: vi.fn(),
        },
        combatSystem: {
          invalidateObstacleIndex: vi.fn(),
          applyAoeDamage: vi.fn(),
        },
        gameAudioSystem: { playSound: vi.fn() },
        lightOccluderIndex: { markDirty: vi.fn() },
        visualFeedback: { camera: { request: vi.fn() } },
        hostPhysics: { applyRadialImpulse: vi.fn() },
      };

      const rockDestructionRenderer = {
        playDestruction: vi.fn(),
      };

      const helper = new RockVisualHelper(
        scene as never,
        ctx as never,
        { rebuildArenaStaticShadows: vi.fn(), rebuildArenaStaticShadowRegions: vi.fn() } as never,
        rockDestructionRenderer as never,
        null,
        {
          getWorldRuntime: () => ({
            context: null,
            materialization: {
              arena: result,
              placement: ctx.placementSystem,
              rocks: rockRegistry,
              lightOccluders: ctx.lightOccluderIndex,
            },
            presentation: { layout },
          } as never),
          getTargetingRuntime: () => null,
          getPlayerGameplayRuntime: () => ({
            systems: { playerModifier: coopDefensePlayerModifierSystem },
          } as never),
          getPowerUpRuntime: () => ({ system: powerUpSystem } as never),
        },
      );

      return { helper, powerUpSystem, layout, rockRegistry, rockPhysicsProxies };
    }

    it('1. Dachs of Steel zerstört normalen Fels → normaler Armor-Drop-Pfad', () => {
      const { helper, powerUpSystem } = setupHelper([{ gridX: 2, gridY: 2 }]);
      helper.handleDestroyedRock(0, 'damage', 'player_steel');

      expect(powerUpSystem.onRockDestroyed).toHaveBeenCalledTimes(1);
      expect(powerUpSystem.onRockDestroyed).toHaveBeenCalledWith(0);
    });

    it('2. Dachs of Steel zerstört Tutorial-Fels → identischer Armor-Drop-Pfad', () => {
      const { helper, powerUpSystem } = setupHelper([{ gridX: 20, gridY: 15 }]);
      helper.handleDestroyedRock(0, 'damage', 'player_steel');

      expect(powerUpSystem.onRockDestroyed).toHaveBeenCalledTimes(1);
      expect(powerUpSystem.onRockDestroyed).toHaveBeenCalledWith(0);
    });

    it('3. Andere Coop-Klasse zerstört Tutorial-Fels → kein Armor-Drop', () => {
      const { helper, powerUpSystem } = setupHelper([{ gridX: 20, gridY: 15 }]);

      helper.handleDestroyedRock(0, 'damage', 'player_nukem');
      expect(powerUpSystem.onRockDestroyed).not.toHaveBeenCalled();
    });

    it('4. Map-11-Zombie-Bomber zerstört Tutorial-Fels → kein Armor-Drop', () => {
      const { helper, powerUpSystem } = setupHelper([{ gridX: 20, gridY: 15 }]);

      helper.handleDestroyedRock(0, 'damage', COOP_DEFENSE_ENEMY_AIRSTRIKE_ATTACKER_ID);
      expect(powerUpSystem.onRockDestroyed).not.toHaveBeenCalled();
    });

    it('5. Rock Decay oder Zerstörung ohne Spieler-Schaden erzeugt keinen Armor-Drop', () => {
      const { helper, powerUpSystem } = setupHelper([{ gridX: 20, gridY: 15 }]);

      helper.handleDestroyedRock(0, 'decay', 'player_steel');
      expect(powerUpSystem.onRockDestroyed).not.toHaveBeenCalled();

      const { helper: helper2, powerUpSystem: powerUpSystem2 } = setupHelper([{ gridX: 20, gridY: 15 }]);
      helper2.handleDestroyedRock(0, 'damage', undefined);
      expect(powerUpSystem2.onRockDestroyed).not.toHaveBeenCalled();
    });
  });
});
