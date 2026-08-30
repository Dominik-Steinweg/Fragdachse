import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RoundParticipationState } from '../src/types';
import type { RoundState } from '../src/network/NetworkBridge';
import type { ActivityDescriptor } from '../src/world/ActivityDescriptor';
import type { WorldDescriptor } from '../src/world/WorldDescriptor';
import type { WorldParticipation, WorldParticipationState } from '../src/world/WorldParticipation';
import { WorldLifecycle, type WorldLifecycleSink } from '../src/world/WorldLifecycle';
import type { WorldRuntimeContext } from '../src/world/WorldRuntimeContext';
import {
  isArenaTransitionReady,
  type ArenaTransitionReadiness,
} from '../src/scenes/arena/ArenaTransitionReadiness';

const MATCH_START = 123_456;

function world(worldRevision: number, definitionId = 'world:coop-defense:7'): WorldDescriptor {
  return {
    worldRevision,
    definitionId,
    seed: worldRevision,
    generatorVersion: 3,
    layoutFingerprint: `fingerprint-${worldRevision}`,
  };
}

function activity(worldRevision: number, activityRevision = worldRevision): ActivityDescriptor {
  return {
    activityRevision,
    worldRevision,
    kind: 'coop-mission',
    definitionId: 'activity:coop-mission:7',
  };
}

function roundState(roundStartTime = MATCH_START): RoundState {
  return { status: 'active', roundStartTime };
}

function participation(roundRevision: number): RoundParticipationState {
  return {
    roundStartTime: MATCH_START,
    roundRevision,
    participantIds: ['p1'],
    spectatorIds: [],
  };
}

function worldParticipation(
  worldRevision: number,
  localParticipation: WorldParticipation = 'joining',
): WorldParticipationState {
  return {
    worldRevision,
    participants: { p1: localParticipation },
  };
}

function readiness(overrides: Partial<ArenaTransitionReadiness> = {}): ArenaTransitionReadiness {
  return {
    phase: 'ARENA',
    worldDescriptor: world(19),
    activityDescriptor: activity(19),
    roundState: roundState(),
    arenaStartTime: MATCH_START,
    participation: participation(19),
    worldParticipationState: worldParticipation(19),
    localPlayerId: 'p1',
    ...overrides,
  };
}

function runtime(descriptor: WorldDescriptor): WorldRuntimeContext {
  return { descriptor } as WorldRuntimeContext;
}

