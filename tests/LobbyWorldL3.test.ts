import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
    Angle: { Between: (x1: number, y1: number, x2: number, y2: number) => Math.atan2(y2 - y1, x2 - x1) },
    Distance: { Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1) },
  },
}));

import { buildLobbyWorldLayout } from '../src/arena/LobbyWorldLayout';
import { getPersistentBaseGravelCells } from '../src/arena/PersistentBaseGravelField';
import { RockGridIndex } from '../src/arena/RockGridIndex';
import { getAuthoredWorldMetricsProfile, HP_MAX } from '../src/config';
import { COOP_DEFENSE_CONSTRUCTIONS } from '../src/config/coopDefenseConstructions';
import { LOBBY_WORLD_DEFINITION_ID, getLobbyWorldDefinition } from '../src/config/authoring/lobbyWorld';
import type { PlayerEntity } from '../src/entities/PlayerEntity';
import type { PlayerManager } from '../src/entities/PlayerManager';
import { NetworkBridge } from '../src/network/NetworkBridge';
import { clearActiveSession, setActiveSession } from '../src/network/peer/session';
import { CoopDefensePlayerModifierSystem } from '../src/systems/CoopDefensePlayerModifierSystem';
import { PlacementSystem } from '../src/systems/PlacementSystem';
import type { LobbyLoadoutPreviewState, PlayerNetState, SyncedPlaceableRock, SyncedRockSnapshot } from '../src/types';
import { resolvePlayerCapabilities } from '../src/world/PlayerCapabilities';
import { PlayerWorldRuntime, resolvePlayerRuntimeFeatures } from '../src/world/PlayerWorldRuntime';
import { createAuthoredWorldDescriptor } from '../src/world/WorldLayout';
import { resolveActiveGameMode, toWorldDefinitionId } from '../src/world/arenaDescriptorAdapter';
import { worldCellCenter } from '../src/world/WorldMetrics';
import {
  hasPersistentBaseConfigurationChanged,
  hasPersistentBaseUnlockStatusChanged,
} from '../src/world/WorldDescriptor';
import { resolveWorldPresentation } from '../src/world/WorldPresentation';
import { consumesWorldReplication } from '../src/world/WorldReplication';
import { createWorldRuntimeContext } from '../src/world/WorldRuntimeContext';
import { WorldLifecycle } from '../src/world/WorldLifecycle';
import { FakeNetwork, addClientRoom, createHostRoom, type TestRoom } from './fakePeerNetwork';

const LOBBY_WORLD = getLobbyWorldDefinition();

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function bridgeFor(room: TestRoom): NetworkBridge {
  setActiveSession({ room: room.room, transport: room.transport, roomCode: 'LOBBYL3' });
  const bridge = new NetworkBridge();
  bridge.activate();
  return bridge;
}

function useRoom(room: TestRoom): void {
  setActiveSession({ room: room.room, transport: room.transport, roomCode: 'LOBBYL3' });
}

function playerState(x: number, y: number, alive = true): PlayerNetState {
  return {
    x,
    y,
    rot: 0,
    hp: alive ? 100 : 0,
    maxHp: 100,
    armor: 0,
    alive,
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
      isMoving: true,
      weapon1DynamicSpread: 0,
      weapon2DynamicSpread: 0,
    },
  };
}

function placeable(id: number, ownerId: string): SyncedPlaceableRock {
  return {
    id,
    kind: 'rock',
    constructionId: 'rock_barrier',
    gridX: 20,
    gridY: 12,
    hp: 200,
    maxHp: 200,
    ownerId,
    ownerColor: 0x52d273,
    expiresAt: 0,
    warningStartsAt: 0,
    angle: 0,
    ownership: 'guest-session',
    toolRef: { kind: 'construction', id: 'rock_barrier' },
  };
}

