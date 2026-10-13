import { expect, it } from 'vitest';
import { FORMATION_SIDE } from '../src/arena/rocks/RockFormationField';
import { fixture } from './RockFormationFieldTestFixture';
// Split from RockFormationField.test.ts by cost so vitest runs it in parallel.

it('keeps incremental geometry byte-identical to full builds across explosions, gutters, holes and sun/quality changes',()=>{
  const cells:[number,number][]=[];for(let y=12;y<21;y++)for(let x=12;x<21;x++)cells.push([x,y]);
  const detail=Float32Array.from({length:65536},(_,i)=>Math.sin(i%256*.1)*Math.cos(Math.floor(i/256)*.1));
  const {field,states}=fixture(cells,detail,[[510,510],[511,510],[510,511],[511,511]]);
  field.setRimGeometry({rockRimWidth:14,rockRimHeight:12,rockRimLip:2});
  for(let cy=0;cy<2;cy++)for(let cx=0;cx<2;cx++)field.buildCached(cx,cy);
  for(const [gx,gy,angle,solar] of [[16,16,135,true],[17,15,135,true],[13,14,35,false]] as const) {
    const ids:number[]=[];
    for(const s of states)if(s.active&&Math.hypot(s.gridX-gx,s.gridY-gy)<=2.5){s.active=false;ids.push(s.id);}
    field.invalidate(ids);
    let shaded=0;
    for(let cy=0;cy<2;cy++)for(let cx=0;cx<2;cx++) {
      const actual=field.buildCached(cx,cy,angle,solar);shaded+=field.lastBuild.shadedTexels;
      const expected=field.build(cx,cy,angle,solar);
      for(const channel of ['data','occlusion','heights'] as const)
        expect(Buffer.from(actual[channel].buffer).equals(Buffer.from(expected[channel].buffer)),channel).toBe(true);
    }
    if(angle===135)expect(shaded).toBeLessThan(4*FORMATION_SIDE**2);
  }
  // An unchanged rebuild reuses every ray result, with identical bytes.
  const before=field.buildCached(0,0,35,false),again=field.buildCached(0,0,35,false);
  expect(field.lastBuild.shadedTexels).toBe(0);
  expect(Buffer.from(before.data).equals(Buffer.from(again.data))).toBe(true);
},60000);

it('keeps rim normals, contact and horizon bytes identical in adjacent chunk gutters',()=>{
  const cells:[number,number][]=[];for(let y=6;y<12;y++)for(let x=12;x<21;x++)cells.push([x,y]);
  const {field}=fixture(cells);field.setRimGeometry({rockRimWidth:11,rockRimHeight:14,rockRimLip:3});
  const a=field.build(0,0),b=field.build(1,0);let differences=0;
  for(let y=0;y<FORMATION_SIDE;y++)for(let x=0;x<2;x++)for(let c=0;c<4;c++){
    const i=(y*FORMATION_SIDE+FORMATION_SIDE-2+x)*4+c,j=(y*FORMATION_SIDE+x)*4+c;
    if(a.data[i]!==b.data[j]||a.occlusion[i]!==b.occlusion[j])differences++;
  }
  expect(differences).toBe(0);
});

