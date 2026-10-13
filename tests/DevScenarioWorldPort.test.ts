import { describe, expect, it, vi } from 'vitest';
const authority=vi.hoisted(()=>({host:true,isolated:true}));
vi.mock('../src/network/bridge',()=>({bridge:{isHost:()=>authority.host,getConnectedPlayers:()=>[],getLocalPlayerId:()=> 'local',
  isArenaStarted:()=>true, getActivityDescriptor:vi.fn(), getRoundState:vi.fn(),
  getSynchronizedNow:vi.fn(), getArenaStartTime:vi.fn(), setArenaStartTime:vi.fn(),
  setRoundEndTime:vi.fn(), publishRoundState:vi.fn(),
}}));
vi.mock('../src/utils/devScenarioMode',()=>({isDevScenarioMode:()=>authority.isolated}));
vi.mock('phaser', async () => ({
  ...(await import('./fakeArenaRenderScene')).createFakePhaserModule(), Scene: class {},
  Filters: { Displacement: class {}, ParallelFilters: class {} },
}));
import { createDevScenarioWorldPort } from '../src/scenes/arena/ArenaRuntimeAdapters';
import { ArenaLifecycleCoordinator } from '../src/scenes/arena/ArenaLifecycleCoordinator';
import { ArenaRuntime } from '../src/scenes/arena/ArenaRuntime';
import { CoopMissionRuntime } from '../src/activity/CoopMissionRuntime';
import { ArenaTimeOfDayController } from '../src/systems/ArenaTimeOfDayController';
import { getDawnSchedule, getDawnThreatCurve } from '../src/config/dawn/dawnContent';
import { getDawnPhaseStartMs, toDawnDynamicTimeOfDay } from '../src/dawn/rules/DawnPhase';
import { parseTimeOfDay } from '../src/effects/TimeOfDay';
import { bridge } from '../src/network/bridge';

it('reanchors frozen Dawn HUD and authored lighting together without replaying mission systems', () => {
  authority.host = true; authority.isolated = true;
  const schedule = getDawnSchedule(getDawnThreatCurve(1).scheduleId);
  const descriptor = { kind: 'coop-mission', parameters: { dawn: { scheduleId: schedule.id } } } as never;
  const mission = new CoopMissionRuntime(descriptor);
  let now = 1_000_000, start = now;
  vi.mocked(bridge.getSynchronizedNow).mockImplementation(() => now);
  vi.mocked(bridge.getArenaStartTime).mockImplementation(() => start);
  vi.mocked(bridge.setArenaStartTime).mockImplementation(value => { start = value; });
  vi.mocked(bridge.getActivityDescriptor).mockReturnValue(descriptor);
  vi.mocked(bridge.getRoundState).mockReturnValue({ status: 'active', roundStartTime: start } as never);
  const clock = new ArenaTimeOfDayController({ startMinutes: parseTimeOfDay(schedule.phases[0].clock)!,
    roundStartTime: start, dynamic: toDawnDynamicTimeOfDay(schedule) });
  const flow = Object.assign(Object.create(ArenaLifecycleCoordinator.prototype), {
    timeOfDayController: clock,
    worldLifecycle: { bindActivityStartAnchor: vi.fn() },
    resolveRoundEndTime: (anchor: number) => anchor + schedule.durationMs,
    applyRuntimeTimeOfDay: vi.fn(),
  }) as ArenaLifecycleCoordinator;
  Object.defineProperty(flow, 'coopMissionRuntime', { value: mission });
  const requestBake = vi.fn();
  const runtime = Object.assign(Object.create(ArenaRuntime.prototype), {
    flow, requestWorldStaticShadowBake: requestBake,
  }) as ArenaRuntime;
  // Include accumulated pause time: seeking must use the effective mission clock.
  mission.setScenarioOptions(true, true, now); now += 8000;
  mission.setScenarioOptions(false, true, now); now += 2000;
  mission.setScenarioOptions(true, true, now); now += 3000;
  for (const phase of ['night', 'dawn', 'day', 'dusk'] as const) {
    const elapsed = getDawnPhaseStartMs(schedule, phase);
    runtime.seekDevScenarioDawnTime(elapsed);
    expect(mission.getMissionNow(now) - start).toBe(elapsed);
    expect(clock.getCurrentMinutes()).toBe(parseTimeOfDay(schedule.phases.find(p => p.id === phase)!.clock));
    expect(bridge.setRoundEndTime).toHaveBeenLastCalledWith(start + schedule.durationMs);
    expect(bridge.publishRoundState).toHaveBeenLastCalledWith(expect.objectContaining({ roundStartTime: start }));
    expect(mission.analysisScenarioActive).toBe(true);
    expect(mission.scenarioMissionFrozen).toBe(true);
    now += 1000; flow.syncRuntimeTimeOfDay(now);
    expect(mission.getMissionNow(now) - start).toBe(elapsed);
    expect(clock.getCurrentMinutes()).toBe(parseTimeOfDay(schedule.phases.find(p => p.id === phase)!.clock));
  }
  expect(requestBake).toHaveBeenCalledTimes(4);
  expect(requestBake).toHaveBeenLastCalledWith(true);
  const mutations = vi.mocked(bridge.setArenaStartTime).mock.calls.length;
  authority.host = false;
  expect(() => flow.seekDevScenarioDawnTime(0)).toThrow('Isolated dev host');
  authority.host = true; authority.isolated = false;
  expect(() => flow.seekDevScenarioDawnTime(0)).toThrow('Isolated dev host');
  authority.isolated = true;
  expect(() => flow.seekDevScenarioDawnTime(NaN)).toThrow('Invalid mission time');
  expect(bridge.setArenaStartTime).toHaveBeenCalledTimes(mutations);
});

