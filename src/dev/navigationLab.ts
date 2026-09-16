import * as Phaser from 'phaser';
import { ArenaScene } from '../scenes/ArenaScene';
import { bridge } from '../network/bridge';
import { connectLocalNavigationLab } from './navigationLab/LocalLabTransport';
import { createWebGLStartupContext } from '../utils/webglContext';
import { validateGameContentReferences } from '../loadout/content/GameContentValidation';
import { loadUiFonts } from '../ui/uiFonts';
import { installRenderResolution } from '../graphics/RenderResolution';
import { navigationScenario, navigationRandom, summarizeNavigationSamples,
  NAVIGATION_SCENARIO_VERSION, NAVIGATION_LAB_SCENARIOS } from '../debug/navigationLab/scenarios';
import type { NavigationLabPort, NavigationSpawnCase } from '../debug/navigationLab/NavigationLabPort';
import enemyConfig from '../config/coopDefenseEnemies.json';
import { DEFAULT_LOADOUT, WEAPON_CONFIGS } from '../loadout/LoadoutConfig';
import { resolveLoadoutSelectionIds } from '../loadout/LoadoutRules';
import { getStoredGraphicsQuality } from '../utils/localPreferences';
import { buildDefaultCoopDefenseUpgradeProfile } from '../utils/coopDefenseUpgrades';
import { NavigationGeometry } from '../systems/navigation/NavigationGeometry';

declare const __NAVIGATION_BUILD_ID__: string;
const params = new URLSearchParams(location.search);
if (!params.has('session')) params.set('session', String(Date.now()));
const scenario = navigationScenario(params.get('scenario') ?? 'rock-field');
const spawnAudit = params.get('spawnAudit') === '1';
const pursuit = params.get('pursuit') === '1';
if (spawnAudit && params.has('suite')) throw new Error('Spawn audit is separate from performance comparisons');
const mapId = spawnAudit ? params.get('map') ?? '1' : scenario.mapId;
const count = Math.max(1, Math.min(1000, Number(params.get('count') ?? 100)));
const seed = Number(params.get('seed') ?? 183);
const warmupMs = Math.max(0, Number(params.get('warmup') ?? 10)) * 1000;
const durationMs = Math.max(1, Number(params.get('duration') ?? 60)) * 1000;
const random = navigationRandom(seed);
if (![count, seed, warmupMs, durationMs].every(Number.isFinite) || !Number.isSafeInteger(seed)
  || !Number.isInteger(count)) throw new Error('Invalid numeric scenario parameter');
const loadout = resolveLoadoutSelectionIds(DEFAULT_LOADOUT, 'coop_defense', buildDefaultCoopDefenseUpgradeProfile(), null);
const status = document.querySelector<HTMLOutputElement>('#status')!;
const results = document.querySelector<HTMLPreElement>('#results')!;
const environment = { build: __NAVIGATION_BUILD_ID__, scenarioVersion: NAVIGATION_SCENARIO_VERSION,
  cpuMeasurement: 'phaser-game-step-v1', combatObservation: 'combatant-committed-damage-v1',
  cameraFixture: '1856px-spawn-band-overview',
  targetFixture: { pinned: !pursuit, maxHp: 1_000_000, healEveryFrame: true },
  pursuit,
  density: params.get('density') === '1',
  spawnAudit, mapId,
  mutations: params.get('mutations') === '1',
  scenario: scenario.id, seed, count, warmupMs, durationMs, userAgent: navigator.userAgent,
  devicePixelRatio, hardwareConcurrency: navigator.hardwareConcurrency, enemyConfig, weaponConfig: WEAPON_CONFIGS,
  hardware: null as unknown, gpu: null as unknown, session: params.get('session'), pair: Number(params.get('pair') ?? 0),
  phase: Number(params.get('phase') ?? 0), suite: params.get('suite'),
  graphicsQuality: getStoredGraphicsQuality(), repeat: Number(params.get('repeat') ?? 0),
  viewport: { width: innerWidth, height: innerHeight }, renderResolution: { width: 0, height: 0 },
  initialLoadout: null as unknown };
