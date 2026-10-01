import type { SunTuning } from './SunTuning';

/** Shared by the ground composite, fog and shafts. Sampler/offset declarations
 * come from the receiver, so existing sceneSunlight can coexist with this field. */
export const SUN_BAND_GLSL = `
uniform float uSunOpen, uSunAlong, uSunAcross, uSunPenumbra, uSunDapple, uSunStretch;
uniform vec2 uSunDirection;
uniform float uSunLeafTime,uSunLeafFlutter;
float sunHash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float sunNoise(vec2 p) {
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(sunHash(i),sunHash(i+vec2(1.0,0.0)),f.x),
    mix(sunHash(i+vec2(0.0,1.0)),sunHash(i+vec2(1.0,1.0)),f.x),f.y);
}
vec2 sunAxes(vec2 world) {
  // u points towards the sun; v is perpendicular. World origin never drifts.
  return vec2(dot(world,uSunDirection),dot(world,vec2(-uSunDirection.y,uSunDirection.x)));
}
float sunBandField(vec2 p) {
  float along=mix(min(uSunAlong,uSunAcross*2.0),uSunAlong,uSunStretch);
  // Two transverse octaves break up widths/gaps. The second changes even more
  // slowly along the sun axis, retaining long parallel paths rather than blobs.
  return 0.65*sunNoise(p/vec2(along,uSunAcross))
    +0.35*sunNoise(p/vec2(along*1.7,uSunAcross*0.45)+vec2(13.71,37.29));
}
float sunBandVisibility(vec2 world) {
  float edge=clamp(uSunPenumbra/uSunAcross*.5,.015,.45);
  return smoothstep(1.0-uSunOpen-edge,1.0-uSunOpen+edge,sunBandField(sunAxes(world)));
}
`;
export const SUN_VISIBILITY_GLSL = SUN_BAND_GLSL + `
// Volumetric visibility deliberately has neither leaf texture nor tiny gaps.
// Broad penumbrae are a low-frequency envelope, not a blurred circle pattern.
float sunVolumeVisibility(vec2 world) {
  vec2 p=sunAxes(world),crossAxis=vec2(0.0,uSunAcross*.22);
  float field=.5*sunBandField(p)+.25*sunBandField(p+crossAxis)+.25*sunBandField(p-crossAxis);
  float edge=clamp(uSunPenumbra/uSunAcross*.5+.14,.16,.48);
  return smoothstep(1.0-uSunOpen-edge,1.0-uSunOpen+edge,field);
}
float sunGapMask(vec2 p,float leaf) {
  vec2 warp=vec2(sunNoise(p/57.0+13.7),sunNoise(p/57.0+31.9))-.5;
  float n=.7*sunNoise(p/vec2(22.0,13.0)+warp*.8)
    +.3*sunNoise(p/vec2(9.0,7.0)+warp+7.1);
  return smoothstep(.76,.93,n)*mix(.35,1.0,leaf);
}
float sunVisibility(vec2 world) {
  vec2 p=sunAxes(world);
  float field=sunBandField(p);
  float edge=clamp(uSunPenumbra/uSunAcross*0.5,0.015,0.45);
  // Incommensurate, rotated small samples retain 12-40px leaf clusters without
  // repeating the large transmission tile visibly along each band.
  if(uSunDapple<=0.0)return smoothstep(1.0-uSunOpen-edge,1.0-uSunOpen+edge,field);
  vec2 leaves=p+uSunLeafFlutter*vec2(sin(uSunLeafTime*.37+p.y*.007),.6*sin(uSunLeafTime*.29+p.x*.005));
  vec2 uv=fract(leaves/vec2(384.0,320.0));
  vec2 uv2=fract(vec2(leaves.x*.8-leaves.y*.6,leaves.x*.6+leaves.y*.8)/271.0+vec2(.31,.73));
  float leaf=smoothstep(.22,.78,0.7*texture2D(uSunTransmission,vec2(uv.x,1.0-uv.y)).r
    +0.3*texture2D(uSunTransmission,vec2(uv2.x,1.0-uv2.y)).r);
  float bands=smoothstep(1.0-uSunOpen-edge,1.0-uSunOpen+edge,
    field+(leaf-0.5)*uSunDapple*edge*1.5);
  return clamp(bands*(1.0-uSunDapple*(1.0-leaf)*.45)
    +(1.0-bands)*sunGapMask(leaves,leaf)*uSunDapple,0.0,1.0);
}

`;

export function setSunVisibilityUniforms(set: (name: string, value: unknown) => void, t: SunTuning): void {
  set('uSunOpen', t.openFraction); set('uSunAlong', t.bandAlong); set('uSunAcross', t.bandAcross);
  set('uSunPenumbra', t.penumbra); set('uSunDapple', t.dappleAmount);
}
