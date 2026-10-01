/** Static World-owned exclusion for small light openings, independent of hiding/fade alpha. */
export interface SunCanopy {worldX:number;worldY:number;gfx:{displayWidth:number;displayHeight:number;rotation?:number}}
export function bakeSunCanopyMask(x:number,y:number,width:number,height:number,canopies:readonly SunCanopy[]) {
 const cols=Math.min(512,Math.max(1,Math.ceil(width/24))),rows=Math.min(512,Math.max(1,Math.ceil(height/24)));
 const data=new Uint8Array(cols*rows*4).fill(255),sx=width/cols,sy=height/rows;
 for(const c of canopies){
  const rx=Math.max(1,c.gfx.displayWidth*.48),ry=Math.max(1,c.gfx.displayHeight*.48),reach=Math.max(rx,ry);
  const angle=c.gfx.rotation??0,cos=Math.cos(angle),sin=Math.sin(angle);
  for(let gy=Math.max(0,Math.floor((c.worldY-reach-y)/sy));gy<Math.min(rows,Math.ceil((c.worldY+reach-y)/sy));gy++)
   for(let gx=Math.max(0,Math.floor((c.worldX-reach-x)/sx));gx<Math.min(cols,Math.ceil((c.worldX+reach-x)/sx));gx++){
    const dx=x+(gx+.5)*sx-c.worldX,dy=y+(gy+.5)*sy-c.worldY;
    const r=Math.hypot((dx*cos+dy*sin)/rx,(-dx*sin+dy*cos)/ry),t=Math.max(0,Math.min(1,(r-.55)/.45));
    const openness=Math.round(255*t*t*(3-2*t)),i=(gy*cols+gx)*4;
    data[i]=data[i+1]=data[i+2]=Math.min(data[i],openness);
   }
 }
 return {data,width:cols,height:rows};
}