let port: NavigationLabPort | null = null;
let state: 'idle' | 'loading' | 'warmup' | 'measuring' | 'complete' | 'failed' = 'idle';
let paused = false, singleStep = false, elapsed = 0, observationAt = 0, shot = 0;
let playerPoint: { x: number; y: number } | null = null;
let pursuitTrack: { start: { x: number; y: number }; end: { x: number; y: number }; speed: number } | null = null;
let pursuitTime = 0;
let spawnPoints: readonly { x: number; y: number }[] = [];
let spawnSequence = 0, lastWallAt = 0;
let report: unknown = null;
let labScene: NavigationArena | null = null;
let initialGeometryFingerprint = '', interrupted = false;
let frameCpuMs = 0, arcadeCpuMs = 0, currentArcadeCpuMs = 0;
const samples: Record<string, number[]> = {};
const longFrames: { type: string; atMs: number; durationMs: number }[] = [];
for (const type of ['longtask', 'long-animation-frame']) if (PerformanceObserver.supportedEntryTypes.includes(type)) {
  new PerformanceObserver(list => {
    if (state === 'measuring') for (const entry of list.getEntries()) longFrames.push({ type: entry.entryType, atMs: entry.startTime, durationMs: entry.duration });
  }).observe({ type, buffered: false });
}
const positions = new Map<string, { x: number; y: number; stationaryMs: number }>();
let unwantedStationaryMs = 0, observations = 0, respawns = 0;
let stationaryWithoutAttackMs = 0, attackMs = 0, specialMs = 0, bodyOverlapSamples = 0;
let lastObservationAt = 0;
let initialNavigation: Record<string, number> = {};
const combatantDamageEvents: Record<string, { count: number; damage: number }> = {};
let removeDamageObserver: (() => void) | null = null;
const movementReasons: Record<string, number> = {};
const overlapEvents: { atMs: number; id: string; kind: string; x: number; y: number; radius: number; waitReason: string | null }[] = [];
const geometryChanges: { enemyId: string; objectId: string; atMs: number; topologyBefore: number;
  topologyAfter?: number; routeLatencyMs?: number; status: 'pending' | 'ready' | 'timeout' }[] = [];
let mutationAt = 1000, mutationStarted = 0;
let authoredCases: readonly NavigationSpawnCase[] = [], authoredIndex = 0, caseAt = -1, nextAttemptAt = 0;
let caseSpawn: { id: string; at: number; x: number; y: number; unsafe: number } | null = null;
const spawnAuditResults: { caseId: string; kind: string; status: string; x?: number; y?: number; unsafe?: number; distance?: number }[] = [];
const overlay = document.querySelector<HTMLInputElement>('#overlay')!;
const sample = (key: string, value: number) => { (samples[key] ??= []).push(value); };

function spawn(): void {
  if (!port || spawnPoints.length === 0) return;
  const i = spawnSequence++;
  const point = spawnPoints[Math.floor(random() * spawnPoints.length)];
  port.spawnEnemy(point.x, point.y, pursuit ? 'void-stalker' : scenario.kinds[i % scenario.kinds.length],
    scenario.allyFraction > 0 && i % Math.round(1 / scenario.allyFraction) === 0);
}

function begin(): void {
  if (!port || state !== 'idle') return;
  port.start(mapId, seed, loadout);
  state = 'loading'; status.value = 'World und Activity werden geladen …';
}

function prepare(): void {
  if (!port) return;
  port.setScenarioActive(true);
  port.setDensityEnabled(environment.density);
  port.removeEnemies();
  initialGeometryFingerprint = port.getGeometryFingerprint();
  const free = port.getFreePositions(15);
  const metrics = port.getMetrics();
  const initial = metrics && { x: metrics.offsetX + metrics.widthPx / 2, y: metrics.offsetY + metrics.heightPx / 2 };
  if (!initial || !free.length) throw new Error('No player / safe scenario positions');
  playerPoint = free.reduce((a, b) => Math.hypot(b.x - initial.x, b.y - initial.y)
    < Math.hypot(a.x - initial.x, a.y - initial.y) ? b : a);
  if (pursuit) {
    const geometry = new NavigationGeometry(port.getGeometry()!);
    const end = free.filter(point => Math.hypot(point.x - playerPoint!.x, point.y - playerPoint!.y) >= 384
      && Math.hypot(point.x - playerPoint!.x, point.y - playerPoint!.y) <= 800
      && geometry.canMove(playerPoint!.x, playerPoint!.y, point.x, point.y, 16))
      .sort((a, b) => Math.hypot(b.x - playerPoint!.x, b.y - playerPoint!.y) - Math.hypot(a.x - playerPoint!.x, a.y - playerPoint!.y))[0];
    if (!end) throw new Error('No continuous safe pursuit track on this seed');
    pursuitTrack = { start: { ...playerPoint }, end, speed: 140 };
  }
  spawnPoints = free.filter(p => {
    const distance = Math.hypot(p.x - playerPoint!.x, p.y - playerPoint!.y);
    return distance >= 256 && distance <= 800;
  });
  if (!spawnPoints.length) throw new Error('No spawn positions in the scenario band');
  if (spawnAudit) {
    authoredCases = port.getAuthoredSpawnCases();
    if (!authoredCases.length) throw new Error('No authored encounter groups on selected map');
  } else for (let i = 0; i < count; i++) spawn();
  environment.initialLoadout = bridge.getPlayerCommittedLoadout(bridge.getLocalPlayerId());
  state = 'warmup'; elapsed = 0;
}

