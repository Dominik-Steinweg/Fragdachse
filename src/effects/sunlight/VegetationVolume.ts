import { FOREST_VEGETATION_CONFIG, GROUND_COVER_CONFIG, getGroundCoverTextureKey } from '../../arena/GroundCoverConfig';

/** Upright registry tiers only. Moss, litter, soil and gravel are deliberately flat. */
const COVER_KEYS=new Set([...GROUND_COVER_CONFIG.variants,...FOREST_VEGETATION_CONFIG.variants]
  .map(v=>getGroundCoverTextureKey(v.fileName)));
const DECAL_KEYS=new Set(['flower01','flower02','flower03','flower04','busch01','busch02','grass01','grass02','pilz01']);
export function isVolumeVegetation(key:string,decals=false):boolean {
 return (decals?DECAL_KEYS:COVER_KEYS).has(key);
}
// Max cast length 22 + soft penumbra/bilinear reach. Colour gutter stays unchanged.
export const VEGETATION_PAD=28;
export interface VegetationAlpha { width:number; height:number; alpha:Uint8Array }

/** Runtime rasterizer and CPU reference. Alpha has no baked lighting direction:
 * rotate/reflect the source coverage with exactly the colour stamp transform. */
export function stampVegetationAlpha(out:Float32Array,side:number,originX:number,originY:number,
 source:VegetationAlpha,x:number,y:number,width:number,height:number,rotation:number,alpha:number,
 flipX=false,flipY=false):void {
 if(!(width>0&&height>0&&alpha>0))return;
 const c=Math.cos(rotation),s=Math.sin(rotation),rx=(Math.abs(c)*width+Math.abs(s)*height)/2,
 ry=(Math.abs(s)*width+Math.abs(c)*height)/2;
 const x0=Math.max(0,Math.floor((x-rx-originX)/2)),x1=Math.min(side,Math.ceil((x+rx-originX)/2));
 const y0=Math.max(0,Math.floor((y-ry-originY)/2)),y1=Math.min(side,Math.ceil((y+ry-originY)/2));
 for(let py=y0;py<y1;py++)for(let px=x0;px<x1;px++){
  const dx=originX+px*2+1-x,dy=originY+py*2+1-y;
  const u=((c*dx+s*dy)/width*(flipX?-1:1)+.5)*source.width-.5;
  const v=((-s*dx+c*dy)/height*(flipY?-1:1)+.5)*source.height-.5;
  const ix=Math.floor(u),iy=Math.floor(v),fx=u-ix,fy=v-iy;
  let a=0;
  for(let oy=0;oy<2;oy++)for(let ox=0;ox<2;ox++){
   const sx=ix+ox,sy=iy+oy;
   if(sx>=0&&sy>=0&&sx<source.width&&sy<source.height)
    a+=source.alpha[sy*source.width+sx]*(ox?fx:1-fx)*(oy?fy:1-fy);
  }
  a=a/255*Math.min(1,alpha);const i=py*side+px;out[i]+=a*(1-out[i]);
 }
}
function boxPass(src:Float32Array,out:Float32Array,n:number,r:number,vertical:boolean):void {
 const stride=vertical?n:1,span=2*r+1;
 for(let line=0;line<n;line++){
  const base=vertical?line:line*n;let sum=0;
  for(let k=0;k<=r;k++)sum+=src[base+k*stride];
  for(let k=0;k<n;k++){
   out[base+k*stride]=sum/span;
   if(k-r>=0)sum-=src[base+(k-r)*stride];
   if(k+r+1<n)sum+=src[base+(k+r+1)*stride];
  }
 }
}
/** Two separable box blurs approximate a smooth dome. Gradient is baked too:
 * RG=height/coverage, BA=world normal XY. No derivative samples each frame. */
export function packVegetationVolume(raw:Float32Array,a:Float32Array,b:Float32Array,
 side:number,radius:number,out:Uint8Array):void {
 boxPass(raw,a,side,radius,false);boxPass(a,b,side,radius,true);
 boxPass(b,a,side,radius,false);boxPass(a,b,side,radius,true);
 const border=2*radius,n=side-2*border;
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const i=(y+border)*side+x+border,p=(y*n+x)*4;
  const nx=-(b[i+1]-b[i-1])*18/4,ny=-(b[i+side]-b[i-side])*18/4,l=Math.sqrt(nx*nx+ny*ny+1);
  out[p]=Math.round(b[i]*255);out[p+1]=Math.round(raw[i]*255);
  out[p+2]=Math.round((nx/l*.5+.5)*255);out[p+3]=Math.round((ny/l*.5+.5)*255);
 }
}
export function vegetationFormFactor(nx:number,ny:number,sun:readonly number[],strength:number,light=1,cloud=1):number {
 if(!(strength>0))return 1;
 const z=Math.sqrt(Math.max(0,1-nx*nx-ny*ny));
 const delta=nx*sun[0]+ny*sun[1]+z*sun[2]-sun[2];
 return 1+Math.max(-.20,Math.min(.15,delta*light))*Math.min(1,strength)*cloud;
}
export function vegetationShadowLength(elevation:number,base:number):number {
 // The game's artistic sun tops out at 45 degrees. Expand its shallow 1..1.9
 // cotangent range to readable short vegetation shadows, without changing sunpath.
 return Math.max(3,Math.min(22,base*(1+4.5*Math.max(0,1/Math.max(.1,Math.tan(elevation))-1))));
}