it('spawns pickups only in the isolated host and resolves the current World owner on each command', () => {
  authority.host = true;
  const first = { system: { spawnPickup: vi.fn(() => 12) } }, second = { system: { spawnPickup: vi.fn(() => 13) } };
  let runtime: typeof first | null = first;
  const port = createDevScenarioWorldPort({ getWorldPowerUpRuntime: () => runtime } as never, {} as never);
  expect(port.spawnPowerUp('ARMOR', 100, 200)).toBe(12);
  expect(first.system.spawnPickup).toHaveBeenCalledWith('ARMOR', 100, 200);
  runtime = second;
  expect(port.spawnPowerUp('NUKE', 100, 200)).toBe(13);
  authority.host = false;
  expect(() => port.spawnPowerUp('NUKE', 100, 200)).toThrow('Isolated dev host');
  expect(second.system.spawnPickup).toHaveBeenCalledOnce();
  authority.host = true;
  runtime = null;
  expect(port.spawnPowerUp('NUKE', 100, 200)).toBeNull();
});

describe('isolated scenario rock damage port',()=>{
  it('selects a live destructible grid cell and commits lethal damage through the current world mutation owner',()=>{
    authority.host=true;
    const damage=vi.fn(()=>({kind:'damage-applied',transition:{kind:'destroyed'}}));
    const materialization={arena:{rockGrid:{getIndex:(x:number,y:number)=>y===4&&x>=4&&x<=6?x:-1}},
      rocks:{isIndestructible:(id:number)=>id===4,readIntegrity:(id:number)=>({integrity:id===5?0:75})}};
    const flow={getWorldRuntime:()=>({materialization}),getWorldObjectMutationRuntime:()=>({applyResolvedDamage:damage})};
    const port=createDevScenarioWorldPort(flow as never,{} as never);
    expect(port.findDestructibleRock(4,4)).toMatchObject({id:6,gridX:6,gridY:4});
    expect(port.destroyRock(6)).toBe(true);
    expect(damage).toHaveBeenCalledWith('rock',6,75,'local','dev-scenario.single-rock');
    expect(port.destroyRock(5)).toBe(false);expect(damage).toHaveBeenCalledOnce();
    expect(port.destroyRocksNear(5,4,2)).toEqual([6]);
    expect(damage).toHaveBeenLastCalledWith('rock',6,75,'local','dev-scenario.rock-explosion');
    damage.mockClear();authority.host=false;
    expect(()=>port.destroyRocksNear(5,4,2)).toThrow('Isolated dev host required');
    expect(()=>port.destroyRock(6)).toThrow('Isolated dev host required');
    expect(damage).not.toHaveBeenCalled();authority.host=true;
  });
});
