import { describe, expect, it, vi } from 'vitest';

it('validates fog-rock optical controls and lobby time before renderDebug dispatch',()=>{
  const setRenderDebug=vi.fn(),controller={setRenderDebug,syncPanel(){}} as never;
  for(const key of ['fogRockContactStrength','fogRockSunShadowStrength','rockAerialPerspectiveStrength'])for(const value of [-1,1,NaN,Infinity,'0.2',null])
    expect(()=>runScenarioCommand(controller,{action:'renderDebug',disable:[],[key]:value})).toThrow();
  for(const value of [-1,1440,NaN,'480'])expect(()=>runScenarioCommand(controller,{action:'renderDebug',disable:[],lobbyTimeOfDay:value})).toThrow();
  for(const value of ['true',1,null])expect(()=>runScenarioCommand(controller,{action:'renderDebug',rockAerialPerspective:value})).toThrow();
  expect(setRenderDebug).not.toHaveBeenCalled();
  runScenarioCommand(controller,{action:'renderDebug',disable:[],rockAerialPerspective:true,rockAerialPerspectiveStrength:.3});
  expect(setRenderDebug).toHaveBeenLastCalledWith([],'normal',false,false,'material',expect.objectContaining({rockAerialPerspective:true,rockAerialPerspectiveStrength:.3}));
  runScenarioCommand(controller,{action:'renderDebug',disable:['fogRockContact'],fogRockSunShadowStrength:.15,lobbyTimeOfDay:480});
  expect(setRenderDebug).toHaveBeenLastCalledWith(['fogRockContact'],'normal',false,false,'material',
    {fogRockContactStrength:undefined,fogRockSunShadowStrength:.15,lobbyTimeOfDay:480});
});

it('validates targeted pickup commands and forwards authored IDs and optional grid coordinates', () => {
  const spawnPowerUp = vi.fn(), controller = { spawnPowerUp, syncPanel() {} } as never;
  runScenarioCommand(controller, { action: 'spawnPowerUp', id: 'HEALTH_PACK', gridX: 24, gridY: 24 });
  expect(spawnPowerUp).toHaveBeenLastCalledWith('HEALTH_PACK', { gridX: 24, gridY: 24 });
  runScenarioCommand(controller, { action: 'spawnPowerUp', id: 'NUKE' });
  expect(spawnPowerUp).toHaveBeenLastCalledWith('NUKE', undefined);
  for (const id of ['typo', 'constructor', 'DECOY_STEALTH']) {
    expect(() => runScenarioCommand(controller, { action: 'spawnPowerUp', id })).toThrow();
  }
  expect(() => runScenarioCommand(controller, { action: 'spawnPowerUp', id: 'ARMOR', gridX: NaN, gridY: 0 })).toThrow();
  expect(spawnPowerUp).toHaveBeenCalledTimes(2);
});
import { COOP_DEFENSE_CLASS_IDS } from '../src/config/coopDefenseClasses';
import { COOP_DEFENSE_UPGRADE_DEFINITIONS, isCoopDefenseUpgradeAvailableForClass } from '../src/utils/coopDefenseUpgrades';
import { buildScenarioProfile, defaultScenario, parseScenario, scenarioLoadout, encodeScenario, decodeScenario } from '../src/dev/scenario/config';
import { createMemoryStorage } from '../src/dev/scenario/memoryStorage';
import { ScenarioClock } from '../src/dev/scenario/clock';
import { visualTest } from '../src/dev/scenario/visualTest';

