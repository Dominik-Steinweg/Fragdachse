import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', async () => {
  const { createFakePhaserModule } = await import('./fakeArenaRenderScene');
  return createFakePhaserModule();
});

import { ArenaRuntime } from '../src/scenes/arena/ArenaRuntime';

/**
 * Integrations-Checkpoint C: der Arena-Flow nach Phase 10C.
 *
 * Der Top-Level-Owner ist die `ArenaRuntime`: Sie besitzt den Flow, den raumlanglebigen
 * Persistent-Base-Owner und die Frame-Orchestrierung. Der Flow besitzt World-/Activity-Uebergaenge,
 * Readiness, Participation, Completion und den `WorldPresentationHandoff` - und materialisiert
 * keinen Gameplay-Graphen mehr.
 *
 * Die frame-positionierten Coop-Schritte bleiben dabei ausdruecklich an ihrer fachlichen Stelle im
 * Host-Frame (R-4); verschoben ist nur, wer sie besitzt.
 */

const FLOW_PATH = 'src/scenes/arena/ArenaLifecycleCoordinator.ts';
const RUNTIME_PATH = 'src/scenes/arena/ArenaRuntime.ts';
const PERSISTENT_BASE_PATH = 'src/scenes/arena/ArenaPersistentBaseSession.ts';
const SCENE_PATH = 'src/scenes/ArenaScene.ts';
const HOST_UPDATE_PATH = 'src/scenes/arena/HostUpdateCoordinator.ts';
const COMPOSITION_PATHS = [
  'src/scenes/arena/ArenaWorldGameplayComposition.ts',
  'src/scenes/arena/ArenaWorldEnvironmentComposition.ts',
  'src/scenes/arena/ArenaWorldPlayerComposition.ts',
  'src/scenes/arena/ArenaWorldCombatComposition.ts',
  'src/scenes/arena/ArenaWorldConstructionComposition.ts',
];

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function bodyOf(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + 1);
  expect(from, `missing ${start}`).toBeGreaterThan(0);
  expect(to, `missing ${end} after ${start}`).toBeGreaterThan(from);
  return source.slice(from, to);
}

function fakeFrameCoordinator() {
  return {
    activityFramePort: null as { getStep(): unknown } | null,
    worldFramePort: null as object | null,
    setActivityFramePort(port: { getStep(): unknown }) { this.activityFramePort = port; },
    setWorldFramePort(port: object) { this.worldFramePort = port; },
    setPlayerFramePort: vi.fn(),
    setCombatFramePort: vi.fn(),
    runHostUpdate: vi.fn(),
    runClientUpdate: vi.fn(),
  };
}

function createArenaRuntime() {
  const hostUpdate = fakeFrameCoordinator();
  const clientUpdate = fakeFrameCoordinator();
  const runtime = new ArenaRuntime({
    scene: { time: { delayedCall: vi.fn() }, game: { events: { emit: vi.fn() } } } as never,
    ctx: {} as never,
    renderers: {} as never,
    rockVisualHelper: {} as never,
    placementPreview: {} as never,
    persistentBasePreviewRenderer: {} as never,
    lobbyOverlay: {} as never,
    hostUpdate: hostUpdate as never,
    clientUpdate: clientUpdate as never,
    roomQualityMonitor: {} as never,
    getSpectatorCameraInput: () => undefined,
  });
  return { runtime, hostUpdate, clientUpdate };
}

