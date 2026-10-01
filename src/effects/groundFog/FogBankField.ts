import { CELL_SIZE } from '../../config';
import type { FogTerrainModel } from './FogTerrainModel';
export const FOG_BOUNDARY_RANGE=64;
const STEP=8,HALO=10,SIDE=64,FULL=SIDE+HALO*2;
/** Reused scratch, two chamfer sweeps; never a second collision/flow owner. */
export class FogBankField {
  private readonly solid=new Float32Array(FULL*FULL);
  private readonly open=new Float32Array(FULL*FULL);
  build(terrain:FogTerrainModel,cx:number,cy:number,out:Uint8Array,stride:number,ox:number,oy:number,keepPrevious=false):void {
    for(let y=0;y<FULL;y++)for(let x=0;x<FULL;x++) {
      const gx=Math.floor((cx*512+(x-HALO+.5)*STEP)/CELL_SIZE),gy=Math.floor((cy*512+(y-HALO+.5)*STEP)/CELL_SIZE);
      const blocked=gx<0||gy<0||gx>=terrain.cols||gy>=terrain.rows||terrain.blocked[gy*terrain.cols+gx]>0;
      const i=y*FULL+x;this.solid[i]=blocked?0:1e4;this.open[i]=blocked?1e4:0;
    }
    this.sweep(this.solid);this.sweep(this.open);
    for(let y=0;y<SIDE;y++)for(let x=0;x<SIDE;x++) {
      const i=(y+HALO)*FULL+x+HALO;
      const distance=this.solid[i]===0?4-this.open[i]:this.solid[i]-4;
      const n=Math.round((Math.max(-64,Math.min(64,distance))/128+.5)*65535);
      const target=((oy+y)*stride+ox+x)*4;out[target]=n>>8;out[target+1]=n&255;
      if(!keepPrevious){out[target+2]=out[target];out[target+3]=out[target+1];}
    }
  }
  private sweep(a:Float32Array):void {
    for(let pass=0;pass<2;pass++) {
      const dir=pass===0?1:-1;
      for(let y=pass===0?0:FULL-1;y>=0&&y<FULL;y+=dir)for(let x=pass===0?0:FULL-1;x>=0&&x<FULL;x+=dir) {
        const i=y*FULL+x,px=x-dir,py=y-dir;
        if(px>=0&&px<FULL)a[i]=Math.min(a[i],a[y*FULL+px]+STEP);
        if(py>=0&&py<FULL) {
          a[i]=Math.min(a[i],a[py*FULL+x]+STEP);
          if(x>0)a[i]=Math.min(a[i],a[py*FULL+x-1]+STEP*Math.SQRT2);
          if(x<FULL-1)a[i]=Math.min(a[i],a[py*FULL+x+1]+STEP*Math.SQRT2);
        }
      }
    }
  }
}
/** Snapshot an in-progress transition only on geometry edits. No per-frame uploads. */
export function snapshotFogBoundary(data:Uint8Array,blend:number):void {
  let t=Math.max(0,Math.min(1,blend));t=t*t*(3-2*t);
  for(let i=0;i<data.length;i+=4) {
    const old=data[i+2]*256+data[i+3],next=data[i]*256+data[i+1];
    const value=Math.round(old+(next-old)*t);
    data[i+2]=value>>8;data[i+3]=value&255;
  }
}
export function fogDayWeight(strength:number):number {
  const t=Number.isFinite(strength)?Math.max(0,Math.min(1,strength/.15)):0;
  return t*t*(3-2*t);
}
export function fogShoreRamp(distance:number,width:number,warp=0):number {
  const t=Math.max(0,Math.min(1,(distance+warp+width*.65)/width));return t*t*(3-2*t);
}
export function fogPileEnvelope(distance:number,softness:number):number {
  const t=Math.max(0,Math.min(1,(distance+5)/(softness+5)));
  return t*t*(3-2*t)*(1+.28*Math.exp(-(((distance-softness*.65)/Math.max(1,softness))**2)));
}