describe('Dev scenario contract', () => {
  it('loads old recipes with visual-review defaults and validates explicit overrides', () => {
    const old = { version: 1, classId: 'dachs_nukem', mapId: '1' };
    expect(parseScenario(old)).toMatchObject({ freezeMission: true, hideTutorial: true });
    expect(parseScenario({ ...old, freezeMission: false, hideTutorial: false })).toMatchObject({ freezeMission: false, hideTutorial: false });
    expect(() => parseScenario({ ...old, freezeMission: 'yes' })).toThrow();
    expect(parseScenario(old)).toMatchObject({ bots: [], playerFreeForAll: false });
  });
  it('validates scripted bots against the scenario class', () => {
    const config = defaultScenario('dachs_nukem');
    const parsed = parseScenario({ ...config, bots: [{ name: 'Kalle', weapon1: 'PLASMA' }], playerFreeForAll: true });
    expect(parsed.bots).toEqual([{ name: 'Kalle', weapon1: 'PLASMA', weapon2: config.weapon2, player: null }]);
    expect(parsed.playerFreeForAll).toBe(true);
    expect(() => parseScenario({ ...config, bots: [{ weapon2: 'missing' }] })).toThrow();
    expect(() => parseScenario({ ...config, bots: [{ typo: true }] })).toThrow();
    expect(() => parseScenario({ ...config, bots: Array.from({ length: 12 }, () => ({})) })).toThrow();
  });
  it.each(COOP_DEFENSE_CLASS_IDS)('round-trips a complete %s loadout without real progression', classId => {
    const config = defaultScenario(classId);
    expect(decodeScenario(encodeScenario(config))).toEqual(config);
    const commit = scenarioLoadout(config);
    expect(commit.coopDefenseClassId).toBe(classId);
    expect(commit.weapon2).toBe(config.weapon2);
    expect(commit.tools).toEqual(config.tools);
  });
  it('includes prerequisites and rejects impossible tuning instead of silently clamping', () => {
    const classId = 'inspector_gadachs';
    const definition = Object.values(COOP_DEFENSE_UPGRADE_DEFINITIONS).find(value => value.kind === 'upgrade'
      && value.requires.length > 0 && isCoopDefenseUpgradeAvailableForClass(value.id, classId))!;
    const profile = buildScenarioProfile(classId, { [definition.id]: definition.maxLevel }, []);
    expect(profile.upgrades[definition.id].level).toBe(definition.maxLevel);
    for (const requirement of definition.requires) expect(profile.upgrades[requirement.upgradeId].level).toBeGreaterThanOrEqual(requirement.minLevel);
    expect(() => buildScenarioProfile(classId, { [definition.id]: definition.maxLevel + 1 }, [])).toThrow();
    expect(() => buildScenarioProfile(classId, { missing_upgrade: 1 }, [])).toThrow();
  });
  it('rejects unknown schema, maps, equipment, geometry and corrupted items', () => {
    const config = defaultScenario();
    for (const change of [{ version: 2 }, { mapId: 'missing' }, { weapon2: 'missing' }, { typo: true },
      { player: { gridX: NaN, gridY: 1 } }, { items: [{ uid: 'invalid' }] }, { seed: 1.25 }]) {
      expect(() => parseScenario({ ...config, ...change })).toThrow();
    }
  });
  it('keeps storage instances isolated', () => {
    const first = createMemoryStorage(), second = createMemoryStorage();
    first.setItem('progress', 'scenario');
    expect(second.getItem('progress')).toBeNull();
    first.clear(); expect(first.length).toBe(0);
  });
  it('freezes gameplay time, advances exact steps and restores the clock owner', () => {
    const realNow = Date.now;
    const deltas: number[] = [];
    const original = (_time: number, delta: number) => { deltas.push(delta); };
    const loop = { callback: original };
    const clock = new ScenarioClock(loop);
    try {
      clock.paused = true; const pausedAt = Date.now();
      loop.callback(1000, 16); expect(Date.now()).toBe(pausedAt); expect(deltas).toEqual([]);
      clock.step(2); loop.callback(1016, 99); loop.callback(1032, 99); loop.callback(1048, 99);
      expect(deltas).toHaveLength(2); expect(Date.now() - pausedAt).toBe(Math.floor(1000 / 30));
      expect(Number.isSafeInteger(Date.now())).toBe(true);
      clock.paused = false; clock.speed = 0.25; loop.callback(1064, 16);
      expect(deltas[2]).toBe(4);
    } finally { clock.destroy(); }
    expect(Date.now).toBe(realNow); expect(loop.callback).toBe(original);
  });
  it('settles asynchronous rendering without aging effects or consuming queued simulation steps', () => {
    const deltas: number[] = [];
    const loop = { callback: (_time: number, delta: number) => { deltas.push(delta); } };
    const clock = new ScenarioClock(loop);
    try {
      clock.settle(2);
      const before = Date.now();
      expect(() => clock.settle(1)).toThrow(/pending/);
      loop.callback(1000, 80); loop.callback(1100, 100); loop.callback(1200, 100);
      expect(deltas).toEqual([0, 0]); expect(clock.pendingSteps).toBe(0);
      expect(Date.now()).toBe(before);
      clock.step(1); loop.callback(1300, 100);
      expect(deltas[2]).toBe(1000 / 60); expect(clock.now).toBe(1000 / 60);
    } finally { clock.destroy(); }
  });
  it('gives effect frames the same random sequence regardless of loading duration', () => {
    const previous = { ...visualTest };
    try {
      visualTest.enabled = true;
      for (const loadingFrames of [2, 37]) {
        const seeds: number[] = [];
        visualTest.reseed = frame => { seeds.push(frame); };
        const loop = { callback(_time: number, _delta: number) {} };
        const clock = new ScenarioClock(loop);
        try {
          clock.holdLoadingTime = () => false;
          for (let i = 0; i < loadingFrames; i++) loop.callback(1000, 20);
          clock.preparing = false;
          clock.step(2); loop.callback(2000, 99); loop.callback(2100, 99);
          clock.settle(2); loop.callback(2200, 99); loop.callback(2300, 99);
          expect(seeds.slice(-4)).toEqual([1, 2, 2, 2]);
        } finally { clock.destroy(); }
      }
    } finally { Object.assign(visualTest, previous); }
  });
});

