import type * as Phaser from 'phaser';
import { bridge } from '../../network/bridge';
import type { PlayerManager } from '../../entities/PlayerManager';
import type { ArenaRuntime } from '../../scenes/arena/ArenaRuntime';
import type { ArenaDiagnosticsController } from '../../scenes/arena/ArenaDiagnosticsController';
import type { PerformanceCase, PerformanceLabGamePort, PerformanceWindow } from './contracts';
import type { LoadoutUseResult, WeaponSlot } from '../../types';
import { NavigationGeometry } from '../../systems/navigation/NavigationGeometry';
import { quantizeAngle } from '../../utils/angle';
import { REFERENCE_SEED } from './referenceMap';
import { getVisibleWorldView, isWorldPointInsideView } from '../../ui/HostileBaseIndicator';
import { PERFORMANCE_FIXTURE as fixture } from './fixtures';

export function createPerformanceLabGamePort(scene: Phaser.Scene, flow: ArenaRuntime,
  players: PlayerManager, diagnostics: ArenaDiagnosticsController,
  setInput: (angle: number, trigger: WeaponSlot | null) => void,
  isLobbyRevealed: () => boolean): PerformanceLabGamePort {
  diagnostics.addFrameScope(flow, 'runHostFrame', 'gameplay');
  diagnostics.addFrameScope(flow, 'runClientFrame', 'gameplay');
  const targets = new Map<string, { x: number; y: number }>();
  let previousMap = bridge.getCoopDefenseMapId(), previousMode = bridge.getGameMode();
  let playerPosition = { x: 1000, y: 540 }, aimPosition = { x: 1220, y: 540 };
  let active = false, stopped = false, caseStart = 0, heldAt: number | null = null, heldId = '', temporaryId: string | undefined;
  let counters: Record<string, number> = {}, rocksBefore = 0, builds = 0;
  let removeWorldObserver: (() => void) | null = null;
  let lastTrainY: number | null = null;
  let lastObservationAt = 0;
  let requestedMap = '', focusedWorld = -1;
  let preparedId = '', preparationAt = 0, prepared = false, timeChanged = false;
  let nextBuildAt = 0, nextCombatShotAt = 0, nextWaveAt = 0, actionSequence = 0;
  let carriedRecovery = false;
  let clearedRouteAt: number | null = null;
  let subphases: PerformanceWindow[] = [];
  let spawnCandidates: readonly { x: number; y: number }[] | null = null;
  let nextResourceAt = 0, maximumAdrenaline = 0;
  const seenLakes = new Set<number>();
  let geometry: NavigationGeometry | null = null;
  const event = diagnostics.getSemanticEventSink();
  let route: { x: number; y: number }[] = [], routeIndex = 0;
  const localId = () => bridge.getLocalPlayerId();
  const point = (x: number, y: number) => {
    const m = flow.getWorldMetrics()!;
    return { x: m.offsetX + x * 32 + 16, y: m.offsetY + y * 32 + 16 };
  };
  const add = (key: string, n = 1) => { counters[key] = (counters[key] ?? 0) + n; };
  const peak = (key: string, n: number) => { counters[key] = Math.max(counters[key] ?? 0, n); };
  const rocks = () => new Set(flow.navigationLabPort.getGeometry()?.obstacles.filter(o => o.kind === 'rock').map(o => o.id)).size;
  const fieldRocks = (item?: string) => {
    const a = point(item === 'BFG' ? 80 : 44, 43), b = point(item === 'BFG' ? 100 : 64, 59);
    return new Set(flow.navigationLabPort.getGeometry()?.obstacles.filter(o => {
      if (o.kind !== 'rock') return false;
      const x = o.shape === 'rect' ? (o.left + o.right) / 2 : o.x;
      const y = o.shape === 'rect' ? (o.top + o.bottom) / 2 : o.y;
      return x >= a.x - 16 && x < b.x - 16 && y >= a.y - 16 && y < b.y - 16;
    }).map(o => o.id)).size;
  };
  const input = (dx = 0, dy = 0, trigger: WeaponSlot | null = null) => {
    const player = players.getPlayer(localId());
    const angle = player ? Math.atan2(aimPosition.y - player.y, aimPosition.x - player.x) : 0;
    setInput(angle, trigger);
    bridge.sendLocalInput({ dx, dy, aim: quantizeAngle(angle), dashHeld: false });
  };
  const maintainTargets = () => {
    for (const [id, position] of targets) flow.weaponBalanceLabPort.pinTarget(id, position.x, position.y);
    if (performance.now() >= nextResourceAt) {
      flow.weaponBalanceLabPort.setAdrenaline(localId(), maximumAdrenaline);
      nextResourceAt = performance.now() + fixture.resourceRefillIntervalMs;
    }
  };
  const observe = () => {
    const now = performance.now();
    peak('projectilePeak', flow.getWorldProjectileRuntime()?.getDebugActiveProjectileCount() ?? 0);
    if (flow.getWorldProjectileRuntime()?.hasActiveBfgProjectile()) peak('bfgObserved', 1);
    // Existing snapshots at a bounded diagnostic cadence, no scene-wide object scans.
    if (now - lastObservationAt < fixture.observationIntervalMs) return;
    lastObservationAt = now;
    const state = flow.getScenarioObservation();
    if (window.__FD_PERF__) window.__FD_PERF__.detail = { ...counters, mapEvents: state.mapEvents };
    peak('smokePeak', state.smoke); peak('meteorPeak', state.meteors); peak('nukePeak', state.nukes);
    peak('burningCellsPeak', state.burningCells);
    peak('activeLightsPeak', state.lights.activeLights); peak('renderedLightsPeak', state.lights.renderedLights);
    if (preparedId.startsWith('combat.')) {
      const waterProbe = point(86, 72);
      if (isWorldPointInsideView(waterProbe.x, waterProbe.y, getVisibleWorldView(scene.cameras.main))) add('waterVisibleSamples');
    }
    counters.remainingMeteors = state.meteors; counters.remainingSmoke = state.smoke;
    counters.remainingBurningCells = state.burningCells;
    peak('constructionPeak', state.constructions.length);
    peak('enemyPeak', flow.getEnemyCount());
    if (preparedId === 'environment.route') {
      for (const [i, coordinates] of [[60,20],[110,25],[100,72]].entries()) {
        const center = point(coordinates[0], coordinates[1]);
        if (isWorldPointInsideView(center.x, center.y, getVisibleWorldView(scene.cameras.main))) seenLakes.add(i);
      }
      counters.lakesObserved = seenLakes.size;
    }
    const train = state.train;
    if (train?.alive) { add('trainActiveSamples'); counters.trainX = train.x; counters.trainY = train.y;
      counters.cameraX = scene.cameras.main.worldView.x; counters.cameraY = scene.cameras.main.worldView.y; }
    if (train?.alive && isWorldPointInsideView(train.x, train.y, getVisibleWorldView(scene.cameras.main))) {
      add('trainVisibleSamples');
      if (lastTrainY !== null && Math.abs(lastTrainY - train.y) > 1) add('trainMovingSamples');
      lastTrainY = train.y;
    }
  };
  const spawnEnemies = (count: number) => {
    const candidates = spawnCandidates ??= flow.navigationLabPort.getFreePositions(18)
      .filter(p => Math.hypot(p.x - playerPosition.x, p.y - playerPosition.y) >= fixture.enemySpawnRadius.min
        && Math.hypot(p.x - playerPosition.x, p.y - playerPosition.y) < fixture.enemySpawnRadius.max);
    if (candidates.length < count) throw new Error('Insufficient fixed enemy spawn positions');
    // Stable dispersion and species mix. Population never depends on achieved FPS.
    // All four species pursue players on a map without an allied mission base.
    const kinds = fixture.enemyKinds;
    for (let i = 0; i < count; i++) {
      const p = candidates[Math.floor(i * candidates.length / count)];
      if (!flow.navigationLabPort.spawnEnemy(p.x, p.y, kinds[i % kinds.length], false)) throw new Error('Enemy spawn failed');
    }
    add('spawnedEnemies', count);
  };
  const startSiege = () => {
    if (counters.siegeAttackers) return;
    for (const y of [70, 74]) {
      const p = point(73, y);
      if (!flow.navigationLabPort.spawnEnemy(p.x, p.y, 'timebomb-badger', false)) throw new Error('Siege enemy spawn failed');
    }
    counters.siegeAttackers = 2; add('spawnedEnemies', 2);
  };
  const initializeCase = (test: PerformanceCase) => {
    carriedRecovery = test.kind === 'recovery' && preparedId.startsWith('combat.');
    preparedId = test.id; prepared = false; preparationAt = performance.now(); timeChanged = false;
    clearedRouteAt = null; subphases = [];
    nextBuildAt = 0; nextCombatShotAt = 0; nextWaveAt = fixture.combatWaveIntervalMs; seenLakes.clear();
    spawnCandidates = null; nextResourceAt = 0;
    maximumAdrenaline = flow.weaponBalanceLabPort.getMaxAdrenaline(localId());
    removeWorldObserver?.(); removeWorldObserver = null;
    targets.clear(); counters = {}; builds = 0; heldAt = null; temporaryId = undefined;
    Object.assign(counters, flow.getScenarioEnvironmentCounts());
    stopped = false; lastTrainY = null; lastObservationAt = 0; caseStart = performance.now();
    flow.navigationLabPort.setScenarioActive(true);
    // The environment case keeps the ordinary authored event scheduler (including the train).
    if (test.kind === 'environment') flow.navigationLabPort.setScenarioActive(false);
    const snapshot = flow.navigationLabPort.getGeometry();
    if (!snapshot) throw new Error('Reference geometry unavailable');
    geometry = new NavigationGeometry(snapshot);
    rocksBefore = rocks();
    if (rocksBefore < fixture.minimumGlobalRocks) throw new Error(`Reference rock reserve too small: ${rocksBefore}`);
    if (test.id.startsWith('destruction')) {
      counters.fieldRocksBefore = fieldRocks(test.itemId);
      if (counters.fieldRocksBefore < fixture.minimumDestructionFieldRocks) throw new Error(`${test.id}: destruction field is already empty`);
    }
    if (carriedRecovery) {
      counters.carriedWorld = 1;
      flow.navigationLabPort.removeEnemies();
      input();
      return;
    }
    playerPosition = test.kind === 'environment' ? point(33, 48)
      : test.itemId === 'NUKE' || test.id === 'destruction.single' ? point(40, 51)
      : test.itemId === 'BFG' ? point(76, 51) : point(67, 72);
    if (!geometry.isFree(playerPosition.x, playerPosition.y, 18)) throw new Error(`${test.id}: blocked player fixture`);
    flow.navigationLabPort.placePlayer(playerPosition.x, playerPosition.y);
    aimPosition = { x: playerPosition.x + (test.targetDistance ?? 220), y: playerPosition.y };
    if (test.id === 'destruction.single') aimPosition = point(44, 50);
    if (test.itemId === 'NUKE') aimPosition = point(54, 50);
    if (test.itemId === 'BFG') aimPosition = point(95, 50);
    route = test.kind === 'environment'
      ? [[33,48],[33,32],[45,32],[75,32],[87,37],[126,37],[126,65],[122,85],[78,85],[73,72],[67,72]].map(([x,y]) => point(x,y))
      : [];
    routeIndex = 0;
    if (test.timeOfDay !== undefined) {
      event('performance:time-of-day', { caseId: test.id, minutes: test.timeOfDay });
      flow.setTimeOfDayDebugOverride(test.timeOfDay);
    }
    if (test.kind === 'weapon' && !test.id.startsWith('destruction') || test.kind === 'utility') {
      for (const offset of test.itemId === 'BITE' ? [0] : [-65, 0, 65]) {
        const position = { x: aimPosition.x, y: aimPosition.y + offset };
        if (!geometry.isFree(position.x, position.y, 16)) throw new Error(`${test.id}: blocked target fixture`);
        const target = flow.weaponBalanceLabPort.spawnTarget(position.x, position.y, fixture.targetHp);
        if (!target) throw new Error('Failed to spawn performance target');
        targets.set(target.id, position);
      }
      counters.fixtureTargetHp = fixture.targetHp;
      spawnEnemies(fixture.weaponEnemyCount);
    } else if (test.enemyCount && test.kind !== 'combat') spawnEnemies(test.enemyCount);
    removeWorldObserver = flow.observeScenarioWorldDamage(outcome => {
      if (outcome.kind !== 'damage-applied') return;
      if (outcome.target.kind === 'rock') {
        add('rockDamageEvents');
        if (outcome.transition.kind === 'destroyed') add('destroyedRocks');
      }
      if (outcome.target.kind === 'construction') add('constructionDamageEvents');
    });
    event('performance:prepared', { caseId: test.id, rocksBefore, enemies: flow.getEnemyCount(), buildSignature: test.buildSignature });
    input();
  };
  const prepareCase = (test: PerformanceCase, markPreparation?: (name: string) => void): boolean => {
    if (preparedId !== test.id) initializeCase(test);
    if (prepared) return true;
    const now = performance.now();
    observe();
    if (test.kind === 'pickup' && !temporaryId) {
      // Normal proximity pickup can already have collected the authored item on this frame.
      temporaryId = bridge.getPlayerTemporaryUtilityInstances(localId()).find(p => p.utilityId === test.itemId)?.instanceId;
      const item = flow.getScenarioObservation().powerUps.find(p => p.defId === test.itemId);
      if (!item && !temporaryId) {
        if (now - preparationAt > 10_000) throw new Error(`${test.id}: authored pickup missing after ten seconds; pedestals=${JSON.stringify(flow.getPowerUpPedestalSnapshot())}`);
        return false;
      }
      if (!temporaryId && item) {
        flow.navigationLabPort.placePlayer(item.x, item.y);
        if (!flow.rpcPorts.playerLoadout.tryPickupPowerUp(localId(), item.uid, item.x, item.y)) throw new Error(`${test.id}: pickup rejected`);
      }
      temporaryId = bridge.getPlayerTemporaryUtilityInstances(localId()).find(p => p.utilityId === test.itemId)?.instanceId;
      if (!temporaryId) throw new Error(`${test.id}: no acquired temporary utility`);
      flow.navigationLabPort.placePlayer(playerPosition.x, playerPosition.y);
      counters.pickups = 1;
    }
    if (test.kind === 'combat') {
      if (!timeChanged) {
        if (now - preparationAt < 1500) return false;
        markPreparation?.('time-change'); timeChanged = true;
      }
      if (builds < 4) {
        if (now >= nextBuildAt) {
          const result = performAction(test, ++actionSequence, true);
          if (result?.ok) nextBuildAt = now + 2000;
          else if (result?.reason !== 'cooldown') throw new Error(`Combat preparation build failed: ${result?.reason}`);
        }
        return false;
      }
      if (now < nextBuildAt) return false;
      markPreparation?.('defense-build');
      spawnEnemies(test.enemyCount!);
      counters.combatWaves = 1;
    }
    if (test.kind === 'recovery' && !carriedRecovery) {
      if (!counters.recoveryTriggered) {
        const result = performAction(test, ++actionSequence, true);
        if (!result?.ok) throw new Error('Recovery fixture could not activate Armageddon');
        counters.recoveryTriggered = 1;
        preparationAt = now;
      }
      if (now - preparationAt < 4000) return false;
      flow.stopScenarioUltimate();
      flow.navigationLabPort.removeEnemies();
    }
    caseStart = now; prepared = true;
    return true;
  };
  const attack = (slot: WeaponSlot, sequence: number, inputStarted: boolean) => {
    const player = players.getPlayer(localId())!;
    return flow.weaponBalanceLabPort.useWeaponAction(slot, localId(), Math.atan2(aimPosition.y - player.y, aimPosition.x - player.x),
      aimPosition.x, aimPosition.y, bridge.getSynchronizedNow(), sequence, inputStarted);
  };
  const performAction = (test: PerformanceCase, sequence: number, inputStarted: boolean): LoadoutUseResult | null => {
    const now = bridge.getSynchronizedNow(), player = players.getPlayer(localId())!;
    const angle = Math.atan2(aimPosition.y - player.y, aimPosition.x - player.x);
    if (test.kind === 'weapon') return attack(test.slot, sequence, test.continuous ? inputStarted : true);
    if (test.kind === 'construction' || test.kind === 'combat') {
      const id = builds < 2 ? 'rocket_turret' : 'rock_barrier';
      const target = point(70 + (builds >= 2 ? 2 : 0), 70 + (builds % 2) * 4);
      const result = flow.rpcPorts.construction.placeInspectorConstruction(localId(), id, target.x, target.y, now);
      if (result.ok) { builds++; counters.built = builds; }
      return result;
    }
    if (test.itemId === 'ARMAGEDDON') {
      flow.prepareScenarioRage();
      return flow.rpcPorts.playerLoadout.usePlayerAction({ category: 'ultimate', playerId: localId(), angle,
        targetX: aimPosition.x, targetY: aimPosition.y, hostNowMs: now, params: { ultimateAction: 'press' } });
    }
    const cfg = temporaryId ? flow.rpcPorts.playerLoadout.getTemporaryUtilityConfig(localId(), temporaryId)
      : flow.rpcPorts.playerLoadout.getEquippedUtilityConfig(localId());
    if (!cfg) throw new Error(`${test.id}: missing resolved utility`);
    if (cfg.activation.type === 'charged_throw' || cfg.activation.type === 'charged_gate') {
      if (heldAt === null) {
        heldId = `perf:${sequence}`;
        if (!flow.rpcPorts.playerLoadout.startUtilityHeldAction(localId(), heldId, cfg.activation.type, now, undefined, temporaryId)) return { ok: false, reason: 'cooldown' };
        heldAt = now;
        event('performance:hold', { caseId: test.id, actionId: heldId, itemId: test.itemId });
      }
      const holdDuration = cfg.activation.type === 'charged_gate' ? cfg.activation.fullChargeDuration : Math.min(200, cfg.activation.fullChargeDuration);
      if (now - heldAt < holdDuration) return null;
    }
    const result = flow.rpcPorts.playerLoadout.usePlayerAction({ category: 'utility', playerId: localId(), angle,
      targetX: aimPosition.x, targetY: aimPosition.y, hostNowMs: now,
      source: temporaryId ? { kind: 'temporary', instanceId: temporaryId } : { kind: 'equipped' },
      params: { heldActionId: heldId, temporaryUtilityInstanceId: temporaryId } });
    if (result.ok) { heldAt = null; event('performance:utility', { caseId: test.id, itemId: test.itemId, sequence }); }
    return result;
  };
  return {
    start(mapId, seed, commit) {
      if (!bridge.isHost() || bridge.getConnectedPlayers().length !== 1 || bridge.getGamePhase() !== 'LOBBY') throw new Error('Performance lab requires a solo host in the lobby');
      previousMap = bridge.getCoopDefenseMapId(); previousMode = bridge.getGameMode(); active = true;
      requestedMap = mapId; focusedWorld = -1;
      preparedId = '';
      bridge.setGameMode('coop_defense'); bridge.setCoopDefenseMapId(mapId);
      flow.navigationLabPort.setNextRoundSeed(seed);
      bridge.setLocalReadyWithCommittedLoadout(commit); flow.setIsLocalReady(true);
    },
    isReady: () => {
      if (flow.isMatchTerminated()) throw new Error('Arena preparation failed; see console.json');
      const world = flow.getWorldDescriptor();
      if (world?.definitionId.endsWith(`:${requestedMap}`) && focusedWorld !== world.worldRevision
        && flow.getWorldMetrics()?.gridCols === 160 && players.getPlayer(localId())) {
        const initial = requestedMap.endsWith('-train') ? point(33, 48) : point(67, 72);
        flow.navigationLabPort.placePlayer(initial.x, initial.y);
        focusedWorld = world.worldRevision;
      }
      if (window.__FD_PERF__ && performance.now() - lastObservationAt > 1000) {
        lastObservationAt = performance.now();
        window.__FD_PERF__.detail = { phase: bridge.getGamePhase(), world: flow.getWorldDescriptor()?.definitionId,
          reveal: flow.getWorldRevealState(getVisibleWorldView(scene.cameras.main)), arenaStarted: bridge.isArenaStarted(), countdown: bridge.isArenaCountdownActive(),
          participantReady: bridge.areWorldParticipantsLoadReady(true), load: bridge.getPlayerWorldLoadState(localId(), world?.worldRevision ?? 0),
          player: flow.navigationLabPort.getPlayerPosition(),
          rendering: flow.getScenarioLoadingState() };
      }
      return flow.navigationLabPort.isReady() && bridge.isArenaStarted();
    },
    isLobbyReady: () => bridge.getGamePhase() === 'LOBBY' && flow.getWorldDescriptor()?.definitionId === 'world:lobby'
      && flow.getWorldRevealState(getVisibleWorldView(scene.cameras.main)).ready && isLobbyRevealed(),
    prepareTargets: () => { throw new Error('Performance cases require explicit preparation'); },
    prepareCase, maintainTargets, attack, performAction,
    updateCase(test, elapsed, stage = 'measure', duration = test.durationMs) {
      if (test.kind === 'recovery' && flow.getEnemyCount() > 0) {
        // Already airborne brood projectiles can hatch after the initial removal.
        // Drain their actors before the next host combat step, preserving the effects and evidence.
        const count = flow.getEnemyCount();
        add('lateRecoveryEnemiesRemoved', count);
        event('performance:recovery-late-spawns', { count });
        flow.navigationLabPort.removeEnemies();
      }
      maintainTargets(); observe();
      if (stage === 'tail') { input(); return; }
      if ((test.kind === 'construction' || test.kind === 'combat') && builds === 4) startSiege();
      if (test.kind === 'pickup' && elapsed > 12_000) {
        if (clearedRouteAt === null) {
          clearedRouteAt = performance.now();
          event('performance:cleared-route', { caseId: test.id, fieldRocks: fieldRocks(test.itemId) });
        }
        const player = players.getPlayer(localId())!, goal = point(test.itemId === 'BFG' ? 94 : 60, 50);
        const dx = goal.x - player.x, dy = goal.y - player.y, distance = Math.hypot(dx, dy);
        if (distance < 28) { counters.clearedRouteReached = 1; input(); }
        else input(dx / distance, dy / distance);
      } else if (test.kind === 'environment' && elapsed > 15_000 && routeIndex < route.length) {
        const player = players.getPlayer(localId())!, goal = route[routeIndex];
        const dx = goal.x - player.x, dy = goal.y - player.y, distance = Math.hypot(dx, dy);
        if (distance < 28) { routeIndex++; counters.routeWaypoints = routeIndex; input(); }
        else input(dx / distance, dy / distance);
      } else if (test.kind === 'combat') {
        // Fixed waves and productive cooldowns, independent of the achieved frame rate.
        if (elapsed >= nextWaveAt && counters.combatWaves < Math.ceil(duration / fixture.combatWaveIntervalMs)) {
          spawnEnemies(test.enemyCount!); add('combatWaves'); nextWaveAt = elapsed + fixture.combatWaveIntervalMs;
        }
        if (elapsed >= nextCombatShotAt && (counters.combatShots ?? 0) < Math.ceil(duration / 350)) {
          const result = attack('weapon1', ++actionSequence, true);
          if (result?.ok) { add('combatShots'); nextCombatShotAt = elapsed + 350; }
          else if (result?.reason !== 'cooldown') throw new Error(`Combat shot failed: ${result?.reason}`);
        }
        input();
      } else if (test.kind === 'enemies') {
        const phase = elapsed / 1500, player = players.getPlayer(localId())!;
        const dx = playerPosition.x + Math.cos(phase) * 130 - player.x;
        const dy = playerPosition.y + Math.sin(phase) * 130 - player.y;
        const length = Math.hypot(dx, dy);
        input(length > 12 ? dx / length : 0, length > 12 ? dy / length : 0);
      } else input(0, 0, test.continuous ? test.slot : null);
    },
    isCaseComplete(test, elapsed, duration) {
      const ready = test.kind === 'environment' ? routeIndex === route.length
        : test.kind === 'pickup' ? counters.clearedRouteReached === 1
        : test.kind === 'combat' ? counters.combatWaves >= Math.ceil(duration / fixture.combatWaveIntervalMs)
          && elapsed >= nextWaveAt && counters.combatShots >= Math.ceil(duration / 350) : true;
      if (!ready && elapsed > duration + 60_000) throw new Error(`${test.id}: required route or combat actions stalled for sixty seconds`);
      return ready;
    },
    finishCase(test) {
      if (clearedRouteAt !== null) subphases.push({ id: `${test.id}.cleared-route`, kind: 'measurement',
        caseVersion: test.version, fromMs: clearedRouteAt, toMs: performance.now(), load: { ...counters, rocksRemaining: rocks() } });
      stopped = true; input(); flow.rpcPorts.heldAction.clearPlayer(localId());
    },
    readSubphases: () => subphases,
    verifyCase(test) {
      observe();
      for (const kind of test.requiredDamageKinds ?? []) {
        if (!(counters[`damage.${kind}`] > 0)) throw new Error(`${test.id}: required ${kind} damage was not observed`);
      }
      if (test.id.startsWith('destruction') && !(counters.destroyedRocks > 0)) throw new Error(`${test.id}: no rock destruction observed`);
      if (test.id.startsWith('destruction') && rocks() < fixture.remainingGlobalRocks) throw new Error(`${test.id}: global rock reserve exhausted`);
      if (test.kind === 'environment' && (!(counters.trainMovingSamples > 0) || counters.routeWaypoints !== route.length || counters.lakesObserved !== 3)) throw new Error(`Environment route, lakes or visible moving train missing: ${JSON.stringify(counters)}`);
      if (test.id.startsWith('destruction')) counters.fieldRocksRemaining = fieldRocks(test.itemId);
      if (test.kind === 'pickup' && !counters.clearedRouteReached) throw new Error(`${test.id}: cleared route could not be traversed`);
      if (test.itemId === 'SMOKE_GRENADE' && !(counters.smokePeak > 0)) throw new Error('No smoke cloud observed');
      if (test.itemId === 'BFG' && !counters.bfgObserved) throw new Error('No BFG projectile observed');
      if (test.itemId === 'ARMAGEDDON' && !carriedRecovery && !(counters.meteorPeak > 0)) throw new Error('No Armageddon meteors observed');
      if (test.kind === 'combat' && counters.trainActiveSamples) throw new Error('Train contaminated the day/night comparison');
      if (test.kind === 'combat' && !counters.waterVisibleSamples) throw new Error('Water missing from the combat view');
      if (test.id === 'combat.night' && !counters.renderedLightsPeak) throw new Error('No active rendered lights in the night case');
      if (test.kind === 'environment' && (!counters.trees || !counters.wildlife)) throw new Error('Reference vegetation or wildlife missing');
      if (test.itemId === 'MOLOTOV_GRENADE' && !(counters.burningCellsPeak > 0)) throw new Error('No burning ground observed');
      if (test.kind === 'recovery' && (flow.getEnemyCount() || counters.remainingMeteors)) throw new Error('Recovery did not stop enemy attacks or meteor spawning');
      if ((test.kind === 'construction' || test.kind === 'combat') && (!(counters.built >= 4) || !(counters.constructionDamageEvents > 0))) throw new Error('Constructs were not built and attacked');
      if ((test.kind === 'construction' || test.kind === 'combat') && !(counters.turretDamageEvents > 0)) throw new Error('No enemy hit from a constructed turret was observed');
    },
    observeHits(listener) {
      const combat = flow.getWorldCombatCore()!;
      const removeDamage = combat.addDamageDealtObserver(damage => {
        if (damage.attackerId === localId() && damage.targetType === 'enemy' && damage.damage > 0) { add('damageEvents'); add(`damage.${damage.damageKind}`); listener(); }
      });
      const removeKills = combat.observeEnemyDamageCommitted(outcome => {
        if (outcome.transition.kind === 'dead') add('kills');
        if (outcome.source.actor?.kind === 'turret' && outcome.source.allegiance.ownerId === localId()
          && outcome.actualDamage > 0) add('turretDamageEvents');
      });
      return () => { removeDamage(); removeKills(); };
    },
    readLoad() {
      return { ...counters, enemies: flow.getEnemyCount(), projectiles: flow.getWorldProjectileRuntime()?.getDebugActiveProjectileCount() ?? 0,
        rocksBefore, rocksRemaining: active ? rocks() : 0, layoutFingerprint: bridge.getWorldDescriptor()?.layoutFingerprint ?? '',
        seed: REFERENCE_SEED, elapsedCaseMs: Math.round(performance.now() - caseStart), playerAttacksStopped: stopped ? 1 : 0 };
    },
    discard() {
      if (!active) return;
      input(); flow.rpcPorts.heldAction.clearPlayer(localId()); removeWorldObserver?.(); removeWorldObserver = null;
      flow.clearTimeOfDayDebugOverride(); flow.hostDiscardRound(); targets.clear();
      bridge.setLocalReady(false); flow.setIsLocalReady(false); bridge.setCoopDefenseMapId(previousMap); bridge.setGameMode(previousMode); active = false;
    },
    stopRecording: () => diagnostics.stopScenarioRecording(),
    environment: () => ({ canvasWidth: scene.game.canvas.width, canvasHeight: scene.game.canvas.height,
      viewportWidth: innerWidth, viewportHeight: innerHeight, dpr: devicePixelRatio,
      quality: 'high', targetFps: 120, physicsFps: 120, coldBrowser: true, audio: 'running' }),
  };
}