function finish(): void {
  if (!port) return;
  removeDamageObserver?.(); removeDamageObserver = null;
  const performance = port.stopRecording();
  const summaries = Object.fromEntries(Object.entries(samples).map(([key, values]) => [key, summarizeNavigationSamples(values)]));
  report = { environment, valid: !interrupted, geometryChanges, geometryFingerprint: initialGeometryFingerprint,
    pursuitTrack,
    spawnAudit: spawnAudit ? { expectedCases: authoredCases.length, results: spawnAuditResults } : undefined,
    browserObservations: { longFrames, gc: 'unsupported', longFrameSupport: PerformanceObserver.supportedEntryTypes },
    finalGeometryFingerprint: port.getGeometryFingerprint(), metrics: port.getMetrics(),
    summaries, combatantDamageEvents, overlapEvents, quality: { unwantedStationaryMs, stationaryWithoutAttackMs, attackMs, specialMs, bodyOverlapSamples,
      observations, respawns, movementReasons }, navigation: { initial: initialNavigation, final: port.getNavigationMetrics() }, samples, performance };
  results.textContent = JSON.stringify({ environment: { ...environment, enemyConfig: undefined, weaponConfig: undefined, initialLoadout: undefined }, summaries,
    spawnAudit: spawnAudit ? { expectedCases: authoredCases.length, results: spawnAuditResults } : undefined,
    quality: { unwantedStationaryMs, stationaryWithoutAttackMs, attackMs, specialMs, bodyOverlapSamples, observations, respawns, movementReasons } }, null, 2);
  state = 'complete'; status.value = 'Messung abgeschlossen';
  labScene?.scene.pause();
  fetch('/__navigation-report', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(report) }).then(async response => {
      if (!response.ok) throw new Error(await response.text());
      status.value = `Gespeichert: ${(await response.json()).saved}`;
      if (params.get('suite') === 'paired') {
        const repetitions = Number(params.get('repetitions') ?? 3);
        const phase = environment.phase === 0 ? 1 : 0;
        let pair = environment.pair + (phase === 0 ? 1 : 0);
        let index = NAVIGATION_LAB_SCENARIOS.findIndex(entry => entry.id === scenario.id);
        if (pair >= repetitions) { pair = 0; index++; }
        if (index < NAVIGATION_LAB_SCENARIOS.length) {
          params.set('pair', String(pair)); params.set('phase', String(phase));
          params.set('scenario', NAVIGATION_LAB_SCENARIOS[index].id);
          const variant = (pair + phase) % 2 === 0 ? 'baseline' : 'candidate';
          location.href = `/build/navigation-${variant}/navigation-lab.html?${params}`;
        }
        return;
      }
      if (params.get('suite') === 'reference') {
        const scenarios = NAVIGATION_LAB_SCENARIOS;
        const index = scenarios.findIndex(entry => entry.id === scenario.id);
        const next = (index + 1) % scenarios.length;
        const repeat = environment.repeat + (next === 0 ? 1 : 0);
        if (repeat < 3) {
          params.set('scenario', scenarios[next].id); params.set('repeat', String(repeat));
          location.search = params.toString();
        }
      }
    }).catch(error => { status.value = `Export fehlgeschlagen: ${String(error)}. JSON-Download verfügbar.`; });
}

