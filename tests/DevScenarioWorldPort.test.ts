import { describe, expect, it, vi } from 'vitest';
const authority=vi.hoisted(()=>({host:true}));
vi.mock('../src/network/bridge',()=>({bridge:{isHost:()=>authority.host,getConnectedPlayers:()=>[],getLocalPlayerId:()=> 'local'}}));
vi.mock('../src/utils/devScenarioMode',()=>({isDevScenarioMode:()=>true}));
import { createDevScenarioWorldPort } from '../src/scenes/arena/ArenaRuntimeAdapters';

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
