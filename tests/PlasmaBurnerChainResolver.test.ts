import { describe, expect, it } from 'vitest';
import { resolvePlasmaBurnerChain } from '../src/combat/plasmaBurner/PlasmaBurnerChainResolver';
import { target } from './PlasmaBurnerTestFixture';
describe('PlasmaBurnerChainResolver',()=>{
  const p=target('p',0),a=target('a',30),b=target('b',60),near=target('near',5);
  const resolve=(previous:string[],pool=[a,b,near],maxJumps=4,visible=()=>true)=>resolvePlasmaBurnerChain({
    primary:p,previous,maxJumps,radius:40,read:key=>pool.find(t=>t.key===key)??null,candidates:()=>[p,...pool],visible,
  });
  it('keeps a valid ordered prefix despite a closer newcomer and never visits twice',()=>{
    expect(resolve([a.key,b.key]).map(t=>t.id)).toEqual(['a','b']);
    expect(resolve([], [a,b],1).map(t=>t.id)).toEqual(['a']);
  });
  it('rebuilds from the first invalid member using deterministic nearest choice',()=>{
    expect(resolve([a.key,b.key],[{...a,alive:false},near,b]).map(t=>t.id)).toEqual(['near']);
    expect(resolve([],[target('z',10),target('a',10)],1).map(t=>t.id)).toEqual(['a']);
    expect(resolve([], [a],4,()=>false)).toEqual([]);
  });
  it('uses a healthy directly targeted ally as start and permits injured self as secondary',()=>{
    const self=target('self',20,{self:true,damageable:false,supportable:true});
    expect(resolvePlasmaBurnerChain({primary:{...p,hp:100,damageable:false,supportable:true}, previous:[],
      maxJumps:2,radius:90,read:()=>null,candidates:()=>[self,{...a,hp:100,damageable:false,supportable:true}],visible:()=>true})).toEqual([self]);
  });
});