describe('Checkpoint C – Top-Level-Owner und Frame', () => {
  it('bündelt Flow und raumlanglebigen Persistent-Base-Owner in der ArenaRuntime', () => {
    const { runtime } = createArenaRuntime();
    expect(runtime.flow).toBeDefined();
    expect(runtime.persistentBase).toBeDefined();
    // Der Persistent-Base-Owner haengt an keiner World: ohne Instanz gibt es keine world-lokale
    // Materialisierung, aber sehr wohl den Raumstand.
    expect(runtime.flow.persistentBaseWorldPorts.getWorldBinding()).toBeNull();
    expect(runtime.flow.persistentBaseWorldPorts.getConstructionRuntime()).toBeNull();
    expect(runtime.persistentBase.session).toBeDefined();
    expect(runtime.persistentBase.session.hasOpenTransaction).toBe(false);
  });

  it('gibt den benannten Activity-Schritt vom Frame-Owner an beide Frame-Phasen', () => {
    const { runtime, hostUpdate, clientUpdate } = createArenaRuntime();
    expect(hostUpdate.activityFramePort?.getStep).toBeTypeOf('function');
    expect(clientUpdate.activityFramePort?.getStep).toBeTypeOf('function');
    // Ohne Activity gibt es keinen Schritt - und keinen Sonderpfad.
    expect(hostUpdate.activityFramePort?.getStep()).toBeNull();
    expect(runtime.runHostFrame(16, true)).toBeNull();
    runtime.applyDebugBaseDamage(50);

    const step = {
      hostResolveCompletion: vi.fn(() => 'victory' as const),
      hostApplyDebugBaseDamage: vi.fn(),
    };
    vi.spyOn(runtime.flow, 'getActivityStep').mockReturnValue(step as never);
    expect(hostUpdate.activityFramePort?.getStep()).toBe(step);
    expect(clientUpdate.activityFramePort?.getStep()).toBe(step);
    runtime.applyDebugBaseDamage(50);
    expect(step.hostApplyDebugBaseDamage).toHaveBeenCalledWith(50);
  });

  it('fragt den Abschluss nur im laufenden Gameplay und wendet ihn nicht selbst an', () => {
    const { runtime, hostUpdate } = createArenaRuntime();
    const step = { hostResolveCompletion: vi.fn(() => 'defeat' as const) };
    vi.spyOn(runtime.flow, 'getActivityStep').mockReturnValue(step as never);
    const completeRound = vi.spyOn(runtime.flow, 'hostCompleteRound').mockImplementation(() => {});

    // Ohne laufendes Gameplay läuft nur die Host-Phase; der Abschluss wird nicht gefragt.
    expect(runtime.runHostFrame(16)).toBeNull();
    expect(hostUpdate.runHostUpdate).toHaveBeenCalledWith(16);
    expect(step.hostResolveCompletion).not.toHaveBeenCalled();

    // Im laufenden Gameplay liefert der Frame-Owner den Abschluss zurück, wendet ihn aber nicht
    // an: Die letzte Momentaufnahme der Runde entsteht beim Aufrufer davor.
    expect(runtime.runHostFrame(16, true)).toBe('defeat');
    expect(step.hostResolveCompletion).toHaveBeenCalledTimes(1);
    expect(completeRound).not.toHaveBeenCalled();
  });

  it('taktet die raumlanglebigen Owner selbst', () => {
    const { runtime } = createArenaRuntime();
    const contributions = vi.spyOn(runtime.persistentBase, 'syncPersistentBaseContributions')
      .mockImplementation(() => {});
    const rewards = vi.spyOn(runtime.persistentBase, 'syncPersistentBaseRewards')
      .mockImplementation(() => {});

    runtime.syncRoomOwners();

    expect(contributions).toHaveBeenCalledTimes(1);
    expect(rewards).toHaveBeenCalledTimes(1);
  });

  it('taktet die World-Runtime ueber den Frame-Owner und laesst die Phasen ihre Arbeit tun', () => {
    const { runtime, hostUpdate, clientUpdate } = createArenaRuntime();
    // Ohne lokale World taktet niemand - kein Sonderpfad, kein Fehler.
    runtime.update(16);
    runtime.runHostFrame(16);
    runtime.runClientFrame(16);
    expect(hostUpdate.runHostUpdate).toHaveBeenCalledWith(16);
    expect(clientUpdate.runClientUpdate).toHaveBeenCalledWith(16);
  });

  it('haelt die Coop-Simulation an ihrer fachlichen Frame-Position (R-4)', () => {
    const runtimeSource = read(RUNTIME_PATH);
    const hostUpdate = read(HOST_UPDATE_PATH);
    const scene = read(SCENE_PATH);
    // Der Frame-Owner kennt ausschliesslich benannte Activity-Schritte.
    for (const missionSystem of [
      'EnemyManager',
      'FlowFieldCoordinator',
      'coopDefenseSecondaryObjectiveSystem',
      'coopDefenseMissionProgressSystem',
      'coopDefenseSpawnExecutor',
    ]) {
      expect(runtimeSource, missionSystem).not.toContain(missionSystem);
    }
    // Die Reihenfolge innerhalb des Host-Frames bleibt unveraendert bei der Host-Phase.
    expect(hostUpdate).toContain('this.activityStep()?.hostSimulationStep(');
    expect(hostUpdate).toContain('this.activityStep()?.hostPrePhysicsStep(');
    // Die Scene ruft nur noch den Frame-Owner.
    expect(scene).toContain('this.arenaRuntime.update(delta);');
    expect(scene).toContain('this.arenaRuntime.runHostFrame(delta);');
    expect(scene).toContain('this.arenaRuntime.runHostFrame(delta, gameplayActive)');
    expect(scene).toContain('this.arenaRuntime.runClientFrame(delta);');
    // Die fachliche Frame-Reihenfolge im Top-Level-Frame bleibt erhalten: Owner-Sync vor Update,
    // Update vor der ersten Host- bzw. Client-Frame-Ausfuehrung.
    const syncRoomOwnersIndex = scene.indexOf('this.arenaRuntime.syncRoomOwners();');
    const updateIndex = scene.indexOf('this.arenaRuntime.update(delta);');
    const firstRunHostFrameIndex = scene.indexOf('this.arenaRuntime.runHostFrame(');
    const firstRunClientFrameIndex = scene.indexOf('this.arenaRuntime.runClientFrame(');
    expect(syncRoomOwnersIndex, 'syncRoomOwners fehlt').toBeGreaterThan(-1);
    expect(updateIndex, 'update fehlt').toBeGreaterThan(-1);
    expect(firstRunHostFrameIndex, 'runHostFrame fehlt').toBeGreaterThan(-1);
    expect(firstRunClientFrameIndex, 'runClientFrame fehlt').toBeGreaterThan(-1);
    expect(syncRoomOwnersIndex, 'syncRoomOwners muss vor update(delta) stehen').toBeLessThan(updateIndex);
    expect(updateIndex, 'update(delta) muss vor dem ersten runHostFrame stehen').toBeLessThan(
      firstRunHostFrameIndex,
    );
    expect(updateIndex, 'update(delta) muss vor dem ersten runClientFrame stehen').toBeLessThan(
      firstRunClientFrameIndex,
    );
    expect(scene).not.toContain('setActivityStepResolver');
    expect(scene).not.toContain('this.hostUpdate.runHostUpdate(');
    expect(scene).not.toContain('this.clientUpdate.runClientUpdate(');
  });

  it('laesst die Scene keinen Top-Level-Owner der ArenaRuntime selbst takten', () => {
    const scene = read(SCENE_PATH);
    // Der raumlanglebige Persistent-Base-Owner wird vom Frame-Owner getaktet; die Scene bestimmt
    // nur noch die Frame-Position.
    expect(scene).toContain('this.arenaRuntime.syncRoomOwners();');
    expect(scene).not.toContain('persistentBase.syncPersistentBase');
    // Vorschau, Radial und RPC duerfen den Owner weiterhin fragen - das ist keine Taktung.
    for (const drivenWork of [
      'persistentBase.applyRoundOutcome',
      'persistentBase.applyRoundConclusion',
      'persistentBase.reconcilePersistentBaseWorld',
      'persistentBase.rollbackPersistentBaseMissionIfActive',
      'persistentBase.useWorldRuntimes',
    ]) {
      expect(scene, drivenWork).not.toContain(drivenWork);
    }
  });
});

