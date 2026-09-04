import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
    Angle: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.atan2(y2 - y1, x2 - x1),
    },
    Distance: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
    },
  },
}));

import type * as Phaser from 'phaser';
import { getArenaMetricsProfile, PLAYER_SPEED } from '../src/config';
import { PERSISTENT_BASE_STATE_SCHEMA_VERSION } from '../src/config/persistentBase';
import { COOP_DEFENSE_CONSTRUCTIONS } from '../src/config/coopDefenseConstructions';
import { getCoopDefenseMapConfig } from '../src/config/coopDefenseMaps';
import { toWorldDefinition } from '../src/config/authoring/coopDefenseAuthoringAdapter';
import type { PlayerEntity } from '../src/entities/PlayerEntity';
import type { PlayerManager } from '../src/entities/PlayerManager';
import { RockGridIndex } from '../src/arena/RockGridIndex';
import type { CombatSystem } from '../src/systems/CombatSystem';
import { HostPhysicsSystem } from '../src/systems/HostPhysicsSystem';
import { PlacementSystem } from '../src/systems/PlacementSystem';
import type { NetworkBridge } from '../src/network/NetworkBridge';
import { NetworkBridge as Bridge } from '../src/network/NetworkBridge';
import { clearActiveSession, setActiveSession } from '../src/network/peer/session';
import { PersistentBaseContributionStore } from '../src/persistentBase/PersistentBaseContributionStore';
import { PersistentBaseRoomSession } from '../src/persistentBase/PersistentBaseRoomSession';
import type { PersistentBaseRepositoryPort } from '../src/persistentBase/PersistentBaseRepository';
import type { PersistentBaseState } from '../src/persistentBase/PersistentBaseTypes';
import type { PlayerNetState, SyncedPlaceableRock } from '../src/types';
import { createWorldRuntimeContext, type WorldRuntimeContext } from '../src/world/WorldRuntimeContext';
import { resolvePlayerCapabilities } from '../src/world/PlayerCapabilities';
import { PlayerWorldRuntime, resolvePlayerRuntimeFeatures } from '../src/world/PlayerWorldRuntime';
import { resolveWorldPresentation } from '../src/world/WorldPresentation';
import { WorldLifecycle } from '../src/world/WorldLifecycle';
import type { WorldDescriptor } from '../src/world/WorldDescriptor';
import { worldCellCenter } from '../src/world/WorldMetrics';
import { FakeNetwork, addClientRoom, createHostRoom, type TestRoom } from './fakePeerNetwork';
import type { ArenaLayout } from '../src/types';

const WORLD: WorldDescriptor = {
  worldRevision: 2201,
  definitionId: 'world:coop-defense:17',
  seed: 2201,
  generatorVersion: 1,
  layoutFingerprint: 'step-22-proof',
  parameters: { persistentBaseUnlocked: true, persistentBaseAreaStage: 1 },
};

const LAYOUT: ArenaLayout = {
  seed: WORLD.seed,
  rocks: [],
  trees: [],
  tracks: [],
  dirt: [],
  powerUpPedestals: [],
};

class MemoryRepository implements PersistentBaseRepositoryPort {
  state: PersistentBaseState = {
    schemaVersion: PERSISTENT_BASE_STATE_SCHEMA_VERSION,
    revision: 0,
    constructions: [],
  };

  saves = 0;

  load(): PersistentBaseState {
    return structuredClone(this.state);
  }

  save(state: PersistentBaseState): void {
    this.saves += 1;
    this.state = structuredClone(state);
  }
}

interface HeadlessBody {
  velocity: { x: number; y: number };
  setVelocity: ReturnType<typeof vi.fn>;
}

interface HeadlessPlayer {
  id: string;
  active: boolean;
  x: number;
  y: number;
  physicsProxy: { body: HeadlessBody };
  setDashScale: ReturnType<typeof vi.fn>;
  setCollisionRadius: ReturnType<typeof vi.fn>;
}

