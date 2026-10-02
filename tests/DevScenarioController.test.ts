import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Phaser from 'phaser';
import type { ArenaRuntime } from '../src/scenes/arena/ArenaRuntime';
import { defaultScenario, encodeScenario } from '../src/dev/scenario/config';
import { DevScenarioController } from '../src/dev/scenario/controller';
import { WorldLightingMeasurement } from '../src/dev/scenario/WorldLightingMeasurement';

const host = vi.hoisted(() => ({ phase: 'LOBBY', started: false }));
const arenaSystem = vi.hoisted(() => ({ pause: vi.fn(), resume: vi.fn(), setVisible: vi.fn(), isActive: () => true, settings: { visible: true } }));
vi.mock('../src/utils/devScenarioMode', () => ({ isDevScenarioMode: () => true }));
vi.mock('../src/dev/scenario/panel', () => ({ createScenarioPanel: () => ({ sync() {}, syncTarget() {}, refresh() {}, setCollapsed() {}, destroy() {} }) }));
vi.mock('../src/systems/navigation/NavigationGeometry', () => ({ NavigationGeometry: class { isFree() { return true; } } }));
vi.mock('../src/network/bridge', () => ({ bridge: {
  getGamePhase: () => host.phase, isArenaStarted: () => host.started, getLocalPlayerId: () => 'p1',
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
});

it('restores world output diagnostics and rejects unknown passes before mutating the world',()=>{
 enter();controller.afterHostFrame();
 const sunlight={setDebugCharacterShadowSolid: vi.fn(), getCharacterShadowsStatus:()=>({activeInstances:1}), setDebugCharacterShadowsSuppressed: vi.fn(), setDebugCompositeSuppressed:vi.fn(),setDebugCompositeView:vi.fn(),inspectDebugCompositeMaterial:vi.fn(()=>({zeroRGB:0}))};
 const enemyReadability={setSuppressed:vi.fn(),getDiagnostics:()=>({instances:8})};
 const rockOverlays={setVisible:vi.fn()},rocks={setDebugFormationSuppressed:vi.fn()};
 const fog={setDebugDisplaySuppressed:vi.fn()},lighting={setCompositeSuppressed:vi.fn()};
 const postFx={setDebugDisabled:vi.fn((names:string[])=>{if(names.includes('typo'))throw Error('unknown');}),getDebugPasses:()=>[]};
 (controller as any).runtime.getScenarioLightingTargets=()=>({sunlight,fog,lighting,postFx,rocks,rockOverlays,enemyReadability});
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
});

function trainShowcaseFixture() {
  enter(); controller.afterHostFrame();
  const runtime = (controller as any).runtime;
  const scene = (controller as any).scene;
  scene.scale = { width: 1920, height: 1080 };
  const camera = scene.cameras.main;
  camera.width = 1920; camera.height = 1080;
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
  expect(window.devScenario!.run({ action: 'trainShowcase', follow: true, zoom: .7 })).toMatchObject({ ok: true });
  expect(start).toHaveBeenCalledWith(expect.objectContaining({ mapId: '7', seed: 12345, player: null }));
  expect(window.devScenario!.status()).toMatchObject({ train: { preparing: true } });
  expect(window.devScenario!.run({ action: 'trainShowcase', zoom: 0 })).toMatchObject({ ok: false });
});

it('places the observer off the track before spawning and follows the locomotive', () => {
  const { runtime, train } = trainShowcaseFixture();
  runtime.devScenarioPort.startTrain.mockImplementation(() => {
    expect(player.x).toBeLessThan(train.trackBounds.left - 128); return true;
  });
  expect(window.devScenario!.run({ action: 'trainShowcase', follow: true, zoom: .8 })).toMatchObject({ ok: true });
  expect(runtime.devScenarioPort.startTrain).toHaveBeenCalledOnce();
  train.state.y = 700; controller.afterHostFrame(); controller.syncCamera();
  expect(controller.snapshot()).toMatchObject({ train: { visible: true, fullyVisible: false, speed: 600,
    coordinateSpace: 'world', cameraCenter: { x: 1000, y: 700 }, trackBounds: train.trackBounds } });
});

it('waits for entry, frames the complete train and fixes the camera on the real main blast', () => {
  const { runtime, train } = trainShowcaseFixture();
  controller.startTrainShowcase(true, 1.4);
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
  expect(camera.scrollY + camera.height / 2).toBe(1800);
  train.state.y = 4000; controller.afterHostFrame();
  expect(controller.snapshot()).toMatchObject({ train: { cameraCenter: { x: 1000, y: 1800 } } });
  expect(runtime.devScenarioPort.destroyTrain).toHaveBeenCalledOnce();
});

it('cancels a queued train explosion on stop and refuses unsafe observer positions', () => {
  const { runtime, train } = trainShowcaseFixture();
  controller.startTrainShowcase(); controller.destroyTrain(true); controller.stop();
  train.bounds.top = 100; train.bounds.bottom = 3300;
  controller.afterHostFrame(); expect(runtime.devScenarioPort.destroyTrain).not.toHaveBeenCalled();
  runtime.devScenarioPort.startTrain.mockClear();
  runtime.navigationLabPort.getFreePositions = () => [{ x: 1000, y: 400 }];
  expect(() => controller.startTrainShowcase()).toThrow('Sicherheitsabstand');
  expect(runtime.devScenarioPort.startTrain).not.toHaveBeenCalled();
});
