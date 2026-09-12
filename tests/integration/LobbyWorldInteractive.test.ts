import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Die Boot-Barriere und die echten Overlay-Methoden laufen ohne GPU/DOM.
vi.mock('phaser', () => ({
  Scene: class {},
  Core: { Events: { POST_RENDER: 'postrender' } },
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
    Circle: class {},
    Rectangle: class {
      x = 0; y = 0; width = 0; height = 0;
      constructor(x = 0, y = 0, width = 0, height = 0) { this.setTo(x, y, width, height); }
      setTo(x: number, y: number, width: number, height: number) {
        Object.assign(this, { x, y, width, height });
        return this;
      }
      get left() { return this.x; }
      get right() { return this.x + this.width; }
      get top() { return this.y; }
      get bottom() { return this.y + this.height; }
    },
    Line: class {
      setTo(x1: number, y1: number, x2: number, y2: number) {
        Object.assign(this, { x1, y1, x2, y2 });
        return this;
      }
      static Length(line: { x1: number; y1: number; x2: number; y2: number }) {
        return Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
      }
    },
  },
  Filters: { ParallelFilters: class {}, Displacement: class {} },
}));
import { CELL_SIZE, getAuthoredWorldMetricsProfile, isGridCellInArenaRegion } from '../../src/config';
import { buildLobbyWorldLayout, isLobbyUiReservedCell } from '../../src/arena/LobbyWorldLayout';
import {
  LOBBY_WORLD_DEFINITION_ID,
  getLobbyWorldDefinition,
} from '../../src/config/authoring/lobbyWorld';
import { getWorldDefinitionForMap } from '../../src/config/authoring/authoredScenarios';
import { NetworkBridge } from '../../src/network/NetworkBridge';
import { bridge } from '../../src/network/bridge';
import { ArenaScene } from '../../src/scenes/ArenaScene';
import { ArenaLifecycleCoordinator } from '../../src/scenes/arena/ArenaLifecycleCoordinator';
import { DEFAULT_LOADOUT, WEAPON_CONFIGS } from '../../src/loadout/LoadoutConfig';
import { LobbyOverlay } from '../../src/scenes/LobbyOverlay';
import { BootScreen } from '../../src/ui/BootScreen';
import { clearActiveSession, setActiveSession } from '../../src/network/peer/session';
import { resolveInputPolicy } from '../../src/world/InputPolicy';
import { resolvePlayerCapabilities } from '../../src/world/PlayerCapabilities';
import { resolvePlayerRuntimeFeatures } from '../../src/world/PlayerWorldRuntime';
import { resolvePresentationPolicy } from '../../src/world/PresentationPolicy';
import { createAuthoredWorldDescriptor } from '../../src/world/WorldLayout';
import {
  hasWorldFigure,
  hasWorldRuntimeEntry,
  maySendWorldInput,
  resolveWorldParticipation,
} from '../../src/world/WorldParticipation';
import { resolveWorldPresentation } from '../../src/world/WorldPresentation';
import { FakeNetwork, addClientRoom, createHostRoom, type TestRoom } from '../fakePeerNetwork';

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

  it('haelt die World-Self-Admit-Policy frei von Runden- und Ready-Begriffen', () => {
    const lifecycle = read('src/scenes/arena/ArenaLifecycleCoordinator.ts');
    const start = lifecycle.indexOf('  canSelfAdmitToWorld(): boolean {');
    const end = lifecycle.indexOf('\n  /** Mit der World-Instanz endet jede Aufnahme in sie. */', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const joinPath = lifecycle.slice(start, end);

    for (const roundTerm of [
      'getRoundParticipation', 'getRoundState', 'canPlayerInitialSpawn',
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

  it('sperrt nur den Join fuer bereite Spieler und laesst Leave/Ready getrennt', () => {
    const lifecycle = read('src/scenes/arena/ArenaLifecycleCoordinator.ts');
    const start = lifecycle.indexOf('  hostHandleWorldParticipationRequest(playerId: string, join: boolean): boolean {');
    const end = lifecycle.indexOf('\n  /** Der lokale Wunsch. Der Host entscheidet', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const requestPath = lifecycle.slice(start, end);

    expect(requestPath).toContain('if (join && bridge.getPlayerReady(playerId)) return false;');
    expect(requestPath).toContain('if (join) this.hostAdmitToWorld(playerId);');
    expect(requestPath).toContain('else this.hostRemoveFromWorld(playerId);');
    expect(requestPath).not.toContain('setLocalReady');
    expect(requestPath).not.toContain('hostSetPlayerReady');

    const overlay = read('src/scenes/LobbyOverlay.ts');
    expect(overlay).toContain('setEnabled(showEntry && this.worldEntryAvailable && this.worldEntryEnabled');
    expect(overlay).not.toContain('ui.lobby.enterRange');
    expect(overlay).not.toContain('ui.lobby.leaveRange');
  });

  it('nennt die World-Funktion Testgelaende und trennt Entry, Exit und Optionen', () => {
    const overlay = read('src/scenes/LobbyOverlay.ts');
    expect(overlay).toContain("label: t('ui.lobby.testArea')");
    expect(overlay).toContain("label: t('ui.lobby.returnToLobby')");
    expect(overlay).toContain('private testAreaBtn:');
    expect(overlay).toContain('private worldExitBtn:');
    expect(overlay).toContain('const showEntry = this.visible && !this.worldEntryInside;');
    expect(overlay).toContain('showEntry && this.worldEntryAvailable && this.worldEntryEnabled');
    expect(overlay).toContain('const showExit = this.worldEntryAvailable && this.worldEntryInside;');
    expect(read('src/scenes/ArenaScene.ts')).toContain(
      'canEnter: bridge.getPlayerReady(bridge.getLocalPlayerId()) === false,',
    );

    for (const locale of ['de', 'en']) {
      const ui = read(`src/i18n/${locale}/ui.ts`);
      expect(ui).toContain('"ui.lobby.testArea"');
      expect(ui).toContain('"ui.lobby.returnToLobby"');
      expect(ui).toContain('"ui.options.returnToLobbyHint"');
      expect(ui).not.toContain('ui.lobby.enterRange');
      expect(ui).not.toContain('ui.lobby.leaveRange');
    }

    const options = read('src/ui/OptionsOverlay.ts');
    expect(options).toContain('export interface WorldLeaveBinding');
    expect(options).toContain('binding.leave();');
    expect(options).not.toContain('NetworkBridge');
  });

  it('behandelt ESC modale Oberflaechen vor dem World-Leave', () => {
    const inputBindings = read('src/scenes/arena/ArenaInputBindings.ts');
    const start = inputBindings.indexOf('    this.escapeHotkeyHandler = (event: KeyboardEvent) => {');
    const end = inputBindings.indexOf("    keyboard.on('keydown-ESC', this.escapeHotkeyHandler);", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const escapePath = inputBindings.slice(start, end);

    expect(escapePath).toContain('ports.hideOptionsOverlay();');
    expect(escapePath).toContain('ports.isHotkeyInputBlocked()');
    expect(escapePath).toContain('ports.canLeaveLocalLobbyWorld()');
    expect(escapePath).toContain('ports.requestLocalLobbyWorldLeave();');
    expect(escapePath.indexOf('isOptionsOverlayOpen')).toBeLessThan(
      escapePath.indexOf('ports.requestLocalLobbyWorldLeave();'),
    );
    const scene = read('src/scenes/ArenaScene.ts');
    expect(scene).toContain('leave: () => this.requestLocalLobbyWorldLeave(),');
    expect(scene).toContain(': this.requestLocalLobbyWorldLeave(),');
    expect(scene).toContain('this.arenaRuntime.requestLocalWorldParticipation(false);');
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
  it('verwendet committed Host-Konfigurationen bis zur nächsten Auswahl oder zum Moduswechsel wieder', () => {
    let mode = 'coop_defense';
    let committed = {
      weapon1: DEFAULT_LOADOUT.weapon1.id, weapon2: DEFAULT_LOADOUT.weapon2.id,
      utility: DEFAULT_LOADOUT.utility.id, ultimate: DEFAULT_LOADOUT.ultimate.id,
      coopDefenseClassId: null, coopDefenseProfile: null,
    };
    const coordinator = Object.create(ArenaLifecycleCoordinator.prototype) as any;
    coordinator.committedLoadoutSelections = new WeakMap();
    coordinator.resolveConfiguredGameMode = () => mode;
    vi.spyOn(bridge, 'getActivityDescriptor').mockReturnValue({ kind: 'pvp-match' } as any);
    vi.spyOn(bridge, 'getPlayerCommittedLoadout').mockImplementation(() => committed);

    const initial = coordinator.resolveCommittedLoadoutSelection('local');
    expect(coordinator.resolveCommittedLoadoutSelection('local')).toBe(initial);
    committed = { ...committed, weapon2: WEAPON_CONFIGS.P90.id };
    const next = coordinator.resolveCommittedLoadoutSelection('local');
    expect(next).not.toBe(initial);
    expect(next.weapon2.id).toBe(WEAPON_CONFIGS.P90.id);
    mode = 'deathmatch';
    expect(coordinator.resolveCommittedLoadoutSelection('local')).not.toBe(next);
  });

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
      isHost: true,
      participation: 'interactive',
    });
    // Kein Fake-Missionszustand, nur weil eine Figur existiert: Missionsmodule sind seit der
    // Player-Lifetime-Trennung ueberhaupt kein World-Feature mehr.
    expect(features).toEqual({
      entity: true,
      worldTargeting: true,
      navigation: true,
      combat: true,
      combatResources: true,
      loadoutTools: true,
      playerBuild: true,
    });
  });

  it('loest die Spielfigur ohne Activity aus der World-Teilnahme statt aus der Runde', () => {
    const lifecycle = read('src/world/WorldCombatGameplayBinding.ts');
    const start = lifecycle.indexOf('    combat.setInitialSpawnAllowedResolver(');
    const end = lifecycle.indexOf('combat.setRespawnCallback(', start);
    expect(start).toBeGreaterThanOrEqual(0);
    const spawnGate = lifecycle.slice(start, end);

    // Mit Runde bleibt die Runde die Quelle ...
    expect(spawnGate).toContain('o.network.round.canPlayerInitialSpawn(playerId)');
    expect(spawnGate).toContain('o.network.round.canPlayerRespawn(playerId)');
    // ... ohne Runde traegt die World-Teilnahme die Antwort.
    expect(spawnGate).toContain('o.isActivityActive()');
    expect(spawnGate).toContain('hasWorldFigure(o.getWorldParticipation(playerId))');
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
    expect(scene).toContain('this.arenaRuntime.syncLobbySurface(presentationPolicy.showLobby);');
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
    // Das Testgelaende braucht Platz; ein einzelner Restzipfel waere kein Startpunkt.
    expect(free).toBeGreaterThan(200);
  });

  it('reicht den authored Ausschluss an die World-Geometrie des PlayerManagers durch', () => {
    const binding = read('src/world/WorldGeometryBinding.ts');
    expect(binding).toContain('spawnExclusionZones: world.definition?.spawnExclusionZones');
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

describe('LobbyWorld – der Bootscreen weicht erst der fertigen Lobby', () => {
  afterEach(() => vi.restoreAllMocks());

  class DisplayObject {
    alpha = 1;
    y = 0;
    visible = true;
    children: DisplayObject[] = [];
    setAlpha(alpha: number) { this.alpha = alpha; return this; }
    setY(y: number) { this.y = y; return this; }
    setVisible(visible: boolean) { this.visible = visible; return this; }
    add(children: DisplayObject | DisplayObject[]) {
      this.children.push(...(Array.isArray(children) ? children : [children]));
      return this;
    }
    setScrollFactor() { return this; }
    setOrigin() { return this; }
    setText() { return this; }
    setColor() { return this; }
    setEnabled() { return this; }
    setLabel() { return this; }
    setStrokeStyle() { return this; }
    setDisplaySize() { return this; }
    on() { return this; }
  }

  function overlayFixture() {
    const container = new DisplayObject();
    const add = () => new DisplayObject();
    const tweens = { add: vi.fn((_config: { targets: unknown; alpha?: number; y?: number }) => ({ remove: vi.fn() })) };
    const scene = { add: { image: add, text: add, circle: add, container: add }, tweens };
    const noop = () => {};
    const overlay = new LobbyOverlay(
      scene as any, { getLocalPlayerId: () => 'local' } as any,
      noop, noop, noop, noop, noop, noop, noop, noop, noop, noop,
    ) as any;
    overlay.container = container;
    // Texturen, Loadout-Controls und dekoratives Ready-Glow sind nicht Teil des Eintritts.
    overlay.updateReadyGlow = vi.fn();
    overlay.rowTexture = () => 'row';
    overlay.readyMarkTexture = () => 'ready';
    overlay.loadoutFrameTexture = () => 'loadout-frame';
    overlay.refreshPlayerLoadout = vi.fn();
    overlay.setPlayerRowInteractive = vi.fn();
    return { overlay, container, tweens };
  }

  function bootFixture() {
    vi.spyOn(bridge, 'getGamePhase').mockReturnValue('LOBBY');
    const progress = vi.spyOn(BootScreen, 'setProgress').mockImplementation(() => {});
    let finishFade!: () => void;
    const fade = vi.spyOn(BootScreen, 'fadeOut').mockImplementation(() => new Promise<void>((resolve) => {
      finishFade = resolve;
    }));
    const reveal = { ready: false, progress: 85 };
    const overlay = overlayFixture();
    overlay.overlay.show();
    const scene = Object.create(ArenaScene.prototype) as any;
    scene.bootRevealPending = true;
    scene.time = { now: 0 };
    scene.game = { events: { off: vi.fn() } };
    scene.cameras = {
      main: { width: 1280, height: 720, zoom: 2, originX: 0, originY: 0, scrollX: 90, scrollY: 120 },
    };
    scene.arenaRuntime = { getWorldRevealState: vi.fn(() => reveal) };
    scene.lobbyOverlay = overlay.overlay;
    return { scene, reveal, progress, fade, finishFade: () => finishFade(), ...overlay };
  }

  it('bindet die Reveal-Barriere an das fertige Renderbild und entfernt sie beim Shutdown', () => {
    const scene = read('src/scenes/ArenaScene.ts');
    // create() komponiert die gesamte Szene; nur die Render-Lifecycle-Grenze bleibt statisch.
    const create = scene.slice(scene.indexOf('  create(): void {'), scene.indexOf('  update('));
    expect(create).toContain('this.game.events.on(Phaser.Core.Events.POST_RENDER, this.syncBootReveal, this)');
    expect(create).toMatch(
      /this\.events\.once\(Phaser\.Scenes\.Events\.SHUTDOWN, \(\) => \{\s*this\.game\.events\.off\(Phaser\.Core\.Events\.POST_RENDER, this\.syncBootReveal, this\)/,
    );
    const update = scene.slice(scene.indexOf('  update('), scene.indexOf('  private syncBootReveal('));
    expect(update).not.toMatch(/this\.syncBootReveal\(/);
  });

  it('haelt unfertige sichtbare World-Flaechen auch bei langsamem Start bedeckt', () => {
    const { scene, progress, fade, reveal } = bootFixture();
    for (const now of [0, 3000, 60000]) {
      scene.time.now = now;
      scene.syncBootReveal();
      expect(scene.bootRevealPending).toBe(true);
      expect(fade).not.toHaveBeenCalled();
      expect(scene.game.events.off).not.toHaveBeenCalled();
      expect(progress.mock.lastCall?.[0]).toBeLessThan(1);
    }
    expect(scene.arenaRuntime.getWorldRevealState).toHaveBeenCalledWith({
      x: 90, y: 120, width: 640, height: 360, centerX: 410, centerY: 300,
    });
    reveal.ready = true;
    scene.syncBootReveal();
    expect(scene.bootRevealPending).toBe(false);
    expect(progress).toHaveBeenLastCalledWith(1);
    expect(fade).toHaveBeenCalledOnce();
    expect(scene.game.events.off).toHaveBeenCalledWith('postrender', scene.syncBootReveal, scene);
  });

  it('zeigt beim Boot-Reveal sofort das vollstaendige Panel und startet nach dem Fade keine Animation', async () => {
    const { scene, reveal, container, tweens, finishFade } = bootFixture();
    expect(container).toMatchObject({ visible: true, alpha: 1, y: 0 });
    expect(tweens.add).not.toHaveBeenCalled();
    reveal.ready = true;
    scene.syncBootReveal();
    expect(container).toMatchObject({ visible: true, alpha: 1, y: 0 });
    finishFade();
    await Promise.resolve();
    expect(tweens.add).not.toHaveBeenCalled();
    expect(container).toMatchObject({ visible: true, alpha: 1, y: 0 });
  });

  it('haelt den Einstieg in eine laufende Arena nicht an der Lobby-World fest', () => {
    const { scene, fade } = bootFixture();
    vi.mocked(bridge.getGamePhase).mockReturnValue('ARENA');
    scene.syncBootReveal();
    expect(scene.arenaRuntime.getWorldRevealState).not.toHaveBeenCalled();
    expect(scene.bootRevealPending).toBe(false);
    expect(fade).toHaveBeenCalledOnce();
  });

  it.each(['showHostDisconnectedMessage', 'showArenaFailureMessage'] as const)(
    'gibt einen terminalen Fehler aus %s auch ohne fertige World frei', (showFailure) => {
      const { scene, overlay, reveal, fade, progress } = bootFixture();
      overlay.statusText = new DisplayObject();
      overlay.readyBtn = new DisplayObject();
      overlay.updateRoomActionButtons = vi.fn();
      overlay.lobbyAlertBanner = { showAlert: vi.fn() };
      expect(overlay.hasTerminalFailure()).toBe(false);

      overlay[showFailure]('Start fehlgeschlagen');
      expect(overlay.hasTerminalFailure()).toBe(true);
      expect(overlay.lobbyAlertBanner.showAlert).toHaveBeenCalledWith(expect.objectContaining({
        severity: 'error', message: expect.stringContaining('Start fehlgeschlagen'),
      }));
      scene.syncBootReveal();
      expect(reveal.ready).toBe(false);
      expect(scene.arenaRuntime.getWorldRevealState).not.toHaveBeenCalled();
      expect(scene.bootRevealPending).toBe(false);
      expect(progress).toHaveBeenLastCalledWith(1);
      expect(fade).toHaveBeenCalledOnce();
    },
  );

  it('wartet bei sichtbarer World auf Shader-Warmup vor Reveal und replizierter Ladefreigabe', () => {
    let warmupComplete = false;
    let presentationRequired = true;
    const coordinator = Object.create(ArenaLifecycleCoordinator.prototype) as any;
    coordinator.arenaBuilt = true;
    coordinator.terrainSnapshotReady = true;
    coordinator.worldRuntime = {
      materialization: { arena: {} },
      presentation: { layout: {} },
      presentationFrame: { getWorldRenderWork: () => ({ pending: 0, resident: 1, renderReady: true }) },
    };
    coordinator.renderers = { gpuVfx: { isShaderWarmupComplete: () => warmupComplete } };
    coordinator.getLocalWorldPresentation = () => ({ required: presentationRequired });
    coordinator.syncAuthoritativeRoundStartAnchors = vi.fn();
    coordinator.tryScheduleArenaStart = vi.fn();
    vi.spyOn(bridge, 'isHost').mockReturnValue(true);
    vi.spyOn(bridge, 'getWorldDescriptor').mockReturnValue({ worldRevision: 7 } as any);
    const publishProgress = vi.spyOn(bridge, 'setLocalWorldLoadProgress').mockImplementation(() => {});
    const publishReady = vi.spyOn(bridge, 'setLocalWorldLoadReady').mockImplementation(() => {});
    const view = { x: 0, y: 0, width: 100, height: 100 };

    expect(coordinator.getWorldRevealState(view).ready).toBe(false);
    coordinator.syncArenaLoadReady(view);
    expect(publishProgress).toHaveBeenLastCalledWith(7, expect.any(Number), 'rendering', false);

    warmupComplete = true;
    expect(coordinator.getWorldRevealState(view)).toEqual({ ready: true, progress: 100 });
    coordinator.syncArenaLoadReady(view);
    expect(publishProgress).toHaveBeenLastCalledWith(7, 100, 'ready', true);

    // A host without local presentation does not wait for renderer preparation.
    warmupComplete = false;
    presentationRequired = false;
    expect(coordinator.getWorldRevealState(null).ready).toBe(true);
    coordinator.syncArenaLoadReady(null);
    expect(publishReady).toHaveBeenLastCalledWith(7, true);
  });

  it('laesst die Reveal-Abfrage nicht auf runden- oder netzseitige Bedingungen warten', () => {
    const lifecycle = read('src/scenes/arena/ArenaLifecycleCoordinator.ts');
    const start = lifecycle.indexOf('  getWorldRevealState(view: WorldViewRect | null)');
    expect(start).toBeGreaterThan(0);
    // Bis zur Schlusszeile der Methode - sie ist zugleich die Aussage, die hier zaehlt.
    const end = lifecycle.indexOf('return { ready: loadProgress.ready', start);
    expect(end).toBeGreaterThan(start);
    const body = lifecycle.slice(start, end);
    // Der Terrain-Farb-Snapshot ist asynchron und beim Reveal unsichtbar; er darf nicht halten.
    expect(body.includes('terrainSnapshotReady')).toBe(false);
    expect(body.includes('bridge.')).toBe(false);
    expect(body).toContain('resolveWorldLoadProgress(');
  });

  it('bereitet die erste Spielerliste voll sichtbar vor und animiert erst spaetere Eintritte', () => {
    const { overlay, container, tweens } = overlayFixture();
    overlay.show();
    overlay.addPlayerRow({ id: 'local', name: 'Host', colorHex: 0xffffff });
    expect(container.children.length).toBeGreaterThan(0);
    expect(container.children.every((object) => object.alpha === 1)).toBe(true);
    expect(tweens.add).not.toHaveBeenCalled();

    overlay.completeBootReveal();
    overlay.show();
    expect(tweens.add).not.toHaveBeenCalled();
    overlay.addPlayerRow({ id: 'guest', name: 'Guest', colorHex: 0xffffff });
    expect(tweens.add).toHaveBeenCalled();
    tweens.add.mockClear();

    overlay.hide();
    overlay.show();
    expect(tweens.add).toHaveBeenCalledOnce();
    expect(tweens.add.mock.calls[0][0]).toMatchObject({ targets: container, alpha: 1, y: 0 });
  });

  it('zeigt beide Ergebnisaktionen gemeinsam erst bei verfuegbarer Rundenauswertung', () => {
    const { overlay } = overlayFixture();
    overlay.replayBtn = new DisplayObject();
    overlay.statisticsBtn = new DisplayObject();
    overlay.setResultsReplayAvailable(false);
    expect(overlay.replayBtn.visible).toBe(false);
    expect(overlay.statisticsBtn.visible).toBe(false);
    overlay.setResultsReplayAvailable(true);
    expect(overlay.replayBtn.visible).toBe(true);
    expect(overlay.statisticsBtn.visible).toBe(true);
    overlay.setResultsReplayAvailable(false);
    expect(overlay.replayBtn.visible).toBe(false);
    expect(overlay.statisticsBtn.visible).toBe(false);
  });

  it('sperrt offene Raumeinstellungen auch beim autoritativen Rundenstart', () => {
    const { overlay } = overlayFixture();
    overlay.readyBtn = new DisplayObject();
    overlay.settings = { setLocked: vi.fn() };
    overlay.progress = { setReady: vi.fn() };
    overlay.updateRoomActionButtons = vi.fn();
    overlay.lockButton();
    expect(overlay.settings.setLocked).toHaveBeenCalledWith(true);
    expect(overlay.progress.setReady).toHaveBeenCalledWith(true, false);
  });
});

describe('LobbyWorld – World-Ende raeumt ihre Teilnehmer', () => {
  it('loest jede Player-Runtime im World-Teardown, nicht erst beim Rundenende', () => {
    const lifecycle = read('src/scenes/arena/ArenaLifecycleCoordinator.ts');
    const start = lifecycle.indexOf('  tearDownArena(');
    expect(start).toBeGreaterThanOrEqual(0);
    // Der Abbau steht ganz vorn: die Detach-Module brauchen die Fachsysteme noch.
    expect(lifecycle.slice(start, start + 600)).toContain('this.detachAllWorldPlayers();');
    // Und der Matchstart schneidet die LobbyWorld samt Teilnehmern ab. Der Zeilenumbruch bleibt
    // offen: Ob die Arbeitskopie mit LF oder CRLF ausgecheckt ist, ist keine Aussage ueber den
    // Lifecycle.
    expect(lifecycle).toMatch(
      / {4}this\.detachAllWorldPlayers\(\);\r?\n {4}this\.worldLifecycle\.endInstance\(\);/,
    );
  });
});