function createHeadlessPlayer(id: string, x: number, y: number): HeadlessPlayer {
  const body: HeadlessBody = {
    velocity: { x: 0, y: 0 },
    setVelocity: vi.fn((vx: number, vy: number) => {
      body.velocity.x = vx;
      body.velocity.y = vy;
    }),
  };
  return {
    id,
    active: true,
    x,
    y,
    physicsProxy: { body },
    setDashScale: vi.fn(),
    setCollisionRadius: vi.fn(),
  };
}

function playerManager(players: Map<string, HeadlessPlayer>): PlayerManager {
  return {
    getAllPlayers: () => [...players.values()] as unknown as PlayerEntity[],
    getPlayer: (id: string) => players.get(id) as unknown as PlayerEntity | undefined,
    hasPlayer: (id: string) => players.has(id),
  } as unknown as PlayerManager;
}

function bridgeFor(room: TestRoom): NetworkBridge {
  setActiveSession({ room: room.room, transport: room.transport, roomCode: 'STEP22' });
  const bridge = new Bridge();
  bridge.activate();
  return bridge;
}

function useRoom(room: TestRoom): void {
  setActiveSession({ room: room.room, transport: room.transport, roomCode: 'STEP22' });
}

function createWorld(descriptor: WorldDescriptor): WorldRuntimeContext {
  const mapConfig = getCoopDefenseMapConfig('17');
  return createWorldRuntimeContext({
    descriptor,
    metricsProfile: getArenaMetricsProfile(
      'coop_defense',
      'ARENA',
      mapConfig.arenaWidthCells,
      mapConfig.arenaHeightCells,
    ),
    definition: toWorldDefinition(mapConfig),
  });
}

function playerState(x: number, y: number): PlayerNetState {
  return {
    x,
    y,
    rot: 0,
    hp: 100,
    maxHp: 100,
    armor: 0,
    alive: true,
    adrenaline: 0,
    rage: 0,
    isBurrowed: false,
    isStunned: false,
    burrowPhase: 'idle',
    isRaging: false,
    burnStacks: 0,
    dashPhase: 0,
    aim: {
      revision: 0,
      isMoving: false,
      weapon1DynamicSpread: 0,
      weapon2DynamicSpread: 0,
    },
  };
}

function worldSnapshot(
  players: Record<string, PlayerNetState>,
  placeableRocks: readonly SyncedPlaceableRock[],
): Parameters<NetworkBridge['publishGameState']>[0] {
  return {
    roundStartTime: 0,
    players,
    projectiles: null,
    enemies: null,
    rocks: null,
    placeableRocks: [...placeableRocks],
    reinforcementMatrices: [],
    energyInjectorEffects: [],
    energyInjectorFocus: [],
    remoteControlTurrets: [],
    decoys: [],
    smokes: [],
    fires: [],
    powerups: null,
    pedestals: null,
    nukes: [],
    airstrikes: [],
    meteors: [],
    tunnels: [],
    train: null,
    bases: [],
    captureTheBeer: null,
    coopDefenseCarry: [],
    stinkClouds: [],
    timeBubbles: [],
    teslaDomes: [],
    energyShields: [],
    guardianSpirits: [],
    repairDrones: [],
    slimeTrail: { cells: [], affectedEnemies: [] },
    targetVulnerabilities: [],
    ak47StrategicTargets: [],
    burningGround: { cells: [] },
  };
}

function worldLifecycleFor(
  publish: (world: WorldDescriptor, activity: null) => void,
  clear: () => void,
  state: { context: WorldRuntimeContext | null },
): WorldLifecycle {
  return new WorldLifecycle({
    publish,
    clear,
    attach: (context) => { state.context = context; },
    detach: () => { state.context = null; },
  });
}