it('rejects saved comparison options with an explicit migration hint',()=>{
 expect(()=>parseScenario({...defaultScenario(),worldLighting:{}})).toThrow(/Lichtvergleichs-Optionen.*Standard/);
});

import { CameraPostFxController } from '../src/effects/postfx/CameraPostFxController';
import { NEUTRAL_WORLD_GRADE } from '../src/effects/postfx/worldGrade';
import { GraphicsQualityController } from '../src/graphics/GraphicsQuality';
import { runScenarioCommand } from '../src/dev/scenario/api';
const fxMock = vi.hoisted(() => {
  const matrix = () => ({ active: true, colorMatrix: {
    reset() {}, brightness() {}, saturate() {}, contrast() {}, multiply() {},
  } });
  class Parallel {
    active = false;
    blend = { blendMode: 0, amount: 0 };
    top = { addThreshold: () => ({ setEdge() {} }), addBlur: () => ({ active: true }),
      addColorMatrix: matrix, addMask: () => ({ active: true }) };
    setEffectActive(value: boolean) { this.active = value; }
    setActive(value: boolean) { this.active = value; return this; }
  }
  return { matrix, Parallel };
});
vi.mock('phaser', () => ({ BlendModes: { NORMAL: 0, ADD: 1 }, Filters: { Displacement: class {
  active = false;
  setActive(value: boolean) { this.active = value; return this; }
  setPaddingOverride() {}
  setTexture() {}
} } }));
vi.mock('../src/effects/postfx/RadialFocusFilter', () => ({
  RadialFocusParallelFilters: fxMock.Parallel,
  RadialFocusMaskTexture: class { textureKey = 'mask'; update() {} destroy() {} },
}));
function fxFixture() {
  const list = { add: (filter: unknown) => filter, addParallelFilters: () => new fxMock.Parallel(),
    addColorMatrix: fxMock.matrix, addVignette: () => ({ active: false }), addBarrel: () => ({ active: false }) };
  const camera = { width: 1664, height: 936, filters: { internal: list } };
  const scene = { time: { now: 0 }, scale: { width: 1664 }, add: { particles() {} } };
  const quality = new GraphicsQualityController(); quality.attach(scene as never);
  const controller = new CameraPostFxController(scene as never, camera as never);
  controller.setBaseGrade({ ...NEUTRAL_WORLD_GRADE, brightness: .9, bloomAmount: .2, vignetteStrength: .1 });
  controller.update(0);
  return { controller, quality };
}
describe('camera pass diagnostics', () => {
  it('disables selected passes through frame/quality updates and restores the normal resolver', () => {
    const { controller, quality } = fxFixture();
    const active = (name: string) => controller.getDebugPasses().find(p => p.name === name)!.active;
    expect(active('grade')).toBe(true);
    controller.setDebugDisabled(['grade', 'distortion']);
    controller.setDistortion('map', .1); controller.update(16);
    quality.setLevel('low'); quality.setLevel('high');
    expect(active('grade')).toBe(false); expect(active('distortion')).toBe(false);
    expect(active('bloom')).toBe(true);
    controller.setDebugDisabled([]); controller.setDistortion('map', .1);
    expect(active('grade')).toBe(true); expect(active('distortion')).toBe(true);
    controller.destroy();
  });
  it('rejects unknown names atomically and clears diagnostics at reset', () => {
    const { controller } = fxFixture(); controller.setDebugDisabled(['grade']);
    expect(() => controller.setDebugDisabled(['bloom', 'typo'])).toThrow('Unknown camera pass');
    expect(controller.getDebugPasses().filter(p => p.disabled).map(p => p.name)).toEqual(['grade']);
    controller.reset(); expect(controller.getDebugPasses().some(p => p.disabled)).toBe(false);
    controller.destroy();
  });
  it('validates the script action before dispatch', () => {
    const setRenderDebug = vi.fn(); const controller = { setRenderDebug, syncPanel() {} } as never;
    for (const disable of [null, 'grade', [2], undefined]) {
      expect(() => runScenarioCommand(controller, { action: 'renderDebug', disable })).toThrow();
    }
    runScenarioCommand(controller, { action: 'renderDebug', disable: ['grade'] });
    expect(setRenderDebug).toHaveBeenCalledExactlyOnceWith(['grade']);
    runScenarioCommand(controller,{action:'renderDebug',disable:[],characterShadowSolid:true});
    expect(setRenderDebug).toHaveBeenLastCalledWith([],'normal',false,true);
    expect(()=>runScenarioCommand(controller,{action:'renderDebug',disable:[],characterShadowSolid:'yes'})).toThrow();
  });
});