describe('Arena-Transition-Bereitschaft', () => {
  it('erlaubt keinen Build bei ARENA + World + Activity null', () => {
    expect(isArenaTransitionReady(readiness({ activityDescriptor: null }))).toBe(false);
  });

  it('verwirft eine Activity fuer die alte World-Revision', () => {
    expect(isArenaTransitionReady(readiness({ activityDescriptor: activity(18) }))).toBe(false);
  });

  it('erlaubt den Build bei passender World, Activity, Round-State und Participation', () => {
    expect(isArenaTransitionReady(readiness({
      activityDescriptor: activity(19, 31),
      participation: participation(31),
      worldParticipationState: worldParticipation(19, 'interactive'),
    }))).toBe(true);
  });

  it('wartet bei leerem WorldParticipation-Snapshot auf die lokale Konvergenz', () => {
    expect(isArenaTransitionReady(readiness({
      worldParticipationState: { worldRevision: 19, participants: {} },
    }))).toBe(false);
  });

  it.each(['joining', 'interactive'] as const)(
    'erlaubt einen normalen Round-Teilnehmer mit WorldParticipation=%s',
    (localParticipation) => {
      expect(isArenaTransitionReady(readiness({
        worldParticipationState: worldParticipation(19, localParticipation),
      }))).toBe(true);
    },
  );

  it('erlaubt einen Round-Spectator nur mit observer-Participation', () => {
    const spectatorRound = participation(19);
    spectatorRound.spectatorIds = ['p1'];
    expect(isArenaTransitionReady(readiness({
      participation: spectatorRound,
      worldParticipationState: worldParticipation(19, 'observer'),
    }))).toBe(true);
    expect(isArenaTransitionReady(readiness({
      participation: spectatorRound,
      worldParticipationState: { worldRevision: 19, participants: {} },
    }))).toBe(false);
  });

  it('wartet bei Round-Teilnehmer und none-Participation', () => {
    expect(isArenaTransitionReady(readiness({
      worldParticipationState: worldParticipation(19, 'none'),
    }))).toBe(false);
  });

  it('akzeptiert none nur fuer einen Spieler ausserhalb des Round-Snapshots', () => {
    expect(isArenaTransitionReady(readiness({
      localPlayerId: 'p2',
      worldParticipationState: { worldRevision: 19, participants: {} },
    }))).toBe(true);
  });

  it('verwirft einen WorldParticipation-Snapshot fuer eine andere World-Revision', () => {
    expect(isArenaTransitionReady(readiness({
      worldParticipationState: worldParticipation(18),
    }))).toBe(false);
  });

  it('erlaubt die Activity-lose LobbyWorld weiterhin', () => {
    expect(isArenaTransitionReady(readiness({
      phase: 'LOBBY',
      worldDescriptor: world(18, 'world:lobby'),
      activityDescriptor: null,
      roundState: null,
      participation: null,
    }))).toBe(true);
  });

  it('verlangt beim LobbyWorld-zu-MatchWorld-Race ein Ende der alten Instanz', () => {
    const calls: string[] = [];
    const sink: WorldLifecycleSink = {
      publish: () => {},
      clear: () => { calls.push('clear'); },
      attach: (context) => { calls.push(`attach:${context.descriptor.worldRevision}`); },
      detach: () => { calls.push('detach'); },
    };
    const lifecycle = new WorldLifecycle(sink);
    const lobby = world(18, 'world:lobby');
    const match = world(19);

    lifecycle.attachRuntime(runtime(lobby));
    expect(() => lifecycle.attachRuntime(runtime(match), activity(19))).toThrow(/does not match/);

    lifecycle.endInstance();
    lifecycle.attachRuntime(runtime(match), activity(19));

    expect(calls).toEqual(['attach:18', 'detach', 'clear', 'attach:19']);
  });

  it('durchlaeuft Lobby → Match → Lobby → Match ohne Lifecycle-Mismatch', () => {
    const lifecycle = new WorldLifecycle({
      publish: () => {},
      clear: () => {},
      attach: () => {},
      detach: () => {},
    });
    const lobby1 = world(18, 'world:lobby');
    const match1 = world(19);
    const lobby2 = world(20, 'world:lobby');
    const match2 = world(21);

    lifecycle.attachRuntime(runtime(lobby1));
    lifecycle.endInstance();
    lifecycle.attachRuntime(runtime(match1), activity(19));
    lifecycle.endInstance();
    lifecycle.attachRuntime(runtime(lobby2));
    lifecycle.endInstance();
    lifecycle.attachRuntime(runtime(match2), activity(21));

    expect(lifecycle.descriptor).toEqual(match2);
    expect(lifecycle.activity.descriptor).toEqual(activity(21));
  });
});

