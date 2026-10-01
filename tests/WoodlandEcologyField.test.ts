
import {expect,it} from 'vitest';
import {buildWoodlandEcology,EcologyWaterField} from '../src/arena/WoodlandEcologyField';
import {WaterSurfaceModel} from '../src/arena/WaterSurfaceModel';
import {CELL_SIZE} from '../src/config';
import type {ArenaLayout} from '../src/types';
import {validateSunTuning,SUN_TUNING_DEFAULTS} from '../src/effects/sunlight/SunTuning';
const frame={offsetX:-123,offsetY:61,width:1024,height:1024};
const layout:ArenaLayout={seed:12345,rocks:[{gridX:9,gridY:9}],trees:[{gridX:8,gridY:8}],tracks:[],dirt:[],powerUpPedestals:[],
  water:Array.from({length:144},(_,i)=>({gridX:16+i%12,gridY:16+Math.floor(i/12)}))};
const model=new WaterSurfaceModel(layout.water!,frame);
const field=new EcologyWaterField(model.getChunkOrigins(512,1024,1024).map(p=>({...p,mask:model.bake(p.x,p.y,512)})));
const crowns=[{worldX:frame.offsetX+272,worldY:frame.offsetY+272,radius:120}];
it('places the same bounded colonies for the same world seed and masks',()=>{
  const a=buildWoodlandEcology(layout,frame,crowns,field);
  expect(buildWoodlandEcology(layout,frame,crowns,field)).toEqual(a);
  expect(a.some(p=>p.kind==='litter')).toBe(true);expect(a.some(p=>p.kind==='pond')).toBe(true);
  expect(a.some(p=>p.floating)).toBe(true);expect(a.some(p=>p.kind==='pond'&&!p.floating)).toBe(false);
  expect(buildWoodlandEcology({...layout,seed:54321},frame,crowns,field)).not.toEqual(a);
  for(const p of a){
    const x=p.x-frame.offsetX,y=p.y-frame.offsetY,r=p.size*.71;
    expect(x-r).toBeGreaterThanOrEqual(0);expect(y-r).toBeGreaterThanOrEqual(0);
    expect(x+r).toBeLessThan(frame.width);expect(y+r).toBeLessThan(frame.height);
    for(const c of [...layout.rocks,...layout.trees,...(p.kind==='litter'?layout.water!:[])])
      expect(x+r<=c.gridX*CELL_SIZE||x-r>=(c.gridX+1)*CELL_SIZE||y+r<=c.gridY*CELL_SIZE||y-r>=(c.gridY+1)*CELL_SIZE).toBe(true);
    if(p.kind==='litter')expect(Math.hypot(p.x-crowns[0].worldX,p.y-crowns[0].worldY)).toBeLessThanOrEqual(crowns[0].radius*1.25);
    else {
      expect(field.distance(x,y)).toBeGreaterThanOrEqual(3);expect(field.distance(x,y)).toBeLessThanOrEqual(63);
      if(p.floating)for(let tap=0;tap<8;tap++)expect(field.distance(x+Math.cos(tap*Math.PI/4)*(r+2),y+Math.sin(tap*Math.PI/4)*(r+2))).toBeGreaterThanOrEqual(6);
    }
    expect(p.frame).not.toMatch(/^(moss-roots|pebbles-04|lily-group-03)/);
  }
});
it('accepts bounded live density and glint tuning and rejects invalid edits',()=>{
  expect(validateSunTuning({litterDensity:0,pondFloraDensity:2,waterGlint:0})).toEqual({litterDensity:0,pondFloraDensity:2,waterGlint:0});
  for(const key of ['litterDensity','pondFloraDensity','waterGlint','waterGlintDensity','waterGlintSpeed'])for(const value of [-1,Infinity,NaN,999,'1'])expect(()=>validateSunTuning({[key]:value})).toThrow();
  expect(validateSunTuning(SUN_TUNING_DEFAULTS)).toEqual(SUN_TUNING_DEFAULTS);
});
