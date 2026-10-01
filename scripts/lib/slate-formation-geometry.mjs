/** Periodic intersecting, weathered fracture volumes. Geometry is authored in
 * world pixels and is independent of albedo brightness and the gameplay grid. */
export function slateFormationGeometry(size = 256, seed = 8191,
  scales = [[43,18,.95],[19,5,.6],[8,1.2,.45]]) {
  let rng = seed >>> 0;
  const random = () => ((rng = (Math.imul(rng,1664525)+1013904223)>>>0)/4294967296);
  const wrap = (x) => (x%size+size)%size;
  const field = new Float32Array(size*size);
  const variation = new Float32Array(size*size).fill(1);
  const hash=(x,y,n)=>{let v=Math.imul(x,374761393)^Math.imul(y,668265263)^n;
    v=Math.imul(v^(v>>>13),1274126177);return ((v^(v>>>16))>>>0)/4294967295;};
  const noise=(x,y,cells,n)=>{
    x=x/size*cells;y=y/size*cells;const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
    const u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy),h=(a,b)=>hash((a%cells+cells)%cells,(b%cells+cells)%cells,n);
    return (h(ix,iy)*(1-u)+h(ix+1,iy)*u)*(1-v)+(h(ix,iy+1)*(1-u)+h(ix+1,iy+1)*u)*v;
  };
  for(const [spacing,amplitude,weight] of scales) {
    const cells=Math.round(size/spacing),step=size/cells,layer=new Float32Array(size*size).fill(-amplitude);
    for(let gy=0;gy<cells;gy++)for(let gx=0;gx<cells;gx++) {
      const cx=(gx+random())*step,cy=(gy+random())*step;
      const radius=step*(.48+random()*.62),peak=amplitude*(.42+random()*.58);
      const angle=random()*Math.PI*2,tilt=.1+random()*.32;
      const planes=Array.from({length:5+Math.floor(random()*4)},(_,i)=>{
        const a=angle+i*Math.PI*.76+random()*.65;
        return {x:Math.cos(a),y:Math.sin(a),slope:(.5+random()*1.1)*amplitude/radius,
          inset:radius*(.62+random()*.5)};
      });
      const reach=Math.ceil(radius*1.8);
      for(let y=Math.floor(cy-reach);y<=cy+reach;y++)for(let x=Math.floor(cx-reach);x<=cx+reach;x++) {
        const dx=x+.5-cx,dy=y+.5-cy;
        let z=peak+(dx*Math.cos(angle)+dy*Math.sin(angle))*tilt;
        for(const p of planes) z=Math.min(z,(p.inset-dx*p.x-dy*p.y)*p.slope);
        const i=wrap(y)*size+wrap(x),prev=layer[i];
        // Tiny weathered joins, not a dark bevel surrounding every polygon.
        const k=amplitude*.055,h=Math.max(0,1-Math.abs(z-prev)/k);
        layer[i]=Math.max(z,prev)+h*h*k*.25;
      }
    }
    const sample=(x,y)=>{const ix=Math.floor(x),iy=Math.floor(y),u=x-ix,v=y-iy;
      const s=(a,b)=>layer[wrap(b)*size+wrap(a)];
      return (s(ix,iy)*(1-u)+s(ix+1,iy)*u)*(1-v)+(s(ix,iy+1)*(1-u)+s(ix+1,iy+1)*u)*v;};
    for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
      const warp=(spacing>20?3.5:1.4),n=Math.round(size/24);
      const dx=(noise(x,y,n,seed+7)-.5)*warp,dy=(noise(x,y,n,seed+29)-.5)*warp;
      const detailWeight=spacing>30?1:.25+.75*noise(x,y,Math.round(size/85),seed+61);
      field[y*size+x]+=(sample(x+dx,y+dy)-amplitude*.32)*weight*detailWeight;
    }
  }
  // Interrupted foliation: local shallow steps, never a uniform tile outline.
  for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
    const n=noise(x,y,Math.round(size/22),seed+81),m=noise(x,y,Math.round(size/9),seed+131);
    field[y*size+x]+=(n-.5)*1.2+(m-.5)*.5;
    variation[y*size+x]=.88+n*.12;
  }
  return {field,variation};
}
