import { describe, expect, it } from 'vitest';
import { getArenaMetricsProfile } from '../../src/config';
import { getCoopDefenseMapConfig } from '../../src/config/coopDefenseMaps';
import { COOP_DEFENSE_MODE } from '../../src/gameModes';
import { NetworkBridge } from '../../src/network/NetworkBridge';
import { clearActiveSession, setActiveSession } from '../../src/network/peer/session';
import { toMapId, toWorldDefinitionId } from '../../src/world/arenaDescriptorAdapter';
import { toWorldDefinition } from '../../src/config/authoring/coopDefenseAuthoringAdapter';
import { createWorldRuntimeContext } from '../../src/world/WorldRuntimeContext';
import { resolveInputPolicy } from '../../src/world/InputPolicy';
import { resolvePlayerCapabilities } from '../../src/world/PlayerCapabilities';
import { resolvePresentationPolicy } from '../../src/world/PresentationPolicy';
import { resolveWorldPresentation } from '../../src/world/WorldPresentation';
import { FakeNetwork, addClientRoom, createHostRoom, type TestRoom } from '../fakePeerNetwork';

/**
 * Der Pflichtfall aus dem Konzept: eine Shared World laeuft, waehrend der Raum in der Lobby
 * steht und der Host sie nur simuliert.
 *
 *   Room: Lobby | Shared World: Active | Activity: None
 *   Host:   Participation none        - simuliert, stellt nichts dar, hat keine Figur
 *   Client: Participation interactive - stellt dar, handelt gemaess Capabilities
 *
 * Bewiesen wird er an der replizierten Grenze: World, Teilnahme und Ladezustand liegen als
 * host-autoritativer Zustand auf der NetworkBridge. Der ArenaLifecycleCoordinator ist
 * Phaser-gebunden und laesst sich nur mit kompletter Scene bauen - seine fachlichen Regeln
 * sind hier aber genau die, die auf der Bridge stehen.
 */

const WORLD_REVISION = 8100;

const SHARED_WORLD = {
  worldRevision: WORLD_REVISION,
  definitionId: 'world:coop-defense:0',
  seed: 4242,
  generatorVersion: 1,
  layoutFingerprint: 'sharedworld',
} as const;

function bridgeFor(room: TestRoom): NetworkBridge {
  setActiveSession({ room: room.room, transport: room.transport, roomCode: 'ABC123' });
  const bridge = new NetworkBridge();
  bridge.activate();
  return bridge;
}

function useRoom(room: TestRoom): void {
  setActiveSession({ room: room.room, transport: room.transport, roomCode: 'ABC123' });
}

async function createRoom(playerCount: number): Promise<TestRoom[]> {
  const network = new FakeNetwork();
  const rooms = [await createHostRoom(network)];
  for (let i = 1; i < playerCount; i += 1) rooms.push(await addClientRoom(network));
  return rooms;
}

/**
 * Baut den Pflichtzustand auf: World ohne Activity, Host ohne Teilnahme, Client interaktiv.
 * Die Bridge-Aufrufe entsprechen hostSyncWorldParticipation() mit dem Host ausserhalb des
 * kanonischen Admission-Sets.
 */
function hostOpenSharedWorld(host: NetworkBridge): void {
  host.publishLobbySync();
  host.setMatchHostId();
  host.publishWorldAndActivity(SHARED_WORLD, null);
  host.hostPublishWorldParticipation({ p1: 'interactive' });
}

