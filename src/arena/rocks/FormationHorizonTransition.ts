/** The secondary azimuth support: its three solar horizon angles and contact AO, packed
 * apart from the direction-independent normals, coverage and ambient cavity. */
export function packHorizonSupport(data: Uint8Array, occlusion: Uint8Array, out: Uint8Array): void {
  for(let i=0;i<data.length;i+=4) {
    out[i]=data[i+2];out[i+1]=occlusion[i+1];out[i+2]=occlusion[i+2];out[i+3]=occlusion[i+3];
  }
}
/** Per-slot weight of the primary support. Both supports store horizon angles, so the mix
 * is an angle interpolation by azimuth that precedes every visibility test – the shadow
 * edge moves instead of fading between two finished results. */
export const HORIZON_BLEND_GLSL = `
uniform sampler2D uHorizonPrevious;
uniform vec4 uHorizonBlend[16];
float horizonMix(float slot) {
  vec4 group=vec4(1.0);
  // Literal indices also compile on WebGL 1 fragment implementations which do
  // not support dynamically indexed uniform arrays. Generated once, never per draw.
  ${Array.from({length:16},(_,i)=>`${i?'else ':''}if(slot<${((i+1)*4).toFixed(1)}) group=uHorizonBlend[${i}];`).join('\n  ')}
  float component=mod(slot,4.0);
  return component<.5?group.x:component<1.5?group.y:component<2.5?group.z:group.w;
}
vec4 blendHorizons(vec4 next,vec2 uv,float slot) {
  float weight=horizonMix(slot);
  if(weight>=1.0)return next;
  return mix(texture2D(uHorizonPrevious,uv),next,weight);
}
`;
