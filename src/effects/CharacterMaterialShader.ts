import { CLOUD_SHADOW_GLSL } from './sunlight/cloudShadow';
import { CHARACTER_MATERIAL_CONFIG as config } from './CharacterMaterialModel';

/** GLSL ES has no implicit int→float conversion; authored tuning values may be integral. */
export function characterGLSLFloat(value: number): string {
  if (!Number.isFinite(value)) throw new Error('Character material requires finite GLSL constants');
  return Number.isInteger(value) ? value.toFixed(1) : String(value);
}
const f = characterGLSLFloat;

export const CHARACTER_MATERIAL_HEADER = `
uniform sampler2D uCharacterAlbedo, uCharacterNormal;
uniform vec4 uCharacterBeautyUV, uCharacterAlbedoUV, uCharacterNormalUV;
uniform vec3 uCharacterSun, uCharacterNormalScale;
uniform vec2 uCharacterWorld;
uniform float uCharacterStrength, uCharacterView;
uniform vec4 uCharacterLocal0, uCharacterLocal1;
${CLOUD_SHADOW_GLSL}
vec3 characterUnit(vec3 v) { return dot(v,v)>0.00000001 ? v*inversesqrt(dot(v,v)) : vec3(0,0,1); }
float characterForm(vec3 n,float ao) {
  float sun=${f(config.direct)}*uCharacterStrength*cloudTransmission(uCharacterWorld);
  float numerator=${f(config.ambient)}+sun*max(0.0,dot(n,uCharacterSun));
  float denominator=${f(config.ambient)}+sun*max(0.0,uCharacterSun.z);
  numerator+=uCharacterLocal0.w*max(0.0,dot(n,uCharacterLocal0.xyz))+uCharacterLocal1.w*max(0.0,dot(n,uCharacterLocal1.xyz));
  denominator+=uCharacterLocal0.w*max(0.0,uCharacterLocal0.z)+uCharacterLocal1.w*max(0.0,uCharacterLocal1.z);
  float active=min(1.0,sun/${f(config.direct)}+uCharacterLocal0.w+uCharacterLocal1.w);
  numerator-=${f(config.ambient*config.ao)}*(1.0-ao)*active;
  return numerator/denominator;
}
vec3 characterLinear(vec3 c) { return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(vec3(.04045),c)); }
vec3 characterSRGB(vec3 c) { return mix(c*12.92,1.055*pow(max(c,vec3(0.0)),vec3(1.0/2.4))-.055,step(vec3(.0031308),c)); }
vec4 characterMaterial(vec4 beauty,vec2 coord) {
  if(beauty.a<=0.0) return vec4(0.0);
  vec2 uv=(coord-uCharacterBeautyUV.xy)/uCharacterBeautyUV.zw;
  vec4 albedo=texture2D(uCharacterAlbedo,uCharacterAlbedoUV.xy+uv*uCharacterAlbedoUV.zw);
  vec4 data=texture2D(uCharacterNormal,uCharacterNormalUV.xy+uv*uCharacterNormalUV.zw);
  vec3 n=characterUnit((data.rgb*2.0-1.0)*uCharacterNormalScale);
  float factor=characterForm(n,data.a);
  if(uCharacterView>0.5) {
    vec3 diagnostic=albedo.rgb;
    if(uCharacterView>1.5) diagnostic=n*.5+.5;
    if(uCharacterView>2.5) {
      // 50% grey = neutral response. Magenta marks an invalid factor in the
      // diagnostic only; the production material never hides a NaN/Inf.
      diagnostic=(factor>=0.0 && factor<100.0)?vec3(factor*.5):vec3(1,0,1);
    }
    return vec4(diagnostic*beauty.a,beauty.a);
  }
  // Preserve original coverage for glow, flash and crops. The material never
  // touches destination alpha, blend modes, tint or the object's alpha.
  vec3 colour=characterSRGB(characterLinear(albedo.rgb)*vec3(${config.reflectance.map(f).join(',')})*factor);
  return vec4(colour*beauty.a,beauty.a);
}
`;
// Use the same post-SmoothPixelArt coordinates as Phaser's Beauty lookup. Raw
// outTexCoord would sample a different silhouette at magnified/cropped edges.
export const CHARACTER_MATERIAL_PROCESS = 'fragColor = characterMaterial(fragColor, texCoord);';

/** Locate the real ApplyTint instruction, including its alpha-guard namespace. */
export function characterMaterialInsertionIndex(additions: readonly { additions: object }[]): number {
  const index=additions.findIndex(a => String((a.additions as {fragmentProcess?:string}).fragmentProcess).includes('applyTint('));
  if(index<0)throw new Error('Character material requires the Phaser ApplyTint stage');
  return index;
}
