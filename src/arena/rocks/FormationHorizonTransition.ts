/** Solar horizons and contact AO packed separately from normals, coverage and ambient
 * cavity. Interrupted transitions start at the currently visible horizon. */
export function packPreviousHorizons(data: Uint8Array, occlusion: Uint8Array,
  previous: Uint8Array, mix: number): void {
  for(let i=0;i<data.length;i+=4) {
    previous[i]=Math.round(previous[i]+(data[i+2]-previous[i])*mix);
    previous[i+1]=Math.round(previous[i+1]+(occlusion[i+1]-previous[i+1])*mix);
    previous[i+2]=Math.round(previous[i+2]+(occlusion[i+2]-previous[i+2])*mix);
    previous[i+3]=Math.round(previous[i+3]+(occlusion[i+3]-previous[i+3])*mix);
  }
}
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
