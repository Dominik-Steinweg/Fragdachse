type Point = {x:number;y:number};
/** Convex hull of two equal axis-aligned rectangles. Reflect the canonical
 * southeast hull into any quadrant and preserve its winding. Six reused points;
 * axis-aligned offsets intentionally collapse two edges to zero length. */
export function writeShadowCellHull(p: Point[], cx: number, cy: number, width: number,
  height: number, dx: number, dy: number): void {
  const sx=dx<0?-1:1,sy=dy<0?-1:1,hw=width*.5,hh=height*.5;
  const x=Math.abs(dx),y=Math.abs(dy),reverse=sx*sy<0;
  for(let i=0;i<6;i++) {
    let px:number,py:number;
    switch(i) {
      case 0:px=-hw;py=-hh;break;
      case 1:px=hw;py=-hh;break;
      case 2:px=hw+x;py=-hh+y;break;
      case 3:px=hw+x;py=hh+y;break;
      case 4:px=-hw+x;py=hh+y;break;
      default:px=-hw;py=hh;
    }
    const target=p[reverse?5-i:i];target.x=cx+sx*px;target.y=cy+sy*py;
  }
}
