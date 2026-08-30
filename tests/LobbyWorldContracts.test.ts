import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LOBBY_LAYOUT_GRID,
  LOBBY_SPAWN_FOCUS_CELL,
  LOBBY_WORLD_HEIGHT_CELLS,
  LOBBY_WORLD_WIDTH_CELLS,
  buildLobbyWorldLayout,
  isLobbyUiReservedCell,
} from '../src/arena/LobbyWorldLayout';
import { RockHpRegistry } from '../src/arena/RockHpRegistry';
import { getWorldDefinition } from '../src/config/authoring/authoredScenarios';
import {
  LOBBY_PERSISTENT_BASE_ID,
  LOBBY_WORLD_DEFINITION_ID,
  getLobbyWorldDefinition,
  isLobbyWorldDefinitionId,
} from '../src/config/authoring/lobbyWorld';
import { getPersistentBaseCoreSurfaceOffsets } from '../src/persistentBase/PersistentBaseCore';
import { isValidPersistentBaseSite } from '../src/world/WorldRuntimeContext';
import { ROCK_HP_MAX } from '../src/config';
import type { GameMode } from '../src/types';
import { NetworkBridge } from '../src/network/NetworkBridge';
import { clearActiveSession, setActiveSession } from '../src/network/peer/session';
import { resolveInputPolicy } from '../src/world/InputPolicy';
import { resolvePlayerCapabilities } from '../src/world/PlayerCapabilities';
import { resolvePlayerRuntimeFeatures } from '../src/world/PlayerWorldRuntime';
import { resolvePresentationPolicy } from '../src/world/PresentationPolicy';
import { createAuthoredWorldDescriptor, generateWorldLayout } from '../src/world/WorldLayout';
import { createWorldRuntimeContext } from '../src/world/WorldRuntimeContext';
import { getAuthoredWorldMetricsProfile } from '../src/config';
import { hasWorldRuntimeEntry, maySendWorldInput } from '../src/world/WorldParticipation';
import { resolveWorldPresentation } from '../src/world/WorldPresentation';
import { FakeNetwork, addClientRoom, createHostRoom, type TestRoom } from './fakePeerNetwork';

/**
 * L1: die Lobby ist eine echte World.
 *
 * Der Pflichtzustand, den diese Datei absichert:
 *
 *   Room: Lobby | World: LobbyWorld | Activity: null
 *   Participation: none | Presentation: preview
 *
 * Daraus darf ausdruecklich **nichts** entstehen, was eine Runde voraussetzt: keine
 * PlayerRuntime, kein World-Input, kein RoundState. Trotzdem ist die World zu sehen.
 */

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function lobbyWorldContextFor(mode: GameMode, persistentBaseUnlocked: boolean) {
  const ownsPersistentBase = mode === 'coop_defense' && persistentBaseUnlocked;
  const definition = getLobbyWorldDefinition();
  return createWorldRuntimeContext({
    descriptor: createAuthoredWorldDescriptor(
      LOBBY_WORLD_DEFINITION_ID,
      ownsPersistentBase ? 9 : 10,
      ownsPersistentBase
        ? { persistentBaseUnlocked: true, persistentBaseAreaStage: 0 }
        : undefined,
    ),
    metricsProfile: getAuthoredWorldMetricsProfile(
      definition.metrics.widthCells,
      definition.metrics.heightCells,
    ),
    definition,
  });
}

