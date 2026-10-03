import type { SunTuning } from '../../effects/sunlight/SunTuning';
const clamp=(x:number)=>Math.max(0,Math.min(1,x));
export const canopyLinear=(x:number):number=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4;
/** World sun vector -> N, NE, E, SE / S, SW, W, NW. Caller owns both arrays. */
export function canopyHorizonWeights(sun:readonly number[],a:number[],b:number[]):void {
  for(let i=0;i<4;i++){a[i]=0;b[i]=0;}
  const t=((Math.atan2(sun[0],-sun[1])*4/Math.PI)%8+8)%8,i=Math.floor(t),f=t-i,j=(i+1)%8;
  (i<4?a:b)[i%4]=1-f;(j<4?a:b)[j%4]=f;
}
/** CPU counterpart of direct light, independent of colour/tint and ambient. */
export function canopyV9Direct(normal:readonly number[],sun:readonly number[],horizon:number,thickness:number,
  strength:number,t:SunTuning):number {
  if(strength<=0)return 0;
  const elevation=Math.asin(clamp(sun[2])),ndl=normal[0]*sun[0]+normal[1]*sun[1]+normal[2]*sun[2];
  const x=clamp((elevation-horizon+t.canopyHorizonSoftness)/(2*t.canopyHorizonSoftness));
  const visibility=.16+.84*x*x*(3-2*x);
  const diffuse=clamp((ndl+t.canopyWrap)/(1+t.canopyWrap));
  const back=t.canopyTranslucency*(1-clamp(thickness))**1.5*Math.max(0,-ndl+.15)*Math.cos(elevation)*(.35+.65*visibility);
  return strength*t.canopySunWeight*(diffuse*visibility+back);
}
export const CANOPY_V9_GLSL=`
uniform float uCrownHorizons;
uniform sampler2D uCrownData,uCrownH0,uCrownH1;
uniform vec4 uHorizonWeights0,uHorizonWeights1,uCrownModel;
uniform vec3 uCrownSunColor;
uniform float uCrownSunWeight;
vec3 crownLinear(vec3 x){return mix(x/12.92,pow((x+.055)/1.055,vec3(2.4)),step(vec3(.04045),x));}
vec3 crownSrgb(vec3 x){return mix(x*12.92,1.055*pow(max(x,vec3(0)),vec3(1.0/2.4))-.055,step(vec3(.0031308),x));}
vec3 crownV9(vec3 albedo,vec2 uv,vec2 world,vec3 crownAmbient) {
  vec4 d=texture2D(uCrownData,uv);
  vec4 h0=vec4(0.0),h1=vec4(0.0);
  if(uCrownHorizons>0.5){h0=texture2D(uCrownH0,uv);h1=texture2D(uCrownH1,uv);}
  vec2 xy=d.rg*2.0-1.0;
  vec3 n=normalize(vec3(xy,sqrt(max(0.0,1.0-dot(xy,xy)))));
  float horizon=(dot(h0,uHorizonWeights0)+dot(h1,uHorizonWeights1))*1.570796327;
  float elevation=asin(clamp(uCrownSun.z,0.0,1.0));
  float visibility=uCrownHorizons>0.5?mix(.16,1.0,smoothstep(-uCrownModel.w,uCrownModel.w,elevation-horizon)):1.0;
  float ndl=dot(n,uCrownSun),diffuse=clamp((ndl+uCrownModel.x)/(1.0+uCrownModel.x),0.0,1.0);
  float back=uCrownModel.z*pow(1.0-d.a,1.5)*max(0.0,-ndl+.15)*cos(elevation)*(.35+.65*visibility);
  vec3 ambient=crownAmbient*mix(1.0,d.b,uCrownModel.y);
  vec3 direct=uCrownSunColor*uCrownStrength*uCrownSunWeight*(diffuse*visibility+back)*cloudTransmission(world);
  vec3 shade=mix(vec3(1.0),mix(uCloudCanopyShade,vec3(1.0),cloudShadow(world,uCloudTime)),uCloudStrength*uCloudDensity);
  return crownSrgb(crownLinear(albedo)*(ambient+direct))*shade;
}
`;
