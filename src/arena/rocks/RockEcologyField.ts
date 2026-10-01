import { CELL_SIZE } from '../../config';
import type { RockCell } from '../../types';
import type { ChunkWorldFrame } from '../chunks/ArenaChunkGrid';
import type { RockVegetationPlacement } from '../RockVegetationField';
import type { RockMossPlacement } from '../RockMossField';
import { rockCellKey } from '../RockOverlayRegions';
import { ROCK_ECOLOGY_ASSETS } from './RockEcologyAssets';

export interface RockEcologyTuning {rockEdgeFlora:number;rockCreviceFlora:number;rockFootFlora:number;rockFloraContact?:number;rockFloraBlend?:number}
export const ROCK_ECOLOGY_DEFAULTS:RockEcologyTuning={rockEdgeFlora:1,rockCreviceFlora:1,rockFootFlora:1,rockFloraContact:.24,rockFloraBlend:.5};
export interface EcologyColony extends RockVegetationPlacement {anchorKey:number;kind:string;edgeRun?:number}
export interface EcologyEdge {x:number;y:number;nx:number;ny:number;tx:number;ty:number;length:number;startConcave:boolean;endConcave:boolean}
const hash=(x:number,y:number,salt:number):number=>{let n=Math.imul(x,73856093)^Math.imul(y,19349663)^salt;n=Math.imul(n^(n>>>16),2246822507);return(n>>>0)/4294967296;};
const types=['edge-overhang','corner-tuft','foot-cluster','crevice-herb','moss-nest','moss-strip','lichen'] as const;
const groups=types.map(type=>ROCK_ECOLOGY_ASSETS.filter(a=>a.name.startsWith(type)));

/** Baseline contours, never live occupancy: destruction masks remove colonies
 * without rerolling their neighbours. Normals and concave endpoints are explicit. */