function lobbyPlacementFixture(): {
  readonly placement: PlacementSystem;
  readonly player: { id: string; x: number; y: number };
  readonly target: { x: number; y: number };
} {
  const layout = buildLobbyWorldLayout();
  const metricsProfile = getAuthoredWorldMetricsProfile(
    LOBBY_WORLD.metrics.widthCells,
    LOBBY_WORLD.metrics.heightCells,
  );
  const descriptor = createAuthoredWorldDescriptor(LOBBY_WORLD_DEFINITION_ID, 7304);
  const world = createWorldRuntimeContext({ descriptor, metricsProfile, definition: LOBBY_WORLD });
  const blocked = new Set([
    ...layout.rocks.map((cell) => `${cell.gridX}:${cell.gridY}`),
    ...layout.trees.map((cell) => `${cell.gridX}:${cell.gridY}`),
  ]);
  let originCell: { gridX: number; gridY: number } | null = null;
  let targetCell: { gridX: number; gridY: number } | null = null;
  for (let gridY = 1; gridY < world.metrics.gridRows - 1 && !originCell; gridY += 1) {
    for (let gridX = 1; gridX < world.metrics.gridCols - 2; gridX += 1) {
      if (blocked.has(`${gridX}:${gridY}`) || blocked.has(`${gridX + 1}:${gridY}`)) continue;
      originCell = { gridX, gridY };
      targetCell = { gridX: gridX + 1, gridY };
      break;
    }
  }
  if (!originCell || !targetCell) throw new Error('LobbyWorld hat kein freies Placement-Zellpaar');
  const origin = worldCellCenter(world.metrics, originCell.gridX, originCell.gridY);
  const target = worldCellCenter(world.metrics, targetCell.gridX, targetCell.gridY);
  const player = { id: 'p0', active: true, x: origin.x, y: origin.y };
  const playerManager = {
    getPlayer: (id: string) => id === player.id ? player : undefined,
    getAllPlayers: () => [player] as unknown as PlayerEntity[],
  } as unknown as PlayerManager;
  return {
    placement: new PlacementSystem(
      layout,
      new RockGridIndex(layout.rocks, { cols: world.metrics.gridCols, rows: world.metrics.gridRows }),
      playerManager,
      world.metrics,
      world.bases,
    ),
    player,
    target,
  };
}

