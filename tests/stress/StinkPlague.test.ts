import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({
  Math: { Clamp: (value:number,min:number,max:number)=>Math.min(max,Math.max(min,value)),
    Distance: { Squared: (a:number,b:number,c:number,d:number)=>(a-c)**2+(b-d)**2 } },
}));
import { plagueHarness, plagueSource, plagueTarget } from '../StinkPlagueTestHelper';
import { SlimeTrailSystem } from '../../src/systems/SlimeTrailSystem';
import { getSlimeTrailBaseline } from '../../src/loadout/SlimeTrailConfig';

describe('plague horde processing', () => {
  it('processes 600 targets, multiple owners and every death with one shared damage tick per target', () => {
    const { runtime, damage } = plagueHarness();
    const targets = Array.from({ length: 600 }, (_, i) => plagueTarget('e'+i, i % 30 * 45, Math.floor(i / 30)*45));
    for (const target of targets) for (let owner=0; owner<4; owner++) {
      runtime.applyDirect(target, plagueSource('p'+owner, { damagePerTick: owner + 1, deathChunkCount: owner, pandemicEnabled: 1 }), 0);
    }
    runtime.advance(targets, 500); runtime.spread(targets, 500);
    expect(runtime.getSnapshot(500).targets).toHaveLength(targets.length);
    expect(damage).toHaveBeenCalledTimes(targets.length);
    expect(damage.mock.calls.every(([,source]) => source.ownerId === 'p3')).toBe(true);
    let chunks=0;
    for(const target of targets) { chunks += runtime.consumeDeath(target.ref, 500)?.count ?? 0; expect(runtime.consumeDeath(target.ref, 500)).toBeNull(); }
    expect(chunks).toBe(targets.length*3); expect(runtime.getSnapshot(500).targets).toEqual([]);
  });
  it('uses local buckets to infect every nearby target without full pair scans', () => {
    const { runtime, canReach, canTransfer } = plagueHarness();
    const targets = Array.from({ length: 600 }, (_, i) => plagueTarget('e'+i, Math.floor(i/2)*1000 + i%2*50));
    for(let i=0;i<targets.length;i+=2) runtime.applyDirect(targets[i], plagueSource('p'+(i%4), { pandemicEnabled: 1 }), 0);
    runtime.spread(targets, 0);
    expect(runtime.getSnapshot(0).targets).toHaveLength(targets.length);
    expect(canReach.mock.calls.length + canTransfer.mock.calls.length).toBeLessThan(targets.length * 4);
  });

  it('leaves and expires trails for every carrier in a 600-enemy horde without duplicating owner contributions', () => {
    const { runtime } = plagueHarness(), baseline = getSlimeTrailBaseline();
    const size = baseline.cellSize;
    const targets = Array.from({ length: 600 }, (_, i) => plagueTarget('e'+i, (i%30*4+.5)*size, (Math.floor(i/30)*4+.5)*size));
    const entities = new Map(targets.map(target => [String(target.ref.id), {
      id:String(target.ref.id),sprite:{active:true,x:target.x,y:target.y},positionRevision:0,
      getHp:()=>1000,isBurrowed:()=>false,getCollisionRadius:()=>target.radius,
    }]));
    const refs = new Map(targets.map(target => [String(target.ref.id),target.ref]));
    const manager = {getHostileEnemies:()=>[...entities.values()],getAllEnemies:()=>[...entities.values()],
      getEnemy:(id:string)=>entities.get(id),getCombatTargetRef:(id:string)=>refs.get(id),hasEnemy:(id:string)=>entities.has(id)};
    const source = plagueSource('p1',{pandemicEnabled:1});
    for (const target of targets) for (let owner=0;owner<4;owner++) runtime.applyDirect(target,{...source,ownerId:'p'+owner},0);
    const damage=vi.fn();
    const slime = new SlimeTrailSystem({getAllPlayers:()=>[]} as never,manager as never,{applyDamage:damage} as never,(_id,_stat,base)=>base,()=>false);
    slime.setPlagueSource({getOwner:(ref,now)=>runtime.getSlimeTrailOwner(ref,now),isPursuing:()=>false});
    try {
      expect(slime.hostUpdate(0).cells).toHaveLength(targets.length);
      for (const entity of entities.values()) entity.sprite.x+=size;
      expect(slime.hostUpdate(1).cells).toHaveLength(targets.length*2);
      const tick=baseline.tickIntervalMs;
      slime.hostUpdate(tick);
      expect(damage).toHaveBeenCalledTimes(targets.length);
      expect(damage.mock.calls.every(call=>call[1]===baseline.damagePerTick&&call[3]==='p0')).toBe(true);
      const end=source.config.directDurationMs+baseline.lingerDurationMs+baseline.effectDurationMs;
      const final=slime.hostUpdate(end);
      expect(final).toEqual({cells:[],affectedEnemies:[]});
      // Reused IDs cannot inherit either the infection or an old trail segment.
      for (const [id,ref] of refs) refs.set(id,{...ref,instance:{entityGeneration:ref.instance.entityGeneration+1}});
      expect(slime.hostUpdate(end+1).cells).toEqual([]);
    } finally {slime.setPlagueSource(null);slime.clear();runtime.clear();}
  });
});
