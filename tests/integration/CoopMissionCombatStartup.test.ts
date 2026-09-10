import { describe, expect, it, vi } from 'vitest';

const essenceHost = vi.hoisted(() => ({ now: 1000 }));
const essenceRenderer = vi.hoisted(() => ({
  update: vi.fn(), clear: vi.fn(), destroy: vi.fn(), setSuppressed: vi.fn(),
}));

// Only the GPU boundary is replaced; the Coordinator and its presentation/HUD binding run normally.
vi.mock('../../src/adrenalineEssence/AdrenalineEssenceGpuRenderer', () => ({
  AdrenalineEssenceGpuRenderer: class {
    update = essenceRenderer.update;
    clear = essenceRenderer.clear;
    destroy = essenceRenderer.destroy;
    setSuppressed = essenceRenderer.setSuppressed;
    getStats() { return {}; }
  },
}));

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
    Distance: { Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1) },
  },
  BlendModes: { ADD: 1, NORMAL: 0 },
  Geom: {
    Circle: class { x = 0; y = 0; radius = 0; },
    Rectangle: class {
      x = 0; y = 0; width = 0; height = 0;
      constructor(x = 0, y = 0, width = 0, height = 0) { this.setTo(x, y, width, height); }
      setTo(x: number, y: number, width: number, height: number) {
        this.x = x; this.y = y; this.width = width; this.height = height;
        return this;
      }
      get left() { return this.x; }
      get right() { return this.x + this.width; }
      get top() { return this.y; }
      get bottom() { return this.y + this.height; }
    },
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
    getActiveGameMode: () => 'deathmatch',
    getSynchronizedNow: () => essenceHost.now,
    getLocalPlayerId: () => 'local',
    isLocalSpectator: () => false,
    isHost: () => true,
    getWorldParticipation: () => 'interactive',
    getLocalWorldParticipation: () => 'interactive',
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
import { WorldRuntime } from '../../src/world/WorldRuntime';
import { resolveWorldMetrics } from '../../src/world/WorldMetrics';
import { createWorldGeometryQueries } from '../../src/world/WorldGeometryQueries';
import { WorldPlayerGameplayRuntime } from '../../src/world/WorldPlayerGameplayRuntime';
import { ResourceSystem } from '../../src/systems/ResourceSystem';
import { BurrowSystem } from '../../src/systems/BurrowSystem';
import { LoadoutManager } from '../../src/loadout/LoadoutManager';
import { PlayerActionRuntime } from '../../src/world/PlayerActionRuntime';
import { PlayerWeaponActivationRuntime } from '../../src/world/PlayerWeaponActivationRuntime';
import { WorldWeaponExecutionRuntime } from '../../src/world/WorldWeaponExecutionRuntime';
import { SpecializedWeaponExecutionAdapter } from '../../src/world/SpecializedWeaponExecutionAdapter';
import { WorldProjectileRuntime } from '../../src/projectile/WorldProjectileRuntime';
import type { PrimaryHitAdrenalineRewardFact } from '../../src/combat/PrimaryHitReward';
import { createTechnicalPhysicsBinding, createPresentation } from '../ProjectileRuntimeTestHelper';
import { essenceWorldGeometry } from '../essenceWorldGeometry';
import { ADRENALINE_ESSENCE_CONFIG } from '../../src/adrenalineEssence/AdrenalineEssenceConfig';

const activity: ActivityDescriptor = {
  activityRevision: 2,
  worldRevision: 1,
  kind: 'coop-mission',
  definitionId: 'activity:coop-mission:1',
};

describe('Lobby World essence composition', () => {
  function lobbyFixture(definitionId = 'world:lobby') {
    essenceHost.now = 1000;
    for (const callback of Object.values(essenceRenderer)) callback.mockClear();
    const terrain = essenceWorldGeometry('lobby');
    const origin = terrain.openPoints(ADRENALINE_ESSENCE_CONFIG.scatterMaxRadius + ADRENALINE_ESSENCE_CONFIG.groundClearance)[0];
    expect(origin).toBeDefined();
    const world = new WorldRuntime({
      descriptor: { worldRevision: 73, definitionId, seed: 91, generatorVersion: 1, layoutFingerprint: 'practice' },
      definition: null, bases: [], persistentBaseSite: null,
      metrics: terrain.metrics,
    });
    const actors = new Map(['local', 'other'].map((id, index) => [id,
      fakeEntity({ id, x: origin.x - 30 + index * 30, y: origin.y, body: { enable: true }, setPosition: vi.fn() })]));
    const playerManager = {
      getPlayer: (id: string) => actors.get(id),
      getAllPlayers: () => [...actors.values()],
    } as unknown as PlayerManager;
    const combatBridge = {
      isHost: () => true, areTeammates: () => false,
      getPlayerProfile: (id: string) => actors.has(id) ? { id } : undefined,
      broadcastEffect: vi.fn(), broadcastHitscanTracer: vi.fn(), broadcastMeleeSwing: vi.fn(),
    } as unknown as NetworkBridge;
    const combat = new WorldCombatCore(playerManager, combatBridge);
    world.bind(combat.bindPlayerVitalsScope({ worldRevision: world.descriptor.worldRevision, runtimeGeneration: 9 }));
    combat.bindHostExecutionSources({ nowMs: () => essenceHost.now, random: () => 0.25 });
    combat.setWorldMetrics(world.context.metrics);
    const resource = new ResourceSystem();
    combat.setResourceSystem(resource);
    for (const id of actors.keys()) { combat.initPlayer(id); resource.initPlayer(id); }
    resource.setAdrenaline('local', 0);
    const burrow = new BurrowSystem(resource, playerManager, combat, {} as any, combatBridge);
    // Keep the real gameplay resource/participation methods, excluding unrelated abilities/render setup.
    const playerGameplay = Object.create(WorldPlayerGameplayRuntime.prototype);
    playerGameplay.systems = { resource, burrow };
    playerGameplay.destroyed = false;
    const geometry = createWorldGeometryQueries({
      metrics: world.context.metrics, index: terrain.index, isActive: () => !world.isDestroyed(),
    });
    const hud = { setEssenceIncoming: vi.fn(), notifyEssenceArrival: vi.fn() };
    const coordinator = Object.create(ArenaLifecycleCoordinator.prototype) as any;
    coordinator.worldRuntime = world;
    coordinator.worldLifecycle = { isActive: () => !world.isDestroyed() };
    coordinator.adrenalineEssence = null;
    coordinator.ctx = { playerManager, playerStatusRing: hud };
    coordinator.scene = {};
    coordinator.renderers = { gpuVfx: { isSuppressed: () => false }, lighting: { setLight: vi.fn(), releaseLight: vi.fn() } };
    coordinator.worldGameplay = { combatSystem: combat, player: playerGameplay, geometry: { getQueries: () => geometry } };

    const facts: PrimaryHitAdrenalineRewardFact[] = [];
    const removeObserver = combat.addPrimaryHitRewardObserver(fact => facts.push(fact));
    world.bind({ destroy: removeObserver });
    const loadout = new LoadoutManager(resource, { getGameMode: () => 'deathmatch' });
    loadout.assignDefaultLoadout('local');
    const physics = createTechnicalPhysicsBinding();
    const projectiles = new WorldProjectileRuntime({
      physicsBinding: physics.binding, presentation: createPresentation(), identityScope: world.projectileIdentityScope,
      hostNowMs: () => essenceHost.now,
      resolveProvenance: provenance => combat.captureProjectileProvenance(provenance),
    });
    world.bind(projectiles);
    projectiles.setProjectileCombatPort(combat);
    projectiles.setProjectileCollisionTargetQueryPort({ readCollisionTargets: sink => {
      const target = actors.get('other')!;
      const x = target.x as number; const y = target.y as number;
      sink('player', 'other', 'other', x, y, 10, x - 10, y - 10, x + 10, y + 10);
    } });
    projectiles.setProjectileTargetabilityPort({ canDamage: () => true, canDamageOwner: () => true, isTargetCurrentlyValid: () => true });
    const activation = new PlayerWeaponActivationRuntime({
      playerManager: { getPlayer: id => actors.get(id) }, loadout, resourceSystem: resource,
      capturePrimaryHitRewardScope: () => combat.getPrimaryHitRewardScope(),
      weaponExecution: new WorldWeaponExecutionRuntime({ projectileSpawn: projectiles, combatSystem: combat }),
      specializedWeaponExecution: new SpecializedWeaponExecutionAdapter(projectiles),
    });
    const actions = new PlayerActionRuntime({
      getPlayer: id => actors.get(id), canInteract: () => true, isAlive: id => combat.isAlive(id),
      isWeaponBlocked: () => false, isDashBurst: () => false,
    }, loadout, null, activation);
    const shoot = () => {
      expect(actions.execute({ category: 'weapon', playerId: 'local', slot: 'weapon1', angle: 0,
        targetX: origin.x, targetY: origin.y, hostNowMs: essenceHost.now })).toEqual({ ok: true });
      const spec = physics.specs.at(-1)!;
      const handle = physics.handles.get(spec.id)!;
      Object.assign(handle.sprite, origin);
      physics.observe(spec.id, origin.x, origin.y, handle.body.velocity.x, handle.body.velocity.y);
      projectiles.runHostProjectileStage(16, essenceHost.now);
      projectiles.runHostInteractionStage(essenceHost.now);
    };
    return { world, coordinator, combat, resource, actors, hud, facts, shoot, loadout, physics };
  }

  it('attaches practice rewards to the actual World lease and carries an authored Glock hit through pickup and HUD', () => {
    const f = lobbyFixture();
    try {
      expect(f.combat.getPrimaryHitRewardScope()).toBeNull();
      // Production attachment, after World gameplay composition and with no Activity descriptor.
      f.coordinator.attachLobbyAdrenalineEssence();
      const binding = f.coordinator.getAdrenalineEssence()!;
      expect(binding.scope).toEqual({ worldRevision: 73, activityRevision: null });
      expect(f.world.activity.isAttached()).toBe(false);
      expect(f.world.activity.descriptor).toBeNull();
      expect(f.combat.getPrimaryHitRewardScope()).toEqual({ worldRevision: 73, runtimeGeneration: 9, activityRevision: null });
      expect(f.loadout.getEquippedWeaponConfig('local', 'weapon1')?.id).toBe('GLOCK');

      const hp = f.combat.getHP('other');
      f.shoot();
      expect(f.combat.getHP('other')).toBeLessThan(hp);
      expect(f.facts).toHaveLength(1);
      expect(f.facts[0]).toMatchObject({ creatorId: 'local', worldRevision: 73, runtimeGeneration: 9,
        activityRevision: null, source: { authoredSourceId: 'GLOCK', sourceSlot: 'weapon1' } });
      expect(f.facts[0].resolvedValue).toBeGreaterThan(0);
      expect(f.resource.getAdrenaline('local')).toBe(0);
      const clusters = binding.runtime!.getState().clusters;
      const totalValue = f.facts[0].resolvedValue;
      expect(clusters).toHaveLength(ADRENALINE_ESSENCE_CONFIG.fragmentsPerReward);
      expect(clusters.reduce((sum: number, cluster: { value: number }) => sum + cluster.value, 0)).toBe(totalValue);
      for (const cluster of clusters) {
        expect(cluster).toMatchObject({ state: 'ejecting', accessGroup: { kind: 'personal', playerId: 'local' } });
        for (const other of clusters) if (cluster !== other) {
          expect(Math.hypot(cluster.x - other.x, cluster.y - other.y)).toBeGreaterThan(ADRENALINE_ESSENCE_CONFIG.mergeRadius);
        }
      }
      binding.render(essenceHost.now);
      expect(essenceRenderer.update).toHaveBeenLastCalledWith(expect.objectContaining({ clusters }), essenceHost.now, []);

      Object.assign(f.actors.get('local')!, { x: clusters[0].x, y: clusters[0].y });
      essenceHost.now = Math.max(...clusters.map((cluster: { landAt: number }) => cluster.landAt));
      binding.updateHost(essenceHost.now);
      const transfers = binding.runtime!.getState().transfers;
      expect(transfers).toHaveLength(clusters.length);
      expect(transfers.every((transfer: { playerId: string }) => transfer.playerId === 'local')).toBe(true);
      expect(f.resource.getAdrenaline('local')).toBe(0);
      binding.render(essenceHost.now);
      expect(f.hud.setEssenceIncoming).toHaveBeenLastCalledWith(totalValue);
      essenceHost.now = Math.max(...transfers.map((transfer: { arrivalAt: number }) => transfer.arrivalAt));
      binding.updateHost(essenceHost.now);
      binding.render(essenceHost.now);
      expect(f.resource.getAdrenaline('local')).toBe(totalValue);
      expect(f.hud.notifyEssenceArrival).toHaveBeenCalledExactlyOnceWith(totalValue, 0);
      expect(binding.runtime!.getDiagnostics()).toMatchObject({ activeValue: 0, committedValue: totalValue, conservationError: 0 });

      // Outstanding ground value and presentation must die with World even though Activity stayed empty.
      essenceHost.now += 1000;
      f.shoot();
      expect(binding.runtime!.getState().clusters).toHaveLength(ADRENALINE_ESSENCE_CONFIG.fragmentsPerReward);
      f.world.destroy();
      expect(f.coordinator.getAdrenalineEssence()).toBeNull();
      expect(f.combat.getPrimaryHitRewardScope()).toBeNull();
      expect(binding.runtime!.getState()).toMatchObject({ clusters: [], transfers: [] });
      expect(essenceRenderer.destroy).toHaveBeenCalledOnce();
      expect(f.physics.releaseWorldState).toHaveBeenCalledOnce();
      expect(f.world.activity.descriptor).toBeNull();
    } finally { f.world.destroy(); }
  });

  it('does not invent practice essence for an ordinary World whose Activity has not started', () => {
    const f = lobbyFixture('world:coop-defense:1');
    try {
      f.coordinator.attachLobbyAdrenalineEssence();
      expect(f.coordinator.getAdrenalineEssence()).toBeNull();
      expect(f.combat.getPrimaryHitRewardScope()).toBeNull();
      expect(f.world.activity.isAttached()).toBe(false);
    } finally { f.world.destroy(); }
  });
});

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

  it('detaches world targeting outside a host combat execution', () => {
    const coordinator = Object.create(ArenaLifecycleCoordinator.prototype);
    const removeOwner = vi.fn();
    const removeTarget = vi.fn();
    const removeInjectorOwner = vi.fn();
    coordinator.worldGameplay = {
      combatSystem: { getHostTime: () => { throw new Error('No active host execution'); } },
      support: { plague: { removeOwner } },
      targeting: { systems: {
        targetStatus: { removeTarget },
        energyInjector: { removeOwner: removeInjectorOwner },
      } },
    };
    const runtime = coordinator.composePlayerRuntime();
    runtime.attach({ profile: { id: 'leaving-player' }, reconnectAfterDeath: false, nowMs: 1000 }, {
      entity: false, navigation: false, combat: false, combatResources: false,
      loadoutTools: false, playerBuild: false, worldTargeting: true,
    });
    const beforeDetach = Date.now();
    expect(() => runtime.detachAll()).not.toThrow();
    expect(removeOwner).toHaveBeenCalledOnce();
    expect(removeOwner.mock.calls[0][0]).toBe('leaving-player');
    expect(removeOwner.mock.calls[0][1]).toBeGreaterThanOrEqual(beforeDetach);
    expect(removeOwner.mock.calls[0][1]).toBeLessThanOrEqual(Date.now());
    expect(removeTarget).toHaveBeenCalledWith({ targetType: 'player', targetId: 'leaving-player' });
    expect(removeInjectorOwner).toHaveBeenCalledWith('leaving-player');
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
