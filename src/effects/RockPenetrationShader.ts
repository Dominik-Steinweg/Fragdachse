import { FORMATION, FORMATION_SIDE } from '../arena/rocks/RockFormationField';
import { SURFACE_REACH_DISTANCE_START_PX, SURFACE_REACH_DISTANCE_SHARE } from './LightingConfig';

/** Fixed program key: one linked program per renderer, warmed while loading. */
export const ROCK_PENETRATION_SHADER_NAME = 'RockPenetration';
/** March samples towards the lamp; covers 1.5 reach lengths in equal steps. */
export const ROCK_PENETRATION_STEPS = 12;

/**
 * Organic rock penetration of a lamp (GDD Nachtsicht N-4), erased from an occluding light's
 * scratch texture. Each pixel marches towards the lamp over the resident V7 coverage and darkens
 * once the crossed rock depth passes the lamp's reach: the lit band follows the real contour
 * instead of the cell grid. Ground right behind a thick rock darkens the same way; ground behind
 * thin rocks keeps the exact projected shadow of the back edges.
 */
export const ROCK_PENETRATION_FRAGMENT = `
#pragma phaserTemplate(shaderName)
precision highp float;
varying vec2 outTexCoord;
uniform sampler2D uRockField, uRockLookup;
uniform vec4 uRockFrame;
// Lamp world position, scratch centre in pixels, world pixels per scratch pixel.
uniform vec4 uLamp;
// Reach near, reach far, lamp radius, lit share of the reach.
uniform vec4 uReach;
uniform vec2 uScratchSize;
uniform float uFlipY;
float rockCoverage(vec2 world) {
  vec2 local=world-uRockFrame.xy;
  if(any(lessThan(local,vec2(0.0)))||any(greaterThanEqual(local,uRockFrame.zw))) return 0.0;
  vec2 chunk=floor(local/${FORMATION.chunk}.0);
  float slot=floor(texture2D(uRockLookup,(chunk+.5)/ceil(uRockFrame.zw/${FORMATION.chunk}.0)).r*255.0+.5)-1.0;
  if(slot<0.0) return 0.0;
  vec2 grid=vec2(${FORMATION.atlasColumns}.0,${FORMATION.atlasRows}.0);
  vec2 uv=(vec2(mod(slot,grid.x),floor(slot/grid.x))*${FORMATION_SIDE}.0
    +mod(local,${FORMATION.chunk}.0)/${FORMATION.step}.0+${FORMATION.gutter}.0)/(grid*${FORMATION_SIDE}.0);
  return texture2D(uRockField,uv).a;
}
void main() {
  vec2 pixel=vec2(outTexCoord.x,mix(outTexCoord.y,1.0-outTexCoord.y,uFlipY))*uScratchSize;
  vec2 world=uLamp.xy+(pixel-uLamp.zz)*uLamp.w;
  vec2 toLamp=uLamp.xy-world;
  float dist=length(toLamp);
  if(dist>=uReach.z||dist<1.0) { gl_FragColor=vec4(0.0); return; }
  float t=clamp((dist-${SURFACE_REACH_DISTANCE_START_PX.toFixed(1)})/max(1.0,uReach.z*${SURFACE_REACH_DISTANCE_SHARE.toFixed(3)}-${SURFACE_REACH_DISTANCE_START_PX.toFixed(1)}),0.0,1.0);
  float reach=mix(uReach.x,uReach.y,t*t*(3.0-2.0*t));
  vec2 dir=toLamp/dist;
  float step=reach*1.5/${ROCK_PENETRATION_STEPS}.0, depth=0.0;
  for(int i=0;i<${ROCK_PENETRATION_STEPS};i++) {
    float along=(float(i)+.5)*step;
    if(along>=dist) break;
    depth+=rockCoverage(world+dir*along)*step;
  }
  float shade=smoothstep(reach*uReach.w,reach,depth);
  gl_FragColor=vec4(0.0,0.0,0.0,shade);
}`;
