import { describe, expect, it } from 'vitest';
import { ARENA_COUNTDOWN_SEC } from '../src/config';
import { NetworkBridge, type RoundConclusion } from '../src/network/NetworkBridge';
import { clearActiveSession, setActiveSession } from '../src/network/peer/session';
import { resolveArenaStartTime } from '../src/scenes/arena/ArenaStartTiming';
import { FakeNetwork, addClientRoom, createHostRoom, type TestRoom } from './fakePeerNetwork';

/**
 * Regressionsnetz fuer den Missions-Lifecycle an seiner testbaren Grenze: dem replizierten
 * Rundenvertrag der {@link NetworkBridge}.
 *
 * `ArenaLifecycleCoordinator` selbst ist Phaser-gebunden und laesst sich nur mit einer kompletten
 * Scene aufbauen. Alles, was den Lifecycle fachlich ausmacht – eingefrorene Teilnahme, das
 * Freigabetor fuer Gameplay, der Abschlussweg und der Zustand danach – liegt jedoch ohnehin als
 * host-autoritativer Zustand auf der Bridge. Die Helfer unten spiegeln deshalb exakt die
 * Bridge-Aufrufe von `hostCheckReadyToStart()`, `hostCompleteRound()` und `terminateMatch()`
 * wider, ohne deren Regeln zu duplizieren.
 */

function bridgeFor(room: TestRoom): NetworkBridge {
  setActiveSession({ room: room.room, transport: room.transport, roomCode: 'ABC123' });
  const bridge = new NetworkBridge();
  bridge.activate();
  return bridge;
}

/** Bridge-Aufrufe aus `ArenaLifecycleCoordinator.hostCheckReadyToStart()`. */
function hostStartMission(host: NetworkBridge, roundRevision: number): void {
  host.publishLobbySync();
  host.setMatchHostId();
  host.resetAllFrags();
  host.publishRoundResults([]);
  host.hostStartRoundParticipants(host.getConnectedPlayerIds(), 0, roundRevision);
  host.setArenaStartTime(0);
  host.setRoundEndTime(0);
  host.publishRoundState({ status: 'active', roundStartTime: 0 });
  // Der aktive Persistent-Base-Radius ist ein World-Parameter. Clients duerfen ihn nicht aus
  // ihrem eigenen lokalen Speicher ableiten, sonst baut jeder Peer eine andere Zone.
  host.publishWorldAndActivity(
    {
      worldRevision: roundRevision,
      definitionId: 'world:coop-defense:1',
      seed: 99,
      generatorVersion: 1,
      layoutFingerprint: 'cafebabe',
      parameters: { persistentBaseRadiusCells: 6 },
    },
    {
      activityRevision: roundRevision,
      worldRevision: roundRevision,
      kind: 'coop-mission',
      definitionId: 'activity:coop-mission:1',
    },
  );
  // Teilnahme ist ein eigener World-Kanal; der Host schreibt ihn wie in
  // `ArenaLifecycleCoordinator.hostSyncWorldParticipation()`.
  host.hostPublishWorldParticipation(Object.fromEntries(
    host.getConnectedPlayerIds().map((id) => [id, 'interactive' as const]),
  ));
  host.setGamePhase('ARENA');
}

/** Bridge-Aufrufe aus `ArenaLifecycleCoordinator.hostCompleteRound()`. */
function hostCompleteMission(host: NetworkBridge, conclusion: RoundConclusion, endedAt: number): void {
  const current = host.getRoundState();
  host.publishRoundState({
    status: conclusion,
    roundStartTime: host.getArenaStartTime(),
    timeOfDayMinutes: current?.timeOfDayMinutes,
    resultEligiblePlayerIds: host.getRoundResultEligiblePlayerIds(),
    endedAt,
  });
  host.hostResetRoundParticipation();
  host.hostResetAllLobbyReady();
  // Mit der Runde endet auch die World-Instanz.
  host.clearWorldAndActivity();
  host.setGamePhase('LOBBY');
}

/**
 * Bridge-Aufrufe aus `ArenaLifecycleCoordinator.terminateMatch()`. Der technische Abbruch loescht
 * den Teilnahme-Snapshot bewusst NICHT; er beendet die Runde allein ueber die Phase.
 */
function hostTerminateMatch(host: NetworkBridge): void {
  host.hostResetAllLobbyReady();
  host.clearWorldAndActivity();
  host.setGamePhase('LOBBY');
}

