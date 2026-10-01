import {describe,it,expect} from 'vitest';
import {RockGroundEstimate} from '../src/arena/rocks/RockGroundEstimate';
import type {FormationRock} from '../src/arena/rocks/RockFormationField';
function fixture(){const rocks:FormationRock[]=[];for(let y=0;y<32;y++)for(let x=0;x<32;x++)rocks.push({id:rocks.length,gridX:x,gridY:y,active:true,frame:0} as FormationRock);return {rocks,estimate:new RockGroundEstimate(1024,1024,rocks),out:new Float64Array(5)};}
describe('immediate ground horizons',()=>{
 it('shadows an enclosed fresh hole before any worker reply',()=>{const {rocks,estimate,out}=fixture();rocks[4*32+4].active=false;
  for(const azimuth of [0,45,90,135,270]){estimate.sample(out,144,144,azimuth);expect(out[0]).toBeGreaterThan(.85);expect(out[3]).toBeLessThan(.4);}
 });
 it('uses the whole explosion footprint, including across chunk boundaries',()=>{const {rocks,estimate,out}=fixture();
  for(let y=14;y<=17;y++)for(let x=14;x<=17;x++)rocks[y*32+x].active=false;
  const values=[];for(const x of [479,481,511,513,543,545]){estimate.sample(out,x,512,0);values.push([...out]);}
  expect(values.every(v=>v[4]===1)).toBe(true);
  expect(Math.abs(values[2][0]-values[3][0])).toBeLessThan(.03);
  expect(Math.abs(values[0][0]-values[1][0])).toBeLessThan(.03);
  estimate.sample(out,513,512,0);expect([...out]).toEqual(values[3]);
 });
 it('does not invent a pit after a whole formation is removed',()=>{const {rocks,estimate,out}=fixture();for(const r of rocks)r.active=false;
  estimate.sample(out,512,512,135);expect([...out]).toEqual([0,0,0,1,1]);
 });
});

it('feeds dark ground response immediately at the reported daytime, independent of asynchronous completion',async()=>{
 const {formationSurfaceColour}=await import('../src/arena/rocks/rockFormationShader');
 const {resolveSunPath,createSunPath}=await import('../src/effects/sunlight/SunPath');
 const {createSunTuning}=await import('../src/effects/sunlight/SunAtmosphere');
 const {rocks,estimate,out}=fixture();rocks[4*32+4].active=false;
 const path=resolveSunPath(600,null,createSunPath());estimate.sample(out,144,144,path.azimuth,36);
 const rgb=formationSurfaceColour(0,0,out[0],{enabled:true,normals:false,strength:1,sun:path.sun,mineralResponse:true,
  clouds:{tuning:createSunTuning(),timeSec:0,strength:1,sunPath:path}},[out[3],out[1],out[2],out[4]],true);
 expect(Math.max(...rgb)).toBeLessThan(.6);
});
