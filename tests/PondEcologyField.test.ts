
import {it,expect,vi} from 'vitest';vi.mock('phaser',()=>({}));
import {getCoopDefenseMapConfig} from '../src/config/coopDefenseMaps';
import {getArenaMetricsProfile} from '../src/config';
import {resolveWorldMetrics} from '../src/world/WorldMetrics';
import {ArenaGenerator,resolveArenaGenerationInput} from '../src/arena/ArenaGenerator';
import {WaterSurfaceModel} from '../src/arena/WaterSurfaceModel';
import {buildWoodlandEcology,EcologyWaterField} from '../src/arena/WoodlandEcologyField';
import {pondComponents} from '../src/arena/PondEcologyField';

function reference() {
  const map=getCoopDefenseMapConfig('1'),m=resolveWorldMetrics(getArenaMetricsProfile('coop_defense','ARENA',map.arenaWidthCells,map.arenaHeightCells));
  const layout=ArenaGenerator.generate(12345,resolveArenaGenerationInput('coop_defense',m),map);
  const frame={offsetX:m.offsetX,offsetY:m.offsetY,width:m.widthPx,height:m.heightPx};
  // Current authored Map 1: nearest pond to the reported camera target.
  const distance=(cells:{gridX:number;gridY:number}[])=>Math.min(...cells.map(c=>Math.hypot(c.gridX-33,c.gridY-17)));
  const cells=pondComponents(layout.water!,m.gridCols).sort((a,b)=>distance(a)-distance(b))[0];
  const model=new WaterSurfaceModel(cells,frame),masks=model.getChunkOrigins(512,frame.width,frame.height).map(p=>({...p,mask:model.bake(p.x,p.y,512)}));
  return {layout:{...layout,water:cells},frame,field:new EcologyWaterField(masks)};
}
it('places only lily colonies while shore flora is disabled',()=>{
  const {layout,frame,field}=reference(),all=buildWoodlandEcology(layout,frame,[],field).filter(p=>p.kind==='pond');
  expect(all.length).toBeGreaterThan(0);
  for(const p of all)expect(p.frame.startsWith('lily-')).toBe(true);
});
it('splits disconnected water bodies without wrapping grid rows',()=>{
  expect(pondComponents([{gridX:0,gridY:1},{gridX:7,gridY:0},{gridX:1,gridY:1}],8).map(c=>c.length)).toEqual([1,2]);
});