async function createRoom(playerCount: number): Promise<TestRoom[]> {
  const network = new FakeNetwork();
  const rooms = [await createHostRoom(network)];
  for (let i = 1; i < playerCount; i += 1) rooms.push(await addClientRoom(network));
  return rooms;
}

describe('mission lifecycle – Start und Freigabe', () => {
  it('friert Teilnahme und Rundenzustand beim Wechsel aus der Lobby host-autoritativ ein', async () => {
    const [hostRoom, clientRoom] = await createRoom(2);
    try {
      const host = bridgeFor(hostRoom);
      expect(host.getGamePhase()).toBe('LOBBY');
      expect(host.getRoundParticipation()).toBeNull();
      expect(host.getConnectedPlayerIds()).toEqual(['p0', 'p1']);

      hostStartMission(host, 4711);

      const client = bridgeFor(clientRoom);
      expect(client.getGamePhase()).toBe('ARENA');
      expect(client.getRoundParticipation()).toEqual({
        roundStartTime: 0,
        roundRevision: 4711,
        participantIds: ['p0', 'p1'],
        spectatorIds: [],
      });
      expect(client.getRoundState()).toMatchObject({ status: 'active' });
      expect(client.getWorldDescriptor()).toMatchObject({
        worldRevision: 4711,
        definitionId: 'world:coop-defense:1',
        parameters: { persistentBaseRadiusCells: 6 },
      });
      expect(client.getActivityDescriptor()?.kind).toBe('coop-mission');
      expect(client.getMatchHostId()).toBe('p0');
      // Der Endstand der Vorrunde ist beim Start atomar geleert.
      expect(client.getRoundResults()).toEqual([]);
    } finally {
      clearActiveSession();
    }
  });

  it('gibt Gameplay erst frei, nachdem alle Teilnehmer ihre Arena geladen haben', async () => {
    const [hostRoom, clientRoom] = await createRoom(2);
    try {
      const client = bridgeFor(clientRoom);
      const host = bridgeFor(hostRoom);
      hostStartMission(host, 4712);

      // Ohne gemeinsamen Startzeitpunkt laedt die Runde noch und Gameplay bleibt gesperrt.
      expect(host.getArenaStartTime()).toBe(0);
      expect(host.isArenaLoading(1_000)).toBe(true);
      expect(host.isArenaStarted(1_000)).toBe(false);
      expect(host.areWorldParticipantsLoadReady()).toBe(false);

      host.setLocalWorldLoadReady(4712);
      expect(host.areWorldParticipantsLoadReady()).toBe(false);

      setActiveSession({ room: clientRoom.room, transport: clientRoom.transport, roomCode: 'ABC123' });
      client.setLocalWorldLoadReady(4712);
      setActiveSession({ room: hostRoom.room, transport: hostRoom.transport, roomCode: 'ABC123' });
      expect(host.areWorldParticipantsLoadReady()).toBe(true);

      const now = 1_000_000;
      const arenaStartTime = resolveArenaStartTime(now);
      host.setArenaStartTime(arenaStartTime);
      expect(host.isArenaLoading(now)).toBe(false);
      expect(host.isArenaCountdownActive(now)).toBe(true);
      expect(host.isArenaStarted(now)).toBe(false);
      expect(host.isArenaStarted(now + ARENA_COUNTDOWN_SEC * 1000)).toBe(true);
    } finally {
      clearActiveSession();
    }
  });

  it('verwirft eine Ladebestaetigung aus der Vorrunde', async () => {
    const [hostRoom, clientRoom] = await createRoom(2);
    try {
      const client = bridgeFor(clientRoom);
      const host = bridgeFor(hostRoom);
      hostStartMission(host, 4713);
      host.setLocalWorldLoadReady(4713);
      setActiveSession({ room: clientRoom.room, transport: clientRoom.transport, roomCode: 'ABC123' });
      client.setLocalWorldLoadReady(4713);
      setActiveSession({ room: hostRoom.room, transport: hostRoom.transport, roomCode: 'ABC123' });
      expect(host.areWorldParticipantsLoadReady()).toBe(true);

      hostCompleteMission(host, 'victory', 2_000);
      hostStartMission(host, 4714);
      host.setLocalWorldLoadReady(4714);

      // Verspaetetes reliable Paket der Vorrunde – direkt auf dem Draht, damit es die lokale
      // Entprellung von setLocalWorldLoadProgress() umgeht und der Host es wirklich sieht.
      clientRoom.room.setPlayerState('p1', 'wlr', {
        worldRevision: 4713,
        progress: 100,
        stage: 'ready',
        ready: true,
      }, true);
      expect(hostRoom.room.getPlayerState('p1', 'wlr')).toMatchObject({ worldRevision: 4713, ready: true });
      expect(host.getPlayerWorldLoadState('p1', 4714)).toBeNull();
      expect(host.areWorldParticipantsLoadReady()).toBe(false);
    } finally {
      clearActiveSession();
    }
  });
});