describe('Shared World ohne Activity – Aufbau und Teilnahme', () => {
  it('laeuft mit Raumzustand Lobby und ohne jede Runde', async () => {
    const [hostRoom, clientRoom] = await createRoom(2);
    try {
      const host = bridgeFor(hostRoom);
      const client = bridgeFor(clientRoom);
      useRoom(hostRoom);
      hostOpenSharedWorld(host);

      // Der Raum bleibt ausdruecklich in der Lobby; die World haengt nicht an der Phase.
      expect(host.getGamePhase()).toBe('LOBBY');
      expect(host.getWorldDescriptor()).toMatchObject({ worldRevision: WORLD_REVISION });
      expect(host.getActivityDescriptor()).toBeNull();

      // Und es gibt keine Runde: kein Rundenzustand, keine Rundenteilnahme, kein Startzeitpunkt.
      expect(host.getRoundState()).toBeNull();
      expect(host.getRoundParticipation()).toBeNull();
      expect(host.getArenaStartTime()).toBe(0);

      // Die gemischte Kompatibilitaetssicht bleibt leer - sie beschreibt eine Runde, keine
      // World. Genau deshalb darf sie den Weltaufbau nicht torwaechtern.

      // Der Client sieht dieselbe World-Instanz.
      useRoom(clientRoom);
      expect(client.getWorldDescriptor()).toEqual(host.getWorldDescriptor());
      expect(client.getActivityDescriptor()).toBeNull();
    } finally {
      clearActiveSession();
    }
  });

  it('traegt die Teilnahme als eigenen World-Kanal, nicht als Rundenzustand', async () => {
    const [hostRoom, clientRoom] = await createRoom(2);
    try {
      const host = bridgeFor(hostRoom);
      const client = bridgeFor(clientRoom);
      useRoom(hostRoom);
      hostOpenSharedWorld(host);

      // Host: simuliert, nimmt aber nicht teil und hat damit keine Figur in der World.
      expect(host.getLocalWorldParticipation()).toBe('none');
      // Client: vollwertige Teilnahme in derselben World.
      expect(host.getWorldParticipation('p1')).toBe('interactive');
      expect(host.getWorldParticipants()).toEqual(['p1']);

      // Beide Peers lesen denselben Stand - er wird nirgends lokal rekonstruiert.
      useRoom(clientRoom);
      expect(client.getLocalWorldParticipation()).toBe('interactive');
      expect(client.getWorldParticipation('p0')).toBe('none');
    } finally {
      clearActiveSession();
    }
  });

  it('bindet den Teilnahmestand an die World-Instanz, aus der er stammt', async () => {
    const [hostRoom] = await createRoom(1);
    try {
      const host = bridgeFor(hostRoom);
      useRoom(hostRoom);
      hostOpenSharedWorld(host);
      expect(host.getWorldParticipants()).toEqual(['p1']);

      // Eine neue World-Instanz startet ohne Teilnehmer; nichts wird uebernommen.
      host.publishWorldAndActivity({ ...SHARED_WORLD, worldRevision: WORLD_REVISION + 1 }, null);
      expect(host.getWorldParticipants()).toEqual([]);
      expect(host.getWorldParticipation('p1')).toBe('none');

      // Und mit der World endet auch die Teilnahme.
      host.hostPublishWorldParticipation({ p1: 'interactive' });
      host.clearWorldAndActivity();
      expect(host.getWorldParticipationState()).toBeNull();
      expect(host.getWorldParticipation('p1')).toBe('none');
    } finally {
      clearActiveSession();
    }
  });
});

describe('Shared World ohne Activity – Admission statt Raum-Mitgliedschaft', () => {
  it('laesst einen dritten Peer im Raum, ohne ihn in die World zu nehmen', async () => {
    const [hostRoom, clientARoom, clientBRoom] = await createRoom(3);
    try {
      const host = bridgeFor(hostRoom);
      const clientB = bridgeFor(clientBRoom);
      useRoom(hostRoom);
      hostOpenSharedWorld(host);

      // Alle drei stehen im selben Raum.
      expect(host.getConnectedPlayerIds().sort()).toEqual(['p0', 'p1', 'p2']);
      // In der World steht nur, wer aufgenommen wurde.
      expect(host.getWorldParticipants()).toEqual(['p1']);
      expect(host.getWorldParticipation('p1')).toBe('interactive');
      expect(host.getWorldParticipation('p2')).toBe('none');
      expect(host.getLocalWorldParticipation()).toBe('none');

      // Und der nicht aufgenommene Peer stellt die World auch nicht dar.
      useRoom(clientBRoom);
      expect(clientB.getLocalWorldParticipation()).toBe('none');
      expect(resolveWorldPresentation({
        participation: clientB.getLocalWorldParticipation(),
        worldActive: clientB.getWorldDescriptor() !== null,
      }).required).toBe(false);

      // Erst der ausdrueckliche Eintritt bringt ihn hinein - das ist ein echtes Join.
      useRoom(hostRoom);
      host.hostPublishWorldParticipation({ p1: 'interactive', p2: 'interactive' });
      expect(host.getWorldParticipants()).toEqual(['p1', 'p2']);

      // Und ein echtes Leave bringt ihn zurueck in die Lobby.
      host.hostPublishWorldParticipation({ p1: 'interactive' });
      expect(host.getWorldParticipation('p2')).toBe('none');
      expect(clientARoom.room.getGlobal('wpp')).toEqual(hostRoom.room.getGlobal('wpp'));
    } finally {
      clearActiveSession();
    }
  });

});

describe('Shared World ohne Activity – Laden ohne Runde', () => {
  it('oeffnet die Ladebarriere ueber die World-Revision statt ueber eine Rundenrevision', async () => {
    const [hostRoom, clientRoom] = await createRoom(2);
    try {
      const host = bridgeFor(hostRoom);
      const client = bridgeFor(clientRoom);
      useRoom(hostRoom);
      hostOpenSharedWorld(host);

      // Solange der einzige Teilnehmer nicht geladen hat, bleibt die Barriere zu.
      expect(host.areWorldParticipantsLoadReady()).toBe(false);

      useRoom(clientRoom);
      client.setLocalWorldLoadReady(WORLD_REVISION);
      useRoom(hostRoom);

      // Der Host wird nicht erwartet: er nimmt nicht teil und laedt deshalb nichts.
      expect(host.areWorldParticipantsLoadReady()).toBe(true);
      expect(host.getPlayerWorldLoadReady('p1', WORLD_REVISION)).toBe(true);

      // Eine Meldung zu einer anderen World-Instanz zaehlt nicht.
      expect(host.getPlayerWorldLoadState('p1', WORLD_REVISION + 1)).toBeNull();
    } finally {
      clearActiveSession();
    }
  });
});