describe('LobbyWorld – Authoring', () => {
  it('ist eine regulaere WorldDefinition ohne Activity und ohne Fake-Mission', () => {
    const world = getLobbyWorldDefinition();
    expect(world.id).toBe(LOBBY_WORLD_DEFINITION_ID);
    expect(isLobbyWorldDefinitionId(world.id)).toBe(true);
    // Sie loest ueber dieselbe Registry auf wie jede adaptierte Coop-World.
    expect(getWorldDefinition(LOBBY_WORLD_DEFINITION_ID)).toBe(world);

    // Keine Coop-Map-Vorlage und keine Gleise: reine World-Geometrie.
    expect(world.sourceMapId).toBeUndefined();
    expect(world.tracks).toBeUndefined();

    // Ihre einzige Struktur ist der persistente Basiskern. Die Definition beschreibt ihn nicht
    // selbst, sondern nur seine Stelle - die Form kommt aus der kanonischen Kerngeometrie.
    expect(world.persistentBaseSite?.baseId).toBe(LOBBY_PERSISTENT_BASE_ID);
    expect(world.bases.map((base) => base.id)).toEqual([LOBBY_PERSISTENT_BASE_ID]);
    const core = world.bases[0];
    expect(core?.faction).toBe('friendly');
    expect(core?.role).toBe('main');
    expect(core?.shape).toEqual({
      kind: 'cells',
      cells: getPersistentBaseCoreSurfaceOffsets(),
    });
    // Der Anker der Stelle ist die Mittelzelle; der Shape-Ursprung liegt zwei Zellen davor.
    expect(core?.anchor).toEqual({
      kind: 'grid',
      gridX: world.persistentBaseSite!.anchor.gridX - 2,
      gridY: world.persistentBaseSite!.anchor.gridY - 2,
    });

    // Kampf ist eine ausdrueckliche World-Policy, keine Nebenwirkung einer laufenden Activity.
    expect(world.actionPolicy?.combat).toBe(true);
    // Sie ist der erste Fall, der ohne Teilnahme sichtbar sein darf ...
    expect(world.presentationPolicy?.previewWithoutParticipation).toBe(true);
    // ... und der erste, den Raum-Mitglieder von sich aus betreten duerfen: es gibt keine
    // Activity, die ihre Besetzung taktet.
    expect(world.participationPolicy?.selfAdmit).toBe(true);
  });

  it('traegt ihr Mass selbst und passt zur vollen Lobbyflaeche', () => {
    const world = getLobbyWorldDefinition();
    expect(world.metrics).toEqual({
      widthCells: LOBBY_WORLD_WIDTH_CELLS,
      heightCells: LOBBY_WORLD_HEIGHT_CELLS,
    });

    const metricsProfile = getAuthoredWorldMetricsProfile(
      world.metrics.widthCells,
      world.metrics.heightCells,
    );
    expect(metricsProfile.arenaOffsetX).toBe(0);
    expect(metricsProfile.arenaWidth).toBe(LOBBY_WORLD_WIDTH_CELLS * 32);
    // Bildschirmbreite ohne Schwenk: die Lobby zeigt ihre World vollstaendig.
    expect(metricsProfile.usesDynamicCamera).toBe(false);
  });
});

describe('LobbyWorld – authored Geometrie', () => {
  const layout = buildLobbyWorldLayout();
  const rockAt = new Map(layout.rocks.map((rock) => [`${rock.gridX}:${rock.gridY}`, rock]));

  it('haelt den FRAGDACHSE-Schriftzug als ganz normalen, zerstoerbaren Fels', () => {
    // Der Schriftzug steht ueber dem Rahmen, also oberhalb der oberen Rahmenzeile.
    const titleRocks = layout.rocks.filter((rock) => rock.gridY >= 1 && rock.gridY <= 5);
    expect(titleRocks.length).toBeGreaterThan(100);
    for (const rock of titleRocks) {
      expect(rock.indestructible, `Titelfels ${rock.gridX}:${rock.gridY}`).toBeUndefined();
    }
  });

  it('schuetzt ausschliesslich den Rahmen der Lobby-Oberflaeche', () => {
    const { leftFrameColumn, rightFrameColumn, frameTopRow, frameBottomRow } = LOBBY_LAYOUT_GRID;
    for (const row of [frameTopRow, frameBottomRow]) {
      expect(rockAt.get(`${leftFrameColumn}:${row}`)?.indestructible).toBe(true);
      expect(rockAt.get(`${rightFrameColumn}:${row}`)?.indestructible).toBe(true);
    }
    // Jeder geschuetzte Fels liegt auf einer Rahmenzeile oder -spalte; sonst waere die
    // Unterscheidung zwischen Struktur und Ziel bloss zufaellig.
    for (const rock of layout.rocks) {
      if (rock.indestructible !== true) continue;
      const onFrameRow = rock.gridY === frameTopRow || rock.gridY === frameBottomRow;
      const onFrameColumn = rock.gridX === leftFrameColumn || rock.gridX === rightFrameColumn;
      expect(onFrameRow || onFrameColumn, `${rock.gridX}:${rock.gridY}`).toBe(true);
    }
  });

  it('haelt die zentrale Flaeche fuer die spaetere persistente Basis frei', () => {
    for (const rock of layout.rocks) {
      expect(isLobbyUiReservedCell(rock.gridX, rock.gridY), `Fels ${rock.gridX}:${rock.gridY}`).toBe(false);
    }
    for (const tree of layout.trees) {
      expect(isLobbyUiReservedCell(tree.gridX, tree.gridY), `Baum ${tree.gridX}:${tree.gridY}`).toBe(false);
    }
  });

  it('liegt vollstaendig innerhalb ihrer eigenen Metrik und traegt keine Gleise', () => {
    expect(layout.tracks).toEqual([]);
    expect(layout.powerUpPedestals).toEqual([]);
    for (const cell of [...layout.rocks, ...layout.trees, ...layout.dirt]) {
      expect(cell.gridX).toBeGreaterThanOrEqual(0);
      expect(cell.gridY).toBeGreaterThanOrEqual(0);
      expect(cell.gridX).toBeLessThan(LOBBY_WORLD_WIDTH_CELLS);
      expect(cell.gridY).toBeLessThan(LOBBY_WORLD_HEIGHT_CELLS);
    }
  });

  it('gibt jeder World-Instanz ihr eigenes Layout', () => {
    const first = buildLobbyWorldLayout();
    const second = buildLobbyWorldLayout();
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(second.rocks).not.toBe(first.rocks);
    // Die Runtime haengt platzierte Konstrukte als zusaetzliche Felszellen an; das darf die
    // naechste LobbyWorld nicht erben.
    first.rocks.push({ gridX: 0, gridY: 0 });
    expect(buildLobbyWorldLayout().rocks.length).toBe(second.rocks.length);
  });
});