describe('mission lifecycle – Abschluss und Rueckkehr in die Lobby', () => {
  for (const conclusion of ['victory', 'defeat', 'aborted'] as const) {
    it(`raeumt den Rundenzustand nach "${conclusion}" auf demselben Abschlussweg ab`, async () => {
      const [hostRoom, clientRoom] = await createRoom(2);
      try {
        const host = bridgeFor(hostRoom);
        hostStartMission(host, 4715);
        host.hostSetPlayerReady('p0', true);
        host.hostSetPlayerReady('p1', true);
        host.setArenaStartTime(resolveArenaStartTime(1_000));

        hostCompleteMission(host, conclusion, 9_000);

        const client = bridgeFor(clientRoom);
        // Fachlich unterscheidet allein der Status; alle drei Wege enden regulaer.
        expect(client.getRoundState()).toMatchObject({
          status: conclusion,
          endedAt: 9_000,
          resultEligiblePlayerIds: ['p0', 'p1'],
        });
        // Rueckkehr in eine konsistente Lobby.
        expect(client.getGamePhase()).toBe('LOBBY');
        expect(client.getRoundParticipation()).toBeNull();
        expect(client.getPlayerReady('p0')).toBe(false);
        expect(client.getPlayerReady('p1')).toBe(false);
        expect(client.areAllPlayersReady()).toBe(false);
        // Keine aktive Round-Runtime mehr: weder Spawn- noch Handlungsrechte.
        for (const playerId of ['p0', 'p1']) {
          expect(client.canPlayerSpawnOrRespawn(playerId)).toBe(false);
          expect(client.canPlayerAct(playerId)).toBe(false);
          expect(client.canPlayerReceiveRoundRewards(playerId)).toBe(false);
        }
        expect(client.isArenaStarted(20_000)).toBe(false);
        // Keine Runde, keine World: der replizierte Weltzustand endet mit der Mission.
        expect(client.getWorldDescriptor()).toBeNull();
        expect(client.getActivityDescriptor()).toBeNull();
      } finally {
        clearActiveSession();
      }
    });
  }

  it('hinterlaesst nach einem technischen Abbruch keine aktive Round-Runtime', async () => {
    const [hostRoom, clientRoom] = await createRoom(2);
    try {
      const host = bridgeFor(hostRoom);
      hostStartMission(host, 4716);
      host.hostSetPlayerReady('p0', true);
      host.hostSetPlayerReady('p1', true);
      host.setArenaStartTime(resolveArenaStartTime(1_000));
      expect(host.canPlayerSpawnOrRespawn('p1')).toBe(true);

      hostTerminateMatch(host);

      const client = bridgeFor(clientRoom);
      expect(client.getGamePhase()).toBe('LOBBY');
      // Der Teilnahme-Snapshot ueberlebt den Abbruch bewusst; die Phase allein sperrt die Runde.
      expect(client.getRoundParticipation()?.roundRevision).toBe(4716);
      for (const playerId of ['p0', 'p1']) {
        expect(client.canPlayerSpawnOrRespawn(playerId)).toBe(false);
        expect(client.canPlayerInitialSpawn(playerId)).toBe(false);
        expect(client.canPlayerAct(playerId)).toBe(false);
      }
      expect(client.isArenaStarted(20_000)).toBe(false);
      expect(client.isArenaCountdownVisible(20_000)).toBe(false);
      expect(client.getWorldDescriptor()).toBeNull();
      // Stehengebliebene Ready-Flags duerfen keine neue Runde ausloesen.
      expect(client.getPlayerReady('p1')).toBe(false);
      expect(client.areAllPlayersReady()).toBe(false);
    } finally {
      clearActiveSession();
    }
  });
});
