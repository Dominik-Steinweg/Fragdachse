import { describe, expect, it } from 'vitest';
import { plasmaBurnerTargetEffect } from '../src/combat/plasmaBurner/PlasmaBurnerTargetPolicy';
import { target } from './PlasmaBurnerTestFixture';
describe('PlasmaBurnerTargetPolicy matrix', () => {
  it.each(['player','enemy','decoy','construction','base'] as const)('damages hostile %s directly and automatically', kind => {
    const t=target('a',10,{kind});expect(plasmaBurnerTargetEffect(t,'direct')).toBe('damage');expect(plasmaBurnerTargetEffect(t,'automatic')).toBe('damage');
  });
  it.each(['player','construction','base'] as const)('heals injured friendly %s but never automatically selects a full one',kind=>{
    const t=target('a',10,{kind,damageable:false,supportable:true});
    expect(plasmaBurnerTargetEffect(t,'automatic')).toBe('heal');t.hp=100;
    expect(plasmaBurnerTargetEffect(t,'automatic')).toBeNull();expect(plasmaBurnerTargetEffect(t,'direct')).toBe('heal');
  });
  it('excludes necromantic enemies, friendly decoys, corpses and environment from automatic contact',()=>{
    for(const kind of ['enemy','decoy'] as const)expect(plasmaBurnerTargetEffect(target('a',10,{kind,damageable:false,supportable:true}),'direct')).toBeNull();
    expect(plasmaBurnerTargetEffect(target('a',10,{alive:false}),'direct')).toBeNull();
    const rock=target('0',10,{kind:'rock',category:'environment',automatic:false});
    expect(plasmaBurnerTargetEffect(rock,'direct')).toBe('damage');expect(plasmaBurnerTargetEffect(rock,'automatic')).toBeNull();
  });
  it('allows secondary self-healing and direct-only socket/tunnel repair',()=>{
    const self=target('self',0,{self:true,damageable:false,supportable:true});
    expect(plasmaBurnerTargetEffect(self,'direct')).toBeNull();expect(plasmaBurnerTargetEffect(self,'automatic')).toBe('heal');
    const socket=target('s',10,{kind:'construction',automatic:false,damageable:false,supportable:true});
    expect(plasmaBurnerTargetEffect(socket,'direct')).toBe('heal');expect(plasmaBurnerTargetEffect(socket,'automatic')).toBeNull();
  });
});
