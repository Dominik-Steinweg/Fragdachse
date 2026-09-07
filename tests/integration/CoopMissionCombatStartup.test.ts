import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Scene: class {},
  GameObjects: {
    Image: class {}, Sprite: class {}, Container: class {},
    Particles: { ParticleProcessor: class {} },
  },
  Math: {
    Vector2: class {},
    Clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)),
    Linear: (a: number, b: number, t: number) => a + (b - a) * t,
  },
  BlendModes: { ADD: 1, NORMAL: 0 },
  Geom: {
    Circle: class {},
    Rectangle: class {},
    Line: class {
      x1 = 0; y1 = 0; x2 = 0; y2 = 0;
      setTo(x1: number, y1: number, x2: number, y2: number) {
        this.x1 = x1; this.y1 = y1; this.x2 = x2; this.y2 = y2;
        return this;
      }
      static Length(line: { x1: number; y1: number; x2: number; y2: number }) {
        return Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
      }
    },
  },
  Filters: { ParallelFilters: class {}, Displacement: class {} },
}));
vi.mock('../../src/network/bridge', () => ({
  bridge: {
    getRoundState: () => null,
    getGamePhase: () => 'LOBBY',
    getGameMode: () => 'DEATHMATCH',
    getLocalPlayerId: () => 'local',
    isLocalSpectator: () => false,
    isHost: () => true,
    getWorldParticipation: () => 'interactive',
    clearWeapon2PredictionState: () => {},
  },
}));
vi.mock('../../src/activity/CoopMissionActivityConfig', () => ({
  resolveCoopMissionActivityConfiguration: () => ({ mapConfig: {} }),
}));
vi.mock('../../src/arena/BaseRegistry', () => ({
  resolveCoopDefenseActivityBaseOverlays: () => [],
}));

import { ArenaLifecycleCoordinator } from '../../src/scenes/arena/ArenaLifecycleCoordinator';
import { ArenaScene } from '../../src/scenes/ArenaScene';
import { CoopMissionRuntime } from '../../src/activity/CoopMissionRuntime';
import { CoopMissionPlayerRuntime } from '../../src/activity/CoopMissionPlayerRuntime';
import { WorldCombatCore } from '../../src/combat/WorldCombatCore';
import { CoopDefenseRespawnBudgetSystem } from '../../src/systems/CoopDefenseRespawnBudgetSystem';
import type { NetworkBridge } from '../../src/network/NetworkBridge';
import type { PlayerManager } from '../../src/entities/PlayerManager';
import type { ActivityDescriptor } from '../../src/world/ActivityDescriptor';
import { fakeEntity } from '../fakeEntity';

const activity: ActivityDescriptor = {
  activityRevision: 2,
  worldRevision: 1,
  kind: 'coop-mission',
  definitionId: 'activity:coop-mission:1',
};

