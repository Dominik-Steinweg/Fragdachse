import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser',()=>({}));
import { PlasmaBurnerTargetCatalog } from '../src/world/PlasmaBurnerTargetCatalog';
import { CELL_SIZE } from '../src/config';
describe('World plasma target catalog',()=>{
  it('reads current vitals and nearest surfaces, canonicalizes rock identities and bounds construction queries by cells',()=>{
    const rock={id:7,gridX:2,gridY:1,kind:'turret',ownerId:'owner'};
    const hp={integrity:12,maxIntegrity:40,destroyed:false};
    const placement={getRuntimeRock:()=>rock,readIntegrity:()=>hp,
      getRuntimeRockAt:vi.fn((x,y)=>x===2&&y===1?rock:undefined)};
    const surface=vi.fn(()=>({x:220,y:160,distance:20}));
    const base={getNearestSurfacePoint:surface,getHp:()=>50,getMaxHp:()=>100,isInert:()=>false,faction:'friendly',id:'b'};
    const catalog=new PlasmaBurnerTargetCatalog({placement,players:{getPlayer:()=>({x:40,y:30}),getAllPlayers:()=>[]},
      enemies:()=>null,decoys:{getHostTargets:()=>[]},bases:{getBase:()=>base,getBases:()=>[base]},metrics:{offsetX:10,offsetY:20},
      combat:{getHP:()=>23,getMaxHp:()=>100,isAlive:()=>true,isPlayerTargetable:()=>true,canDamageTarget:()=>false,
        canSupportPlasmaBurnerTarget:()=>true,captureWorldDamageSource:()=>({}),canDamageStructure:()=>false}} as never);
    expect(catalog.read('player:owner','owner',0,0)).toMatchObject({x:40,y:30,hp:23,self:true});
    expect(catalog.read('rock:7','owner',0,0)).toMatchObject({key:'construction:7',x:10+2*CELL_SIZE,y:20+CELL_SIZE,hp:12});
    expect(catalog.read('base:b','owner',200,160)).toMatchObject({x:220,y:160,hp:50});expect(surface).toHaveBeenCalledWith(200,160);
    const targets=catalog.query('owner',10+2*CELL_SIZE,20+CELL_SIZE,10);
    expect(targets.some(t=>t.key==='construction:7')).toBe(true);expect(placement.getRuntimeRockAt.mock.calls.length).toBeLessThanOrEqual(4);
    hp.integrity=40;expect(catalog.query('owner',10+2*CELL_SIZE,20+CELL_SIZE,10)).toEqual([]);
    rock.kind='pedestal';hp.integrity=20;expect(catalog.read('rock:7','owner',0,0)?.automatic).toBe(false);
  });
});