describe('Checkpoint C – Frame-Reihenfolge der World-Kamera- und Residency-Aufrufe in ArenaScene.update()', () => {
  /**
   * Vor Phase 6A.1 stand diese Reihenfolge ausschliesslich in Kommentaren, nicht in einem Test.
   * Seit Phase 6A.1 delegiert die Scene Kamera-Sync und World-Surface-Residency an
   * `arenaRuntime.syncWorldCamera`/`syncWorldSurfaceResidency`, die intern den world-scoped
   * `WorldPresentationFrameBinding` takten. Dieser Test friert die relative Position dieser
   * Aufrufe zu Input-Frame und den Frame-Ende-Schritten ein - unabhaengig vom jeweiligen
   * Aufrufnamen.
   */
  it('haelt die Reihenfolge von Kamera-Sync, Residency, Input-Frame und Frame-Ende-Schritten fest', () => {
    const scene = read(SCENE_PATH);
    const updateStart = scene.indexOf('  update(_time: number, delta: number): void {');
    expect(updateStart, 'ArenaScene.update() nicht gefunden').toBeGreaterThan(-1);
    const updateEnd = scene.indexOf('\n  // ── Network events', updateStart);
    expect(updateEnd, 'Ende von ArenaScene.update() nicht gefunden').toBeGreaterThan(updateStart);
    const body = scene.slice(updateStart, updateEnd);

    const firstCameraSync = body.indexOf('this.arenaRuntime.syncWorldCamera(delta, presentationPolicy.showWorld);');
    const visibleWorldViewForResidency = body.indexOf('const worldView = getVisibleWorldView(this.cameras.main);');
    const updateSurfaceResidency = body.indexOf('this.arenaRuntime.syncWorldSurfaceResidency(');
    const inputBindingsUpdateFrame = body.indexOf('this.inputBindings?.updateFrame({');
    const secondCameraSync = body.indexOf('this.arenaRuntime.syncWorldCamera(spectator ? 0 : delta, presentationPolicy.showWorld);');
    const applyCameraFeedback = body.indexOf('this.applyCameraFeedback(delta);');
    const flushBakeBudget = body.indexOf('ChunkedRenderSurface.flushBakeBudget(');
    const syncArenaLoadReady = body.indexOf('this.lifecycle.syncArenaLoadReady(');
    const syncBootReveal = body.indexOf('this.syncBootReveal(phase);');

    for (const [label, index] of [
      ['erster syncMainCamera-Aufruf', firstCameraSync],
      ['getVisibleWorldView fuer Residency', visibleWorldViewForResidency],
      ['ArenaBuilder.updateSurfaceResidency', updateSurfaceResidency],
      ['inputBindings.updateFrame', inputBindingsUpdateFrame],
      ['zweiter syncMainCamera-Aufruf', secondCameraSync],
      ['applyCameraFeedback', applyCameraFeedback],
      ['flushBakeBudget', flushBakeBudget],
      ['syncArenaLoadReady', syncArenaLoadReady],
      ['syncBootReveal', syncBootReveal],
    ] as const) {
      expect(index, `${label} nicht in update() gefunden`).toBeGreaterThan(-1);
    }

    expect(firstCameraSync, '1 vor 2').toBeLessThan(visibleWorldViewForResidency);
    expect(visibleWorldViewForResidency, '2a vor 2b').toBeLessThan(updateSurfaceResidency);
    expect(updateSurfaceResidency, '2 vor 3').toBeLessThan(inputBindingsUpdateFrame);
    expect(inputBindingsUpdateFrame, '3 vor 4').toBeLessThan(secondCameraSync);
    expect(secondCameraSync, '4 vor 5').toBeLessThan(applyCameraFeedback);
    expect(applyCameraFeedback, '5 vor 6').toBeLessThan(flushBakeBudget);
    expect(flushBakeBudget, '6 vor 7').toBeLessThan(syncArenaLoadReady);
    expect(syncArenaLoadReady, '7 vor 8').toBeLessThan(syncBootReveal);
  });
});

