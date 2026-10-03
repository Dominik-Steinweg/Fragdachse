import { buildPondEcology } from './PondEcologyField';
import { buildShoreStones } from './ShoreStoneField';
import { ecologyHash } from './ecologyHash';
export { ecologyHash } from './ecologyHash';
import { CELL_SIZE } from '../config';
import type { ArenaLayout } from '../types';
import type { ChunkWorldFrame } from './chunks/ArenaChunkGrid';
import { ARENA_RENDER_CHUNK_SIZE } from './chunks/ArenaChunkGrid';
import { WATER_MASK_HALO, WATER_MASK_STEP, WATER_SHORE_DISTANCE, type WaterMaskView } from './WaterSurfaceModel';
import litter from '../assets/manifests/ground-litter.json';
import pond from '../assets/manifests/lilies.json';
import stones from '../assets/manifests/shore-stones.json';
import { CANOPY_ASSETS, canopyVariant } from './trees/CanopyAssets';

export const WOODLAND_ATLASES = [
  {...litter.atlas,key:'woodland-ground-litter'}, {...pond.atlas,key:'woodland-lilies'},
  {...stones.atlas,key:'woodland-shore-stones'},
];
export type PreparedWaterMask = {readonly x:number;readonly y:number;readonly mask:WaterMaskView};
export interface EcologyPlacement {
  kind:'litter'|'pond'|'shore'; frame:string; x:number;y:number;size:number;rotation:number;alpha:number;
  /** Stable density thinning; changing density doesn't reshuffle or upload textures. */
  rank:number;floating:boolean;pond?:number;colony?:number;stand?:number;
}
/** Uses the rendered mask, including propagated shore distance and soft bank expansion. */
export class EcologyWaterField {
  private readonly chunks = new Map<string,WaterMaskView>();
  constructor(masks:Iterable<PreparedWaterMask>) {
    for(const entry of masks)this.chunks.set(`${entry.x/ARENA_RENDER_CHUNK_SIZE},${entry.y/ARENA_RENDER_CHUNK_SIZE}`,entry.mask);
  }
  distance(x:number,y:number):number {
    const size=ARENA_RENDER_CHUNK_SIZE,cx=Math.floor(x/size),cy=Math.floor(y/size),m=this.chunks.get(`${cx},${cy}`);
    if(!m)return -1;
    const px=Math.floor((x-cx*size+WATER_MASK_HALO)/WATER_MASK_STEP),py=Math.floor((y-cy*size+WATER_MASK_HALO)/WATER_MASK_STEP);
    const i=(py*m.size+px)*4;
    return m.data[i+2]<150 ? -1 : m.data[i]/255*WATER_SHORE_DISTANCE;
  }
}

/** Pure, bounded placement; no colliders, occupancy edits or random global state. */
export function buildWoodlandEcology(layout:ArenaLayout, frame:ChunkWorldFrame,
  crowns:readonly {worldX:number;worldY:number;radius:number;conifer?:boolean}[], water:EcologyWaterField,
  extraBlocked:readonly {gridX:number;gridY:number}[]=[]):EcologyPlacement[] {
  const columns=Math.ceil(frame.width/CELL_SIZE),blocked=new Set<number>(),wet=new Set<number>();
  for(const cell of [...layout.rocks,...layout.trees,...layout.tracks,...layout.powerUpPedestals,...extraBlocked])
    blocked.add(cell.gridY*columns+cell.gridX);
  for(const cell of layout.water??[])wet.add(cell.gridY*columns+cell.gridX);
  const fits=(x:number,y:number,r:number,dry:boolean):boolean=>{
    if(x-r<0||y-r<0||x+r>=frame.width||y+r>=frame.height)return false;
    for(let gy=Math.floor((y-r)/CELL_SIZE);gy<=Math.floor((y+r)/CELL_SIZE);gy++)
      for(let gx=Math.floor((x-r)/CELL_SIZE);gx<=Math.floor((x+r)/CELL_SIZE);gx++)
        if(blocked.has(gy*columns+gx)||(dry&&wet.has(gy*columns+gx)))return false;
    return true;
  };
  const out:EcologyPlacement[]=buildShoreStones(layout,frame,water,fits,1024);
  const pick=(assets:readonly {name:string}[],n:number)=>assets[Math.min(assets.length-1,Math.floor(n*assets.length))].name;
  const leaf=litter.assets.filter(a=>a.name.startsWith('leaf-')),needles=litter.assets.filter(a=>a.name.startsWith('needle-'));
  const twigs=litter.assets.filter(a=>a.name.startsWith('twigs')),pebbles=litter.assets.filter(a=>a.name.startsWith('pebbles'));
  for(const crown of crowns) {
    const conifer=crown.conifer??CANOPY_ASSETS[canopyVariant(crown.worldX,crown.worldY)].conifer;
    for(let i=0;i<48&&out.length<4096;i++) {
      const h=(salt:number)=>ecologyHash(crown.worldX,crown.worldY,layout.seed+i*31+salt);
      const radial=Math.sqrt(h(1))*1.25,angle=h(2)*Math.PI*2;
      const x=crown.worldX-frame.offsetX+Math.cos(angle)*crown.radius*radial;
      const y=crown.worldY-frame.offsetY+Math.sin(angle)*crown.radius*radial;
      const size=24+h(3)*25;
      if(h(4)>Math.max(.1,1-radial*.58)||!fits(x,y,size*.71,true))continue;
      const species=h(5),assets=species>.93?pebbles:species>.72?twigs:conifer?needles:leaf;
      out.push({kind:'litter',frame:pick(assets,h(6)),x:x+frame.offsetX,y:y+frame.offsetY,size,
        rotation:h(7)*Math.PI*2,alpha:(.40+h(8)*.28)*Math.max(.2,1-radial*.45),rank:h(9)*2,floating:false});
    }
  }
  out.push(...buildPondEcology(layout,frame,water,fits,4096-out.length));
  return out;
}
