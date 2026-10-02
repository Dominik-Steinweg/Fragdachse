/** Deterministic triangle-union raster, ground-clamped projection; no Canvas/GPU. */
export function project(positions, azimuth, elevation) {
  const a = azimuth * Math.PI / 180, cot = 1 / Math.tan(elevation * Math.PI / 180);
  const x = Math.cos(a) * cot, y = Math.sin(a) * cot;
  const out = new Float32Array(positions.length / 3 * 2);
  for (let i=0,j=0;i<positions.length;i+=3,j+=2) {
    const h=Math.max(0,positions[i+2]); out[j]=positions[i]-x*h;out[j+1]=positions[i+1]-y*h;
  }
  return out;
}
export function extents(points) {
  const b=[Infinity,Infinity,-Infinity,-Infinity];
  for(let i=0;i<points.length;i+=2){b[0]=Math.min(b[0],points[i]);b[1]=Math.min(b[1],points[i+1]);b[2]=Math.max(b[2],points[i]);b[3]=Math.max(b[3],points[i+1]);}
  return b;
}
export function raster(points, indices, bounds, density=3) {
  const w=Math.ceil((bounds[2]-bounds[0])*density),h=Math.ceil((bounds[3]-bounds[1])*density);
  const data=new Uint8Array(w*h),xy=new Float32Array(points.length);
  for(let i=0;i<points.length;i+=2){xy[i]=(points[i]-bounds[0])*density;xy[i+1]=(points[i+1]-bounds[1])*density;}
  for(let t=0;t<indices.length;t+=3){
    const a=indices[t]*2,b=indices[t+1]*2,c=indices[t+2]*2;
    const ax=xy[a],ay=xy[a+1],bx=xy[b],by=xy[b+1],cx=xy[c],cy=xy[c+1];
    const area=(bx-ax)*(cy-ay)-(by-ay)*(cx-ax);if(Math.abs(area)<1e-8)continue;
    const y0=Math.max(0,Math.ceil(Math.min(ay,by,cy)-.5)), y1=Math.min(h-1,Math.floor(Math.max(ay,by,cy)-.5));
    for(let y=y0;y<=y1;y++){
      const sy=y+.5;let lo=Infinity,hi=-Infinity;
      if(ay!==by&&sy>=Math.min(ay,by)&&sy<=Math.max(ay,by)){const x=ax+(sy-ay)*(bx-ax)/(by-ay);lo=Math.min(lo,x);hi=Math.max(hi,x);}
      if(by!==cy&&sy>=Math.min(by,cy)&&sy<=Math.max(by,cy)){const x=bx+(sy-by)*(cx-bx)/(cy-by);lo=Math.min(lo,x);hi=Math.max(hi,x);}
      if(cy!==ay&&sy>=Math.min(cy,ay)&&sy<=Math.max(cy,ay)){const x=cx+(sy-cy)*(ax-cx)/(ay-cy);lo=Math.min(lo,x);hi=Math.max(hi,x);}
      const x0=Math.max(0,Math.ceil(lo-.5)),x1=Math.min(w-1,Math.floor(hi-.5));
      if(x1>=x0)data.fill(1,y*w+x0,y*w+x1+1);
    }
  }
  return {data,width:w,height:h,bounds,density};
}
export function compare(a,b) {
  if(a.width!==b.width||a.height!==b.height)throw Error('Unmatched canvases');
  let intersection=0,union=0,source=0;
  for(let i=0;i<a.data.length;i++){intersection+=a.data[i]&b.data[i];union+=a.data[i]|b.data[i];source+=a.data[i];}
  if(!union||!source)throw Error('Empty source silhouette');
  return {iou:intersection/union, sourceAreaWorld2:source/a.density**2};
}