describe('Checkpoint C – Flow besitzt nur Flow', () => {
  const flow = read(FLOW_PATH);

  it('haelt den WorldPresentationHandoff beim tatsaechlichen Flow-Owner', () => {
    expect(flow).toContain('new WorldPresentationHandoff()');
    expect(flow).toContain('this.worldPresentationHandoff.release(');
    expect(flow).toContain('this.worldPresentationHandoff.discard();');
    // Weder der Top-Level-Owner noch eine Composition-Grenze traegt die Darstellung weiter.
    for (const path of [RUNTIME_PATH, PERSISTENT_BASE_PATH, ...COMPOSITION_PATHS]) {
      expect(read(path), path).not.toContain('WorldPresentationHandoff');
    }
  });

  it('materialisiert keinen Gameplay-Graphen und keine Persistent-Base-Regeln mehr', () => {
    for (const gameplayOwner of [
      'new WorldGeometryBinding',
      'new WorldTargetingRuntime',
      'new WorldTrainRuntime',
      'new WorldPlayerGameplayRuntime',
      'new WorldCombatGameplayBinding',
      'new WorldPowerUpRuntime',
      'new ConstructionWorldRuntime',
      'new WorldSupportGameplayRuntime',
      'new PersistentBaseWorldMaterializer',
      'new PersistentBaseRoomSession',
      'new PersistentBaseRewardGrantService',
    ]) {
      expect(flow, gameplayOwner).not.toContain(gameplayOwner);
    }
    // Persistent-Base-Regeln gehoeren dem Raum-Owner, nicht dem Uebergang.
    for (const persistentBaseRule of [
      'applyPersistentBaseRoundOutcome(',
      'sanitizePersistentBaseRewardPlacementRequest(',
      'sanitizePersistentBaseMoveRequest(',
      'getStoredPersistentBaseRewardUnlocks(',
    ]) {
      expect(flow, persistentBaseRule).not.toContain(persistentBaseRule);
    }
    const persistentBase = read(PERSISTENT_BASE_PATH);
    expect(persistentBase).toContain('applyRoundOutcome(');
    expect(persistentBase).toContain('placePersistentBaseReward(');
    expect(persistentBase).toContain('movePersistentBaseObject(');
  });

  it('beendet jede World-Instanz gemeinsam mit ihrer Aufnahme', () => {
    const endInstances = [...flow.matchAll(/this\.worldLifecycle\.endInstance\(\);/g)];
    expect(endInstances.length).toBeGreaterThanOrEqual(4);
    for (const match of endInstances) {
      const after = flow.slice(match.index ?? 0, (match.index ?? 0) + 200);
      expect(after, 'world instance ends without clearing its admission')
        .toContain('this.clearWorldAdmission();');
    }
  });

  it('friert das Exit-Bild vor dem Ende der World-Instanz ein (R-5)', () => {
    const complete = bodyOf(flow, '  hostCompleteRound(', '\n  /**');
    expect(complete.indexOf('this.captureArenaExitEntityPresentation();'))
      .toBeLessThan(complete.indexOf('this.worldLifecycle.endInstance();'));
    const exitPresentation = bodyOf(flow, '  beginArenaExitPresentation(): void {', '\n  /**');
    expect(exitPresentation.indexOf('this.captureArenaExitEntityPresentation();'))
      .toBeLessThan(exitPresentation.indexOf('this.tearDownArena(true);'));
    expect(exitPresentation.indexOf('this.captureArenaExitEntityPresentation();'))
      .toBeLessThan(exitPresentation.indexOf('this.synchronizeLocalWorldLifecycle(null);'));
  });

  it('uebergibt die Darstellung vor dem uebrigen World-Teardown (R-2)', () => {
    const teardown = bodyOf(flow, '  tearDownArena(', '\n  private ');
    // Die Runtime gibt ihre Darstellung im Handoff ab; erst danach faellt die Renderer-Seite.
    expect(teardown.indexOf('this.releaseWorldRuntime(preserveAuthoredPresentation);'))
      .toBeLessThan(teardown.indexOf('resetRenderersForWorldPresentationTeardown('));
    // Und der Abbau bleibt Owner-getrieben: keine Systemliste, keine Renderer-Einzelaufrufe.
    expect(teardown).not.toMatch(/this\.renderers\.[a-zA-Z]+\.(destroyAll|clearAll|clear)\(/);
    expect(teardown).not.toContain('new ');
  });

  it('nimmt Matchstart, Lobby-Fast-Reinstance und Lobby-Rueckkehr ueber denselben Handoff', () => {
    const matchStart = bodyOf(flow, '  hostCheckReadyToStart(): void {', '\n  /**');
    // Der Matchstart beendet die LobbyWorld mitsamt ihren Teilnehmern.
    expect(matchStart.indexOf('this.detachAllWorldPlayers();'))
      .toBeLessThan(matchStart.indexOf('this.worldLifecycle.endInstance();'));
    // Der Lobby-Fast-Reinstance verwendet die freigegebene Darstellung weiter.
    const worldChange = bodyOf(flow, '  detectWorldChange(', '\n  /**');
    expect(worldChange).toContain('const reusablePresentation = this.worldRuntime?.presentation');
    expect(worldChange).toContain('?? this.worldPresentationHandoff.pending;');
    expect(worldChange).toContain('canFastReinstance');
    const build = bodyOf(flow, '  buildWorld(', '\n  tearDownArena(');
    expect(build).toContain('this.worldPresentationHandoff.pending');
    // Die Lobby-Rueckkehr verwirft die Exit-Projektion und geht durch denselben Teardown.
    const toLobby = bodyOf(flow, '  private onTransitionToLobby(): void {', '\n  /**');
    expect(toLobby).toContain('this.synchronizeLocalWorldLifecycle(null);');
    expect(toLobby).toContain('this.tearDownArena();');
    expect(toLobby).toContain('this.clearArenaExitPresentation();');
  });
});