describe('LobbyWorld – World-Aufbau ueber die kanonischen Mechanismen', () => {
  it('kommt aus der World-Layout-Quelle statt aus dem prozeduralen Generator', () => {
    const world = getLobbyWorldDefinition();
    const metrics = getAuthoredWorldMetricsProfile(world.metrics.widthCells, world.metrics.heightCells);
    const layout = generateWorldLayout({
      definitionId: LOBBY_WORLD_DEFINITION_ID,
      seed: 1,
      generation: {
        metrics: {
          widthPx: metrics.arenaWidth,
          heightPx: metrics.arenaHeight,
          offsetX: metrics.arenaOffsetX,
          offsetY: metrics.arenaOffsetY,
          maxX: metrics.arenaOffsetX + metrics.arenaWidth,
          maxY: metrics.arenaOffsetY + metrics.arenaHeight,
          viewportWidth: metrics.arenaViewportWidth,
          viewportHeight: metrics.arenaViewportHeight,
          gridCols: world.metrics.widthCells,
          gridRows: world.metrics.heightCells,
          trackSpawnMinCol: 0,
          trackSpawnMaxCol: 0,
          usesDynamicCamera: false,
          showStaticFrames: false,
        },
        treeCount: 0,
        captureTheBeerBasesActive: false,
        coopDefenseBasesActive: false,
      },
    });
    // Der uebergebene Seed spielt keine Rolle: authored Geometrie wuerfelt nichts.
    expect(layout).toEqual(buildLobbyWorldLayout());
  });

  it('unterscheidet zwei Instanzen ausschliesslich in ihrer Revision', () => {
    const first = createAuthoredWorldDescriptor(LOBBY_WORLD_DEFINITION_ID, 10);
    const second = createAuthoredWorldDescriptor(LOBBY_WORLD_DEFINITION_ID, 11);
    expect(second).toEqual({ ...first, worldRevision: 11 });
    expect(first.definitionId).toBe(LOBBY_WORLD_DEFINITION_ID);
    expect(first.layoutFingerprint.length).toBeGreaterThan(0);
  });

  it('baut einen regulaeren WorldRuntimeContext ohne Basen und ohne persistente Basis', () => {
    // Ohne Freischaltung: Die Definition kennt die Stelle, diese Instanz besitzt sie nicht.
    const definition = getLobbyWorldDefinition();
    const world = createWorldRuntimeContext({
      descriptor: createAuthoredWorldDescriptor(LOBBY_WORLD_DEFINITION_ID, 7),
      metricsProfile: getAuthoredWorldMetricsProfile(
        definition.metrics.widthCells,
        definition.metrics.heightCells,
      ),
      definition,
    });
    expect(world.definition).toBe(definition);
    expect(world.bases).toEqual([]);
    expect(world.persistentBaseSite).toBeNull();
    expect(world.metrics.gridCols).toBe(LOBBY_WORLD_WIDTH_CELLS);
    expect(world.metrics.gridRows).toBe(LOBBY_WORLD_HEIGHT_CELLS);
  });

  it('materialisiert den Basiskern erst mit der freigeschalteten Instanz', () => {
    const definition = getLobbyWorldDefinition();
    const world = createWorldRuntimeContext({
      descriptor: createAuthoredWorldDescriptor(LOBBY_WORLD_DEFINITION_ID, 8, {
        persistentBaseUnlocked: true,
        persistentBaseAreaStage: 0,
      }),
      metricsProfile: getAuthoredWorldMetricsProfile(
        definition.metrics.widthCells,
        definition.metrics.heightCells,
      ),
      definition,
    });

    expect(world.bases.map((base) => base.id)).toEqual([LOBBY_PERSISTENT_BASE_ID]);
    expect(world.persistentBaseSite).toMatchObject({
      baseId: LOBBY_PERSISTENT_BASE_ID,
      areaStage: 0,
      buildArea: { kind: 'square', sizeCells: 3 },
    });
    // Der Anker ist die authored Mitte der World und damit zugleich ihr Spawn-Fokus: Wer das
    // Testgelaende betritt, steht im eigenen Hof.
    expect(world.persistentBaseSite?.anchor).toEqual({
      gridX: LOBBY_SPAWN_FOCUS_CELL.gridX,
      gridY: LOBBY_SPAWN_FOCUS_CELL.gridY,
    });
    expect(isValidPersistentBaseSite(world.persistentBaseSite)).toBe(true);
    // Die vierseitig offene Kernform: 12 feste Zellen, der Hof bleibt begehbar.
    expect(world.bases[0]?.cells).toHaveLength(12);
    expect(world.bases[0]?.cells.some((cell) => (
      cell.gridX === LOBBY_SPAWN_FOCUS_CELL.gridX && cell.gridY === LOBBY_SPAWN_FOCUS_CELL.gridY
    ))).toBe(false);
  });

  it('materialisiert den Kern in der Lobby nur fuer Coop mit Entitlement', () => {
    const cases: Array<{ mode: GameMode; unlocked: boolean; hasBase: boolean }> = [
      { mode: 'coop_defense', unlocked: true, hasBase: true },
      { mode: 'coop_defense', unlocked: false, hasBase: false },
      { mode: 'deathmatch', unlocked: true, hasBase: false },
      { mode: 'team_deathmatch', unlocked: true, hasBase: false },
      { mode: 'capture_the_beer', unlocked: true, hasBase: false },
    ];

    for (const testCase of cases) {
      const world = lobbyWorldContextFor(testCase.mode, testCase.unlocked);
      expect(world.persistentBaseSite !== null, `${testCase.mode}/${testCase.unlocked}`).toBe(testCase.hasBase);
      expect(world.bases.length > 0, `${testCase.mode}/${testCase.unlocked}`).toBe(testCase.hasBase);
    }

    // Der Coordinator behaelt genau diese Entscheidung im bestehenden Lobby-Reinstance-Pfad;
    // das Entitlement selbst wird dabei nicht aus dem Save entfernt.
    const lifecycle = read('src/scenes/arena/ArenaLifecycleCoordinator.ts');
    expect(lifecycle).toContain('const persistentBaseUnlocked = isCoopDefenseMode(currentMode)');
    expect(lifecycle).toContain('&& getStoredPersistentBaseUnlocked();');
    expect(lifecycle).toContain('this.lobbyWorldModeAtRevision !== currentMode');
  });

  it('bindet Contributions an die persistente World und Working State nur an die Activity', () => {
    // Eine freigeschaltete LobbyWorld materialisiert und editiert den committed Stand direkt.
    // Erst eine echte Activity oeffnet den bestehenden Missions-Working-State. Die Struktur kennt
    // ohne Activity weiterhin keinen Schaden.
    const lifecycle = read('src/scenes/arena/ArenaLifecycleCoordinator.ts');
    expect(lifecycle).toContain('if (bridge.isHost() && persistentBaseSite !== null) {');
    expect(lifecycle).toContain('if (activityDescriptor !== null) this.persistentBaseContributions.beginMission();');
    expect(lifecycle).toContain('if (store && registered && !store.hasActiveMission) {');
    expect(lifecycle).toContain('if (store && ownerId && removedPersistentBlueprint && !store.hasActiveMission) {');
    expect(lifecycle).toContain('this.destroyWorldMaterialization(preserveAuthoredPresentation);');
    // Die Bau-Runtime gibt ihre Zellen mit dem gebauten World-Zustand frei.
    expect(read('src/world/WorldMaterialization.ts')).toContain('placement?.clearRuntimeRocks();');
    expect(lifecycle).toContain('}, presentation, activityDescriptor !== null)');
  });
});

