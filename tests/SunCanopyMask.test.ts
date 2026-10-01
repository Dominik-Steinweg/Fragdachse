import {it,expect} from 'vitest';
import {bakeSunCanopyMask} from '../src/effects/sunlight/SunCanopyMask';
it('excludes dense canopies independently of hiding alpha, with soft edges and bounded storage',()=>{
 const canopy={worldX:120,worldY:120,gfx:{displayWidth:200,displayHeight:200,alpha:1}};
 const first=bakeSunCanopyMask(0,0,240,240,[canopy]);canopy.gfx.alpha=0;
 expect(bakeSunCanopyMask(0,0,240,240,[canopy])).toEqual(first);
 expect(first.data[(5*10+5)*4]).toBe(0);expect(first.data[0]).toBe(255);
 expect(first.data.some(v=>v>0&&v<255)).toBe(true);
 expect(bakeSunCanopyMask(0,0,100000,100000,[]).data.byteLength).toBeLessThanOrEqual(1024*1024);
 expect(bakeSunCanopyMask(-24,-24,240,240,[{...canopy,worldX:96,worldY:96}])).toEqual(first);
});