it('accepts the registry spore repro loadout and exact enemy key through the public API',()=>{
 const config=parseScenario({version:1,classId:'inspector_gadachs',mapId:'7',seed:12345,
   tools:[{kind:'construction',id:'spore_turret'}],player:{gridX:98,gridY:26},
   constructions:[{id:'spore_turret',gridX:102,gridY:25}],
   enemies:[{kind:'zombie-badger',pinned:true,hp:10000000,gridX:106,gridY:25}]});
 expect(scenarioLoadout(config).tools).toEqual(config.tools);
 const spawn=vi.fn(),setRenderDebug=vi.fn(),controller={spawn,setRenderDebug,syncPanel(){}} as never;
 runScenarioCommand(controller,{action:'spawn',...config.enemies[0]});
 expect(spawn).toHaveBeenCalledWith('zombie-badger',true,10000000,{gridX:106,gridY:25});
 for(const composite of ['normal','material','neutral','neutralInline']){
  runScenarioCommand(controller,{action:'renderDebug',disable:['sunComposite','fogDisplay','lightmap'],composite});
  expect(setRenderDebug).toHaveBeenLastCalledWith(['sunComposite','fogDisplay','lightmap'],composite);
 }
 runScenarioCommand(controller,{action:'renderDebug',disable:[],probe:true});
 expect(setRenderDebug).toHaveBeenLastCalledWith([],'normal',true);
 expect(()=>runScenarioCommand(controller,{action:'renderDebug',disable:[],probe:'yes'})).toThrow();
 expect(()=>runScenarioCommand(controller,{action:'renderDebug',disable:[],composite:'typo'})).toThrow();
});
