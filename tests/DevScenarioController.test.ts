import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import EventEmitter from 'eventemitter3';
import type * as Phaser from 'phaser';
import type { ArenaRuntime } from '../src/scenes/arena/ArenaRuntime';
import { defaultScenario, encodeScenario } from '../src/dev/scenario/config';
import { resolveRockAerialPerspective } from '../src/effects/groundFog/FogRockLighting';
import { DevScenarioController } from '../src/dev/scenario/controller';
import { WorldLightingMeasurement } from '../src/dev/scenario/WorldLightingMeasurement';
import { onBootSceneTeardown } from '../src/ui/BootPreparation';

const host = vi.hoisted(() => ({ phase: 'LOBBY', started: false, lobbyMinute:480 }));
const arenaSystem = vi.hoisted(() => ({ pause: vi.fn(), resume: vi.fn(), setVisible: vi.fn(), isActive: () => true, settings: { visible: true } }));
vi.mock('../src/utils/devScenarioMode', () => ({ isDevScenarioMode: () => true }));
vi.mock('../src/dev/scenario/panel', () => ({ createScenarioPanel: () => ({ sync() {}, syncTarget() {}, refresh() {}, setCollapsed() {}, destroy() {} }) }));
vi.mock('../src/systems/navigation/NavigationGeometry', () => ({ NavigationGeometry: class { isFree() { return true; } } }));
vi.mock('../src/network/bridge', () => ({ bridge: {
  getGamePhase: () => host.phase, isArenaStarted: () => host.started, getLocalPlayerId: () => 'p1',
  getLobbyTimeOfDayMinutes:()=>host.lobbyMinute,setLobbyTimeOfDayMinutes:(minute:number)=>{host.lobbyMinute=minute;},
  sendLocalInput() {}, setLocalReady() {}, setGameMode() {}, setCoopDefenseMapId() {},
  setLocalReadyWithCommittedLoadout() {}, getSynchronizedNow: () => Date.now(), getPlayerCommittedLoadout: () => null,
  setDevScenarioPlayerFreeForAll() {}, setDevScenarioBotState() {},
} }));

