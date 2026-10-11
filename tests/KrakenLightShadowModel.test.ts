import { describe, expect, it } from 'vitest';
import { decodeKrakenOctNormal, krakenMeshMatrix, krakenProjectedBounds, type KrakenShadowMesh } from '../src/effects/kraken/KrakenLightShadowModel';
import { krakenResidencyPlan } from '../src/effects/kraken/KrakenResidencyPlan';

describe('Kraken pilot spatial contracts', () => {
  it('decodes both hemispheres and diagonal normals without a positive-Z assumption', () => {
    for (const [encoded, normal] of [ [[.5,.5],[0,0,1]], [[1,1],[0,0,-1]], [[1,.5],[1,0,0]],
      [[.5,0],[0,-1,0]], [[2/3,2/3],[1,1,1].map(v=>v/Math.sqrt(3))] ]) {
      const result=decodeKrakenOctNormal(encoded[0],encoded[1]);
      normal.forEach((v,i)=>expect(result[i]).toBeCloseTo(v,6));
    }
  });
  it('keeps scale tied to the logical canvas across pivots, flips and rotation', () => {
    const m=new Float32Array(16);
    krakenMeshMatrix({x:100,y:200,displayWidth:768,displayHeight:384,originX:.25,originY:.5,
      rotation:Math.PI/2,flipX:true,flipY:false},384,m);
    expect(m[0]).toBeCloseTo(0);expect(m[1]).toBeCloseTo(-2);expect(m[4]).toBeCloseTo(-1);
    expect(m[12]).toBeCloseTo(100);expect(m[13]).toBeCloseTo(392);expect(m[10]).toBeCloseTo(Math.sqrt(2));
  });
  it('bounds a high tentacle shadow even when its sprite is outside the viewport', () => {
    const mesh:KrakenShadowMesh={id:'high',positions:new Float32Array(),indices:new Uint16Array(),bounds:{min:[-20,-10,-100],max:[20,10,258]}};
    const m=new Float32Array(16);krakenMeshMatrix({x:800,y:100,displayWidth:448,displayHeight:448,originX:.5,originY:.5,
      rotation:0,flipX:false,flipY:false},448,m);
    const e=28*Math.PI/180,b=krakenProjectedBounds(mesh,m,[Math.cos(e),0,Math.sin(e)],4);
    expect(b[0]).toBeCloseTo(780-258/Math.tan(e)-4);expect(b[0]+b[2]).toBeCloseTo(824);
    expect(b[1]).toBeCloseTo(86);expect(b[3]).toBeCloseTo(28);
  });
  it('releases intro/ashore clips between phases and only opts into full land prefetch', () => {
    const plan=(phase:Parameters<typeof krakenResidencyPlan>[0],options={})=>{
      const p=krakenResidencyPlan(phase,options);return [...p.required,...p.clips].map(v=>v.join('/'));
    };
    expect(plan('intro')).toContain('water/intro-rise');expect(plan('water')).not.toContain('water/intro-rise');
    expect(plan('water')).not.toContain('water/move');expect(plan('water',{waterMove:true})).toContain('water/move');
    expect(plan('ashore')).toContain('land/ashore');expect(plan('land')).not.toContain('land/ashore');
    expect(plan('land',{activeEggs:false}).some(v=>v.startsWith('egg/'))).toBe(false);
    expect(plan('water').some(v=>v.startsWith('land/'))).toBe(false);
    expect(plan('water',{prefetchLand:true})).toContain('land/death');expect(plan('dead')).toEqual([]);
  });
});
