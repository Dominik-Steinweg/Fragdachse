import { expect, it } from 'vitest';
import { FORMATION_SIDE } from '../src/arena/rocks/RockFormationField';
import { fixture, height } from './RockFormationFieldTestFixture';
// Split from RockFormationField.test.ts by cost so vitest runs it in parallel.

it('raises geometric relief without changing coverage, then restores the exact baseline',()=>{
  const {field,states}=fixture([[3,3],[4,3],[3,4],[4,4]]);
  const base=field.build(0,0),rim={rockRimWidth:9,rockRimHeight:12,rockRimLip:2};
  field.setRimGeometry(rim);const raised=field.build(0,0);let strongerHorizon=0;
  for(let i=0;i<raised.heights.length;i++){
    expect(raised.data[i*4+3]).toBe(base.data[i*4+3]);
    expect(raised.heights[i]).toBeGreaterThanOrEqual(base.heights[i]);
    expect(raised.heights[i]-base.heights[i]).toBeLessThanOrEqual(rim.rockRimHeight+.0001);
    if(!raised.data[i*4+3]&&raised.data[i*4+2]>base.data[i*4+2])strongerHorizon++;
  }
  expect(strongerHorizon).toBeGreaterThan(0);
  const contact=(x:number)=>raised.occlusion[((128/2+1)*FORMATION_SIDE+Math.floor(x/2)+1)*4+3];
  expect(contact(160)).toBeLessThan(contact(164));expect(contact(164)).toBeLessThan(contact(168));expect(contact(172)).toBe(255);
  field.setRimGeometry(null);expect(field.build(0,0)).toEqual(base);
  field.setRimGeometry(rim);states[0].active=false;field.invalidate([0]);const destroyed=field.build(0,0);
  expect(height(destroyed.heights,110,110)).toBe(0);expect(field.coverage(110,110)).toBe(0);
  expect(height(destroyed.heights,134,110)).toBeLessThan(height(raised.heights,134,110));
},30000); // Multiple full-resolution field rebuilds; preserve gutter/horizon coverage in parallel suites.
it('rotates only solar horizons while retaining normals, coverage, height and ambient cavities',()=>{
  const {field}=fixture([[5,5],[6,5],[5,6],[6,6]]),east=field.build(0,0,0),west=field.build(0,0,180);
  expect(east.heights).toEqual(west.heights);
  let eastX=0,eastWeight=0,westX=0,westWeight=0;
  for(let i=0;i<east.data.length;i+=4){
    expect(east.data[i]).toBe(west.data[i]);expect(east.data[i+1]).toBe(west.data[i+1]);expect(east.data[i+3]).toBe(west.data[i+3]);
    expect(east.occlusion[i]).toBe(west.occlusion[i]);expect(east.occlusion[i+3]).toBe(west.occlusion[i+3]);
    if(!east.data[i+3]){const x=(i/4)%FORMATION_SIDE;eastX+=x*east.data[i+2];eastWeight+=east.data[i+2];westX+=x*west.data[i+2];westWeight+=west.data[i+2];}
  }
  expect(eastWeight).toBeGreaterThan(0);expect(westWeight).toBeGreaterThan(0);expect(eastX/eastWeight).toBeLessThan(westX/westWeight);
  expect(field.build(0,0).data).toEqual(field.build(0,0,135).data);
},30000); // Multiple full-resolution field rebuilds; preserve gutter/horizon coverage in parallel suites.
