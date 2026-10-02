/** Blender-independent reference. World X right/Y south, clockwise rotations, light TOWARD sun. */
export function transformPoint(p, rotation = 0, socket = null) {
  let [x, y, z] = p;
  if (socket) {
    const a = socket.rotationMatrix, t = socket.position;
    [x, y, z] = [a[0]*x+a[1]*y+a[2]*z+t[0], a[3]*x+a[4]*y+a[5]*z+t[1], a[6]*x+a[7]*y+a[8]*z+t[2]];
  }
  const c = Math.cos(rotation), s = Math.sin(rotation);
  return [c*x-s*y, s*x+c*y, z];
}
export function projectPoint(p, azimuth, elevation) {
  if (!(elevation > 0 && elevation <= Math.PI / 2)) throw Error('Projection needs sun above horizon');
  const reach = Math.max(0, p[2]) / Math.tan(elevation);
  return [p[0] - Math.cos(azimuth) * reach, p[1] - Math.sin(azimuth) * reach];
}
export function projectMesh(positions, rotation, azimuth, elevation, socket = null) {
  const out = new Float64Array(positions.length / 3 * 2);
  for (let i = 0; i < positions.length; i += 3) out.set(projectPoint(transformPoint(positions.subarray(i, i+3), rotation, socket), azimuth, elevation), i / 3 * 2);
  return out;
}
const edge = (a,b,x,y) => (x-a[0])*(b[1]-a[1])-(y-a[1])*(b[0]-a[0]);
/** Opaque union, independent of triangle winding, submission order and overlap. */
export function rasterUnion(parts, bounds, density = 3) {
  const width = Math.round((bounds[2]-bounds[0])*density), height = Math.round((bounds[3]-bounds[1])*density);
  const data = new Uint8Array(width * height);
  for (const { xy, indices } of parts) {
    if ([...xy].some((v, i) => v < bounds[i%2] + 2 || v > bounds[i%2+2] - 2)) throw Error('Review canvas clips projected geometry');
    for (let j = 0; j < indices.length; j += 3) {
      const t = [0,1,2].map(k => { const i = indices[j+k]*2; return [(xy[i]-bounds[0])*density, (xy[i+1]-bounds[1])*density]; });
      const area = edge(t[0], t[1], ...t[2]); if (Math.abs(area) < 1e-10) continue;
      const sign = Math.sign(area);
      const x0 = Math.max(0,Math.floor(Math.min(...t.map(p=>p[0])))), x1 = Math.min(width-1,Math.ceil(Math.max(...t.map(p=>p[0]))));
      const y0 = Math.max(0,Math.floor(Math.min(...t.map(p=>p[1])))), y1 = Math.min(height-1,Math.ceil(Math.max(...t.map(p=>p[1]))));
      for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++) if (edge(t[0],t[1],x+.5,y+.5)*sign>=-1e-8
        && edge(t[1],t[2],x+.5,y+.5)*sign>=-1e-8 && edge(t[2],t[0],x+.5,y+.5)*sign>=-1e-8) data[y*width+x]=255;
    }
  }
  return { data, width, height };
}
export function softMask(mask, sigma) {
  if (sigma <= 0) return Float32Array.from(mask.data, x=>x/255);
  const radius=Math.ceil(3*sigma), weights=Array.from({length:radius*2+1},(_,i)=>Math.exp(-.5*((i-radius)/sigma)**2));
  const sum=weights.reduce((a,b)=>a+b,0); weights.forEach((w,i)=>weights[i]=w/sum);
  const {width:w,height:h}=mask, temp=new Float32Array(w*h), out=new Float32Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let i=-radius;i<=radius;i++) if(x+i>=0&&x+i<w)temp[y*w+x]+=mask.data[y*w+x+i]/255*weights[i+radius];
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let i=-radius;i<=radius;i++) if(y+i>=0&&y+i<h)out[y*w+x]+=temp[(y+i)*w+x]*weights[i+radius];
  return out;
}
export function bilinear(data, w, h, x, y, channels=1, channel=0) {
  const ix=Math.floor(x),iy=Math.floor(y),u=x-ix,v=y-iy;
  const at=(a,b)=>a<0||b<0||a>=w||b>=h?0:data[(b*w+a)*channels+channel];
  return (at(ix,iy)*(1-u)+at(ix+1,iy)*u)*(1-v)+(at(ix,iy+1)*(1-u)+at(ix+1,iy+1)*u)*v;
}