function worldSnapshot(
  players: Record<string, PlayerNetState>,
  rocks: SyncedRockSnapshot,
  placeableRocks: readonly SyncedPlaceableRock[],
): Parameters<NetworkBridge['publishGameState']>[0] {
  return {
    roundStartTime: 0,
    players,
    projectiles: null,
    enemies: null,
    rocks,
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

afterEach(() => clearActiveSession());

describe('LobbyWorld L3 – Leave und lokale Presentation', () => {
  it('verarbeitet den Runtime-Detach vor dem Preview-Replication-Gate', () => {
    const source = read('src/scenes/arena/ClientUpdateCoordinator.ts');
    const start = source.indexOf('  runClientUpdate(delta: number): void {');
    const end = source.indexOf('\n  getPerformanceMetrics()', start);
    const update = source.slice(start, end);
    expect(update.indexOf('this.syncPlayerWorldRuntimes(state);')).toBeGreaterThanOrEqual(0);
    expect(update.indexOf('this.syncPlayerWorldRuntimes(state);'))
      .toBeLessThan(update.indexOf('consumesWorldReplication({'));
    expect(update).not.toContain("bridge.getLocalWorldParticipation() === 'none') {");
    expect(update).toContain("bridge.getLocalWorldParticipation() === 'interactive'");
  });

  it('aktiviert lokale Player-Presentation nur mit Surface und echter Runtime', () => {
    const frameBinding = read('src/world/WorldPresentationFrameBinding.ts');
    expect(frameBinding).toContain("'localPlayerVisuals',");
    expect(frameBinding).toContain('this.input.isLocalPlayerAttachedToWorld()');
    expect(frameBinding).toContain('this.input.setLocalPlayerStatusRingActive(localPlayerVisuals && !spectator);');
    expect(frameBinding).not.toContain('setLocalPlayerStatusRingActive(showWorld && !spectator)');
  });

  it('erzeugt bei join -> leave -> join eine neue Entity und keinen stale Runtime-Eintrag', () => {
    let nextEntityId = 0;
    const entities = new Map<string, number>();
    const detach = vi.fn((playerId: string) => { entities.delete(playerId); });
    const runtime = new PlayerWorldRuntime({
      attach: [{
        id: 'entity',
        feature: 'entity',
        run: ({ profile }) => { entities.set(profile.id, ++nextEntityId); },
      }],
      detach: [{ id: 'entity', feature: 'entity', run: detach }],
    });
    const features = resolvePlayerRuntimeFeatures({
      activityKind: null,
      isHost: false,
      participation: 'interactive',
    });
    const profile = { id: 'p1', name: 'Client', colorHex: 0x52d273 };

    expect(runtime.attach({ profile, reconnectAfterDeath: false }, features)).toBe(true);
    expect(entities.get('p1')).toBe(1);
    runtime.detach('p1', features);
    expect(runtime.isAttached('p1')).toBe(false);
    expect(entities.has('p1')).toBe(false);
    runtime.detach('p1', features);
    expect(runtime.attach({ profile, reconnectAfterDeath: false }, features)).toBe(true);
    expect(entities.get('p1')).toBe(2);
    expect(detach).toHaveBeenCalledTimes(1);
  });
});

describe('LobbyWorld L3 – Preview ist passiv, aber aktuell', () => {
  it('liefert einem dritten Preview-Peer Spieler, World-Mutationen und Combat-FX', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network);
    const clientARoom = await addClientRoom(network);
    const previewRoom = await addClientRoom(network);
    const host = bridgeFor(hostRoom);
    const clientA = bridgeFor(clientARoom);
    const preview = bridgeFor(previewRoom);

    useRoom(hostRoom);
    host.publishLobbySync();
    host.setMatchHostId();
    host.publishWorldAndActivity(createAuthoredWorldDescriptor(LOBBY_WORLD_DEFINITION_ID, 7301), null);
    host.hostPublishWorldParticipation({ p0: 'interactive', p1: 'interactive' });

    useRoom(previewRoom);
    const previewPresentation = resolveWorldPresentation({
      participation: preview.getLocalWorldParticipation(),
      worldActive: preview.getWorldDescriptor() !== null,
      previewWithoutParticipation: LOBBY_WORLD.presentationPolicy?.previewWithoutParticipation,
    });
    expect(preview.getLocalPlayerId()).toBe('p2');
    expect(preview.getLocalWorldParticipation()).toBe('none');
    expect(previewPresentation.mode).toBe('preview');
    expect(consumesWorldReplication({
      worldActive: true,
      participation: preview.getLocalWorldParticipation(),
      presentation: previewPresentation,
    })).toBe(true);
    expect(resolvePlayerCapabilities({
      participation: preview.getLocalWorldParticipation(),
      activityKind: null,
      worldCombatAllowed: true,
    })).toMatchObject({ canMove: false, canUseCombat: false, canPlace: false, canInteract: false });

    const explosionFx = vi.fn();
    preview.registerExplosionEffectHandler(explosionFx);
    const construction = placeable(41, 'p0');
    useRoom(hostRoom);
    host.publishGameState(worldSnapshot(
      { p0: playerState(120, 160), p1: playerState(220, 260) },
      { full: true, count: 2, upserts: [{ id: 7, hp: 80 }], removals: [8] },
      [construction],
    ), true);
    host.broadcastExplosionEffect(120, 160, 48, 0xffaa44, 'rocket');

    useRoom(previewRoom);
    let state = preview.getLatestGameState();
    expect(state?.players.p0).toMatchObject({ x: 120, y: 160, alive: true });
    expect(state?.players.p1).toMatchObject({ x: 220, y: 260, alive: true });
    expect(state?.rocks).toEqual([{ id: 7, hp: 80 }]);
    expect(state?.rockRemovals).toEqual([8]);
    expect(state?.placeableRocks).toEqual([construction]);
    expect(explosionFx).toHaveBeenCalledWith(120, 160, 48, 0xffaa44, 'rocket');

    // Movement, Death/Respawn und Dismantle bleiben normale World-Snapshots.
    useRoom(hostRoom);
    host.publishGameState(worldSnapshot(
      { p0: playerState(180, 200), p1: playerState(220, 260, false) },
      { full: true, count: 1, upserts: [], removals: [8] },
      [],
    ), true);
    useRoom(previewRoom);
    state = preview.getLatestGameState();
    expect(state?.players.p0).toMatchObject({ x: 180, y: 200 });
    expect(state?.players.p1.alive).toBe(false);
    expect(state?.placeableRocks).toEqual([]);

    useRoom(hostRoom);
    host.publishGameState(worldSnapshot(
      { p0: playerState(180, 200), p1: playerState(320, 360, true) },
      { full: true, count: 1, upserts: [], removals: [8] },
      [],
    ), true);
    useRoom(previewRoom);
    expect(preview.getLatestGameState()?.players.p1).toMatchObject({
      x: 320,
      y: 360,
      alive: true,
    });
    useRoom(clientARoom);
    expect(clientA.getLocalPlayerId()).toBe('p1');
  });

  it('verdrahtet denselben Client-Renderer-Consumer fuer Activity und Activity-lose World', () => {
    const scene = read('src/scenes/ArenaScene.ts');
    const runtime = read('src/scenes/arena/ArenaRuntime.ts');
    const frameBinding = read('src/world/WorldPresentationFrameBinding.ts');
    const noActivityStart = scene.indexOf('  private runArenaWorldWithoutActivityFrame(');
    const noActivityEnd = scene.indexOf('  // ── Network events ───', noActivityStart);
    expect(noActivityStart).toBeGreaterThanOrEqual(0);
    expect(noActivityEnd).toBeGreaterThan(noActivityStart);
    const noActivity = scene.slice(noActivityStart, noActivityEnd);
    expect(scene).toContain('this.runArenaWorldWithoutActivityFrame(');
    expect(noActivity).toContain('this.arenaRuntime.runClientFrame(delta);');
    expect(noActivity).toContain('this.arenaRuntime.syncWorldClientPresentation(');
    expect(scene).not.toContain('syncClientWorldSnapshotPresentation');
    expect(runtime).toContain('presentationFrame?.syncClientWorldPresentation(');
    expect(frameBinding).toContain('syncClientWorldPresentation(');
    expect(frameBinding).toContain('if (this.destroyed || !this.input.getLocalWorldPresentation().required) return;');
  });
});

