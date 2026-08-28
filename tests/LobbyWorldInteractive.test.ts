import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CELL_SIZE, getAuthoredWorldMetricsProfile, isGridCellInArenaRegion } from '../src/config';
import { buildLobbyWorldLayout, isLobbyUiReservedCell } from '../src/arena/LobbyWorldLayout';
import {
  LOBBY_WORLD_DEFINITION_ID,
  getLobbyWorldDefinition,
} from '../src/config/authoring/lobbyWorld';
import { getWorldDefinitionForMap } from '../src/config/authoring/authoredScenarios';
import { NetworkBridge } from '../src/network/NetworkBridge';
import { clearActiveSession, setActiveSession } from '../src/network/peer/session';
import { resolveInputPolicy } from '../src/world/InputPolicy';
import { resolvePlayerCapabilities } from '../src/world/PlayerCapabilities';
import { resolvePlayerRuntimeFeatures } from '../src/world/PlayerWorldRuntime';
import { resolvePresentationPolicy } from '../src/world/PresentationPolicy';
import { createAuthoredWorldDescriptor } from '../src/world/WorldLayout';
import {
  hasWorldFigure,
  hasWorldRuntimeEntry,
  maySendWorldInput,
  resolveWorldParticipation,
} from '../src/world/WorldParticipation';
import { resolveWorldPresentation } from '../src/world/WorldPresentation';
import { FakeNetwork, addClientRoom, createHostRoom, type TestRoom } from './fakePeerNetwork';

/**
 * L2: dieselbe LobbyWorld wird betretbar.
 *
 *   none → joining → interactive → leaving → none
 *
 * Der Eintritt ist ein eigener host-autoritativer Akt an der bereits laufenden World-Instanz.
 * Er haengt an keiner Runde: kein RoundState, kein Ready, kein committed Loadout, kein
 * Countdown. Und er erzeugt keine: Interactive heisst nicht, dass ein Match laeuft.
 */

const LOBBY_WORLD = getLobbyWorldDefinition();

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function presentationFor(participation: 'none' | 'interactive'): ReturnType<typeof resolveWorldPresentation> {
  return resolveWorldPresentation({
    participation,
    worldActive: true,
    previewWithoutParticipation: LOBBY_WORLD.presentationPolicy?.previewWithoutParticipation === true,
  });
}

function capabilitiesFor(participation: 'none' | 'interactive' | 'observer'): ReturnType<typeof resolvePlayerCapabilities> {
  return resolvePlayerCapabilities({
    participation,
    // Die LobbyWorld hat keine Activity - genau das ist der Punkt.
    activityKind: null,
    worldCombatAllowed: LOBBY_WORLD.actionPolicy?.combat === true,
  });
}