describe('Coop mission combat startup', () => {
  function reconnectFixture(respawnsPerPlayer: number) {
    const profile = { id: 'p1', name: 'Dachs', colorHex: '#ffffff' };
    const actors: ReturnType<typeof fakeEntity>[] = [];
    const liveActors = new Map<string, ReturnType<typeof fakeEntity>>();
    const playerManager = {
      addPlayer: (candidate: typeof profile) => {
        const actor = fakeEntity({
          id: candidate.id,
          x: 10,
          y: 20,
          body: { enable: true },
          setPosition: vi.fn(),
        });
        actors.push(actor);
        liveActors.set(candidate.id, actor);
      },
      removePlayer: (id: string) => { liveActors.delete(id); },
      getPlayer: (id: string) => liveActors.get(id),
      getAllPlayers: () => [...liveActors.values()],
      getWorldSpawnPoint: () => ({ x: 300, y: 200 }),
    } as unknown as PlayerManager;
    const combat = new WorldCombatCore(playerManager, {
      isHost: () => true,
      getPlayerProfile: (id: string) => id === profile.id ? profile : undefined,
      areTeammates: () => false,
      broadcastEffect: vi.fn(),
    } as unknown as NetworkBridge);
    combat.bindHostExecutionSources({ nowMs: () => 1000, random: () => 0.25 });

    const budget = new CoopDefenseRespawnBudgetSystem({ respawnsPerPlayer, participantIds: [profile.id] });
    const activityPlayers = new CoopMissionPlayerRuntime({
      respawnBudget: budget,
      releaseMissionObjectives: () => {},
      ensureAllyFlowField: () => {},
      removeAllyFlowField: () => {},
      publishRespawnBudget: () => {},
    });
    const mission = new CoopMissionRuntime(activity);
    mission.setPlayerActivity(activityPlayers);
    combat.setInitialSpawnAllowedResolver(() => true);
    combat.setRespawnAllowedResolver((id) => budget.canPlayerRespawn(id));
    combat.setDeathCallback((id) => activityPlayers.handlePlayerDeath(id));
    combat.setRespawnCallback((id) => activityPlayers.consumeRespawn(id, false));

    const coordinator = Object.create(ArenaLifecycleCoordinator.prototype) as any;
    coordinator.ctx = {
      playerManager,
      effectSystem: { clearBurrowState: () => {} },
      hostPhysics: { removePlayer: () => {} },
    };
    coordinator.clientUpdate = { removePlayerState: () => {} };
    coordinator.worldGameplay = {
      combatSystem: combat,
      player: null,
      construction: null,
      powerUp: null,
      targeting: null,
    };
    const players = coordinator.composePlayerRuntime();
    coordinator.worldRuntime = { players, activity: { runtime: mission } };
    return { coordinator, combat, budget, activityPlayers, profile, actors, liveActors };
  }

  it('reconnects through Death -> full Detach -> Reattach and consumes the remaining budget once', () => {
    const f = reconnectFixture(1);
    expect(f.coordinator.attachPlayerToWorld(f.profile, false)).toBe(true);
    const firstActor = f.liveActors.get(f.profile.id);
    const firstTarget = f.combat.getPlayerCombatTarget(f.profile.id)!;
    expect(f.combat.applyDamage(f.profile.id, 10_000)).toMatchObject({ transition: { kind: 'dead' } });
    expect(f.budget.getPlayerState(f.profile.id)).toMatchObject({ remainingRespawns: 1, alive: false });

    f.coordinator.detachPlayerFromWorld(f.profile.id);
    expect(f.combat.getPlayerCombatTarget(f.profile.id)).toBeNull();
    expect(f.coordinator.attachPlayerToWorld(f.profile, true)).toBe(true);

    expect(f.liveActors.get(f.profile.id)).not.toBe(firstActor);
    expect(f.combat.getPlayerCombatTarget(f.profile.id)?.instance).not.toEqual(firstTarget.instance);
    expect(f.combat.readCombatTarget(firstTarget)).toBeNull();
    expect(f.combat.isAlive(f.profile.id)).toBe(true);
    expect(f.liveActors.get(f.profile.id)?.body.enable).toBe(true);
    expect(f.budget.getPlayerState(f.profile.id)).toEqual({
      remainingRespawns: 0,
      alive: true,
      eliminated: false,
    });
  });

  it('rejects an ineligible post-death reattach without leaving Player state behind', () => {
    const f = reconnectFixture(0);
    expect(f.coordinator.attachPlayerToWorld(f.profile, false)).toBe(true);
    f.combat.applyDamage(f.profile.id, 10_000);
    f.coordinator.detachPlayerFromWorld(f.profile.id);

    expect(f.coordinator.attachPlayerToWorld(f.profile, true)).toBe(false);
    expect(f.liveActors.has(f.profile.id)).toBe(false);
    expect(f.combat.getPlayerCombatTarget(f.profile.id)).toBeNull();
    expect(f.activityPlayers.isAttached(f.profile.id)).toBe(false);
    expect(f.budget.getPlayerState(f.profile.id)).toEqual({
      remainingRespawns: 0,
      alive: false,
      eliminated: true,
    });
  });

  it('keeps exit grading neutral after combat teardown while the Arena fade is still visible', () => {
    const scene = Object.create(ArenaScene.prototype);
    scene.lastObservedGamePhase = 'ARENA';
    scene.arenaExitFadeComplete = false;
    scene.localPlayerState = { spectator: false };
    scene.resolveConfiguredGameMode = () => 'DEATHMATCH';
    const isAlive = vi.fn(() => true);
    let combat: { isAlive: typeof isAlive } | null = { isAlive };
    scene.ctx = {
      getWorldCombatCore: () => combat,
      playerManager: { getPlayer: () => ({ getHpFraction: () => 0.25 }) },
    };
    expect(scene.resolveWorldGradeInputs().localHpFraction).toBe(0.25);
    combat = null;
    expect(scene.resolveWorldGradeInputs()).toMatchObject({
      localHpFraction: 1,
      gamePhase: 'ARENA',
    });
  });

  it('attaches base overlays before combat exists and projects later changes into the current core', () => {
    let publish = () => {};
    const obstacles = [{ x: 10, y: 20, width: 30, height: 40 }];
    // Exercise the production coordinator callback without constructing a renderer or scene.
    const coordinator = Object.create(ArenaLifecycleCoordinator.prototype);
    coordinator.worldGameplay = null;
    coordinator.worldRuntime = {
      context: { definition: {}, metrics: {} },
      materialization: {
        bases: {
          getObstacleRectangles: () => obstacles,
          createActivityBinding: (_overlays: unknown, onChanged: () => void) => {
            publish = onChanged;
            return { attach: onChanged, detach: onChanged };
          },
        },
      },
    };
    const runtime = new CoopMissionRuntime(activity);
    expect(() => coordinator.attachCoopMissionBaseBinding(activity, runtime)).not.toThrow();

    const setBaseObstacles = vi.fn();
    const syncBaseObstacles = vi.fn();
    coordinator.worldGameplay = {
      combatSystem: { setBaseObstacles },
      geometry: { syncBaseObstacles },
    };
    publish();
    expect(setBaseObstacles).toHaveBeenCalledWith(obstacles);
    expect(syncBaseObstacles).toHaveBeenCalledOnce();

    // A failed/partial World build must also be able to release its Activity bindings.
    coordinator.worldGameplay = null;
    expect(() => runtime.destroy()).not.toThrow();
  });
});
