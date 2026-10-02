import { FORMATION, FORMATION_SIDE } from '../../arena/rocks/RockFormationField';

/** R: mineral alpha, G: resident geometry, A: bases. Data, never PMA colour.
 * Mineral alpha is sampled at the final composite as well, independently of the
 * reduced fog material and the deliberately broad base-image feather. */
export const FOG_SURFACE_FRAGMENT = `
#pragma phaserTemplate(shaderName)
precision highp float;
varying vec2 outTexCoord;
uniform sampler2D uBases,uRockField,uRockLookup;
uniform float uHasBases,uHasRocks;
uniform vec4 uView,uRockFrame;
void main() {
 float base=uHasBases>.5?texture2D(uBases,outTexCoord).a:0.0;
 vec2 world=uView.xy+vec2(outTexCoord.x,1.0-outTexCoord.y)*uView.zw;
 vec2 local=world-uRockFrame.xy;
 float coverage=0.0,valid=0.0;
 if(uHasRocks>.5&&all(greaterThanEqual(local,vec2(0)))&&all(lessThan(local,uRockFrame.zw))) {
   vec2 chunk=floor(local/${FORMATION.chunk}.0);
   float slot=floor(texture2D(uRockLookup,(chunk+.5)/ceil(uRockFrame.zw/${FORMATION.chunk}.0)).r*255.0+.5)-1.0;
   if(slot>=0.0) {
     vec2 grid=vec2(${FORMATION.atlasColumns}.0,${FORMATION.atlasRows}.0);
     vec2 uv=(vec2(mod(slot,grid.x),floor(slot/grid.x))*${FORMATION_SIDE}.0
       +mod(local,${FORMATION.chunk}.0)/${FORMATION.step}.0+${FORMATION.gutter}.0)/(grid*${FORMATION_SIDE}.0);
     coverage=texture2D(uRockField,uv).a;valid=1.0;
   }
 }
 gl_FragColor=vec4(coverage,valid,0.0,base);
}
`;

/** Geometry must not become coarser with the Low quality material. */
export function fogSurfaceSize(width: number, height: number): [number, number] {
  return [Math.max(2, Math.ceil(width / 2)), Math.max(2, Math.ceil(height / 2))];
}