export function ecologyEdges(rocks:readonly Pick<RockCell,'gridX'|'gridY'>[]):EcologyEdge[] {
  const set=new Set(rocks.map(rockCellKey)),has=(x:number,y:number)=>set.has(rockCellKey({gridX:x,gridY:y}));
  const sorted=[...rocks].sort((a,b)=>a.gridY-b.gridY||a.gridX-b.gridX),out:EcologyEdge[]=[];
  for(const [nx,ny]of [[0,-1],[1,0],[0,1],[-1,0]])for(const c of sorted){
    const tx=ny?1:0,ty=nx?1:0,x=c.gridX,y=c.gridY;
    const exposed=(a:number,b:number)=>has(a,b)&&!has(a+nx,b+ny);
    if(!exposed(x,y)||exposed(x-tx,y-ty))continue;
    let n=1;while(exposed(x+tx*n,y+ty*n))n++;
    out.push({x:(x+.5)*CELL_SIZE+nx*CELL_SIZE/2-tx*CELL_SIZE/2,
      y:(y+.5)*CELL_SIZE+ny*CELL_SIZE/2-ty*CELL_SIZE/2,nx,ny,tx,ty,length:n*CELL_SIZE,
      startConcave:has(x-tx,y-ty)&&has(x-tx+nx,y-ty+ny),
      endConcave:has(x+tx*n,y+ty*n)&&has(x+tx*n+nx,y+ty*n+ny)});
  }
  return out;
}
export interface EcologyFieldOptions {
  rocks:readonly RockCell[];frame:ChunkWorldFrame;seed:number;tuning:RockEcologyTuning;
  water?:readonly {gridX:number;gridY:number}[];trees?:readonly {gridX:number;gridY:number}[];
  moss:readonly RockMossPlacement[];height?:(x:number,y:number)=>number;
}
export function generateRockEcology(o:EcologyFieldOptions):EcologyColony[]{
  const result:EcologyColony[]=[],rocks=new Set(o.rocks.map(rockCellKey)),moist=new Set<number>(),mossEdge=new Set<number>();
  const key=(x:number,y:number)=>rockCellKey({gridX:x,gridY:y});
  for(const c of [...(o.water??[]),...(o.trees??[])])for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++)
    if(dx*dx+dy*dy<=10)moist.add(key(c.gridX+dx,c.gridY+dy));
  for(const m of o.moss){
    const x=(m.worldX-o.frame.offsetX)/CELL_SIZE,y=(m.worldY-o.frame.offsetY)/CELL_SIZE,r=m.sizePx/(2*CELL_SIZE);
    for(let gy=Math.floor(y-r-1);gy<=y+r+1;gy++)for(let gx=Math.floor(x-r-1);gx<=x+r+1;gx++){
      const d=Math.hypot(gx+.5-x,gy+.5-y);if(Math.abs(d-r)<1.2)mossEdge.add(key(gx,gy));
    }
  }
  const emit=(group:number,x:number,y:number,rotation:number,anchor:number,random:number,run?:number):EcologyColony|null=>{
    const list=groups[group];if(!list.length)return null;
    const a=list[Math.min(list.length-1,Math.floor(random*list.length))];
    const spec=a as typeof a & {minWorld?:number;maxWorld?:number};
    const size=(spec.minWorld??24)+((spec.maxWorld??42)-(spec.minWorld??24))*hash(Math.round(x),Math.round(y),o.seed+712);
    const colony:EcologyColony={textureKey:a.key,frame:a.name,worldX:x+o.frame.offsetX,worldY:y+o.frame.offsetY,
      lengthPx:size,bandPx:size*a.height/a.width,rotation,alpha:1,mirrorX:false,anchorKey:anchor,kind:types[group],edgeRun:run};
    result.push(colony);return colony;
  };
  // Small isolated blocks would otherwise be framed on every side, which outlines
  // the square cell shape; they keep one or two accents instead.
  const component=new Map<number,number>(),componentSize:number[]=[],componentStamps:number[]=[];
  for(const c of o.rocks){
    const start=key(c.gridX,c.gridY);if(component.has(start))continue;
    const id=componentSize.length,stack=[[c.gridX,c.gridY]];let size=0;component.set(start,id);
    while(stack.length){
      const [x,y]=stack.pop()!;size++;
      for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){
        const k=key(x+dx,y+dy);if(rocks.has(k)&&!component.has(k)){component.set(k,id);stack.push([x+dx,y+dy]);}
      }
    }
    componentSize.push(size);componentStamps.push(0);
  }
  const smallBudget=(anchor:number):boolean=>{
    const id=component.get(anchor);if(id===undefined||componentSize[id]>4)return true;
    return componentStamps[id]<(componentSize[id]<=1?1:2);
  };
  const spend=(anchor:number):void=>{const id=component.get(anchor);if(id!==undefined)componentStamps[id]++;};
  const edges=ecologyEdges(o.rocks);
  for(let run=0;run<edges.length;run++){
    const e=edges[run];let index=0;
    const positions:number[]=[];
    if(e.startConcave)positions.push(Math.min(14,e.length/2));
    if(e.endConcave && e.length>90)positions.push(e.length-14);
    for(let a=Math.min(e.length/2,12+hash(e.x,e.y,o.seed+3)*35);a<e.length;){
      if(positions.every(p=>Math.abs(p-a)>110))positions.push(a);
      a+=145+hash(Math.round(e.x+e.tx*a),Math.round(e.y+e.ty*a),o.seed+41)*85;
    }
    positions.sort((a,b)=>a-b);
    // Every stamp is followed by a real gap, even at maximum density. World-
    // anchored variation clusters sections without selecting an entire facing away.
    for(const along of positions){
      const x=e.x+e.tx*along,y=e.y+e.ty*along;
      const gx=Math.floor((x-e.nx*4)/CELL_SIZE),gy=Math.floor((y-e.ny*4)/CELL_SIZE),anchor=key(gx,gy);
      const random=hash(Math.round(x),Math.round(y),o.seed+19);
      const wet=moist.has(anchor)||e.ny<0;
      const patch=hash(Math.floor(x/150),Math.floor(y/150),o.seed+33);
      const corner=(along<35&&e.startConcave)||(e.length-along<35&&e.endConcave);
      const group=corner?1:random<.13?5:random<.35?4:0;
      if(random<Math.min(.88,(corner?.9:.42+patch*.32)*o.tuning.rockEdgeFlora)&&smallBudget(anchor)){
        const angle=Math.atan2(-e.nx,e.ny)+(index%2?1:-1)*(.27+random*.16);
        const c=emit(group,x,y,angle,anchor,hash(gx,gy,o.seed+83),run);
        if(c){spend(anchor);
          // Bound the entire rotated canvas, not merely its centre: <=12px overhang.
          const delta=angle-Math.atan2(-e.nx,e.ny);
          const reach=(Math.abs(Math.sin(delta))*c.lengthPx+Math.abs(Math.cos(delta))*c.bandPx)/2;
          const shift=8+random*4-reach;
          c.worldX+=e.nx*shift;c.worldY+=e.ny*shift;
        }
      }
      if(hash(gx,gy,o.seed+221)<(wet?.44:.17)*o.tuning.rockFootFlora&&smallBudget(anchor)){
        const c=emit(2,x-e.tx*18,y-e.ty*18,Math.atan2(-e.nx,e.ny)+random*.5-.25,anchor,hash(gx,gy,o.seed+177),run);
        if(c){spend(anchor);const d=c.rotation-Math.atan2(-e.nx,e.ny),reach=(Math.abs(Math.sin(d))*c.lengthPx+Math.abs(Math.cos(d))*c.bandPx)/2;
          c.worldX+=e.nx*(12-reach);c.worldY+=e.ny*(12-reach);}
      }
      index++;
    }
  }
  if(o.height)for(const c of [...o.rocks].sort((a,b)=>a.gridY-b.gridY||a.gridX-b.gridX)){
    const anchor=key(c.gridX,c.gridY);if(!rocks.has(key(c.gridX+1,c.gridY))||!rocks.has(key(c.gridX-1,c.gridY))
      ||!rocks.has(key(c.gridX,c.gridY+1))||!rocks.has(key(c.gridX,c.gridY-1)))continue;
    let best=-Infinity,bx=0,by=0;
    for(let i=0;i<4;i++){
      const x=c.gridX*CELL_SIZE+6+20*hash(c.gridX,c.gridY,o.seed+330+i),y=c.gridY*CELL_SIZE+6+20*hash(c.gridY,c.gridX,o.seed+470+i);
      const h=o.height(x,y),cavity=(o.height(x-7,y)+o.height(x+7,y)+o.height(x,y-7)+o.height(x,y+7))/4-h;
      if(cavity>best){best=cavity;bx=x;by=y;}
    }
    const random=hash(c.gridX,c.gridY,o.seed+913),transition=mossEdge.has(anchor);
    const kind=hash(c.gridX,c.gridY,o.seed+1031);
    if(best>.12&&random<Math.min(.52,(transition?.32:.12)*o.tuning.rockCreviceFlora))
      emit(kind<.06?6:kind<.23?4:3,bx,by,hash(c.gridY,c.gridX,o.seed+712)*Math.PI*2,anchor,hash(c.gridX,c.gridY,o.seed+923));
  }
  return result;
}
