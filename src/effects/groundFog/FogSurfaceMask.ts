import { FORMATION, FORMATION_SIDE } from '../../arena/rocks/RockFormationField';
import { HORIZON_BLEND_GLSL } from '../../arena/rocks/FormationHorizonTransition';
import { FOG_ROCK_LIGHTING } from './FogRockLighting';

/** R: mineral alpha, G: resident geometry, B: fog radiance retention, A: bases. Data, never PMA colour.
 * Mineral alpha is sampled at the final composite as well, independently of the
 * reduced fog material and the deliberately broad base-image feather. */
export const FOG_SURFACE_FRAGMENT = `
#pragma phaserTemplate(shaderName)
precision highp float;
varying vec2 outTexCoord;
uniform sampler2D uBases,uRockField,uRockLookup,uRockOcclusion;
uniform float uHasBases,uHasRocks,uHasRockShadows;
uniform vec2 uRockFogStrength;
uniform vec3 uRockSun;
uniform float uRockSolarStrength;
uniform vec4 uView,uRockFrame;
${HORIZON_BLEND_GLSL}
void main() {
 float base=uHasBases>.5?texture2D(uBases,outTexCoord).a:0.0;
 vec2 world=uView.xy+vec2(outTexCoord.x,1.0-outTexCoord.y)*uView.zw;
 vec2 local=world-uRockFrame.xy;
 float coverage=0.0,valid=0.0,retention=1.0;
 if(uHasRocks>.5&&all(greaterThanEqual(local,vec2(0)))&&all(lessThan(local,uRockFrame.zw))) {
   vec2 chunk=floor(local/${FORMATION.chunk}.0);
   float slot=floor(texture2D(uRockLookup,(chunk+.5)/ceil(uRockFrame.zw/${FORMATION.chunk}.0)).r*255.0+.5)-1.0;
   if(slot>=0.0) {
     vec2 grid=vec2(${FORMATION.atlasColumns}.0,${FORMATION.atlasRows}.0);
     vec2 uv=(vec2(mod(slot,grid.x),floor(slot/grid.x))*${FORMATION_SIDE}.0
       +mod(local,${FORMATION.chunk}.0)/${FORMATION.step}.0+${FORMATION.gutter}.0)/(grid*${FORMATION_SIDE}.0);
     vec4 data=texture2D(uRockField,uv);
     coverage=data.a;valid=1.0;
     if(uHasRockShadows>.5) {
       vec4 shelter=texture2D(uRockOcclusion,uv);
       // Keep contact through the antialiased contour. The display pass cuts fog
       // by mineral coverage; fading contact first leaves a bright fringe.
       // Current contact is independent of sun, horizon quality and azimuth fades.
       float contact=1.0-shelter.a;
       retention=1.0-uRockFogStrength.x*contact;
       if(uRockSolarStrength>0.0 && uRockFogStrength.y>0.0 && uRockSun.z>0.0) {
         vec3 horizons=blendHorizons(vec4(data.b,shelter.gba),uv,slot).rgb*1.570796327;
         float elevation=asin(clamp(uRockSun.z,0.0,1.0));
         vec3 visibility=smoothstep(horizons-vec3(${FOG_ROCK_LIGHTING.sunSoftness}),horizons+vec3(${FOG_ROCK_LIGHTING.sunSoftness}),vec3(elevation));
         float shadow=1.0-dot(visibility,vec3(.5,.25,.25));
         // The horizontal receiver loses direct light smoothly towards night.
         float direct=clamp(uRockSolarStrength,0.0,1.0)*smoothstep(0.0,.25,uRockSun.z);
         retention*=1.0-uRockFogStrength.y*shadow*direct;
       }
     }
   }
 }
 gl_FragColor=vec4(coverage,valid,retention,base);
}
`;

/** Geometry must not become coarser with the Low quality material. */
export function fogSurfaceSize(width: number, height: number): [number, number] {
  return [Math.max(2, Math.ceil(width / 2)), Math.max(2, Math.ceil(height / 2))];
}
