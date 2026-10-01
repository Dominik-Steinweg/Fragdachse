/** Receiver helpers. Include CLOUD_SHADOW_GLSL first. All receivers share the
 * same world-space opening; only material form light uses the solar direction. */
export const SUN_VISIBILITY_GLSL = `
float sunHash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float sunNoise(vec2 p) {
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(sunHash(i),sunHash(i+vec2(1.0,0.0)),f.x),
    mix(sunHash(i+vec2(0.0,1.0)),sunHash(i+vec2(1.0,1.0)),f.x),f.y);
}
float sunVisibility(vec2 world) {
  return sunlightFromCloud(cloudShadow(world,uCloudTime));
}
// No leaves, directional apertures or extra contrast in the fog receiver.
float sunVolumeVisibility(vec2 world) { return sunVisibility(world); }
`;

/** Ground modulation and fog compensation must use exactly the same factor. */
export const SUN_COMPOSITE_FACTOR_GLSL=`
vec3 sunCompositeFactor(vec3 shade,vec3 daylight,vec3 lit,float visibility,float strength,float grain) {
  // Ordinary clear sky is near-neutral. Only the clearest openings get the
  // warm highlight colour; a middle visibility is not half a golden highlight.
  vec3 light=mix(shade,daylight,smoothstep(.18,.68,visibility));
  light=mix(light,lit,smoothstep(.80,1.0,visibility));
  vec3 factor=mix(vec3(1.0),clamp(light,0.0,2.0),strength);
  return clamp(factor+grain*(2.0/255.0)*min(1.0,strength*8.0),0.0,2.0);
}
`;

/** CPU contract for receiver compensation; caller owns reusable RGB storage. */
export function sunCompositeFactor(out:number[],shade:readonly number[],daylight:readonly number[],lit:readonly number[],visibility:number,strength:number,grain=0):void {
  const smooth=(a:number,b:number):number=>{const t=Math.max(0,Math.min(1,(visibility-a)/(b-a)));return t*t*(3-2*t);};
  const clear=smooth(.18,.68),highlight=smooth(.80,1);
  for(let i=0;i<3;i++){
    const normal=shade[i]+(daylight[i]-shade[i])*clear;
    const litFactor=Math.max(0,Math.min(2,normal+(lit[i]-normal)*highlight));
    out[i]=Math.max(0,Math.min(2,1+(litFactor-1)*strength+grain*(2/255)*Math.min(1,strength*8)));
  }
}