let controller: DevScenarioController;
let player: { x: number; y: number; alive: boolean };
let attacks: string[];
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('location', { hash: '' });
  vi.stubGlobal('history', { replaceState: (_a: unknown, _b: unknown, hash: string) => { location.hash = hash; } });
  host.phase = 'LOBBY'; host.started = false;
  arenaSystem.pause.mockClear(); arenaSystem.resume.mockClear(); arenaSystem.setVisible.mockClear();
  player = { x: 208, y: 668, alive: true }; attacks = [];
  const runtime = {
    navigationLabPort: {
      setNextRoundSeed() {}, isReady: () => host.started,
      getPlayerPosition: () => ({ ...player }), getGeometry: () => ({}),
      placePlayer: (x: number, y: number) => { player.x = x; player.y = y; }, readEnemies: () => [],
    },
    devScenarioPort: { suppressEncounters() {}, setOptions() {}, readMission: () => ({}), updateTrain() {} },
    weaponBalanceLabPort: { setAdrenaline() {}, getMaxAdrenaline: () => 100,
      useWeaponAction: (slot: string) => { attacks.push(slot); return { ok: true }; } },
    rpcPorts: { heldAction: { clearPlayer() {} } },
    getWorldMetrics: () => ({ offsetX: 0, offsetY: 12, gridCols: 60, gridRows: 33 }),
    getScenarioLoadingState: () => ({ roundStartPrepared: true }), getScenarioObservation: () => ({}),
    getScenarioLightingTargets: () => ({ sunlight: null, enemyReadability: {getDiagnostics:()=>({})} }),
    getWorldDescriptor: () => ({}), getWorldCombatCore: () => null, setTimeOfDayDebugOverride() {},
    setIsLocalReady() {}, stopScenarioUltimate() {}, isMatchTerminated: () => false,
    hostDiscardRound: () => { host.phase = 'LOBBY'; host.started = false; },
  } as unknown as ArenaRuntime;
  const scene = { sys: arenaSystem, game: { loop: { callback() {} }, canvas: { width: 1920, height: 1080 }, renderer: { snapshot() {} } },
    cameras: { main: { scrollX: 0, scrollY: 0, zoomX: 1, zoomY: 1 } } } as unknown as Phaser.Scene;
  controller = new DevScenarioController(scene, runtime, () => {}, () => true);
});
afterEach(() => { controller.destroy(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function enter() {
  controller.start({ ...defaultScenario(), player: { gridX: 14, gridY: 23 } });
  controller.update(); controller.update();
  host.phase = 'ARENA'; host.started = true; controller.update();
}

describe('Dev scenario automation lifecycle', () => {
  it('routes the readability recipe and both terrain stations through the public API',()=>{
    const start=vi.spyOn(controller,'start').mockImplementation(()=>{});
    const arrange=vi.spyOn(controller,'arrangeEnemyReadability').mockImplementation(()=>{});
    const api=window.devScenario!;
    expect(api.run({action:'enemyReadabilityScene',timeOfDay:360})).toMatchObject({ok:true});
    expect(start).toHaveBeenCalledWith(expect.objectContaining({mapId:'1',seed:12345,timeOfDay:360}));
    expect(api.run({action:'enemyReadabilityArrange',surface:'gravel'})).toMatchObject({ok:true});
    expect(arrange).toHaveBeenLastCalledWith('gravel');
    expect(api.run({action:'enemyReadabilityArrange',surface:'typo'})).toMatchObject({ok:false});
    expect(arrange).toHaveBeenCalledTimes(1);
  });
  it('saves a detached report through the existing local artifact endpoint without changing scenario state',async()=>{
    enter();controller.afterHostFrame();
    const before=structuredClone(controller.snapshot());
    const fetcher=vi.fn(async()=>({ok:true,json:async()=>({path:'C:/Fragdachse/build/dev-scenarios/report-test.json',url:'/build/dev-scenarios/report-test.json'})}));
    vi.stubGlobal('fetch',fetcher);
    const result=await window.devScenario!.saveReport();
    expect(result).toMatchObject({ok:true,status:before,path:'C:/Fragdachse/build/dev-scenarios/report-test.json'});
    const request=fetcher.mock.calls[0] as unknown as [string,RequestInit];
    expect(request[0]).toBe('/__dev-scenario-report');
    expect(JSON.parse(await (request[1].body as Blob).text())).toEqual(before);
    expect(controller.config).toEqual(before.config);expect(controller.state).toBe('ready');
  });
  it('routes explicit world measurement modes through the public command API and rejects typos',()=>{
    enter();controller.afterHostFrame();
    const measure=vi.spyOn(controller,'measureWorldLighting').mockImplementation(()=>{});
    expect(window.devScenario!.run({action:'measureWorldLighting',mode:'destruction'}).ok).toBe(true);
    expect(measure).toHaveBeenLastCalledWith('destruction');
    expect(window.devScenario!.run({action:'measureWorldLighting',mode:'traverse'}).ok).toBe(true);
    expect(measure).toHaveBeenLastCalledWith('traverse');
    expect(window.devScenario!.run({action:'measureWorldLighting',mode:'walk'}).ok).toBe(true);
    expect(measure).toHaveBeenLastCalledWith('walk');
    expect(window.devScenario!.run({action:'measureWorldLighting',mode:'typo'}).ok).toBe(false);
    expect(window.devScenario!.run({action:'measureWorldLighting',mode:'explosion',radius:2.5}).ok).toBe(true);
      expect(measure).toHaveBeenLastCalledWith('explosion',2.5);
      expect(window.devScenario!.run({action:'measureWorldLighting',mode:'explosion',radius:99}).ok).toBe(false);
      expect(measure).toHaveBeenCalledTimes(4);
  });
  it('bounds the walking camera route to the map and reports its actual speed without moving the player',()=>{
    enter();controller.afterHostFrame();
    const before={...player},aim={...controller.aim};
    vi.spyOn(WorldLightingMeasurement.prototype,'update').mockImplementation(()=>{});
    const measure=vi.spyOn(WorldLightingMeasurement.prototype,'measure').mockImplementation(()=>{});
    vi.spyOn(controller,'syncCamera').mockImplementation(()=>{});
    controller.measureWorldLighting('walk');
    const workload=measure.mock.calls[0][0]!;
    const report=workload.start() as {route:{gridX:number;gridY:number}[];durationMs:number;speedWorldPxPerSecond:number;cameraOnly:boolean};
    const [from,to]=report.route;
    expect(to.gridX-from.gridX).toBeLessThanOrEqual(72);expect(to.gridX).toBeLessThan(60);
    expect(to.gridY).toBe(from.gridY);expect(report.cameraOnly).toBe(true);
    expect(report.speedWorldPxPerSecond).toBeCloseTo((to.gridX-from.gridX)*32/(report.durationMs/2000));
    workload.advance(workload.durationMs/2);expect(controller.aim).toEqual(to);
    workload.advance(workload.durationMs);expect(controller.aim).toEqual(from);
    workload.restore();expect(controller.aim).toEqual(aim);expect(controller.cameraAtTarget).toBe(false);
    expect(player).toEqual(before);vi.restoreAllMocks();
  });
  it('publishes ready only after post-host start placement, and keeps held fire across teleport', async () => {
    enter();
    expect(controller.snapshot().ready).toBe(false);
    // Simulate a normal spawn reconciliation later in the same host frame.
    player.x = 208; player.y = 668;
    controller.afterHostFrame();
    expect(player).toMatchObject({ x: 464, y: 764 });
    expect((await window.devScenario!.whenReady()).ok).toBe(true);
    expect(window.devScenario!.run({ action: 'holdWeapon', slot: 'weapon2' }).ok).toBe(true);
    window.devScenario!.run({ action: 'teleport', gridX: 15, gridY: 23 });
    controller.update();
    expect(controller.snapshot().trigger).toBe('weapon2');
    expect(attacks).toEqual(['weapon2']);
    expect(player).toMatchObject({ x: 496, y: 764 });
  });
  it('applies hash-only recipe changes and preserves the running recipe for invalid hashes', () => {
    enter(); controller.afterHostFrame();
    location.hash = encodeScenario({ ...defaultScenario(), seed: 777 });
    window.dispatchEvent(new Event('hashchange'));
    expect(controller.config.seed).toBe(777);
    expect(controller.state).toBe('waiting-lobby');
    location.hash = '#scenario=invalid'; window.dispatchEvent(new Event('hashchange'));
    expect(controller.config.seed).toBe(777);
    expect(controller.lastAction).toMatchObject({ ok: false });
  });
  it('returns errors for invalid commands, detached snapshots and cancelled captures', async () => {
    enter(); controller.afterHostFrame();
    const api = window.devScenario!;
    expect(api.run({ action: 'holdWeapon', slot: 'typo' })).toMatchObject({ ok: false });
    const state = api.status(); (state.config as { seed: number }).seed = 7;
    expect(controller.config.seed).not.toBe(7);
    const capture = api.capture();
    controller.destroy();
    expect(await capture).toMatchObject({ ok: false });
    expect(window.devScenario).toBeUndefined();
    expect(api.run({ action: 'resume' })).toMatchObject({ ok: false });
  });
  it.each(['render', 'blob', 'live'] as const)('retains capture ownership at the %s boundary', async boundary => {
    enter(); controller.afterHostFrame();
    class SnapshotImage { src = 'data:image/png;base64,fixture'; }
    vi.stubGlobal('HTMLImageElement', SnapshotImage);
    let render!: (image: SnapshotImage) => void;
    (controller as any).scene.game.renderer.snapshot = (callback: typeof render) => { render = callback; };
    let finishBlob!: (blob: Blob) => void;
    const conversion = new Promise<Blob>(resolve => { finishBlob = resolve; });
    const readBlob = vi.fn(() => boundary === 'blob' ? conversion : Promise.resolve(new Blob(['png'])));
    const fetch = vi.fn(async (_url: string, options?: RequestInit) => options?.method === 'POST'
      ? { ok: true, json: async () => ({ path: 'capture.png', url: '/capture.png' }) }
      : { blob: readBlob });
    vi.stubGlobal('fetch', fetch);
    const pending = controller.captureToWorkspace();
    render(new SnapshotImage());
    if (boundary === 'blob') {
      for (let i = 0; i < 5; i++) await Promise.resolve();
      expect(readBlob).toHaveBeenCalledOnce();
    }
    if (boundary !== 'live') controller.start({ ...defaultScenario(), seed: 777 });
    finishBlob(new Blob(['png']));
    if (boundary === 'live') await expect(pending).resolves.toMatchObject({ path: 'capture.png', url: '/capture.png' });
    else await expect(pending).rejects.toThrow(/beendeten Szenario/);
    expect(fetch.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(boundary === 'live');
  });
});

it('restores world output diagnostics and rejects unknown passes before mutating the world',()=>{
 enter();controller.afterHostFrame();
 const sunlight={setDebugCharacterShadowSolid: vi.fn(), getCharacterShadowsStatus:()=>({activeInstances:1}), setDebugCharacterShadowsSuppressed: vi.fn(), setDebugCompositeSuppressed:vi.fn(),setDebugCompositeView:vi.fn(),inspectDebugCompositeMaterial:vi.fn(()=>({zeroRGB:0}))};
 const enemyReadability={setSuppressed:vi.fn(),getDiagnostics:()=>({instances:8})};
 const rockOverlays={setVisible:vi.fn()},rocks={setDebugFormationSuppressed:vi.fn()};
 const fog={setDebugDisplaySuppressed:vi.fn(),setDebugRockLighting:vi.fn()},lighting={setCompositeSuppressed:vi.fn()};
 const postFx={setDebugDisabled:vi.fn((names:string[])=>{if(names.includes('typo'))throw Error('unknown');}),getDebugPasses:()=>[]};
 (controller as any).runtime.getScenarioLightingTargets=()=>({sunlight,fog,lighting,postFx,rocks,rockOverlays,enemyReadability});
 controller.setRenderDebug(['fogRockContact'],'normal',false,false,'material',{fogRockSunShadowStrength:.15});
 expect(fog.setDebugRockLighting).toHaveBeenLastCalledWith(true,false,{fogRockSunShadowStrength:.15});
 expect(postFx.setDebugDisabled).toHaveBeenLastCalledWith([]);
 expect(controller.lastAction).toMatchObject({fogRockLighting:{contactStrength:0,sunShadowStrength:.15}});
 controller.setRenderDebug([],'normal',false,false,'material',{rockAerialPerspective:true,rockAerialPerspectiveStrength:.3});
 expect(fog.setDebugRockLighting).toHaveBeenLastCalledWith(false,false,{rockAerialPerspective:true,rockAerialPerspectiveStrength:.3});
 expect(controller.lastAction).toMatchObject({rockAerialPerspective:{enabled:true,strength:.3}});
 controller.setRenderDebug(['rockAerialPerspective'],'normal',false,false,'material',{rockAerialPerspective:true});
 expect(fog.setDebugRockLighting).toHaveBeenLastCalledWith(false,false,{rockAerialPerspective:false});
 controller.setRenderDebug([]);expect(fog.setDebugRockLighting).toHaveBeenLastCalledWith(false,false,{});
 expect(controller.lastAction).toMatchObject({rockAerialPerspective:{enabled:true,strength:resolveRockAerialPerspective()}});
 fog.setDebugRockLighting.mockClear();
 expect(()=>controller.setRenderDebug([],'normal',false,false,'material',{fogRockContactStrength:NaN})).toThrow();
 expect(fog.setDebugRockLighting).not.toHaveBeenCalled();
 sunlight.setDebugCompositeSuppressed.mockClear();
 controller.setRenderDebug(['sunComposite','fogDisplay','lightmap','grade','enemyContour','rockSurface','rockFoliage','rockOverlays'],'neutral',true);
 expect(controller.lastAction).toMatchObject({material:{zeroRGB:0}});
 expect(rocks.setDebugFormationSuppressed).toHaveBeenLastCalledWith(true,false,true);
 expect(enemyReadability.setSuppressed).toHaveBeenLastCalledWith(true);
 expect(rockOverlays.setVisible).toHaveBeenLastCalledWith(false);
 expect(postFx.setDebugDisabled).toHaveBeenLastCalledWith(['grade']);
 expect(sunlight.setDebugCompositeSuppressed).toHaveBeenLastCalledWith(true);
 expect(fog.setDebugDisplaySuppressed).toHaveBeenLastCalledWith(true);
 expect(lighting.setCompositeSuppressed).toHaveBeenLastCalledWith(true);
 expect(controller.snapshot().characterShadows).toEqual({activeInstances:1});
 controller.setRenderDebug([],'normal',false,true);
 expect(sunlight.setDebugCharacterShadowSolid).toHaveBeenLastCalledWith(true);
 expect(()=>controller.setRenderDebug(['typo'])).toThrow();
 expect(sunlight.setDebugCompositeSuppressed).toHaveBeenCalledTimes(2);
 controller.start(defaultScenario());
 expect(postFx.setDebugDisabled).toHaveBeenLastCalledWith([]);
 expect(sunlight.setDebugCompositeSuppressed).toHaveBeenLastCalledWith(false);
 expect(sunlight.setDebugCompositeView).toHaveBeenLastCalledWith('normal');
 expect(sunlight.setDebugCharacterShadowSolid).toHaveBeenLastCalledWith(false);
 expect(fog.setDebugDisplaySuppressed).toHaveBeenLastCalledWith(false);
 expect(lighting.setCompositeSuppressed).toHaveBeenLastCalledWith(false);
 expect(rocks.setDebugFormationSuppressed).toHaveBeenLastCalledWith(false,false,false);
 expect(enemyReadability.setSuppressed).toHaveBeenLastCalledWith(false);
 expect(rockOverlays.setVisible).toHaveBeenLastCalledWith(true);
 expect(fog.setDebugRockLighting).toHaveBeenLastCalledWith(false,false);
 // The fresh, ready Lobby World can be inspected without fabricating an Activity.
 controller.state='idle';host.phase='LOBBY';host.started=false;
 const runtime=(controller as any).runtime;
 runtime.getWorldDescriptor=()=>({definitionId:'world:lobby'});runtime.syncLobbyTimeOfDay=vi.fn();
 for(const minute of [480,720,0]) {
   controller.setRenderDebug([],'normal',false,false,'material',{lobbyTimeOfDay:minute});
   expect(runtime.syncLobbyTimeOfDay).toHaveBeenCalled();
   expect(controller.lastAction).toMatchObject({lobbyTimeOfDay:minute});
   expect(controller.state).toBe('idle');
 }
});

function trainShowcaseFixture() {
  enter(); controller.afterHostFrame();
  const runtime = (controller as any).runtime;
  const scene = (controller as any).scene;
  scene.scale = { width: 1920, height: 1080 };
  const camera = scene.cameras.main;
  camera.width = 1920; camera.height = 1080; camera.originX = 0; camera.originY = 0; camera.stopFollow = () => {};
  camera.centerOn = (x: number, y: number) => { camera.scrollX = x - camera.width / 2; camera.scrollY = y - camera.height / 2; };
  camera.removeBounds = () => {};
  camera.setZoom = (x: number, y: number) => { camera.zoomX = x; camera.zoomY = y; };
  camera.setScroll = (x: number, y: number) => { camera.scrollX = x; camera.scrollY = y; };
  const train = { state: { x: 1000, y: 500, alive: true }, speed: 600,
    bounds: { left: 968, right: 1032, top: -2500, bottom: 600 },
    trackBounds: { left: 968, right: 1032, top: 12, bottom: 6000 },
    explosionCenter: { x: 1000, y: 300 } };
  runtime.devScenarioPort.readTrain = () => train;
  runtime.devScenarioPort.startTrain = vi.fn(() => true);
  runtime.devScenarioPort.destroyTrain = vi.fn(() => true);
  runtime.navigationLabPort.getFreePositions = () => [{ x: 1000, y: 400 }, { x: 800, y: 400 }];
  return { runtime, train, camera };
}

it('starts the train showcase on the fallback map through the public API', () => {
  const start = vi.spyOn(controller, 'start').mockImplementation(() => {});
  expect(window.devScenario!.run({ action: 'trainShowcase', park: 'entry', follow: true, zoom: .7 })).toMatchObject({ ok: true });
  expect(start).toHaveBeenCalledWith(expect.objectContaining({ mapId: '7', seed: 12345, player: null }));
  expect(window.devScenario!.status()).toMatchObject({ train: { preparing: true } });
  expect(window.devScenario!.run({ action: 'trainShowcase', zoom: 0 })).toMatchObject({ ok: false });
});

it('places the observer off the track before spawning and follows the locomotive', () => {
  const { runtime, train } = trainShowcaseFixture();
  runtime.devScenarioPort.startTrain.mockImplementation(() => {
    expect(player.x).toBeLessThan(train.trackBounds.left - 128); return true;
  });
  expect(window.devScenario!.run({ action: 'trainShowcase', park: 'entry', follow: true, zoom: .8 })).toMatchObject({ ok: true });
  expect(runtime.devScenarioPort.startTrain).toHaveBeenCalledOnce();
  train.state.y = 700; controller.afterHostFrame(); controller.syncCamera();
  expect(controller.snapshot()).toMatchObject({ train: { visible: true, fullyVisible: false, speed: 600,
    coordinateSpace: 'world', cameraCenter: { x: 1000, y: 700 }, trackBounds: train.trackBounds } });
});

it('waits for entry, frames the complete train and fixes the camera on the real main blast', () => {
  const { runtime, train } = trainShowcaseFixture();
  controller.startTrainShowcase(true, 1.4, { park: 'entry' });
  controller.destroyTrain(true);
  expect(runtime.devScenarioPort.destroyTrain).not.toHaveBeenCalled();
  expect(controller.snapshot()).toMatchObject({ train: { pendingExplosion: true } });
  train.bounds.top = 100; train.bounds.bottom = 3300; train.explosionCenter.y = 1800;
  controller.afterHostFrame();
  expect(runtime.devScenarioPort.destroyTrain).toHaveBeenCalledOnce();
  expect(controller.snapshot()).toMatchObject({ train: { fullyVisible: true, follow: false,
    pendingExplosion: false, cameraCenter: { x: 1000, y: 1800 } } });
  expect(controller.zoom).toBeLessThan(1.4);
  const camera = (controller as any).scene.cameras.main;
  expect(camera.scrollY + camera.height / camera.zoomY / 2).toBeCloseTo(1800);
  train.state.y = 4000; controller.afterHostFrame();
  expect(controller.snapshot()).toMatchObject({ train: { cameraCenter: { x: 1000, y: 1800 } } });
  expect(runtime.devScenarioPort.destroyTrain).toHaveBeenCalledOnce();
});

it('cancels a queued train explosion on stop and refuses unsafe observer positions', () => {
  const { runtime, train } = trainShowcaseFixture();
  controller.startTrainShowcase(true, .8, { park: 'entry' }); controller.destroyTrain(true); controller.stop();
  train.bounds.top = 100; train.bounds.bottom = 3300;
  controller.afterHostFrame(); expect(runtime.devScenarioPort.destroyTrain).not.toHaveBeenCalled();
  runtime.devScenarioPort.startTrain.mockClear();
  runtime.navigationLabPort.getFreePositions = () => [{ x: 1000, y: 400 }];
  expect(() => controller.startTrainShowcase(true, .8, { park: 'entry' })).toThrow('Sicherheitsabstand');
  expect(runtime.devScenarioPort.startTrain).not.toHaveBeenCalled();
});

// Exercise the real start/tick chain; only Phaser bodies and lifecycle services are stubbed.
vi.mock('phaser', () => ({ BlendModes: { NORMAL: 0, ADD: 1 } }));
import { TrainManager } from '../src/train/TrainManager';
import { CoopDefenseTrainEventHandler } from '../src/train/CoopDefenseTrainEventHandler';
import { createDevScenarioWorldPort } from '../src/scenes/arena/ArenaRuntimeAdapters';
import { resolveCoopDefenseWorldMetrics } from '../src/world/WorldMetrics';
import { bridge as trainTestBridge } from '../src/network/bridge';

it.each([1, .25])('drives the showcase into view and detonates within 4 simulation seconds at speed %s', speed => {
  const { runtime } = trainShowcaseFixture();
  const scene = (controller as any).scene;
  Object.assign(trainTestBridge, { isHost: () => true, getConnectedPlayers: () => [], getArenaStartTime: () => 0 });
  const metrics = resolveCoopDefenseWorldMetrics(300, 56); runtime.getWorldMetrics = () => metrics;
  const group = { add() {}, refresh() {}, destroy() {} };
  const trainScene = { physics: { add: { staticGroup: () => group } }, add: {
    rectangle: (x: number, y: number) => ({ active: true, x, y,
      setVisible() {}, setPosition(x: number, y: number) { this.x = x; this.y = y; }, destroy() {},
      body: { enable: false, updateFromGameObject() {}, reset() {} } }),
  } };
  const train = new TrainManager(trainScene as never, { getAllPlayers: () => [] } as never, 9504, -1, metrics);
  const replication = { publish: vi.fn(), clear: vi.fn() };
  const handler = new CoopDefenseTrainEventHandler(train, { setTrainSegments: vi.fn() }, -1, replication);
  // Flags have not reached the activity when afterHostFrame prepares a new showcase.
  const mission = { analysisScenarioActive: false, scenarioMissionFrozen: false,
    setScenarioOptions(frozen: boolean) { this.scenarioMissionFrozen = frozen; } };
  const worldTrain = { getCurrentTrain: () => train, getActivityTrainHandler: () => handler,
    applyDamage: (amount: number, id: string) => train.applyDamage(amount, id) };
  runtime.devScenarioPort = createDevScenarioWorldPort({
    getWorldTrainRuntime: () => worldTrain, getWorldRuntime: () => ({ context: { metrics } }),
    getCoopMissionRuntime: () => mission,
  } as never, {} as never); runtime.devScenarioPort.readMission = () => ({});
  runtime.navigationLabPort.getFreePositions = () => [{ x: 9250, y: 896 }];
  controller.config.freezeMission = false; controller.config.suppressWaves = false;
  expect(train.getNetSnapshot()).toBeNull();
  controller.startTrainShowcase(true, 1.2, { park: 'entry' });
  expect(train.isAlive()).toBe(true); // Immediate start, not merely a successful schedule.
  expect(replication.publish).toHaveBeenCalledOnce();
  controller.clock.speed = speed;
  const advance = (simulationMs: number) => {
    for (let elapsed = 0; elapsed < simulationMs; elapsed += 20 * speed) {
      scene.game.loop.callback(0, 20);
      controller.update();
      // Even an active authored director must not double-tick a manual pass.
      handler.hostUpdate(20 * speed, false, 0);
      controller.afterHostFrame(); controller.syncCamera();
    }
  };
  const startY = train.getNetSnapshot()!.y;
  advance(1000);
  expect(startY - train.getNetSnapshot()!.y).toBeCloseTo(600, 5);
  expect(controller.snapshot()).toMatchObject({ train: { alive: true, visible: true, speed: 600 } });
  controller.destroyTrain(true);
  expect(controller.snapshot()).toMatchObject({ train: { pendingExplosion: true } });
  advance(3000);
  expect(train.isDestroyed()).toBe(true);
  expect(controller.snapshot()).toMatchObject({ train: { pendingExplosion: false, follow: false } });
  // Restart is a real fresh pass, also after destruction and with the map clock released.
  controller.config.freezeMission = false; controller.config.suppressWaves = false;
  controller.startTrain(true);
  expect(train.isAlive()).toBe(true);
  advance(1000);
  expect(startY - train.getNetSnapshot()!.y).toBeCloseTo(600, 5);
  const completed = vi.fn(); handler.setCycleFinishedCallback(completed);
  advance(10000);
  expect(train.isAlive()).toBe(false);
  expect(completed).not.toHaveBeenCalled(); // Dev passes do not complete an authored event.
  controller.startTrain(true); handler.reset();
  const resetY = train.getNetSnapshot()!.y;
  runtime.devScenarioPort.updateTrain(1000, true);
  expect(train.getNetSnapshot()!.y).toBe(resetY);
  train.destroy();
});

import { WorldTrainRuntime } from '../src/world/WorldTrainRuntime';

it.each([{ repeat: false, park: 'entry' }, { repeat: true, park: 'entry' }, { repeat: false, park: 'center' }] as const)('carries showcase through map restart, final World readiness, options and owner replacement (repeat during load: %s)', async ({ repeat, park }) => {
  const { runtime } = trainShowcaseFixture(); // Default scenario is running; no train in that World.
  const scene = (controller as any).scene;
  Object.assign(trainTestBridge, { isHost: () => true, getConnectedPlayers: () => [], getArenaStartTime: () => 0 });
  const metrics = resolveCoopDefenseWorldMetrics(300, 56);
  let worldTrain: WorldTrainRuntime | null = null;
  let descriptor: { worldRevision: number; definitionId: string } | null = { worldRevision: 1, definitionId: 'world:coop-defense:1' };
  const loading = { roundStartPrepared: true, localArenaLoadReady: true };
  let navigationReady = true;
  const mission = { analysisScenarioActive: false, scenarioMissionFrozen: false,
    setScenarioOptions(value: boolean) { this.scenarioMissionFrozen = value; } };
  const destroyed = vi.fn(), publish = vi.fn();
  const makeWorld = () => new WorldTrainRuntime({
    scene: { physics: { add: { staticGroup: () => ({ add() {}, refresh() {}, destroy() {} }) } },
      time: { delayedCall: () => ({ remove() {} }) },
      add: { rectangle: (x: number, y: number) => ({ active: true, x, y, setVisible() {}, destroy() {},
        setPosition(x: number, y: number) { this.x = x; this.y = y; },
        body: { enable: false, reset() {}, updateFromGameObject() {} } }) } },
    playerManager: { getAllPlayers: () => [] }, worldMetrics: metrics, presentationRequired: false,
    projectileTrain: { setTrainGroup() {}, setTrainImpactPort() {} }, combatSystem: { setTrainSegments() {} },
    hostPhysics: {}, gameAudioSystem: {}, network: {
      clock: { getArenaStartTime: () => 0, now: () => Date.now() },
      trainEvents: { isHost: () => true, get: () => undefined, publish, clear() {} },
      matchEvents: { addPlayerFrags() {}, getConnectedPlayers: () => [], broadcastTrainDestroyed: destroyed },
      effects: { broadcastTrainBurrowSparks() {}, broadcastExplosionEffect() {} } },
    getEnemyManager: () => null, getTimeBubbleSystem: () => null, isPlayerBurrowed: () => false,
    getPowerUpSystem: () => null, setTranslocatorTrainManager() {}, setClassicTrainSpawned() {}, onRendererChanged() {},
  } as never);
  runtime.devScenarioPort = createDevScenarioWorldPort({
    getWorldTrainRuntime: () => worldTrain, getWorldRuntime: () => descriptor ? { context: { metrics, descriptor } } : null,
    getCoopMissionRuntime: () => mission,
  } as never, {} as never);
  runtime.devScenarioPort.readMission = () => ({});
  runtime.getWorldDescriptor = () => descriptor;
  runtime.getWorldMetrics = () => metrics;
  runtime.getScenarioLoadingState = () => loading;
  runtime.navigationLabPort.isReady = () => navigationReady;
  runtime.navigationLabPort.getFreePositions = () => [{ x: 9250, y: 896 }];
  const discard = vi.fn(() => {
    worldTrain?.destroy(); worldTrain = null; descriptor = null;
    host.phase = 'LOBBY'; host.started = false; navigationReady = false;
    loading.roundStartPrepared = false; loading.localArenaLoadReady = false;
  });
  runtime.hostDiscardRound = discard;
  const api = window.devScenario!;
  expect(api.run({ action: 'trainShowcase', park, follow: true, zoom: 1.2 })).toMatchObject({ ok: true });
  expect(discard).toHaveBeenCalledOnce();
  const ready = api.whenReady(); let resolved = false; void ready.then(() => { resolved = true; });
  controller.update(); controller.update(); // Lobby/ready publication -> loading.
  expect(controller.state).toBe('loading');
  if (repeat) expect(api.run({ action: 'trainShowcase', park, follow: true, zoom: 1.2 })).toMatchObject({ ok: true });
  expect(controller.state).toBe('loading');
  expect(discard).toHaveBeenCalledOnce(); // Repeated command during load must not discard again.
  worldTrain = makeWorld(); worldTrain.materializeAuthoredTrain(296, -1);
  descriptor = { worldRevision: 2, definitionId: 'world:coop-defense:7' };
  host.phase = 'ARENA'; host.started = true; navigationReady = true;
  loading.roundStartPrepared = true; // Host spawn ready, but local World admission is still pending.
  controller.update(); controller.afterHostFrame(); await vi.advanceTimersByTimeAsync(100);
  expect(resolved).toBe(false); expect(worldTrain.getCurrentTrain()!.isAlive()).toBe(false);
  expect(api.status()).toMatchObject({ ready: false, train: { devPassState: 'waiting-for-ready' } });
  const provisional = worldTrain.getCurrentTrain()!;
  worldTrain.materializeAuthoredTrain(296, -1); // Final Activity attaches a new train owner.
  loading.localArenaLoadReady = true;
  controller.update(); controller.afterHostFrame(); await vi.advanceTimersByTimeAsync(100);
  expect(resolved).toBe(false); expect(publish).not.toHaveBeenCalled();
  controller.update(); controller.afterHostFrame(); await vi.advanceTimersByTimeAsync(100);
  expect(await ready).toMatchObject({ ok: true, status: { ready: true,
    train: { alive: true, devPassState: park === 'center' ? 'parked' : 'running', lastStartReason: 'showcase-after-ready', devPassStartCount: 1 } } });
  if (park === 'center') {
    const initial = (api.status().train as any);
    expect(initial).toMatchObject({ alive: true, visible: true, fullyVisible: true, speed: 0 });
    expect((initial.bounds.top + initial.bounds.bottom) / 2).toBe((metrics.offsetY + metrics.maxY) / 2);
    expect(initial.cameraBounds.left).toBeLessThan(initial.bounds.left);
    expect(initial.cameraBounds.right).toBeGreaterThan(initial.bounds.right);
    expect(initial.cameraBounds.top).toBeLessThan(initial.bounds.top);
    expect(initial.cameraBounds.bottom).toBeGreaterThan(initial.bounds.bottom);
  }
  expect(provisional.isAlive()).toBe(false); expect(publish).toHaveBeenCalledOnce();
  const active = worldTrain.getCurrentTrain()!;
  const owner = (api.status().train as any).devPassOwnerId;
  expect(api.run({ action: 'panel', collapsed: true })).toMatchObject({ ok: true });
  expect(api.run({ action: 'options', values: { timeOfDay: 720 } })).toMatchObject({ ok: true });
  expect(worldTrain.getCurrentTrain()).toBe(active); expect(discard).toHaveBeenCalledOnce();
  expect(api.run({ action: 'speed', value: .25 })).toMatchObject({ ok: true });
  const advance = (ms: number) => {
    for (let t = 0; t < ms; t += 5) {
      scene.game.loop.callback(0, 20); controller.update(); controller.afterHostFrame(); controller.syncCamera();
    }
  };
  advance(1000);
  expect(api.status()).toMatchObject({ train: { alive: true, visible: true, devPassOwnerId: owner, devPassSimulationMs: 1000 } });
  if (park === 'center') {
    const parkedY = active.getNetSnapshot()!.y;
    advance(16000); // No polling or user timing can miss the stationary train.
    expect(active.getNetSnapshot()!.y).toBe(parkedY);
    expect(api.status()).toMatchObject({ train: { alive: true, visible: true, fullyVisible: true, speed: 0 } });
  }
  expect(api.run({ action: 'trainShowcase', park, follow: true, zoom: 1.2 })).toMatchObject({ ok: true });
  expect(discard).toHaveBeenCalledOnce(); expect(window.devScenario).toBe(api);
  expect(api.status()).toMatchObject({ train: { lastStartReason: 'showcase-existing-world', devPassStartCount: 2 } });
  // A later owner swap is visible and re-acknowledged rather than silently losing the pass.
  worldTrain.materializeAuthoredTrain(296, -1);
  controller.afterHostFrame();
  expect(api.status()).toMatchObject({ ready: false, train: { devPassState: 'waiting-for-ready' } });
  controller.afterHostFrame();
  expect(api.status()).toMatchObject({ ready: true, train: { alive: true, lastStartReason: 'showcase-world-replaced' } });
  if (park === 'center') {
    expect(api.run({ action: 'trainShowcase', move: true, speedPxPerSec: 60 })).toMatchObject({ ok: true });
    const moving = worldTrain.getCurrentTrain()!, y = moving.getNetSnapshot()!.y;
    advance(1000);
    expect(Math.abs(moving.getNetSnapshot()!.y - y)).toBeCloseTo(60);
    expect(api.status()).toMatchObject({ train: { speed: 60, fullyVisible: true } });
    // No park option: centered stationary mode is the public API default.
    expect(api.run({ action: 'trainShowcase' })).toMatchObject({ ok: true });
    expect(api.status()).toMatchObject({ train: { speed: 0, devPassState: 'parked', fullyVisible: true } });
  }
  expect(api.run({ action: 'trainExplosion', ...(park === 'entry' ? { whenVisible: true } : {}) })).toMatchObject({ ok: true });
  advance(4000);
  expect(destroyed).toHaveBeenCalledOnce();
  expect(api.status()).toMatchObject({ train: { devPassState: 'destroyed', pendingExplosion: false } });
  worldTrain.destroy();
});

// Verify actual viewport projection, including Arena origin 0 and downsampled / 4K canvases.
it.each([[960, 540, 0], [1920, 1080, 0], [3840, 2160, 0], [1920, 1080, .5]])(
  'centers the train in the real %sx%s viewport with origin %s', (width, height, origin) => {
    const { camera, train } = trainShowcaseFixture();
    const scene = (controller as any).scene;
    scene.scale = { width, height }; camera.width = width; camera.height = height;
    camera.originX = origin; camera.originY = origin;
    controller.startTrainShowcase(true, .2, { park: 'center' });
    controller.syncCamera();
    const status = controller.snapshot().train as any;
    const toScreen = (world: number, scroll: number, extent: number, zoom: number) =>
      zoom * (world - scroll - extent * origin) + extent * origin;
    expect(toScreen(status.cameraCenter.x, camera.scrollX, width, camera.zoomX)).toBeCloseTo(width / 2);
    expect(toScreen(status.cameraCenter.y, camera.scrollY, height, camera.zoomY)).toBeCloseTo(height / 2);
    expect(status).toMatchObject({ visible: true, fullyVisible: true });
    expect(toScreen(train.bounds.left, camera.scrollX, width, camera.zoomX)).toBeGreaterThanOrEqual(0);
    expect(toScreen(train.bounds.bottom, camera.scrollY, height, camera.zoomY)).toBeLessThanOrEqual(height);
    camera.scrollX += 50000;
    expect(controller.snapshot()).toMatchObject({ train: { visible: false, fullyVisible: false } });
  });
// Scene plugins register their shutdown before ArenaScene installs its own teardown.
function bindActualCameraShutdown(): () => void {
  const source = new URL('../node_modules/phaser/src/cameras/2d/CameraManager.js', import.meta.url);
  const require = createRequire(source);
  const module = { exports: {} };
  runInNewContext(readFileSync(source, 'utf8'), {
    module,
    exports: module.exports,
    require: (id: string) => {
      if (id === '../../utils/Class') return function (definition: object) { return definition; };
      if (id === '../../plugins/PluginCache') return { register() {} };
      if (id === '../../scene/events' || id === '../../scale/events') return require(id);
      return function () {};
    },
  });
  const methods = module.exports as Record<string, Function>;
  const scene = (controller as any).scene;
  const events = new EventEmitter();
  const camera = { ...scene.cameras.main, destroy: vi.fn() };
  scene.cameras = { ...methods, main: camera, cameras: [camera], systems: { events } };
  methods.start.call(scene.cameras);
  onBootSceneTeardown(events, () => controller.destroy());
  return () => events.emit('shutdown');
}

it('completes pending readiness and restores the clock after real camera shutdown', async () => {
  controller.start(defaultScenario());
  const api = window.devScenario!;
  const pending = api.whenReady();
  const { nativeNow, original } = controller.clock as any;
  const shutdown = bindActualCameraShutdown();
  expect(() => shutdown()).not.toThrow();
  await expect(pending).resolves.toMatchObject({ ok: false, error: 'Dev-Szenario wurde beendet.', status: { ready: false } });
  expect(window.devScenario).toBeUndefined();
  expect(Date.now).toBe(nativeNow);
  expect((controller as any).scene.game.loop.callback).toBe(original);
  expect(vi.getTimerCount()).toBe(0);
});

it('returns terminal API results without reading a destroyed scene after capture cancellation', async () => {
  enter(); controller.afterHostFrame();
  const api = window.devScenario!;
  const pending = api.capture();
  const shutdown = bindActualCameraShutdown();
  shutdown();
  const snapshot = vi.spyOn(controller, 'snapshot');
  const fail = vi.spyOn(controller, 'fail');
  await expect(pending).resolves.toMatchObject({ ok: false, status: { ready: false } });
  expect(api.status()).toMatchObject({ ready: false });
  expect(api.run({ action: 'resume' })).toMatchObject({ ok: false, status: { ready: false } });
  await expect(api.whenReady()).resolves.toMatchObject({ ok: false, status: { ready: false } });
  await expect(api.saveReport()).resolves.toMatchObject({ ok: false, status: { ready: false } });
  expect(snapshot).not.toHaveBeenCalled();
  expect(fail).not.toHaveBeenCalled();
  snapshot.mockRestore(); fail.mockRestore();
});