describe('LobbyWorld – geschuetzte Struktur nimmt keinen Schaden', () => {
  it('laesst den Rahmen unversehrt und den Schriftzug zerstoerbar', () => {
    const layout = buildLobbyWorldLayout();
    const registry = new RockHpRegistry(layout);
    const frameId = layout.rocks.findIndex((rock) => rock.indestructible === true);
    const titleId = layout.rocks.findIndex((rock) => rock.indestructible !== true);
    expect(frameId).toBeGreaterThanOrEqual(0);
    expect(titleId).toBeGreaterThanOrEqual(0);

    expect(registry.applyDamage(frameId, ROCK_HP_MAX * 10)).toBe(ROCK_HP_MAX);
    expect(registry.isDestroyed(frameId)).toBe(false);
    expect(registry.isIndestructible(frameId)).toBe(true);

    expect(registry.applyDamage(titleId, ROCK_HP_MAX)).toBe(0);
    expect(registry.isDestroyed(titleId)).toBe(true);
  });
});

describe('LobbyWorld – Teilnahme none, Presentation preview', () => {
  const definition = getLobbyWorldDefinition();
  const presentation = resolveWorldPresentation({
    participation: 'none',
    worldActive: true,
    previewWithoutParticipation: definition.presentationPolicy?.previewWithoutParticipation === true,
  });

  it('zeigt die World, ohne dass jemand an ihr teilnimmt', () => {
    expect(presentation.required).toBe(true);
    expect(presentation.mode).toBe('preview');
    // Weltkamera, World-HUD, Zielhilfe und Spielerfigur gehoeren der Teilnahme, nicht der Sicht.
    expect(presentation.surfaces).not.toContain('worldCamera');
    expect(presentation.surfaces).not.toContain('worldHud');
    expect(presentation.surfaces).not.toContain('aim');
    expect(presentation.surfaces).not.toContain('localPlayerVisuals');
  });

  it('laesst die Lobby ueber der World stehen und zeigt kein Runden-HUD', () => {
    const policy = resolvePresentationPolicy({
      inLobby: true,
      worldPresentation: presentation,
      worldVisible: true,
      gameplayActive: false,
      roundRole: 'participant',
      matchTerminated: false,
      spectatorPanAvailable: false,
    });
    expect(policy.showWorld).toBe(true);
    expect(policy.worldMode).toBe('preview');
    expect(policy.showLobby).toBe(true);
    expect(policy.showHud).toBe(false);
    expect(policy.useWorldCamera).toBe(false);
    expect(policy.useSpectatorCamera).toBe(false);
  });

  it('erzeugt daraus weder PlayerRuntime noch World-Input', () => {
    expect(hasWorldRuntimeEntry('none')).toBe(false);
    expect(maySendWorldInput('none')).toBe(false);

    const capabilities = resolvePlayerCapabilities({
      participation: 'none',
      activityKind: null,
      worldCombatAllowed: definition.actionPolicy?.combat === true,
    });
    expect(capabilities).toEqual({
      canMove: false,
      canUseCombat: false,
      canPlace: false,
      canDismantle: false,
      canInteract: false,
      canUseMissionActions: false,
      canControlCamera: false,
    });

    const input = resolveInputPolicy({
      capabilities,
      gameplayActive: false,
      countdownActive: false,
      uiBlocking: false,
      diagnosticsArena: false,
    });
    expect(input).toEqual({
      movement: false,
      combat: false,
      placement: false,
      worldInteraction: false,
      cameraNavigation: false,
      aim: false,
    });

    // Auch der Host fuehrt fuer sie keinen Spielerzustand: es gibt keinen Teilnehmer, dessen
    // Runtime ueberhaupt angehaengt wuerde.
    const features = resolvePlayerRuntimeFeatures({
      activityKind: null,
      isHost: true,
      participation: 'none',
    });
    expect(features.missionStatus).toBe(false);
  });
});

