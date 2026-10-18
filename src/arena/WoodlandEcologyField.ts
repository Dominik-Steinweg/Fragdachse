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
  /** Shows a void overlay (presentation only); never changes position, rank or frame choice. */
  void?:boolean;
  /** Infestation 0..1 of this plant; drives its glow, veins and spores. */
  voidAmount?:number;
  /** Approved void art drawn instead of the natural frame (same size, rotation and motion). */
  voidFrame?:string;
}

/** What the lily marking needs from the void field. */
export interface VoidFloraAmounts {
  intensityAt(x:number,y:number):number;
  amountOf(intensity:number,x:number,y:number,weight?:number):number;
}
/** How strongly a pond pulls its plants towards its average: whole ponds tend to turn together. */
const POND_COHERENCE=.9;
/** Same threshold as `VOID_ART_FROM`, duplicated to keep this placement module free of asset imports. */
const VOID_ART_THRESHOLD=.3;

/**
 * Marks void infestation of lily plants. A pond's plants share most of its average intensity, so
 * neighbours look alike; the rim of an infested area passes through partly taken plants instead of
 * single violet colonies among green ones. Returns the number of colonies that show any void.
 */
export function markVoidPondColonies(placements:EcologyPlacement[],field:VoidFloraAmounts|null,
  artFrame?:(natural:string,amount:number,roll:number)=>string|null):number {
  const ponds=new Map<number,{sum:number;n:number}>(),leads=new Set<number>(),colonies=new Set<number>();
  if(field)for(const p of placements) {
    if(p.kind!=='pond'||p.pond===undefined||p.colony===undefined||leads.has(p.colony))continue;
    leads.add(p.colony);
    const pond=ponds.get(p.pond)??{sum:0,n:0};pond.sum+=field.intensityAt(p.x,p.y);pond.n++;ponds.set(p.pond,pond);
  }
  for(const p of placements) {
    const pond=field&&p.kind==='pond'&&p.pond!==undefined?ponds.get(p.pond):undefined;
    p.voidFrame=undefined;
    if(!field||!pond){p.void=false;p.voidAmount=0;continue;}
    const mean=pond.sum/pond.n,own=field.intensityAt(p.x,p.y);
    const amount=field.amountOf(mean+(own-mean)*(1-POND_COHERENCE),p.x,p.y);
    p.voidAmount=amount;p.void=amount>.02;
    // Above a per-plant threshold near the rim the art replaces the plant; early or full by amount.
    if(artFrame&&amount>=VOID_ART_THRESHOLD+.2*ecologyHash(p.x,p.y,0x51a7))
      p.voidFrame=artFrame(p.frame,amount,ecologyHash(p.x,p.y,0x51a8))??undefined;
    if(p.void&&p.colony!==undefined)colonies.add(p.colony);
  }
  return colonies.size;
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