describe('Shared World ohne Activity – Presentation und Input folgen der Teilnahme', () => {
  it('gibt dem simulierenden Host die Lobby und keine World-Darstellung', async () => {
    const [hostRoom, clientRoom] = await createRoom(2);
    try {
      const host = bridgeFor(hostRoom);
      useRoom(hostRoom);
      hostOpenSharedWorld(host);

      const presentation = resolveWorldPresentation({
        participation: host.getLocalWorldParticipation(),
        worldActive: host.getWorldDescriptor() !== null,
      });
      // Kein einziger Darstellungsanteil - auch kein unsichtbarer.
      expect(presentation.required).toBe(false);
      expect(presentation.surfaces).toEqual([]);

      const policy = resolvePresentationPolicy({
        inLobby: host.getGamePhase() === 'LOBBY',
        worldPresentation: presentation,
        worldVisible: true,
        gameplayActive: false,
        roundRole: 'participant',
        matchTerminated: false,
        spectatorPanAvailable: false,
      });
      expect(policy).toEqual({
        showLobby: true,
        showWorld: false,
        worldMode: 'none',
        showHud: false,
        useWorldCamera: false,
        useSpectatorCamera: false,
      });

      // Ohne Teilnahme gibt es auch keine Eingabe in die World.
      const input = resolveInputPolicy({
        capabilities: resolvePlayerCapabilities({
          participation: host.getLocalWorldParticipation(),
          activityKind: host.getActivityDescriptor()?.kind ?? null,
          worldCombatAllowed: false,
        }),
        gameplayActive: true,
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

      // Der Client steht zur selben Zeit vollstaendig in der World.
      useRoom(clientRoom);
      const client = bridgeFor(clientRoom);
      const clientPresentation = resolveWorldPresentation({
        participation: client.getLocalWorldParticipation(),
        worldActive: client.getWorldDescriptor() !== null,
      });
      expect(clientPresentation.required).toBe(true);
      expect(resolvePresentationPolicy({
        inLobby: false,
        worldPresentation: clientPresentation,
        worldVisible: true,
        gameplayActive: true,
        roundRole: 'participant',
        matchTerminated: false,
        spectatorPanAvailable: false,
      })).toMatchObject({ showWorld: true, showHud: true, useWorldCamera: true });

      const clientInput = resolveInputPolicy({
        capabilities: resolvePlayerCapabilities({
          participation: client.getLocalWorldParticipation(),
          activityKind: client.getActivityDescriptor()?.kind ?? null,
          worldCombatAllowed: false,
        }),
        gameplayActive: true,
        countdownActive: false,
        uiBlocking: false,
        diagnosticsArena: false,
      });
      // Bewegen und Bauen ja - Kampf gehoert einer Activity, und es laeuft keine.
      expect(clientInput.movement).toBe(true);
      expect(clientInput.placement).toBe(true);
      expect(clientInput.combat).toBe(false);
    } finally {
      clearActiveSession();
    }
  });
});

describe('Shared World ohne Activity – der Aufbau gehoert der World', () => {
  it('baut eine authored Coop-World auch ohne laufende Mission auf', () => {
    // Genau der Fall des Persistent-Base-Editors: dieselbe authored Map, aber keine Runde.
    // Frueher kam die Map aus der Activity - ohne Mission blieb sie `null`, und der Kontext
    // scheiterte an seiner eigenen Zusicherung, dass Map und Weltidentitaet zusammenpassen.
    const mapConfig = getCoopDefenseMapConfig('0');
    const descriptor = {
      worldRevision: 900,
      definitionId: toWorldDefinitionId(mapConfig.mapId),
      seed: 11,
      generatorVersion: 1,
      layoutFingerprint: 'editorworld',
    };

    const world = createWorldRuntimeContext({
      descriptor,
      metricsProfile: getArenaMetricsProfile(
        COOP_DEFENSE_MODE,
        'ARENA',
        mapConfig.arenaWidthCells,
        mapConfig.arenaHeightCells,
      ),
      definition: toWorldDefinition(mapConfig),
    });

    expect(world.descriptor.definitionId).toBe(descriptor.definitionId);
    expect(world.definition).not.toBeNull();
    expect(world.metrics.gridCols).toBeGreaterThan(0);
    expect(world.bases.length).toBeGreaterThan(0);

    // Und die Map wird wirklich aus der Weltidentitaet aufgeloest.
    expect(toMapId(descriptor.definitionId)).toBe(mapConfig.mapId);
  });

});