describe('LobbyWorld – normaler World-Kanal', () => {
  async function createRoom(playerCount: number): Promise<TestRoom[]> {
    const network = new FakeNetwork();
    const rooms = [await createHostRoom(network)];
    for (let i = 1; i < playerCount; i += 1) rooms.push(await addClientRoom(network));
    return rooms;
  }

  function bridgeFor(room: TestRoom): NetworkBridge {
    setActiveSession({ room: room.room, transport: room.transport, roomCode: 'LOBBY1' });
    const bridge = new NetworkBridge();
    bridge.activate();
    return bridge;
  }

  it('repliziert die LobbyWorld ohne Activity und ohne Teilnehmer', async () => {
    const [hostRoom, clientRoom] = await createRoom(2);
    try {
      const host = bridgeFor(hostRoom);
      const client = bridgeFor(clientRoom);

      setActiveSession({ room: hostRoom.room, transport: hostRoom.transport, roomCode: 'LOBBY1' });
      host.publishLobbySync();
      host.setMatchHostId();
      const descriptor = createAuthoredWorldDescriptor(LOBBY_WORLD_DEFINITION_ID, 4242);
      host.publishWorldAndActivity(descriptor, null);

      // Der Raum bleibt in der Lobby; die World haengt an keiner Phase und an keiner Runde.
      expect(host.getGamePhase()).toBe('LOBBY');
      expect(host.getActivityDescriptor()).toBeNull();
      expect(host.getRoundState()).toBeNull();
      expect(host.getRoundParticipation()).toBeNull();

      // Host und Client meinen dieselbe World-Instanz - ueber denselben Kanal wie ein Match.
      setActiveSession({ room: clientRoom.room, transport: clientRoom.transport, roomCode: 'LOBBY1' });
      expect(client.getWorldDescriptor()).toEqual(descriptor);
      expect(client.getActivityDescriptor()).toBeNull();

      // Niemand nimmt teil: Raum-Mitgliedschaft ist keine World-Mitgliedschaft.
      expect(client.getLocalWorldParticipation()).toBe('none');
      expect(client.getWorldParticipants()).toEqual([]);
      setActiveSession({ room: hostRoom.room, transport: hostRoom.transport, roomCode: 'LOBBY1' });
      expect(host.getLocalWorldParticipation()).toBe('none');
      expect(host.getWorldParticipants()).toEqual([]);
    } finally {
      clearActiveSession();
    }
  });
});