describe('LobbyWorld L3 – PvP und keine Match-Konsequenzen', () => {
  it('wendet in derselben World DM-, Coop-, TDM- und CTB-Beziehungen an', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network);
    await addClientRoom(network);
    await addClientRoom(network);
    const host = bridgeFor(hostRoom);
    useRoom(hostRoom);
    host.publishLobbySync();
    host.setMatchHostId();
    host.publishWorldAndActivity(createAuthoredWorldDescriptor(LOBBY_WORLD_DEFINITION_ID, 7302), null);
    host.hostPublishWorldParticipation({ p0: 'interactive', p1: 'interactive', p2: 'interactive' });

    expect(LOBBY_WORLD.actionPolicy?.playerRelationships).toBe('game-mode');
    host.setGameMode('deathmatch');
    expect(host.areTeammates('p0', 'p1')).toBe(false);
    expect(host.isEnemyPair('p0', 'p1')).toBe(true);
    expect(host.isEnemyPair('p0', 'p0')).toBe(false);

    host.setGameMode('coop_defense');
    expect(host.areTeammates('p0', 'p1')).toBe(true);
    expect(host.isEnemyPair('p0', 'p1')).toBe(false);

    host.setGameMode('team_deathmatch');
    host.hostAssignMissingTeams('team_deathmatch');
    const blueIds = ['p0', 'p1', 'p2'].filter((id) => host.getPlayerTeam(id) === 'blue');
    const redIds = ['p0', 'p1', 'p2'].filter((id) => host.getPlayerTeam(id) === 'red');
    expect(blueIds.length).toBeGreaterThan(0);
    expect(redIds.length).toBeGreaterThan(0);
    const sameTeamIds = blueIds.length >= 2 ? blueIds : redIds;
    expect(sameTeamIds.length).toBeGreaterThanOrEqual(2);
    expect(host.areTeammates(sameTeamIds[0], sameTeamIds[1])).toBe(true);
    expect(host.isEnemyPair(blueIds[0], redIds[0])).toBe(true);
    expect(host.areTeammates(blueIds[0], redIds[0])).toBe(false);

    host.setGameMode('capture_the_beer');
    expect(host.areTeammates(sameTeamIds[0], sameTeamIds[1])).toBe(true);
    expect(host.areTeammates(blueIds[0], redIds[0])).toBe(false);
    expect(host.isEnemyPair(blueIds[0], redIds[0])).toBe(true);

    // Die Bridge verwaltet hier nur die kanonische Raum-Auswahl und ihre bestehenden
    // Nebenwirkungen; die World-Reinstance-Orchestrierung gehoert dem Lifecycle-Coordinator.
    expect(host.getGameMode()).toBe('capture_the_beer');
  });

  it('repliziert den Live-Coop-Build getrennt vom Commit und raeumt ihn beim Moduswechsel auf', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network);
    const clientRoom = await addClientRoom(network);
    const host = bridgeFor(hostRoom);
    const client = bridgeFor(clientRoom);
    useRoom(hostRoom);
    host.publishLobbySync();
    host.setMatchHostId();
    host.setGameMode('coop_defense');
    host.publishWorldAndActivity(createAuthoredWorldDescriptor(LOBBY_WORLD_DEFINITION_ID, 7305), null);
    host.hostPublishWorldParticipation({ p0: 'interactive', p1: 'interactive' });

    const livePreview: LobbyLoadoutPreviewState = {
      coopDefenseClassId: 'inspector_gadachs',
      coopDefenseProfile: {
        upgrades: { hp: { unlocked: true, level: 2 } },
        toolLoadout: [{ kind: 'construction', id: 'rock_barrier' }],
      },
      equippedItems: [{
        uid: 'live-helmet',
        slot: 'helmet',
        rarity: 'blue',
        itemLevel: 1,
        baseValue: 1,
        affixes: [],
      }],
      tools: [{ kind: 'construction', id: 'rock_barrier' }],
    };
    useRoom(clientRoom);
    client.setLocalLoadoutSlot('weapon1', 'AK47');
    client.setLocalLobbyLoadoutPreview(livePreview);

    useRoom(hostRoom);
    const current = host.getPlayerCurrentLoadoutSnapshot('p1');
    expect(current?.weapon1).toBe('AK47');
    expect(current?.coopDefenseClassId).toBe('inspector_gadachs');
    expect(current?.coopDefenseProfile?.upgrades.hp.level).toBe(2);
    expect(current?.equippedItems).toHaveLength(1);
    expect(current?.tools).toEqual([{ kind: 'construction', id: 'rock_barrier' }]);
    expect(host.getPlayerCommittedLoadout('p1')).toBeNull();

    // Shooting range and Match verwenden dieselbe kanonische Modifier-Aufloesung; nur die
    // Quelle des kleinen Coop-Build-Anteils unterscheidet sich.
    const liveRuntime = new CoopDefensePlayerModifierSystem();
    const matchRuntime = new CoopDefensePlayerModifierSystem();
    liveRuntime.syncPlayer('p1', current);
    matchRuntime.syncPlayer('p1', { ...current });
    expect(liveRuntime.getMaxHp('p1')).toBeGreaterThan(HP_MAX);
    expect(liveRuntime.getMaxHp('p1')).toBe(matchRuntime.getMaxHp('p1'));

    host.setGameMode('deathmatch');
    const cleared = host.getPlayerCurrentLoadoutSnapshot('p1');
    expect(cleared?.coopDefenseClassId).toBeNull();
    expect(cleared?.coopDefenseProfile).toBeNull();
    expect(cleared?.equippedItems).toEqual([]);

    // Der Scene-Tick publiziert im Nicht-Coop-Modus einen leeren Live-Build. Beim Rueckwechsel
    // kann die neue Coop-World bereits aufgebaut werden, bevor der Spieler seinen Coop-Build im
    // spaeteren Teil desselben (oder eines folgenden) Ticks erneut angeboten hat.
    useRoom(clientRoom);
    client.setLocalLobbyLoadoutPreview({
      coopDefenseClassId: null,
      coopDefenseProfile: null,
      equippedItems: [],
      tools: [],
    });

    useRoom(hostRoom);
    host.setGameMode('coop_defense');
    const staleAtWorldBuild = host.getPlayerCurrentLoadoutSnapshot('p1');
    expect(staleAtWorldBuild?.coopDefenseClassId).toBeNull();
    expect(staleAtWorldBuild?.tools ?? []).toEqual([]);

    useRoom(clientRoom);
    client.setLocalLobbyLoadoutPreview(livePreview);

    useRoom(hostRoom);
    const restored = host.getPlayerCurrentLoadoutSnapshot('p1');
    expect(restored?.coopDefenseClassId).toBe('inspector_gadachs');
    expect(restored?.coopDefenseProfile).not.toBeNull();
    expect(restored?.equippedItems).toHaveLength(1);
    expect(restored?.tools).toEqual([{ kind: 'construction', id: 'rock_barrier' }]);
  });

  it('schreibt ohne Activity weder Frags noch Room-Statistik und erzeugt keine Kill-Drops', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network);
    await addClientRoom(network);
    const host = bridgeFor(hostRoom);
    useRoom(hostRoom);
    host.publishLobbySync();
    host.setMatchHostId();
    host.publishWorldAndActivity(createAuthoredWorldDescriptor(LOBBY_WORLD_DEFINITION_ID, 7303), null);
    host.hostPublishWorldParticipation({ p0: 'interactive', p1: 'interactive' });

    host.incrementPlayerFrags('p0');
    host.recordPlayerKill('p0', 'pvp');
    host.recordPlayerDeath('p1');
    host.addPlayerRoomDamage('p0', 75);
    expect(host.getPlayerFrags('p0')).toBe(0);
    expect(host.getPlayerRoomDamage('p0')).toBe(0);
    expect(host.getPlayerRoomDeaths('p1')).toBe(0);
    expect(host.getRoundResultEligiblePlayerIds()).toEqual([]);

    const lifecycle = read('src/world/WorldCombatGameplayBinding.ts');
    expect(lifecycle).toContain('const allowKillDrop = o.isActivityActive() && !o.isCoopMission();');
  });
});