/** Exercises authored areas through the actual executor and Arcade bodies. Mission progression
 * is tested separately; the reference player is placed near each area in this fixture. */
function stepSpawnAudit(delta: number): void {
  if (!port) return;
  state = 'measuring'; elapsed += delta;
  const entry = authoredCases[authoredIndex];
  if (!entry) { finish(); return; }
  if (caseAt < 0) {
    port.removeEnemies();
    const free = port.getFreePositions(15);
    playerPoint = free.reduce((a, b) => Math.hypot(b.x - entry.target.x, b.y - entry.target.y)
      < Math.hypot(a.x - entry.target.x, a.y - entry.target.y) ? b : a);
    caseAt = elapsed; nextAttemptAt = elapsed + 1000; caseSpawn = null;
  }
  port.placePlayer(playerPoint!.x, playerPoint!.y);
  status.value = `Spawn-Prüfung Map ${mapId}: ${authoredIndex + 1}/${authoredCases.length} · ${entry.id}`;
  if (!caseSpawn && elapsed >= nextAttemptAt) {
    const ids = port.spawnAuthoredCase(entry.id);
    nextAttemptAt = elapsed + 100;
    const born = port.readEnemies().find(enemy => ids.includes(enemy.id));
    if (born) caseSpawn = { id: born.id, at: elapsed, x: born.x, y: born.y, unsafe: !born.bodyFree && !born.special ? 1 : 0 };
  }
  if (caseSpawn) {
    const enemy = port.readEnemies().find(enemy => enemy.id === caseSpawn!.id);
    if (enemy && !enemy.bodyFree && !enemy.special) caseSpawn.unsafe++;
    if (elapsed - caseSpawn.at < 600) return;
    spawnAuditResults.push({ caseId: entry.id, kind: entry.kind,
      status: caseSpawn.unsafe ? 'unsafe' : 'spawned', x: caseSpawn.x, y: caseSpawn.y,
      unsafe: caseSpawn.unsafe, distance: enemy ? Math.hypot(enemy.x - caseSpawn.x, enemy.y - caseSpawn.y) : undefined });
  } else if (elapsed - caseAt < 5000) return;
  else spawnAuditResults.push({ caseId: entry.id, kind: entry.kind, status: 'no-spawn' });
  authoredIndex++; caseAt = -1;
}

/** A scenario event goes through the canonical mutation owner and observes the actual worker result. */
function observeGeometryChange(): void {
  if (!port || !environment.mutations) return;
  const pending = geometryChanges[geometryChanges.length - 1];
  if (pending?.status === 'pending') {
    const route = port.readEnemies().find(enemy => enemy.id === pending.enemyId)?.intent?.navigation;
    const latency = performance.now() - mutationStarted;
    if (route?.status === 'ready' && route.topology > pending.topologyBefore) {
      pending.status = 'ready'; pending.topologyAfter = route.topology; pending.routeLatencyMs = latency;
    } else if (latency > 2000) { pending.status = 'timeout'; pending.routeLatencyMs = latency; }
    return;
  }
  if (geometryChanges.length >= 3 || elapsed < mutationAt) return;
  const shapes = port.getGeometry()?.obstacles ?? [];
  let chosen: { enemyId: string; objectId: string; topology: number; distance: number } | null = null;
  for (const enemy of port.readEnemies()) {
    const route = enemy.intent?.navigation;
    if (route?.status !== 'ready' || route.cost < 64 || enemy.faction !== 'hostile') continue;
    for (const shape of shapes) {
      if (shape.kind !== 'rock' || !/^rock:\d+$/.test(shape.id)) continue;
      const x = shape.shape === 'rect' ? (shape.left + shape.right) / 2 : shape.x;
      const y = shape.shape === 'rect' ? (shape.top + shape.bottom) / 2 : shape.y;
      const distance = Math.hypot(x - enemy.x, y - enemy.y);
      if (distance > 128 || (chosen && distance >= chosen.distance)) continue;
      chosen = { enemyId: enemy.id, objectId: shape.id, topology: route.topology, distance };
    }
  }
  mutationAt = elapsed + 4000;
  if (!chosen) return;
  mutationStarted = performance.now();
  if (port.destroyScenarioRock(Number(chosen.objectId.slice(5)))) geometryChanges.push({
    enemyId: chosen.enemyId, objectId: chosen.objectId, atMs: elapsed, topologyBefore: chosen.topology, status: 'pending' });
}