describe('ArenaLifecycleCoordinator – Replacement-Orchestrierung', () => {
  it('haelt den Host-Lobby-Sync waehrend des Arena-Exit-Fades zurueck', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/scenes/ArenaScene.ts'),
      'utf8',
    );
    const deferStart = source.indexOf('const deferArenaExit');
    const phaseChange = source.indexOf(
      'this.lifecycle.detectPhaseChange(deferArenaExit);',
      deferStart,
    );
    const lobbySync = source.indexOf(
      'this.lifecycle.hostSyncLobbyWorld();',
      phaseChange,
    );
    const worldChange = source.indexOf(
      'this.lifecycle.detectWorldChange(deferArenaExit);',
      lobbySync,
    );

    expect(deferStart).toBeGreaterThanOrEqual(0);
    expect(phaseChange).toBeGreaterThan(deferStart);
    expect(lobbySync).toBeGreaterThan(phaseChange);
    expect(worldChange).toBeGreaterThan(lobbySync);
    expect(source).toContain('if (!deferArenaExit) this.lifecycle.hostSyncLobbyWorld();');
    expect([...source.matchAll(/this\.lifecycle\.hostSyncLobbyWorld\(\);/g)]).toHaveLength(1);
  });

  it('reicht das Deferred-Exit-Fenster bis zur World-Erkennung weiter', () => {
    const scene = readFileSync(
      resolve(process.cwd(), 'src/scenes/ArenaScene.ts'),
      'utf8',
    );
    const source = readFileSync(
      resolve(process.cwd(), 'src/scenes/arena/ArenaLifecycleCoordinator.ts'),
      'utf8',
    );

    expect(scene).toContain('this.lifecycle.detectWorldChange(deferArenaExit);');
    expect(source).toContain('detectWorldChange(deferArenaToLobby = false): void {');
    expect(source).toContain('const deferredMatchToLobby = deferArenaToLobby');
    expect(source).toContain("&& bridge.getGamePhase() === 'LOBBY'");
    expect(source).toContain("&& this.lastPhase === 'ARENA';");
  });

  it('haelt den Host-Teardown bei fehlendem WorldDescriptor waehrend Deferred zurueck', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/scenes/arena/ArenaLifecycleCoordinator.ts'),
      'utf8',
    );
    const detectStart = source.indexOf('  detectWorldChange(deferArenaToLobby = false): void {');
    const noWorldStart = source.indexOf('    if (!world) {', detectStart);
    const noWorldEnd = source.indexOf('\n    // Eine neue Instanz', noWorldStart);
    const noWorldBody = source.slice(noWorldStart, noWorldEnd);

    expect(detectStart).toBeGreaterThanOrEqual(0);
    expect(noWorldEnd).toBeGreaterThan(noWorldStart);
    expect(noWorldBody).toContain('&& !deferredMatchToLobby)');
    expect(noWorldBody).toContain('this.onTransitionToLobby();');
  });

  it('blockiert nur Match→Lobby und laesst Reinstancing sowie den normalen Handoff frei', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/scenes/arena/ArenaLifecycleCoordinator.ts'),
      'utf8',
    );
    const detectStart = source.indexOf('  detectWorldChange(deferArenaToLobby = false): void {');
    const detectEnd = source.indexOf('\n  /**', detectStart);
    const detectBody = source.slice(detectStart, detectEnd);
    const matchGuard = detectBody.indexOf('if (deferredMatchToLobby && matchToLobby) return;');
    const fastReinstance = detectBody.indexOf('const canFastReinstance =');

    expect(matchGuard).toBeGreaterThan(0);
    expect(fastReinstance).toBeGreaterThan(matchGuard);
    expect(detectBody).toContain('const lobbyToMatch =');
    expect(detectBody).toContain('const matchToLobby =');
    expect(detectBody).toContain("if (lobbyToMatch || (bridge.getGamePhase() === 'ARENA' && !matchToLobby))");
    expect(detectBody).toContain('this.onTransitionToLobby();');
  });

  it('leitet LobbyWorld → MatchWorld nicht ueber den Lobby-Teardown um', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/scenes/arena/ArenaLifecycleCoordinator.ts'),
      'utf8',
    );
    const detectStart = source.indexOf('  detectWorldChange(deferArenaToLobby = false): void {');
    const detectEnd = source.indexOf('\n  /**', detectStart);
    const detectBody = source.slice(detectStart, detectEnd);
    const transitionStart = source.indexOf('  private onTransitionToArena(): void {');
    const transitionEnd = source.indexOf('\n  private startTerrainSnapshotBuild', transitionStart);
    const transitionBody = source.slice(transitionStart, transitionEnd);

    expect(detectBody).toContain('const lobbyToMatch =');
    expect(detectBody).toContain('const matchToLobby =');
    expect(detectBody).toContain("if (lobbyToMatch || (bridge.getGamePhase() === 'ARENA' && !matchToLobby))");
    expect(detectBody).toContain('this.onTransitionToArena();');
    expect(detectBody).toContain('this.onTransitionToLobby();');
    expect(transitionBody).toContain('this.synchronizeLocalWorldLifecycle(worldDescriptor);');

    const cleanupStart = source.indexOf('  private synchronizeLocalWorldLifecycle(');
    const cleanupEnd = source.indexOf('\n  private onTransitionToLobby', cleanupStart);
    const cleanupBody = source.slice(cleanupStart, cleanupEnd);
    expect(cleanupBody.indexOf('this.detachAllWorldPlayers();'))
      .toBeLessThan(cleanupBody.indexOf('this.worldLifecycle.endInstance();'));
    expect(cleanupBody.indexOf('this.worldLifecycle.endInstance();'))
      .toBeLessThan(cleanupBody.indexOf('this.clearWorldAdmission();'));
    expect(source).toContain("this.terminateMatch(t('ui.lobby.arenaBuildFailed'));");
    expect(source).toContain("this.terminateMatch(t('ui.lobby.arenaTransitionTimeout'));");
    expect(source).toContain("this.terminateMatch(t('ui.lobby.terrainSnapshotStartFailed'));");
    expect(source).toContain("this.terminateMatch(t('ui.lobby.terrainSnapshotCreateFailed'));");
    expect(source).not.toContain("this.terminateMatch('Lokale Arena konnte nicht aufgebaut werden.');");
    expect(source).not.toContain('Generator/Fingerprint abweichend');
  });

  it('synchronisiert den Host vor dem Arena-Readiness-Gate und laesst Clients auf Replikation warten', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/scenes/arena/ArenaLifecycleCoordinator.ts'),
      'utf8',
    );
    const transitionStart = source.indexOf('  private onTransitionToArena(): void {');
    const transitionEnd = source.indexOf('\n  private startTerrainSnapshotBuild', transitionStart);
    const transitionBody = source.slice(transitionStart, transitionEnd);
    expect(transitionBody.indexOf('this.hostSyncWorldParticipation();'))
      .toBeLessThan(transitionBody.indexOf('const activityReady = isArenaTransitionReady({'));
    expect(transitionBody).toContain('worldParticipationState: bridge.getWorldParticipationState(),');
    expect(transitionBody).toContain('localPlayerId: bridge.getLocalPlayerId(),');
    expect(source).toContain(
      "(this.worldLifecycle.phase !== 'active' && this.worldLifecycle.phase !== 'creating')",
    );
    expect(source).toContain('const activityPresent = this.worldLifecycle.activity.descriptor !== null;');
  });
});