describe('LobbyWorld L3 – Placement und Dismantle', () => {
  it('verwendet in der LobbyWorld den normalen World-lifetime PlacementSystem-Pfad', () => {
    const { placement, player, target } = lobbyPlacementFixture();
    const construction = COOP_DEFENSE_CONSTRUCTIONS.rock_barrier;
    const placed = placement.tryPlaceConstruction(
      construction,
      construction.maxHp,
      player.id,
      0x52d273,
      player.x,
      player.y,
      target.x,
      target.y,
      'guest-session',
    );
    expect(placed).toMatchObject({
      ownerId: player.id,
      constructionId: 'rock_barrier',
      ownership: 'guest-session',
    });
    expect(placement.getNetSnapshot()).toHaveLength(1);

    expect(placement.removeRockAt(
      placed!.gridX,
      placed!.gridY,
      'anderer-spieler',
      'guest-session',
    )).toBeUndefined();
    expect(placement.removeRockAt(
      placed!.gridX,
      placed!.gridY,
      player.id,
      'guest-session',
    )).toMatchObject({ id: placed!.id });
    expect(placement.getNetSnapshot()).toEqual([]);
  });
});

describe('LobbyWorld L4 – Fast-Reinstance bei GameMode-Wechsel', () => {
  it('startet eine neue World ohne Activity und leert die World-Teilnahme', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network);
    const clientRoom = await addClientRoom(network);
    const host = bridgeFor(hostRoom);
    const client = bridgeFor(clientRoom);

    useRoom(hostRoom);
    host.publishWorldAndActivity(createAuthoredWorldDescriptor(LOBBY_WORLD_DEFINITION_ID, 7310), null);
    host.hostPublishWorldParticipation({ p0: 'interactive', p1: 'interactive' });
    useRoom(clientRoom);
    client.sendLocalInput({ dx: 1, dy: 0, aim: 0.5, dashHeld: true });

    useRoom(hostRoom);
    host.publishGameState(worldSnapshot(
      { p0: playerState(100, 100), p1: playerState(200, 200) },
      { full: true, count: 0, upserts: [], removals: [] },
      [placeable(77, 'p0')],
    ), true);
    useRoom(clientRoom);
    expect(client.getLatestGameState()?.worldRevision).toBe(7310);
    expect(client.getLocalWorldParticipation()).toBe('interactive');

    useRoom(hostRoom);
    host.publishWorldAndActivity(createAuthoredWorldDescriptor(LOBBY_WORLD_DEFINITION_ID, 7311), null);
    expect(host.getActivityDescriptor()).toBeNull();
    expect(host.getWorldParticipation('p0')).toBe('none');
    expect(host.getWorldParticipation('p1')).toBe('none');
    expect(host.getPlayerInput('p1')).toBeUndefined();

    useRoom(clientRoom);
    expect(client.getWorldDescriptor()?.worldRevision).toBe(7311);
    expect(client.getActivityDescriptor()).toBeNull();
    expect(client.getLocalWorldParticipation()).toBe('none');
    expect(client.getLatestGameState()).toBeUndefined();
    expect(resolveWorldPresentation({
      participation: client.getLocalWorldParticipation(),
      worldActive: true,
      previewWithoutParticipation: true,
    }).mode).toBe('preview');

    useRoom(hostRoom);
    host.publishGameState(worldSnapshot(
      { p0: playerState(300, 300), p1: playerState(400, 400) },
      { full: true, count: 0, upserts: [], removals: [] },
      [],
    ), true);
    useRoom(clientRoom);
    expect(client.getLatestGameState()).toMatchObject({
      worldRevision: 7311,
      players: { p0: { x: 300 }, p1: { x: 400 } },
      placeableRocks: [],
    });
  });

  it('loest die drei fachlichen Mode-Faelle ueber denselben Resolver', () => {
    expect(resolveActiveGameMode({
      activityKind: 'deathmatch',
      roomGameMode: 'coop_defense',
      worldDefinitionId: toWorldDefinitionId('17'),
    })).toBe('deathmatch');
    expect(resolveActiveGameMode({
      activityKind: null,
      roomGameMode: 'team_deathmatch',
      worldDefinitionId: LOBBY_WORLD_DEFINITION_ID,
    })).toBe('team_deathmatch');
    expect(resolveActiveGameMode({
      activityKind: null,
      roomGameMode: 'deathmatch',
      worldDefinitionId: toWorldDefinitionId('17'),
    })).toBe('coop_defense');
  });

  it('haelt bei schnellen Ersetzungen genau eine aktuelle World-Instanz', () => {
    const calls: string[] = [];
    const lifecycle = new WorldLifecycle({
      publish: (world) => calls.push(`publish:${world.worldRevision}`),
      clear: () => calls.push('clear'),
      attach: () => calls.push('attach'),
      detach: () => calls.push('detach'),
    });
    lifecycle.beginCreate(createAuthoredWorldDescriptor(LOBBY_WORLD_DEFINITION_ID, 7312), null);
    lifecycle.beginCreate(createAuthoredWorldDescriptor(LOBBY_WORLD_DEFINITION_ID, 7313), null);
    lifecycle.beginCreate(createAuthoredWorldDescriptor(LOBBY_WORLD_DEFINITION_ID, 7314), null);

    expect(lifecycle.descriptor?.worldRevision).toBe(7314);
    expect(lifecycle.phase).toBe('creating');
    expect(calls).toEqual(['publish:7312', 'publish:7313', 'publish:7314']);
  });

  it('baut nach Map-1-Unlock beim Lobby-Reinstance Basiskern und Gravel-Baubereich neu', () => {
    const lockedDescriptor = createAuthoredWorldDescriptor(LOBBY_WORLD_DEFINITION_ID, 7315);
    const unlockedDescriptor = createAuthoredWorldDescriptor(
      LOBBY_WORLD_DEFINITION_ID,
      7316,
      { persistentBaseUnlocked: true, persistentBaseAreaStage: 0 },
    );
    const definition = getLobbyWorldDefinition();
    const metricsProfile = getAuthoredWorldMetricsProfile(
      definition.metrics.widthCells,
      definition.metrics.heightCells,
    );
    const lockedWorld = createWorldRuntimeContext({
      descriptor: lockedDescriptor,
      metricsProfile,
      definition,
    });
    const unlockedWorld = createWorldRuntimeContext({
      descriptor: unlockedDescriptor,
      metricsProfile,
      definition,
    });

    expect(lockedWorld.persistentBaseSite).toBeNull();
    expect(unlockedWorld.persistentBaseSite).not.toBeNull();
    expect(hasPersistentBaseUnlockStatusChanged(lockedDescriptor, unlockedDescriptor)).toBe(true);
    expect(hasPersistentBaseUnlockStatusChanged(unlockedDescriptor, {
      ...unlockedDescriptor,
      worldRevision: 7317,
    })).toBe(false);

    const gravelCells = getPersistentBaseGravelCells(
      unlockedWorld.persistentBaseSite!.anchor,
      unlockedWorld.persistentBaseSite!.buildArea,
      unlockedWorld.metrics.gridCols,
      unlockedWorld.metrics.gridRows,
    );
    expect(gravelCells).toHaveLength(9);

    const lifecycle = read('src/scenes/arena/ArenaLifecycleCoordinator.ts');
    const composition = read('src/world/WorldComposition.ts');
    expect(lifecycle).toContain('const preserveLobbyPresentation = this.pendingLobbyWorldReinstance');
    expect(lifecycle).toContain('&& !this.pendingLobbyWorldPresentationRebuild;');
    expect(lifecycle).toContain('this.pendingLobbyWorldPresentationRebuild = true;');
    expect(lifecycle).toContain('this.prepareLobbyWorldReinstance(lobbyPresentationStructureChanged);');
    expect(composition).toContain('arena = builder.buildDynamic(layout, {');
    expect(composition).toContain('builder.rebindPresentation(');
  });

  it('aktiviert Stage 1 erst in der ersetzten LobbyWorld und laesst die alte Area unveraendert', () => {
    const stage0Descriptor = createAuthoredWorldDescriptor(
      LOBBY_WORLD_DEFINITION_ID,
      7318,
      { persistentBaseUnlocked: true, persistentBaseAreaStage: 0 },
    );
    const stage1Descriptor = createAuthoredWorldDescriptor(
      LOBBY_WORLD_DEFINITION_ID,
      7319,
      { persistentBaseUnlocked: true, persistentBaseAreaStage: 1 },
    );
    const definition = getLobbyWorldDefinition();
    const metricsProfile = getAuthoredWorldMetricsProfile(
      definition.metrics.widthCells,
      definition.metrics.heightCells,
    );
    const stage0World = createWorldRuntimeContext({
      descriptor: stage0Descriptor,
      metricsProfile,
      definition,
    });
    const stage1World = createWorldRuntimeContext({
      descriptor: stage1Descriptor,
      metricsProfile,
      definition,
    });

    expect(stage0World.persistentBaseSite?.buildArea).toEqual({ kind: 'square', sizeCells: 3 });
    expect(stage1World.persistentBaseSite?.buildArea).toEqual({ kind: 'radius', radiusCells: 5 });
    expect(stage0World.persistentBaseSite?.areaStage).toBe(0);
    expect(stage1World.persistentBaseSite?.areaStage).toBe(1);
    expect(hasPersistentBaseConfigurationChanged(stage0Descriptor, stage1Descriptor)).toBe(true);
    expect(stage0World.persistentBaseSite?.buildArea).toEqual({ kind: 'square', sizeCells: 3 });

    const lifecycle = read('src/scenes/arena/ArenaLifecycleCoordinator.ts');
    expect(lifecycle).toContain('lobbyWorldPersistentBaseAreaStageAtRevision');
    expect(lifecycle).toContain('resolveLobbyWorldParameters(persistentBaseUnlocked, persistentBaseAreaStage)');
    expect(lifecycle).toContain('hasPersistentBaseConfigurationChanged(');
  });

  it('trennt Orchestrierung, Teardown und Presentation-Rebind', () => {
    const lifecycle = read('src/scenes/arena/ArenaLifecycleCoordinator.ts');
    const composition = read('src/world/WorldComposition.ts');
    expect(lifecycle).toContain('this.prepareLobbyWorldReinstance(lobbyPresentationStructureChanged);');
    expect(lifecycle).toContain('Math.max(this.lastRoundRevision, previousRevision)');
    expect(lifecycle).toContain('this.worldLifecycle.endInstance();');
    expect(composition).toContain('builder.rebindPresentation(');
    expect(lifecycle).toContain('this.tearDownArena(reusablePresentation !== null);');
    expect(composition).toContain('enablePersistentBaseGravel: input.persistentBaseGravel !== null,');
    expect(composition).toContain('arena.groundSurface?.setPersistentBaseGravel(input.persistentBaseGravel);');

    const bridge = read('src/network/NetworkBridge.ts');
    const start = bridge.indexOf('  setGameMode(mode: GameMode): void {');
    const end = bridge.indexOf('\n  getCoopDefenseMapId(): string {', start);
    const modeSetter = bridge.slice(start, end);
    expect(modeSetter).not.toContain('WorldRuntime');
    expect(modeSetter).not.toContain('ArenaBuilder');
    expect(modeSetter).not.toContain('Presentation');

    const builder = read('src/arena/ArenaBuilder.ts');
    const rebindStart = builder.indexOf('  rebindPresentation(');
    const rebindEnd = builder.indexOf('\n  /** Erstellt die reine Presentation-Projektion', rebindStart);
    const rebind = builder.slice(rebindStart, rebindEnd);
    expect(rebind).toContain('replaceArenaLayoutContents(layout, authoredLayout);');
    expect(rebind).toContain('collectRockRebindDirtyIds(');
    expect(rebind).toContain('result.rockOverlaySurface?.refreshRegions(dirtyRockIds);');
    expect(rebind).not.toContain('result.rockOverlaySurface?.refreshAll();');
    expect(rebind).toContain('result.rockVisualSystem?.flush();');
  });
});