/** The lab times the complete production Game.step, including physics plugins, input, audio and rendering. */
class NavigationGame extends Phaser.Game {
  step(time: number, delta: number): void {
    const started = performance.now();
    currentArcadeCpuMs = 0;
    try { super.step(time, delta); }
    finally { frameCpuMs = performance.now() - started; arcadeCpuMs = currentArcadeCpuMs; }
  }
}

/** Install before any World subscribes its callbacks; original order and receiver remain unchanged. */
function measureArcadeWorld(): () => void {
  const prototype = Phaser.Physics.Arcade.World.prototype;
  const update = prototype.update, postUpdate = prototype.postUpdate;
  const measuredUpdate = function (this: Phaser.Physics.Arcade.World, time: number, delta: number): void {
    const started = performance.now();
    try { update.call(this, time, delta); }
    finally { currentArcadeCpuMs += performance.now() - started; }
  };
  const measuredPostUpdate = function (this: Phaser.Physics.Arcade.World): void {
    const started = performance.now();
    try { postUpdate.call(this); }
    finally { currentArcadeCpuMs += performance.now() - started; }
  };
  prototype.update = measuredUpdate; prototype.postUpdate = measuredPostUpdate;
  return () => {
    if (prototype.update === measuredUpdate) prototype.update = update;
    if (prototype.postUpdate === measuredPostUpdate) prototype.postUpdate = postUpdate;
  };
}

