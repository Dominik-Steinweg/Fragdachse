/** CPU counterpart of the three shifted dome samples and final source-over alpha. */
const clamp=(n:number)=>Math.max(0,Math.min(1,n));
const smooth=(a:number,b:number,n:number)=>{const t=clamp((n-a)/(b-a));return t*t*(3-2*t);};
export function vegetationShadowAlpha(coverage:number,plant:number,sunZ:number,strength:number,
 amount:number,canopy=1,cloud=1,enabled=true):number {
 if(!enabled||!(strength>0)||!(sunZ>0))return 0;
 const low=1-smooth(.60,Math.SQRT1_2,sunZ);
 return Math.min(.55,Math.max(0,amount))*(.45+.55*low)*clamp(strength)*clamp(canopy)*clamp(cloud)
  *smooth(.015,.32,coverage)*(1-smooth(.02,.18,plant));
}
/** LINEAR sampling of RGBA8 data, with the same half-texel convention as WebGL. */
export function vegetationDataAt(data:Uint8Array,size:number,x:number,y:number,channel:number):number {
 const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;let value=0;
 for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
  const sx=Math.max(0,Math.min(size-1,ix+dx)),sy=Math.max(0,Math.min(size-1,iy+dy));
  value+=data[(sy*size+sx)*4+channel]/255*(dx?fx:1-fx)*(dy?fy:1-fy);
 }
 return value;
}
export function vegetationShadowCoverage(data:Uint8Array,size:number,x:number,y:number,dx:number,dy:number):number {
 const length=Math.hypot(dx,dy),width=1.5+length*.12;
 const px=-dy/Math.max(.001,length)*width,py=dx/Math.max(.001,length)*width;
 const sample=(sx:number,sy:number)=>vegetationDataAt(data,size,sx,sy,0)*.55+vegetationDataAt(data,size,sx,sy,1)*.45;
 // Coordinates/offsets are in world pixels; the data grid is two world px/texel.
 return .35*sample(x+dx*.55/2,y+dy*.55/2)
  +.325*sample(x+(dx+px)/2,y+(dy+py)/2)+.325*sample(x+(dx-px)/2,y+(dy-py)/2);
}
export const VEGETATION_SHADOW_GLSL=`
float vegetationShadowAlpha(float coverage,float plant,float sunZ,float strength,float amount,float canopy,float cloud) {
 if(strength<=0.0||sunZ<=0.0)return 0.0;
 float low=1.0-smoothstep(.60,.7071067811865476,sunZ);
 return clamp(amount,0.0,.55)*(.45+.55*low)*clamp(strength,0.0,1.0)*clamp(canopy,0.0,1.0)*clamp(cloud,0.0,1.0)
  *smoothstep(.015,.32,coverage)*(1.0-smoothstep(.02,.18,plant));
}
float vegetationDome(vec2 uv) {return dot(texture2D(uVegData,uv).rg,vec2(.55,.45));}
float vegetationCanopy(vec2 world) {
 vec2 uv=(world-uCloudWorld.xy)/max(uCloudWorld.zw,vec2(1.0));
 if(uCloudCached>.5&&all(greaterThanEqual(uv,vec2(0)))&&all(lessThanEqual(uv,vec2(1))))
  return texture2D(uCloudField,vec2(uv.x,1.0-uv.y)).a;
 return sunVisibility(world);
}
`;
