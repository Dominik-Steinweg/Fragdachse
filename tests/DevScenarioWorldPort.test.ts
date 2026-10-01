import { describe, expect, it, vi } from 'vitest';
const authority=vi.hoisted(()=>({host:true}));
vi.mock('../src/network/bridge',()=>({bridge:{isHost:()=>authority.host,getConnectedPlayers:()=>[],getLocalPlayerId:()=> 'local'}}));
vi.mock('../src/utils/devScenarioMode',()=>({isDevScenarioMode:()=>true}));
import { createDevScenarioWorldPort } from '../src/scenes/arena/ArenaRuntimeAdapters';

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
    authority.host=false;
    expect(()=>port.destroyRock(6)).toThrow('Isolated dev host required');
    expect(damage).toHaveBeenCalledOnce();authority.host=true;
  });
});