class NavigationArena extends ArenaScene {
  create(): void {
    super.create();
    labScene = this;
    port = this.createNavigationLabPort();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { removeDamageObserver?.(); removeDamageObserver = null; });
    status.value = `${scenario.description} · ${count} Einheiten · Seed ${seed}`;
    if (params.get('autorun') === '1') begin();
  }
  update(time: number, delta: number): void {
    if (state === 'complete' || state === 'failed' || (paused && !singleStep)) return;
    singleStep = false;
    try {
      if (state === 'loading') {
        port?.setScenarioActive(true);
        if (port?.isReady()) prepare();
      }
      if (spawnAudit && (state === 'warmup' || state === 'measuring')) {
        environment.renderResolution = { width: this.game.canvas.width, height: this.game.canvas.height };
        stepSpawnAudit(delta);
        if (authoredIndex < authoredCases.length) super.update(time, delta);
        if (playerPoint) this.cameras.main.stopFollow().setZoom(Math.min(this.scale.width, this.scale.height) / 1856)
          .centerOn(playerPoint.x, playerPoint.y);
        return;
      }
      if (state === 'warmup' || state === 'measuring') {
        if (!port?.getPlayerPosition()?.alive) throw new Error('Scenario player died; measurement invalid');
        elapsed += Math.max(0, delta);
        if (pursuitTrack) {
          pursuitTime += Math.max(0, delta);
          const { start, end, speed } = pursuitTrack, length = Math.hypot(end.x - start.x, end.y - start.y);
          const phase = (pursuitTime * speed / 1000 / length) % 2, t = phase <= 1 ? phase : 2 - phase;
          playerPoint = { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
        }
        if (playerPoint) port?.placePlayer(playerPoint.x, playerPoint.y);
        if (elapsed >= observationAt) {
          const enemies = port!.readEnemies();
          const dt = observationAt === 0 ? 0 : elapsed - lastObservationAt;
          lastObservationAt = elapsed;
          observationAt = elapsed + 100;
          if (state === 'measuring') {
            observations++;
            sample('population', enemies.length);
            const view = this.cameras.main.worldView;
            sample('visiblePopulation', enemies.filter(enemy => enemy.x >= view.left && enemy.x <= view.right
              && enemy.y >= view.top && enemy.y <= view.bottom).length);
            const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
            if (memory) sample('heapBytes', memory.usedJSHeapSize);
            for (const enemy of enemies) {
              const previous = positions.get(enemy.id);
              const stationary = previous && Math.hypot(enemy.x - previous.x, enemy.y - previous.y) < 1;
              const stationaryMs = stationary && enemy.moving && !enemy.attacking ? previous.stationaryMs + dt : 0;
              if (stationaryMs > 2000) unwantedStationaryMs += dt;
              if (stationary && !enemy.attacking && !enemy.special) stationaryWithoutAttackMs += dt;
              if (enemy.attacking) attackMs += dt;
              if (enemy.special) specialMs += dt;
              if (!enemy.bodyFree && !enemy.special) {
                bodyOverlapSamples++;
                if (overlapEvents.length < 32) overlapEvents.push({ atMs: elapsed, id: enemy.id, kind: enemy.kind,
                  x: enemy.x, y: enemy.y, radius: enemy.radius, waitReason: enemy.movement?.waitReason ?? null });
              }
              const reason = enemy.movement?.waitReason ?? (enemy.attacking ? 'attack' : enemy.special ? 'exclusive' : 'unclassified');
              movementReasons[reason] = (movementReasons[reason] ?? 0) + dt;
              positions.set(enemy.id, { x: enemy.x, y: enemy.y, stationaryMs });
            }
          }
          for (let n = enemies.length; n < count; n++) { spawn(); if (state === 'measuring') respawns++; }
          if (scenario.combat && !pursuit && enemies.length) port!.fireAt(enemies[shot % enemies.length].x, enemies[shot % enemies.length].y, ++shot);
          if (overlay.checked) {
            const metrics = port!.getMetrics()!, svg = document.querySelector<SVGSVGElement>('#navigation-map')!;
            const left = Math.min(...enemies.map(e => e.x), playerPoint!.x) - 96;
            const top = Math.min(...enemies.map(e => e.y), playerPoint!.y) - 96;
            const right = Math.max(...enemies.map(e => e.x), playerPoint!.x) + 96;
            const bottom = Math.max(...enemies.map(e => e.y), playerPoint!.y) + 96;
            svg.setAttribute('viewBox', `${left} ${top} ${right - left} ${bottom - top}`);
            svg.replaceChildren();
            for (const shape of port!.getGeometry()?.obstacles ?? []) {
              const bounds = shape.shape === 'rect' ? shape : { left: shape.x - shape.radius, top: shape.y - shape.radius, right: shape.x + shape.radius, bottom: shape.y + shape.radius };
              if (bounds.right < left || bounds.left > right || bounds.bottom < top || bounds.top > bottom) continue;
              const node = document.createElementNS('http://www.w3.org/2000/svg', shape.shape === 'rect' ? 'rect' : 'circle');
              const attributes = shape.shape === 'rect'
                ? { x: shape.left, y: shape.top, width: shape.right - shape.left, height: shape.bottom - shape.top }
                : { cx: shape.x, cy: shape.y, r: shape.radius };
              for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
              node.setAttribute('fill', '#53665d'); svg.append(node);
            }
            for (const enemy of enemies) {
              const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
              circle.setAttribute('cx', String(enemy.x)); circle.setAttribute('cy', String(enemy.y)); circle.setAttribute('r', String(enemy.radius));
              circle.setAttribute('fill', enemy.bodyFree ? '#7de8a7' : '#ff7272'); svg.append(circle);
              const route = enemy.intent?.navigation;
              if (route?.status === 'ready') {
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                for (const [key, value] of Object.entries({ x1: enemy.x, y1: enemy.y, x2: route.waypoint.x, y2: route.waypoint.y })) line.setAttribute(key, String(value));
                line.setAttribute('stroke', '#75baff'); line.setAttribute('stroke-width', '3'); svg.append(line);
              }
            }
            document.querySelector('#navigation-state')!.textContent = enemies.slice(0, 16).map(e =>
              `${e.id} ${e.intent?.target?.id ?? e.target ?? '–'} · ${e.intent?.navigation.status ?? 'Baseline'} · ${e.intent?.attackContext ?? '–'} · ${e.movement?.waitReason ?? '–'}`).join('\n');
          }
        }
        if (state === 'warmup' && elapsed >= warmupMs) {
          environment.renderResolution = { width: this.game.canvas.width, height: this.game.canvas.height };
          port!.startRecording(environment); state = 'measuring'; elapsed = 0; observationAt = 0;
          initialNavigation = port!.getNavigationMetrics();
          removeDamageObserver = port!.observeCombatantDamage(event => {
            if (state !== 'measuring') return;
            const key = `${event.targetType}:${event.damageKind}`;
            const entry = combatantDamageEvents[key] ??= { count: 0, damage: 0 };
            entry.count++; entry.damage += event.damage;
          });
          lastWallAt = performance.now();
        }
      }
      if (paused) this.scene.pause();
      const sceneStarted = performance.now();
      super.update(time, delta);
      const sceneCpuMs = performance.now() - sceneStarted;
      if (playerPoint) this.cameras.main.stopFollow()
        .setZoom(Math.min(this.scale.width, this.scale.height) / 1856).centerOn(playerPoint.x, playerPoint.y);
      if (state === 'measuring') {
        observeGeometryChange();
        const renderCpuMs = port!.getRenderCpuMs();
        sample('sceneCpuMs', sceneCpuMs); sample('renderCpuMs', renderCpuMs);
        // Complete Game.step and Arcade costs are from the previous completed frame in both builds.
        sample('frameCpuMs', frameCpuMs); sample('arcadeCpuMs', arcadeCpuMs);
        const wallAt = performance.now(); sample('frameMs', wallAt - lastWallAt); lastWallAt = wallAt;
        for (const [key, value] of Object.entries(port!.getPerformance())) if (typeof value === 'number') sample(key, value);
        status.value = `Messung ${Math.min(durationMs, elapsed).toFixed(0)} / ${durationMs} ms · ${scenario.id}`;
        if (elapsed >= durationMs) finish();
      }
    } catch (error) {
      removeDamageObserver?.(); removeDamageObserver = null;
      state = 'failed'; status.value = `FEHLER: ${error instanceof Error ? error.message : String(error)}`;
      this.scene.pause();
      console.error(error);
    }
  }
}