describe('LobbyWorld – keine zweite Lobby-Simulation', () => {
  it('haelt in src/lobby/ nur noch Raum-Fachlogik', () => {
    const files = readdirSync(resolve(process.cwd(), 'src/lobby')).sort();
    expect(files).toEqual(['LobbyRosterLayout.ts']);
  });

  it('ersetzt den Systemcursor nur dort, wo es die Zielhilfe ueberhaupt gibt', () => {
    // In der Lobby steht der normale Cursor; das Fadenkreuz gehoert der Teilnahme.
    const scene = read('src/scenes/ArenaScene.ts');
    expect(scene).toContain("const worldInteractive = presentationPolicy.worldMode === 'interactive';");
    expect(scene).toContain('worldInteractive && !optionsOpen && !spectator,');
  });

  it('laesst die Scene die Lobby ueber den World-Lifecycle bauen statt ueber eine Vorschau', () => {
    const scene = read('src/scenes/ArenaScene.ts');
    expect(scene).not.toContain('MenuArenaPreview');
    expect(scene).not.toContain('LobbyAmbient');
    expect(scene).toContain('this.lifecycle.hostSyncLobbyWorld();');

    const lifecycle = read('src/scenes/arena/ArenaLifecycleCoordinator.ts');
    // Die LobbyWorld nimmt denselben Weg wie jede andere World-Instanz.
    expect(lifecycle).toContain('this.worldLifecycle.beginCreate(');
    expect(lifecycle).toContain('createAuthoredWorldDescriptor(');
    expect(lifecycle).toContain('LOBBY_WORLD_DEFINITION_ID,');
    // Und sie ist keine Activity.
    expect(lifecycle).not.toContain("kind: 'lobby'");
  });
});