describe('LobbyWorld – Eintritt und Austritt', () => {
  it('erlaubt Selbstaufnahme nur, weil die World es ausdruecklich sagt', () => {
    expect(LOBBY_WORLD.participationPolicy?.selfAdmit).toBe(true);
    // Eine Match-World nimmt ausschliesslich auf, wen ihre Activity aufnimmt.
    expect(getWorldDefinitionForMap('0')?.participationPolicy?.selfAdmit).toBeUndefined();
  });

  it('durchlaeuft none → joining → interactive an derselben World-Instanz', () => {
    const world = { worldActive: true, admitted: true, mayAct: true } as const;
    expect(resolveWorldParticipation({ ...world, admitted: false, hasRuntimeEntry: false })).toBe('none');
    // Aufgenommen, aber noch ohne Runtime: der Eintritt laeuft.
    expect(resolveWorldParticipation({ ...world, hasRuntimeEntry: false })).toBe('joining');
    // Erst der Runtime-Eintrag macht daraus Teilnahme.
    expect(resolveWorldParticipation({ ...world, hasRuntimeEntry: true })).toBe('interactive');
    // Und der Austritt fuehrt zurueck auf `none`, sobald die Aufnahme faellt.
    expect(resolveWorldParticipation({ ...world, admitted: false, hasRuntimeEntry: true })).toBe('none');
  });

  it('gibt eine Figur an Eintretende und Teilnehmer, nicht an Beobachter', () => {
    // Der Spawn-Gate der World. `joining` zaehlt dazu - genau dann entsteht die Figur.
    expect(hasWorldFigure('joining')).toBe(true);
    expect(hasWorldFigure('interactive')).toBe(true);
    expect(hasWorldFigure('leaving')).toBe(true);
    expect(hasWorldFigure('observer')).toBe(false);
    expect(hasWorldFigure('none')).toBe(false);
  });

  it('haelt Eintritt und Austritt frei von Runden- und Ready-Begriffen', () => {
    const lifecycle = read('src/scenes/arena/ArenaLifecycleCoordinator.ts');
    const start = lifecycle.indexOf('  canSelfAdmitToWorld(): boolean {');
    const end = lifecycle.indexOf('\n  /** Mit der World-Instanz endet jede Aufnahme in sie. */', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const joinPath = lifecycle.slice(start, end);

    for (const roundTerm of [
      'getRoundParticipation', 'getRoundState', 'getPlayerReady', 'canPlayerInitialSpawn',
      'getArenaStartTime', 'isArenaCountdownActive', 'CommittedLoadout', 'this.spawnReadyPlayers(',
    ]) {
      expect(joinPath.includes(roundTerm), `Join/Leave darf ${roundTerm} nicht brauchen`).toBe(false);
    }
    // Stattdessen: der kanonische Admission-Mechanismus und der gemeinsame Player-Lifecycle.
    expect(joinPath).toContain('this.hostAdmitToWorld(playerId)');
    expect(joinPath).toContain('this.hostRemoveFromWorld(playerId)');
    expect(joinPath).toContain('this.attachPlayerToWorld(profile)');
    expect(joinPath).toContain('this.detachPlayerFromWorld(profile.id)');
    // Und keine zweite Wahrheit neben WorldParticipation.
    for (const parallelState of ['inShootingRange', 'isLobbyPlayer', 'lobbyInteractive', 'shootingRangeState']) {
      expect(lifecycle.includes(parallelState), `${parallelState} waere eine zweite Teilnahmequelle`).toBe(false);
    }
  });

  it('bindet den Eintrittswunsch an die World-Revision statt an World-Input', () => {
    const bridgeSource = read('src/network/NetworkBridge.ts');
    const start = bridgeSource.indexOf('  async requestWorldParticipation(join: boolean)');
    const end = bridgeSource.indexOf('\n  // ── Game State', start);
    expect(start).toBeGreaterThanOrEqual(0);
    const requestPath = bridgeSource.slice(start, end);

    // Wer eintreten will, nimmt noch nicht teil und koennte ueber `sendWorldRpc()` nichts senden.
    expect(requestPath).not.toContain('sendWorldRpc');
    expect(requestPath).toContain('wr: world.worldRevision');
    expect(requestPath).toContain('this.acceptsWorldRpc(data)');
    // Der Absender ist der Antragsteller; eine Spieler-ID in der Nutzlast gibt es bewusst nicht.
    expect(requestPath).toContain('caller.id');
    expect(requestPath).not.toMatch(/data as \{[^}]*playerId/);
  });
});

describe('LobbyWorld – interaktives World-Gameplay ohne Activity', () => {
  it('gibt einem Teilnehmer die normalen World-Rechte, aber keine Missionsaktionen', () => {
    expect(capabilitiesFor('interactive')).toEqual({
      canMove: true,
      canUseCombat: true,
      canPlace: true,
      canDismantle: true,
      canInteract: true,
      // Das Einzige, was fehlt: was fachlich eine Activity voraussetzt.
      canUseMissionActions: false,
      canControlCamera: true,
    });
  });

  it('gibt daraus volle Eingabe frei, ohne dass eine Runde laeuft', () => {
    const input = resolveInputPolicy({
      capabilities: capabilitiesFor('interactive'),
      // Ohne Activity ist "Gameplay laeuft" gleichbedeutend mit "die World laeuft".
      gameplayActive: true,
      countdownActive: false,
      uiBlocking: false,
      diagnosticsArena: false,
    });
    expect(input).toEqual({
      movement: true,
      combat: true,
      placement: true,
      worldInteraction: true,
      cameraNavigation: true,
      aim: true,
    });
    expect(maySendWorldInput('interactive')).toBe(true);
    expect(maySendWorldInput('none')).toBe(false);
  });

  it('baut die Player-Runtime ohne missionsgebundene Module auf', () => {
    const features = resolvePlayerRuntimeFeatures({
      activityKind: null,
      isHost: true,
      participation: 'interactive',
    });
    expect(features).toEqual({
      entity: true,
      worldTargeting: true,
      navigation: true,
      combat: true,
      combatResources: true,
      loadoutTools: true,
      playerBuild: true,
      // Kein Fake-Missionszustand, nur weil eine Figur existiert.
      missionStatus: false,
    });
  });

  it('loest die Spielfigur ohne Activity aus der World-Teilnahme statt aus der Runde', () => {
    const lifecycle = read('src/scenes/arena/ArenaLifecycleCoordinator.ts');
    const start = lifecycle.indexOf('    this.ctx.combatSystem.setInitialSpawnAllowedResolver(');
    const end = lifecycle.indexOf('this.ctx.combatSystem.setRespawnCallback(', start);
    expect(start).toBeGreaterThanOrEqual(0);
    const spawnGate = lifecycle.slice(start, end);

    // Mit Runde bleibt die Runde die Quelle ...
    expect(spawnGate).toContain('bridge.canPlayerInitialSpawn(playerId)');
    expect(spawnGate).toContain('bridge.canPlayerRespawn(playerId)');
    // ... ohne Runde traegt die World-Teilnahme die Antwort.
    expect(spawnGate).toContain('this.worldLifecycle.activity.isActive()');
    expect(spawnGate).toContain('hasWorldFigure(this.getWorldParticipation(playerId))');
  });
});

describe('LobbyWorld – Preview und Interactive Presentation', () => {
  it('wechselt an derselben World-Instanz zwischen Kulisse und Teilnahme', () => {
    const preview = presentationFor('none');
    const interactive = presentationFor('interactive');
    expect(preview.mode).toBe('preview');
    expect(interactive.mode).toBe('interactive');
    // Erst die Teilnahme bringt Weltkamera, Zielhilfe, HUD und eigene Figur.
    for (const surface of ['worldCamera', 'worldHud', 'aim', 'localPlayerVisuals'] as const) {
      expect(preview.surfaces).not.toContain(surface);
      expect(interactive.surfaces).toContain(surface);
    }
  });

  it('ersetzt die Lobby-Oberflaeche beim Eintritt und bringt sie beim Austritt zurueck', () => {
    const base = {
      inLobby: true,
      worldVisible: true,
      gameplayActive: true,
      roundRole: 'participant',
      matchTerminated: false,
      spectatorPanAvailable: false,
    } as const;

    const outside = resolvePresentationPolicy({ ...base, worldPresentation: presentationFor('none') });
    expect(outside.showLobby).toBe(true);
    expect(outside.showWorld).toBe(true);
    expect(outside.useWorldCamera).toBe(false);

    const inside = resolvePresentationPolicy({ ...base, worldPresentation: presentationFor('interactive') });
    expect(inside.showLobby).toBe(false);
    expect(inside.showWorld).toBe(true);
    expect(inside.useWorldCamera).toBe(true);
  });

  it('laesst die Scene ihre Lobby-Oberflaeche der Presentation folgen, nicht der Raumphase', () => {
    const scene = read('src/scenes/ArenaScene.ts');
    expect(scene).toContain('this.lifecycle.syncLobbySurface(presentationPolicy.showLobby);');
    // Rundenpraesentation haengt zusaetzlich an der Activity: interaktiv zu spielen heisst nicht,
    // dass eine Runde laeuft.
    expect(scene).toContain('const inRoundWorld = worldInteractive && activityActive;');
    expect(scene).toContain('const coopDefensePresentationActive = inRoundWorld && isCoopDefenseMode(configuredGameMode);');
  });
});

describe('LobbyWorld – Spawn gehoert der World', () => {
  it('haelt jeden authored Spawn-Ausschluss von der Oberflaeche frei', () => {
    const zones = LOBBY_WORLD.spawnExclusionZones ?? [];
    expect(zones.length).toBeGreaterThan(0);
    for (const zone of zones) {
      for (const [gridX, gridY] of [
        [zone.minGridX, zone.minGridY],
        [zone.maxGridX, zone.maxGridY],
      ] as const) {
        expect(isLobbyUiReservedCell(gridX, gridY), `${gridX}:${gridY}`).toBe(true);
      }
    }
  });

  it('laesst genug freie Startzellen ausserhalb von Fels, Baum und Oberflaeche', () => {
    const layout = buildLobbyWorldLayout();
    const profile = getAuthoredWorldMetricsProfile(
      LOBBY_WORLD.metrics.widthCells,
      LOBBY_WORLD.metrics.heightCells,
    );
    const cols = Math.floor(profile.arenaWidth / CELL_SIZE);
    const rows = Math.floor(profile.arenaHeight / CELL_SIZE);
    const blocked = new Set<string>();
    for (const cell of [...layout.rocks, ...layout.trees]) blocked.add(`${cell.gridX}_${cell.gridY}`);

    let free = 0;
    for (let gridY = 0; gridY < rows; gridY += 1) {
      for (let gridX = 0; gridX < cols; gridX += 1) {
        if (blocked.has(`${gridX}_${gridY}`)) continue;
        if ((LOBBY_WORLD.spawnExclusionZones ?? []).some((zone) => isGridCellInArenaRegion(zone, gridX, gridY))) continue;
        free += 1;
      }
    }
    // Der Schiessstand braucht Platz; ein einzelner Restzipfel waere kein Startpunkt.
    expect(free).toBeGreaterThan(200);
  });

  it('reicht den authored Ausschluss an die World-Geometrie des PlayerManagers durch', () => {
    const lifecycle = read('src/scenes/arena/ArenaLifecycleCoordinator.ts');
    expect(lifecycle).toContain('spawnExclusionZones: world.definition?.spawnExclusionZones');
    const playerManager = read('src/entities/PlayerManager.ts');
    // Der Ausschluss sperrt den Start, nicht das Betreten.
    expect(playerManager).toContain('this.worldGeometry?.spawnExclusionZones ?? []');
  });
});

describe('LobbyWorld – Teilnahme im Mehrspielerraum', () => {
  async function createRoom(playerCount: number): Promise<TestRoom[]> {
    const network = new FakeNetwork();
    const rooms = [await createHostRoom(network)];
    for (let i = 1; i < playerCount; i += 1) rooms.push(await addClientRoom(network));
    return rooms;
  }

  function bridgeFor(room: TestRoom): NetworkBridge {
    setActiveSession({ room: room.room, transport: room.transport, roomCode: 'RANGE1' });
    const bridge = new NetworkBridge();
    bridge.activate();
    return bridge;
  }

  function useRoom(room: TestRoom): void {
    setActiveSession({ room: room.room, transport: room.transport, roomCode: 'RANGE1' });
  }

  it('laesst einzelne Spieler unabhaengig eintreten und wieder austreten', async () => {
    const [hostRoom, clientARoom, clientBRoom] = await createRoom(3);
    try {
      const host = bridgeFor(hostRoom);
      const clientA = bridgeFor(clientARoom);
      const clientB = bridgeFor(clientBRoom);
      useRoom(hostRoom);
      host.publishLobbySync();
      host.setMatchHostId();
      const descriptor = createAuthoredWorldDescriptor(LOBBY_WORLD_DEFINITION_ID, 5150);
      host.publishWorldAndActivity(descriptor, null);

      // Client A betritt; Host und Client B bleiben draussen.
      host.hostPublishWorldParticipation({ p1: 'interactive' });
      expect(host.getWorldParticipants()).toEqual(['p1']);
      expect(host.getLocalWorldParticipation()).toBe('none');

      useRoom(clientARoom);
      expect(clientA.getLocalWorldParticipation()).toBe('interactive');
      expect(hasWorldRuntimeEntry(clientA.getLocalWorldParticipation())).toBe(true);
      useRoom(clientBRoom);
      expect(clientB.getLocalWorldParticipation()).toBe('none');
      // Client B sieht A trotzdem - als Preview derselben World-Instanz.
      expect(clientB.getWorldDescriptor()).toEqual(descriptor);
      expect(presentationFor(clientB.getLocalWorldParticipation()).mode).toBe('preview');

      // Client B tritt zusaetzlich ein, ohne A zu beeinflussen.
      useRoom(hostRoom);
      host.hostPublishWorldParticipation({ p1: 'interactive', p2: 'interactive' });
      useRoom(clientARoom);
      expect(clientA.getLocalWorldParticipation()).toBe('interactive');
      useRoom(clientBRoom);
      expect(clientB.getLocalWorldParticipation()).toBe('interactive');

      // A tritt aus; B bleibt drin, und die World-Instanz bleibt dieselbe.
      useRoom(hostRoom);
      host.hostPublishWorldParticipation({ p2: 'interactive' });
      expect(host.getWorldDescriptor()).toEqual(descriptor);
      useRoom(clientARoom);
      expect(clientA.getLocalWorldParticipation()).toBe('none');
      useRoom(clientBRoom);
      expect(clientB.getLocalWorldParticipation()).toBe('interactive');

      // Und der Host kann ueber genau denselben Stand teilnehmen - keine Sonderregel.
      useRoom(hostRoom);
      host.hostPublishWorldParticipation({ p0: 'interactive', p2: 'interactive' });
      expect(host.getLocalWorldParticipation()).toBe('interactive');
    } finally {
      clearActiveSession();
    }
  });

  it('bleibt ohne Runde: Interactive ist kein laufendes Match', async () => {
    const [hostRoom, clientRoom] = await createRoom(2);
    try {
      const host = bridgeFor(hostRoom);
      const client = bridgeFor(clientRoom);
      useRoom(hostRoom);
      host.publishLobbySync();
      host.setMatchHostId();
      host.publishWorldAndActivity(createAuthoredWorldDescriptor(LOBBY_WORLD_DEFINITION_ID, 5151), null);
      host.hostPublishWorldParticipation({ p1: 'interactive' });

      expect(host.getGamePhase()).toBe('LOBBY');
      expect(host.getActivityDescriptor()).toBeNull();
      expect(host.getRoundState()).toBeNull();
      expect(host.getRoundParticipation()).toBeNull();
      expect(host.getArenaStartTime()).toBe(0);
      expect(host.isArenaStarted()).toBe(false);
      expect(host.isArenaCountdownActive()).toBe(false);
      expect(host.getRoundResults()).toBeNull();

      useRoom(clientRoom);
      expect(client.getLocalWorldParticipation()).toBe('interactive');
      expect(client.getActivityDescriptor()).toBeNull();
      expect(client.getRoundState()).toBeNull();
      // Ein Teilnehmer ohne Runde bekommt auch keine Rundenrolle zugesprochen.
      expect(client.isRoundSpectator(client.getLocalPlayerId())).toBe(false);
    } finally {
      clearActiveSession();
    }
  });
});

describe('LobbyWorld – World-Ende raeumt ihre Teilnehmer', () => {
  it('loest jede Player-Runtime im World-Teardown, nicht erst beim Rundenende', () => {
    const lifecycle = read('src/scenes/arena/ArenaLifecycleCoordinator.ts');
    const start = lifecycle.indexOf('  tearDownArena(');
    expect(start).toBeGreaterThanOrEqual(0);
    // Der Abbau steht ganz vorn: die Detach-Module brauchen die Fachsysteme noch.
    expect(lifecycle.slice(start, start + 600)).toContain('this.detachAllWorldPlayers();');
    // Und der Matchstart schneidet die LobbyWorld samt Teilnehmern ab.
    const roundStart = lifecycle.indexOf('    this.detachAllWorldPlayers();\n    this.worldLifecycle.endInstance();');
    expect(roundStart).toBeGreaterThanOrEqual(0);
  });
});