document.querySelector('#start')!.addEventListener('click', begin);
overlay.addEventListener('change', () => {
  document.querySelector<HTMLElement>('#diagnostics')!.hidden = !overlay.checked;
  if (overlay.checked) interrupted = true;
});
document.querySelector('#pause')!.addEventListener('click', () => {
  paused = !paused; interrupted = true;
  if (paused) labScene?.scene.pause(); else labScene?.scene.resume();
});
document.querySelector('#step')!.addEventListener('click', () => {
  paused = true; singleStep = true; interrupted = true; labScene?.scene.resume();
});
document.querySelector('#restart')!.addEventListener('click', () => location.reload());
document.querySelector('#export')!.addEventListener('click', () => {
  if (!report) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(report)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `navigation-${scenario.id}-${seed}-${count}.json`;
  link.click(); URL.revokeObjectURL(url);
});
const select = document.querySelector<HTMLSelectElement>('#scenario')!;
for (const entry of NAVIGATION_LAB_SCENARIOS) select.add(new Option(entry.description, entry.id, false, entry.id === scenario.id));
select.addEventListener('change', () => { params.set('scenario', select.value); location.search = params.toString(); });

async function boot(): Promise<void> {
  environment.hardware = await fetch('/__navigation-environment').then(r => r.ok ? r.json() : null).catch(() => null);
  validateGameContentReferences();
  await connectLocalNavigationLab(); bridge.activate(); bridge.setGameMode('coop_defense');
  await loadUiFonts();
  const context = createWebGLStartupContext();
  if (!context) throw new Error('WebGL unavailable');
  const gl = context.context as WebGLRenderingContext;
  const gpu = gl.getExtension('WEBGL_debug_renderer_info');
  environment.gpu = { vendor: gl.getParameter(gpu?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR),
    renderer: gl.getParameter(gpu?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER) };
  const releaseArcadeMeasurement = measureArcadeWorld();
  const game = new NavigationGame({ type: Phaser.WEBGL, canvas: context.canvas, seed: [String(seed)],
    context: context.context as unknown as CanvasRenderingContext2D,
    width: innerWidth, height: innerHeight - 54, parent: 'game-container',
    smoothPixelArt: context.rendererType === 'webgl1',
    physics: { default: 'arcade', arcade: { gravity: { x: 0, y: 0 }, debug: false, fps: 120 } },
    scene: [NavigationArena], scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    dom: { createContainer: true } });
  game.events.once(Phaser.Core.Events.DESTROY, releaseArcadeMeasurement);
  game.events.once(Phaser.Core.Events.READY, () => installRenderResolution(game));
}
boot().catch(error => { status.value = `FEHLER: ${String(error)}`; console.error(error); });
