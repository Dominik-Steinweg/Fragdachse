import { CELL_SIZE } from '../../config';
import type { FormationRock } from './RockFormationField';

/** Local, presentation-only ground horizons while the formation worker is pending. */
export class RockGroundEstimate {
  private readonly cells: Int32Array;
  private readonly cols: number;
  private readonly rows: number;
  private readonly sun=new Float64Array(6);
  private azimuth=NaN;
  constructor(width:number,height:number,private readonly states:readonly (FormationRock|undefined)[]) {
    this.cols=Math.ceil(width/CELL_SIZE);this.rows=Math.ceil(height/CELL_SIZE);
    this.cells=new Int32Array(this.cols*this.rows).fill(-1);
    for(const s of states)if(s&&s.gridX>=0&&s.gridY>=0&&s.gridX<this.cols&&s.gridY<this.rows)
      this.cells[s.gridY*this.cols+s.gridX]=s.id;
  }
  private solid(x:number,y:number):boolean {
    if(x<0||y<0||x>=this.cols||y>=this.rows)return false;
    const s=this.states[this.cells[y*this.cols+x]];return !!s?.active&&s.material!=='walls';
  }
  /** First occupied grid column along a ray. Absolute coordinates keep shared gutters identical. */
  private distance(x:number,y:number,dx:number,dy:number):number {
    let gx=Math.floor(x/CELL_SIZE),gy=Math.floor(y/CELL_SIZE);
    const sx=dx<0?-1:1,sy=dy<0?-1:1;
    const tx=Math.abs(dx)<1e-8?Infinity:CELL_SIZE/Math.abs(dx),ty=Math.abs(dy)<1e-8?Infinity:CELL_SIZE/Math.abs(dy);
    let nx=tx===Infinity?Infinity:((gx+(sx>0?1:0))*CELL_SIZE-x)/dx;
    let ny=ty===Infinity?Infinity:((gy+(sy>0?1:0))*CELL_SIZE-y)/dy;
    let distance=0;
    while(distance<=160){
      if(this.solid(gx,gy))return distance;
      if(nx<ny){distance=nx;nx+=tx;gx+=sx;}else {distance=ny;ny+=ty;gy+=sy;}
    }
    return Infinity;
  }
  /** centre/left/right solar horizons, sky visibility and contact visibility (linear). */
  sample(out:Float64Array,x:number,y:number,azimuth:number,height=36):void {
    if(azimuth!==this.azimuth){this.azimuth=azimuth;for(let i=0;i<3;i++){
      const angle=-azimuth*Math.PI/180+(i===0?0:i===1?-.045:.045);
      this.sun[i*2]=Math.cos(angle);this.sun[i*2+1]=Math.sin(angle);
    }}
    for(let i=0;i<3;i++){const d=this.distance(x,y,this.sun[i*2],this.sun[i*2+1]);out[i]=Math.atan2(height,d+6);}
    let blocked=0,nearest=Infinity;
    for(let i=0;i<8;i++){
      const d=this.distance(x,y,SKY[i*2],SKY[i*2+1]);nearest=Math.min(nearest,d);
      if(d<=32){const h=Math.atan2(height,d+6);blocked+=Math.sin(h)**2;}
    }
    out[3]=1-blocked/8;const t=Math.min(1,nearest/10);out[4]=t*t*(3-2*t);
  }
}
const SKY=Float64Array.from({length:16},(_,i)=>i%2?Math.sin(Math.floor(i/2)*Math.PI/4):Math.cos(Math.floor(i/2)*Math.PI/4));