describe('Schritt 22 – haertester World-ohne-Activity-Proof', () => {
  it('laeuft von World-Erzeugung bis Teardown ohne Activity Runtime', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network);
    const clientRoom = await addClientRoom(network);

    try {
      const host = bridgeFor(hostRoom);
      const client = bridgeFor(clientRoom);
      const hostWorldState = { context: null as WorldRuntimeContext | null };
      const clientWorldState = { context: null as WorldRuntimeContext | null };
      const hostLifecycle = worldLifecycleFor(
        (world, activity) => host.publishWorldAndActivity(world, activity),
        () => host.clearWorldAndActivity(),
        hostWorldState,
      );
      const clientLifecycle = worldLifecycleFor(
        () => { throw new Error('Client darf keine World erzeugen'); },
        () => { /* Client beendet nur seine lokale Runtime. */ },
        clientWorldState,
      );

      // 1. World erzeugen und an den Client replizieren – ohne Activity oder Runde.
      useRoom(hostRoom);
      hostLifecycle.beginCreate(WORLD, null);
      hostLifecycle.attachRuntime(createWorld(WORLD));
      expect(hostLifecycle.activity.phase).toBe('none');
      expect(host.getActivityDescriptor()).toBeNull();
      expect(host.getRoundState()).toBeNull();
      expect(hostWorldState.context?.definition?.sourceMapId).toBe('17');
      expect(hostWorldState.context?.persistentBaseSite).not.toBeNull();

      useRoom(clientRoom);
      expect(client.getWorldDescriptor()).toEqual(WORLD);
      const clientWorld = createWorld(client.getWorldDescriptor()!);
      expect(clientWorld.definition?.sourceMapId).toBe('17');
      clientLifecycle.attachRuntime(clientWorld, client.getActivityDescriptor());
      expect(clientLifecycle.activity.phase).toBe('none');

      // 2. Admission: Host simuliert ohne Teilnahme, Client A ist der einzige World-Spieler.
      const clientId = client.getLocalPlayerId();
      useRoom(hostRoom);
      host.hostPublishWorldParticipation({ [clientId]: 'interactive' });
      expect(host.getLocalWorldParticipation()).toBe('none');
      expect(host.getWorldParticipation(clientId)).toBe('interactive');
      expect(resolveWorldPresentation({
        participation: host.getLocalWorldParticipation(),
        worldActive: true,
      })).toEqual({ required: false, mode: 'none', surfaces: [] });
      useRoom(clientRoom);
      expect(client.getLocalWorldParticipation()).toBe('interactive');

      // 3. Vollstaendige World-Baseline zuerst; erst danach wird Client A interaktiv.
      useRoom(hostRoom);
      host.publishGameState(worldSnapshot({}, []), true);
      useRoom(clientRoom);
      const baseline = client.getLatestGameState();
      expect(baseline).toBeDefined();
      expect(baseline?.placeableRocks).toEqual([]);
      client.setLocalWorldLoadReady(WORLD.worldRevision);
      useRoom(hostRoom);
      expect(host.areWorldParticipantsLoadReady()).toBe(true);

      const anchor = hostWorldState.context!.persistentBaseSite!.anchor;
      // Gebaut wird im Innenhof: Er ist die einzige Flaeche, die der Baubereich zulaesst.
      const originGrid = { gridX: anchor.gridX + 4, gridY: anchor.gridY };
      const firstTargetGrid = { gridX: anchor.gridX + 1, gridY: anchor.gridY };
      const secondTargetGrid = { gridX: anchor.gridX - 1, gridY: anchor.gridY };
      const origin = worldCellCenter(hostWorldState.context!.metrics, originGrid.gridX, originGrid.gridY);
      const firstTarget = worldCellCenter(hostWorldState.context!.metrics, firstTargetGrid.gridX, firstTargetGrid.gridY);
      const secondTarget = worldCellCenter(hostWorldState.context!.metrics, secondTargetGrid.gridX, secondTargetGrid.gridY);

      const hostPlayers = new Map<string, HeadlessPlayer>();
      const clientPlayers = new Map<string, HeadlessPlayer>();
      const hostPlayerManager = playerManager(hostPlayers);
      const clientPlayerManager = playerManager(clientPlayers);
      const hostFeatureSteps: string[] = [];
      const clientFeatureSteps: string[] = [];
      const hostPlayerRuntime = new PlayerWorldRuntime({
        attach: [
          {
            id: 'entity',
            feature: 'entity',
            run: ({ profile }) => {
              hostFeatureSteps.push('entity');
              hostPlayers.set(profile.id, createHeadlessPlayer(profile.id, origin.x, origin.y));
            },
          },
          ...(['navigation', 'combat', 'combatResources', 'loadoutTools', 'playerBuild', 'worldTargeting'] as const).map((feature) => ({
            id: feature,
            feature,
            run: () => { hostFeatureSteps.push(feature); },
          })),
        ],
        detach: [{
          id: 'entity',
          feature: 'entity',
          run: (id) => { hostFeatureSteps.push(`detach:${id}`); hostPlayers.delete(id); },
        }],
      });
      const clientPlayerRuntime = new PlayerWorldRuntime({
        attach: [{
          id: 'entity',
          feature: 'entity',
          run: ({ profile }) => {
            clientFeatureSteps.push('entity');
            clientPlayers.set(profile.id, createHeadlessPlayer(profile.id, origin.x, origin.y));
          },
        }],
        detach: [{
          id: 'entity',
          feature: 'entity',
          run: (id) => { clientFeatureSteps.push(`detach:${id}`); clientPlayers.delete(id); },
        }],
      });
      const profile = host.getConnectedPlayers().find((candidate) => candidate.id === clientId);
      if (!profile) throw new Error('Client-Profil fehlt im Host-Roster');
      const hostFeatures = resolvePlayerRuntimeFeatures({
        isHost: true,
        participation: 'interactive',
      });
      const clientFeatures = resolvePlayerRuntimeFeatures({
        isHost: false,
        participation: 'interactive',
      });
      // Missionsgebundene Spielermodule gibt es hier nicht einmal als Feature: Sie gehoeren
      // seit der Player-Lifetime-Trennung der Activity und nicht der World.
      expect(Object.keys(hostFeatures)).not.toContain('missionStatus');
      expect(hostFeatures.playerBuild).toBe(true);
      expect(clientFeatures.playerBuild).toBe(false);
      expect(resolvePlayerCapabilities({ participation: 'interactive', activityKind: null, worldCombatAllowed: false })).toMatchObject({
        canMove: true,
        canPlace: true,
        canDismantle: true,
        canUseCombat: false,
      });
      expect(hostPlayerRuntime.attach({ profile, reconnectAfterDeath: false, nowMs: 0 }, hostFeatures)).toBe(true);
      useRoom(clientRoom);
      expect(clientPlayerRuntime.attach({ profile, reconnectAfterDeath: false, nowMs: 0 }, clientFeatures)).toBe(true);
      expect(hostFeatureSteps).toEqual([
        'entity',
        'navigation',
        'combat',
        'combatResources',
        'loadoutTools',
        'playerBuild',
        'worldTargeting',
      ]);
      expect(clientFeatureSteps).toEqual(['entity']);

      // 4. Client-Input -> Host-Physics: Bewegung und persistenter Collider laufen ohne Darstellung.
      const colliderCalls: unknown[][] = [];
      const scene = {
        physics: {
          add: {
            collider: vi.fn((...args: unknown[]) => {
              colliderCalls.push(args);
              return { active: true, destroy: vi.fn() };
            }),
          },
        },
      } as unknown as Phaser.Scene;
      const combatSystem = { isAlive: () => true } as unknown as CombatSystem;
      const hostPhysics = new HostPhysicsSystem(scene, hostPlayerManager, host, combatSystem);
      const rockGroup = {} as unknown as Phaser.Physics.Arcade.StaticGroup;
      hostPhysics.setRockGroup(rockGroup, null);
      hostPhysics.setCanMoveResolver((id) => resolvePlayerCapabilities({
        participation: host.getWorldParticipation(id),
        activityKind: host.getActivityDescriptor()?.kind ?? null,
        worldCombatAllowed: false,
      }).canMove);
      useRoom(clientRoom);
      client.sendLocalInput({ dx: 1, dy: 0, aim: 0, dashHeld: false });
      clientRoom.room.update();
      useRoom(hostRoom);
      hostPhysics.update(false);
      const hostPlayer = hostPlayers.get(clientId)!;
      expect(hostPlayer.physicsProxy.body.velocity).toEqual({ x: PLAYER_SPEED, y: 0 });
      expect(colliderCalls).toHaveLength(1);
      expect(colliderCalls[0]?.[0]).toBe(hostPlayer.physicsProxy);
      expect(colliderCalls[0]?.[1]).toBe(rockGroup);

      // 5. Client-Vorschau -> Host-Placement -> Construction-Mutation.
      const hostPlacement = new PlacementSystem(
        LAYOUT,
        new RockGridIndex(LAYOUT.rocks, {
          cols: hostWorldState.context!.metrics.gridCols,
          rows: hostWorldState.context!.metrics.gridRows,
        }),
        hostPlayerManager,
        hostWorldState.context!.metrics,
        hostWorldState.context!.bases,
      );
      const clientPlacement = new PlacementSystem(
        LAYOUT,
        new RockGridIndex(LAYOUT.rocks, {
          cols: clientWorld.metrics.gridCols,
          rows: clientWorld.metrics.gridRows,
        }),
        clientPlayerManager,
        clientWorld.metrics,
        clientWorld.bases,
      );
      const construction = COOP_DEFENSE_CONSTRUCTIONS.rock_barrier;
      useRoom(clientRoom);
      expect(clientPlacement.getConstructionPlacementPreview(
        construction,
        origin.x,
        origin.y,
        firstTarget.x,
        firstTarget.y,
      )).toMatchObject({ isValid: true, gridX: firstTargetGrid.gridX, gridY: firstTargetGrid.gridY });

      useRoom(hostRoom);
      // Ein einziger Besitzpfad: Die Konstruktion des Gastes laeuft ueber denselben Beitragsspeicher
      // wie die des Hosts, nur unter einer anderen Besitzeridentitaet.
      const contributionSession = new PersistentBaseRoomSession();
      const contributions = contributionSession.contributions;
      const buildArea = hostWorldState.context!.persistentBaseSite!.buildArea;
      contributionSession.beginTransaction({ worldRevision: 21, activityRevision: 7 });
      const placed = hostPlacement.tryPlaceConstruction(
        construction,
        construction.maxHp,
        clientId,
        0x52d273,
        origin.x,
        origin.y,
        firstTarget.x,
        firstTarget.y,
      );
      expect(placed).not.toBeNull();
      expect(hostPlacement.canPlaceSingleCell(firstTargetGrid.gridX, firstTargetGrid.gridY)).toBe(false);
      expect(contributions.registerNew(
        'owner-guest',
        placed!,
        construction,
        construction.footprint,
        anchor,
        buildArea,
      )).toMatchObject({ origin: 'new' });
      const confirmed = contributionSession.completeTransaction('commit', (id) => hostPlacement.hasRuntimeRock(id));
      expect(confirmed).toHaveLength(1);
      expect(confirmed[0]).toMatchObject({ ownerId: 'owner-guest', revision: 1 });
      expect(confirmed[0]?.constructions).toHaveLength(1);

      // 6. Die Construction-Mutation wird als World-Snapshot repliziert, nicht als Activity-Zustand.
      useRoom(hostRoom);
      host.publishGameState(worldSnapshot({ [clientId]: playerState(hostPlayer.x, hostPlayer.y) }, hostPlacement.getNetSnapshot()), true);
      useRoom(clientRoom);
      let replicated = client.getLatestGameState();
      expect(replicated?.placeableRocks).toHaveLength(1);
      expect(replicated?.placeableRocks[0]).toMatchObject({ gridX: firstTargetGrid.gridX, gridY: firstTargetGrid.gridY });
      clientPlacement.syncFromSnapshot(replicated!.placeableRocks);
      expect(clientPlacement.getRuntimeRock(replicated!.placeableRocks[0]!.id)).toMatchObject({
        gridX: firstTargetGrid.gridX,
        gridY: firstTargetGrid.gridY,
      });

      useRoom(hostRoom);
      hostPlacement.applyDamage(placed!.id, 40, clientId);
      hostPlacement.updateAngle(placed!.id, Math.PI / 3);
      host.publishGameState(worldSnapshot({ [clientId]: playerState(hostPlayer.x, hostPlayer.y) }, hostPlacement.getNetSnapshot()), true);
      useRoom(clientRoom);
      replicated = client.getLatestGameState();
      clientPlacement.syncFromSnapshot(replicated!.placeableRocks);
      expect(replicated?.placeableRocks[0]).toMatchObject({ hp: construction.maxHp - 40, angle: Math.PI / 3 });

      // 7. Repositionieren erzeugt einen neuen autoritativen Runtime-Eintrag; der alte wird entfernt.
      useRoom(hostRoom);
      // Die naechste Mission bindet den bestaetigten Blueprint wieder an sein Runtime-Objekt -
      // genau das tut sonst der Composite-Merge. Erst dann ist ein Abriss ueberhaupt moeglich.
      contributionSession.beginTransaction({ worldRevision: 21, activityRevision: 7 });
      contributions.registerRestored('owner-guest', confirmed[0]!.constructions[0]!, placed!.id);
      // Abriss gibt den Besitz auf; ein Konflikt haette den Blueprint dagegen stehen lassen.
      hostPlacement.removeRock(placed!.id);
      expect(contributions.removeByRuntimeId(placed!.id)).toBe(true);
      const repositioned = hostPlacement.tryPlaceConstruction(
        construction,
        construction.maxHp,
        clientId,
        0x52d273,
        origin.x,
        origin.y,
        secondTarget.x,
        secondTarget.y,
      );
      expect(repositioned).not.toBeNull();
      expect(contributions.registerNew(
        'owner-guest',
        repositioned!,
        construction,
        construction.footprint,
        anchor,
        buildArea,
      )).toMatchObject({ origin: 'new' });
      const repositionedConfirmed = contributionSession.completeTransaction('commit', (id) => hostPlacement.hasRuntimeRock(id));
      // Die vorige Konstruktion ist entfernt; ihr Blueprint faellt mit ihrem Runtime-Objekt.
      expect(repositionedConfirmed[0]?.constructions).toEqual([
        expect.objectContaining({ relativeGridX: secondTargetGrid.gridX - anchor.gridX }),
      ]);
      host.publishGameState(worldSnapshot({ [clientId]: playerState(hostPlayer.x, hostPlayer.y) }, hostPlacement.getNetSnapshot()), true);
      useRoom(clientRoom);
      replicated = client.getLatestGameState();
      clientPlacement.syncFromSnapshot(replicated!.placeableRocks);
      expect(clientPlacement.getRuntimeRock(placed!.id)).toBeUndefined();
      expect(clientPlacement.getRuntimeRock(repositioned!.id)).toMatchObject({
        gridX: secondTargetGrid.gridX,
        gridY: secondTargetGrid.gridY,
      });

      // 8. Dismantle, Player-Detach und World-Zerstoerung lassen den Room bestehen.
      useRoom(hostRoom);
      contributionSession.beginTransaction({ worldRevision: 21, activityRevision: 7 });
      contributions.registerRestored(
        'owner-guest',
        repositionedConfirmed[0]!.constructions[0]!,
        repositioned!.id,
      );
      hostPlacement.removeRock(repositioned!.id);
      expect(contributions.removeByRuntimeId(repositioned!.id)).toBe(true);
      expect(contributionSession.completeTransaction('commit', (id) => hostPlacement.hasRuntimeRock(id))[0]?.constructions).toEqual([]);
      host.publishGameState(worldSnapshot({}, hostPlacement.getNetSnapshot()), true);
      hostPlayerRuntime.detach(clientId);
      useRoom(clientRoom);
      replicated = client.getLatestGameState();
      clientPlacement.syncFromSnapshot(replicated!.placeableRocks);
      clientPlayerRuntime.detach(clientId);
      expect(clientPlacement.getAllRuntimeRocks()).toEqual([]);
      expect(hostPlayers.has(clientId)).toBe(false);
      expect(clientPlayers.has(clientId)).toBe(false);

      useRoom(hostRoom);
      hostLifecycle.endInstance();
      useRoom(clientRoom);
      clientLifecycle.endInstance();
      expect(hostLifecycle.phase).toBe('none');
      expect(clientLifecycle.phase).toBe('none');
      expect(host.getWorldDescriptor()).toBeNull();
      expect(client.getWorldDescriptor()).toBeNull();
      useRoom(hostRoom);
      expect(host.getConnectedPlayerIds().sort()).toEqual(['p0', clientId].sort());
    } finally {
      clearActiveSession();
    }
  });
});
