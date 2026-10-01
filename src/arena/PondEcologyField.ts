import { CELL_SIZE } from '../config';
import type { ArenaLayout, WaterCell } from '../types';
import type { ChunkWorldFrame } from './chunks/ArenaChunkGrid';
import type { EcologyPlacement, EcologyWaterField } from './WoodlandEcologyField';
import { ecologyHash } from './ecologyHash';
import pond from '../../public/assets/environment/woodland/ecology/lilies.json';

type LilyAnchor={x:number;y:number;roll:number};
/** Only floating lily pads/groups are placed. */
const families = {
  pads:pond.assets.filter(a=>a.name.startsWith('lily-pad')),
  lilies:pond.assets.filter(a=>a.name.startsWith('lily-group')),
};
const sides=[[0,-1],[1,0],[0,1],[-1,0]] as const;

/** Independent water bodies, deterministic under source-cell reordering. */
export function pondComponents(cells:readonly WaterCell[],columns:number):WaterCell[][] {
  const remaining=new Map(cells.map(c=>[c.gridY*columns+c.gridX,c]));
  const sorted=[...remaining.keys()].sort((a,b)=>a-b),result:WaterCell[][]=[];
  for(const key of sorted) {
    const first=remaining.get(key);if(!first)continue;
    const component=[first];remaining.delete(key);
    for(let i=0;i<component.length;i++)for(const [dx,dy] of sides) {
      const c=component[i],x=c.gridX+dx,y=c.gridY+dy;
      if(x<0||x>=columns||y<0)continue;
      const k=y*columns+x,next=remaining.get(k);if(next){component.push(next);remaining.delete(k);}
    }
    result.push(component);
  }
  return result;
}

/** Deterministic lily colonies per water body. Allocations occur only at world build. */
export function buildPondEcology(layout:ArenaLayout,frame:ChunkWorldFrame,water:EcologyWaterField,
  fits:(x:number,y:number,r:number,dry:boolean)=>boolean,budget:number):EcologyPlacement[] {
  const columns=Math.ceil(frame.width/CELL_SIZE),out:EcologyPlacement[]=[];
  let pondId=0;
  for(const cells of pondComponents(layout.water??[],columns)) {
    if(out.length>=budget)break;
    const id=pondId++,interior:LilyAnchor[]=[];
    const roll=(x:number,y:number,salt:number)=>ecologyHash(x,y,layout.seed+salt);
    for(const cell of cells) {
      const cx=(cell.gridX+.5)*CELL_SIZE,cy=(cell.gridY+.5)*CELL_SIZE;
      for(const dx of [-8,8])for(const dy of [-8,8]) {
        const x=cx+dx,y=cy+dy,d=water.distance(x,y);
        if(d>=36&&d<=62)interior.push({x,y,roll:roll(x,y,31)});
      }
    }
    const add=(family:keyof typeof families,x:number,y:number,size:number,rotation:number,
      floating:boolean,rank:number,colony?:number,stand?:number):boolean=>{
      if(out.length>=budget||!fits(x,y,size*.71+2,false))return false;
      const d=water.distance(x,y);
      if(d<3||d>63)return false;
      if(floating)for(let i=0;i<8;i++) {
        const r=size*.71+2;
        if(water.distance(x+Math.cos(i*Math.PI/4)*r,y+Math.sin(i*Math.PI/4)*r)<6)return false;
      }
      const assets=families[family],a=assets[Math.floor(roll(x,y,71)*assets.length)];
      out.push({kind:'pond',frame:a.name,x:x+frame.offsetX,y:y+frame.offsetY,size,rotation,
        alpha:.94,rank,floating,pond:id,colony,stand});
      return true;
    };
    // Pick well-separated colony anchors, then place several full-sized leaves and
    // grouped motifs nearby. Small puddles gracefully accept fewer colonies.
    interior.sort((a,b)=>a.roll-b.roll);
    const anchors:LilyAnchor[]=[],wanted=Math.min(6,Math.max(3,Math.round(cells.length/65)));
    for(const b of interior) {
      if(anchors.length>=wanted)break;
      if(anchors.some(a=>Math.hypot(a.x-b.x,a.y-b.y)<Math.min(80,Math.max(36,Math.sqrt(cells.length)*10))))continue;
      const colony=id*8+anchors.length;
      if(!add('lilies',b.x,b.y,48+roll(b.x,b.y,91)*12,b.roll*6.283,true,.1+.45*b.roll,colony))continue;
      anchors.push(b);
      for(let i=0;i<9;i++) {
        const angle=roll(b.x,b.y,101+i)*Math.PI*2,radius=19+roll(b.x,b.y,121+i)*33;
        const x=b.x+Math.cos(angle)*radius,y=b.y+Math.sin(angle)*radius;
        const group=i===0||i===5,size=group?44+roll(x,y,83)*10:20+roll(x,y,85)*13;
        add(group?'lilies':'pads',x,y,size,angle,true,i<6?.15+.65*b.roll:1.05+.8*b.roll,colony);
      }
    }
  }
  return out;
}