/**
 * Der Terrain-Farb-Snapshot ist Teil der lokalen Ladebereitschaft: Bleibt er aus, haengt der
 * Ladeschirm bei 95 %. Die Invarianten dieses Lifecycles werden hier ueber den Quelltext
 * geprueft, weil der Koordinator ohne laufende Phaser-Szene nicht instanziierbar ist.
 */
describe('ArenaLifecycleCoordinator – TerrainSnapshotLifecycle', () => {
  const NL = String.fromCharCode(10);
  const source = readFileSync(
    resolve(process.cwd(), 'src/scenes/arena/ArenaLifecycleCoordinator.ts'),
    'utf8',
  );

  function section(startAnchor: string, endAnchor: string): string {
    const start = source.indexOf(startAnchor);
    const end = source.indexOf(endAnchor, start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end);
  }

  function snapshotBuildBody(): string {
    return section(
      '  private startTerrainSnapshotBuild(worldRevision: number): void {',
      NL + '  private get localPlayerState()',
    );
  }

  function transitionBody(): string {
    return section(
      '  private onTransitionToArena(): void {',
      NL + '  /**' + NL + '   * Baut den Terrain-Farb-Snapshot',
    );
  }

  it('setzt terrainSnapshotReady nur im Erfolgspfad des aktuellen Builds', () => {
    const body = snapshotBuildBody();
    expect(body).toContain('build.then((snapshot) => {');
    expect(body).toContain('this.renderers.leafBlower.setTerrainColorSnapshot(snapshot);');
    // Der Erfolgspfad ist der einzige Ort, der die lokale Snapshot-Bereitschaft setzt.
    expect(body.split('this.terrainSnapshotReady = true;')).toHaveLength(2);
  });

  it('bindet jeden Build an Generation, Layout, Arena-Ergebnis und World-Revision', () => {
    const body = snapshotBuildBody();
    expect(body).toContain('const generation = ++this.terrainSnapshotGenerationId;');
    expect(body).toContain('generation === this.terrainSnapshotGenerationId');
    expect(body).toContain('this.ctx.currentLayout === layout');
    expect(body).toContain('this.ctx.arenaResult === arenaResult');
    expect(body).toContain('bridge.getWorldDescriptor()?.worldRevision === worldRevision');
    // Ein World-Teardown invalidiert laufende Builds ueber dieselbe Generation.
    expect(source).toContain('this.terrainSnapshotGenerationId += 1;');
  });

  it('verriegelt verspaetete Callbacks gegen Watchdog und neuere Builds', () => {
    const body = snapshotBuildBody();
    expect(body).toContain('let settled = false;');
    expect(body).toContain('build.then((snapshot) => {' + NL + '      if (settled || !isCurrent()) return;');
    expect(body).toContain('}).catch((error: unknown) => {' + NL + '      if (settled || !isCurrent()) return;');
    // Watchdog, Erfolg und Fehler verriegeln sich gegenseitig ueber dasselbe Flag.
    expect(body.split('settled = true;')).toHaveLength(4);
    expect(body.split('timeoutTimer.remove(false);')).toHaveLength(3);
  });

  it('beendet einen ausbleibenden Snapshot-Callback ueber Watchdog, Retry und Abbruch', () => {
    const body = snapshotBuildBody();
    expect(source).toContain('private static readonly TERRAIN_SNAPSHOT_TIMEOUT_MS = 8000;');
    expect(source).toContain('private static readonly TERRAIN_SNAPSHOT_MAX_RETRIES = 1;');
    expect(body).toContain('ArenaLifecycleCoordinator.TERRAIN_SNAPSHOT_TIMEOUT_MS');
    expect(body).toContain(
      'this.terrainSnapshotRetryCount < ArenaLifecycleCoordinator.TERRAIN_SNAPSHOT_MAX_RETRIES',
    );
    expect(body).toContain('this.terrainSnapshotRetryCount += 1;');
    expect(body).toContain('this.startTerrainSnapshotBuild(worldRevision);');
    expect(body).toContain("this.terminateMatch(t('ui.lobby.terrainSnapshotTimeoutFailed'));");
    // Der Retry-Zaehler gehoert zum jeweiligen Arenaaufbau, nicht zur Session.
    expect(transitionBody()).toContain('this.terrainSnapshotRetryCount = 0;');
  });

  it('bricht fehlende Snapshot-Voraussetzungen ab, statt still zurueckzukehren', () => {
    const body = snapshotBuildBody();
    expect(body).not.toContain('if (!layout || !arenaResult || !world) return;');
    expect(body).toContain('if (!layout || !arenaResult || !world) {');
    expect(body).toContain("this.terminateMatch(t('ui.lobby.terrainSnapshotStartFailed'));");
  });

  it('haelt onTransitionToArena gegen Re-Eintritt aus Retry-Timer und detectWorldChange', () => {
    const body = transitionBody();
    expect(source).toContain('private arenaTransitionInProgress = false;');
    expect(body.indexOf('if (this.arenaTransitionInProgress) return;'))
      .toBeGreaterThan(-1);
    expect(body.indexOf('if (this.arenaTransitionInProgress) return;'))
      .toBeLessThan(body.indexOf('this.arenaTransitionInProgress = true;'));
    // Der Retry haelt den Guard bis zum eigenen Feuern; jeder andere Ausgang gibt ihn frei.
    expect(body).toContain([
      'this.scene.time.delayedCall(16, () => {',
      '        this.arenaTransitionInProgress = false;',
      '        this.onTransitionToArena();',
      '      });',
    ].join(NL));
    expect(body).toContain([
      'this.hostUpdate.setActive(activityDescriptor === null);',
      '    this.arenaTransitionInProgress = false;',
    ].join(NL));
    expect(source).toContain([
      '      && worldDescriptor?.worldRevision !== pendingHostGeneration.roundRevision) {',
      '      this.arenaTransitionInProgress = false;',
    ].join(NL));
  });

  it('gibt den Guard auf jedem Ausstieg aus dem Arena-Uebergang frei', () => {
    expect(source).toContain([
      '  private onTransitionToLobby(): void {',
      '    this.arenaTransitionInProgress = false;',
    ].join(NL));
    // terminateMatch loest den Guard vor dem eigenen Idempotenz-Guard: ein Abbruch im
    // Retry-Fenster darf den Uebergang nicht dauerhaft verriegeln.
    const terminate = section('  terminateMatch(reason?: string): void {', 'this.matchTerminated = true;');
    expect(terminate).toContain('this.arenaTransitionInProgress = false;');
    expect(terminate.indexOf('this.arenaTransitionInProgress = false;'))
      .toBeLessThan(terminate.indexOf('if (this.matchTerminated) return;'));
  });
});
