import { FORMATION, FORMATION_SIDE } from '../arena/rocks/RockFormationField';
import { SURFACE_REACH_DISTANCE_START_PX, SURFACE_REACH_DISTANCE_SHARE } from './LightingConfig';

/** Fixed program keys: one linked program each per renderer, warmed while loading. */
export const ROCK_PENETRATION_SHADER_NAME = 'RockPenetration';
export const ROCK_SHADOW_POLAR_SHADER_NAME = 'RockShadowPolar';
/** Angular texels of a lamp's polar rock map; a cone (or the full circle) maps onto them. */
export const ROCK_SHADOW_TEXELS = 256;
/** Rows of the polar map; both hold the same rays so a centre sample never filters across data. */
export const ROCK_SHADOW_ROWS = 2;
/** Radial samples from the lamp outwards; contour crossings are interpolated between them. */
export const ROCK_SHADOW_STEPS = 256;
/** V7 coverage that counts as rock: the visible contour. */
export const ROCK_CONTOUR = 0.5;
/** Extra angle on both sides of a cone, so its soft rim never reads outside the map. */
export const ROCK_SHADOW_CONE_MARGIN = 0.12;
/** Darkening ramp around a rock's far contour: inside, outside (world px). */
export const ROCK_BEHIND_SOFT_PX = [1, 3] as const;
/** Shadow sides: half-width at least this many light-map pixels, growing with lamp distance. */
export const ROCK_PENUMBRA_MIN_LIGHTMAP_PX = 1.5;
export const ROCK_PENUMBRA_PER_PX = 0.015;

/** Angle the polar map spans for a lamp: its cone plus margin, or the full circle. */
export function rockShadowSpan(shape: 'radial' | 'cone', coneAngle: number): number {
  return shape === 'cone' ? Math.min(Math.PI * 2, coneAngle + ROCK_SHADOW_CONE_MARGIN * 2) : Math.PI * 2;
}

/**
 * CPU twin of the polar march: the first rock segment along one ray from the lamp. `coverageAt`
 * reads V7 coverage at a distance from the lamp. Without rock both ends are the radius; a ray
 * that never leaves its first rock exits at the radius.
 */
export function firstRockSegment(coverageAt: (distance: number) => number, radius: number,
  steps = ROCK_SHADOW_STEPS): { enter: number; exit: number } {
  const step = radius / steps;
  let previousDistance = 0, previous = coverageAt(0), enter = radius, exit = radius;
  let inside = previous >= ROCK_CONTOUR;
  if (inside) enter = 0;
  for (let i = 0; i < steps; i++) {
    const distance = (i + 0.5) * step, coverage = coverageAt(distance);
    if (!inside && coverage >= ROCK_CONTOUR) {
      enter = previousDistance + (distance - previousDistance) * (ROCK_CONTOUR - previous) / Math.max(coverage - previous, 1e-4);
      inside = true;
    } else if (inside && coverage < ROCK_CONTOUR) {
      exit = previousDistance + (distance - previousDistance) * (previous - ROCK_CONTOUR) / Math.max(previous - coverage, 1e-4);
      break;
    }
    previousDistance = distance; previous = coverage;
  }
  return { enter, exit };
}

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * CPU twin of the lamp shade on one ray (GDD Nachtsicht N-4). Before the first rock everything
 * is lit. The lamp lights the first rock's surface up to `reach` deep, fading after
 * `reach * litShare`. Everything beyond that rock's far contour stays dark, ground and further
 * rocks alike, so light never shows behind a rock that casts the shadow.
 */
export function rockLampShade(enter: number, exit: number, distance: number, reach: number, litShare: number): number {
  if (distance < enter) return 0;
  return Math.max(smoothstep(reach * litShare, reach, distance - enter),
    smoothstep(exit - ROCK_BEHIND_SOFT_PX[0], exit + ROCK_BEHIND_SOFT_PX[1], distance));
}

const COVERAGE_GLSL = `
uniform sampler2D uRockField, uRockLookup;
uniform vec4 uRockFrame;
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
}`;
const CONTOUR = ROCK_CONTOUR.toFixed(2);

/**
 * Polar rock map of one lamp: each texel is a ray at its angle and stores where the ray enters
 * and leaves its first rock, both as 16-bit fractions of the radius (enter in RG, exit in BA).
 * Drawn without blending, so every channel is written as computed.
 */
export const ROCK_SHADOW_POLAR_FRAGMENT = `
#pragma phaserTemplate(shaderName)
precision highp float;
varying vec2 outTexCoord;
${COVERAGE_GLSL}
// Lamp world position, radius, central direction.
uniform vec4 uLamp;
uniform float uSpan;
vec2 encode(float v) { v=clamp(v,0.0,1.0)*255.0; return vec2(floor(v)/255.0,fract(v)); }
void main() {
  float angle=uLamp.w+(outTexCoord.x-.5)*uSpan;
  vec2 dir=vec2(cos(angle),sin(angle));
  float radius=uLamp.z, step=radius/${ROCK_SHADOW_STEPS}.0;
  float previousDistance=0.0, previous=rockCoverage(uLamp.xy), enter=radius, exit=radius;
  bool inside=previous>=${CONTOUR};
  if(inside) enter=0.0;
  for(int i=0;i<${ROCK_SHADOW_STEPS};i++) {
    float distance=(float(i)+.5)*step, coverage=rockCoverage(uLamp.xy+dir*distance);
    if(!inside&&coverage>=${CONTOUR}) {
      enter=previousDistance+(distance-previousDistance)*(${CONTOUR}-previous)/max(coverage-previous,1e-4);
      inside=true;
    } else if(inside&&coverage<${CONTOUR}) {
      exit=previousDistance+(distance-previousDistance)*(previous-${CONTOUR})/max(previous-coverage,1e-4);
      break;
    }
    previousDistance=distance; previous=coverage;
  }
  gl_FragColor=vec4(encode(enter/radius),encode(exit/radius));
}`;

/**
 * Lamp shade on rocks (GDD Nachtsicht N-4), erased from an occluding light's scratch texture.
 * Each pixel reads its ray in the lamp's polar rock map: lit up to the first rock, the rock's
 * surface lit to the lamp's reach, everything behind that rock dark. Light and shadow therefore
 * follow the same organic contour on the ground and on further rocks. Shadow edges keep at least
 * a light-map pixel and a half of penumbra, so they never alias into steps.
 */
export const ROCK_PENETRATION_FRAGMENT = `
#pragma phaserTemplate(shaderName)
precision highp float;
varying vec2 outTexCoord;
uniform sampler2D uRockShadow;
// Lamp world position, scratch centre in pixels, world pixels per scratch pixel.
uniform vec4 uLamp;
// Reach near, reach far, lamp radius, lit share of the reach.
uniform vec4 uReach;
// Central direction, span, 1 when the map wraps around the full circle.
uniform vec3 uCone;
uniform vec2 uScratchSize;
uniform float uFlipY;
const float TEXELS=${ROCK_SHADOW_TEXELS}.0;
float decode(vec2 v) { return v.x+v.y/255.0; }
float shadeOf(float texel, float distance) {
  texel=uCone.z>.5?mod(texel,TEXELS):clamp(texel,0.0,TEXELS-1.0);
  vec4 ray=texture2D(uRockShadow,vec2((texel+.5)/TEXELS,${(0.5 / ROCK_SHADOW_ROWS).toFixed(3)}));
  float radius=uReach.z, enter=decode(ray.rg)*radius, exit=decode(ray.ba)*radius;
  if(distance<enter) return 0.0;
  float t=clamp((enter-${SURFACE_REACH_DISTANCE_START_PX.toFixed(1)})/max(1.0,radius*${SURFACE_REACH_DISTANCE_SHARE.toFixed(3)}-${SURFACE_REACH_DISTANCE_START_PX.toFixed(1)}),0.0,1.0);
  float reach=mix(uReach.x,uReach.y,t*t*(3.0-2.0*t));
  return max(smoothstep(reach*uReach.w,reach,distance-enter),
    smoothstep(exit-${ROCK_BEHIND_SOFT_PX[0].toFixed(1)},exit+max(${ROCK_BEHIND_SOFT_PX[1].toFixed(1)},${ROCK_PENUMBRA_MIN_LIGHTMAP_PX.toFixed(1)}*uLamp.w),distance));
}
void main() {
  vec2 pixel=vec2(outTexCoord.x,mix(outTexCoord.y,1.0-outTexCoord.y,uFlipY))*uScratchSize;
  vec2 world=uLamp.xy+(pixel-uLamp.zz)*uLamp.w;
  vec2 fromLamp=world-uLamp.xy;
  float distance=length(fromLamp);
  if(distance>=uReach.z||distance<1.0) { gl_FragColor=vec4(0.0); return; }
  float angle=mod(atan(fromLamp.y,fromLamp.x)-uCone.x+3.14159265,6.28318531)-3.14159265;
  float x=(angle/uCone.y+.5)*TEXELS-.5;
  if(uCone.z<.5&&(x<-1.0||x>TEXELS)) { gl_FragColor=vec4(0.0); return; }
  // Penumbra: never thinner than ${ROCK_PENUMBRA_MIN_LIGHTMAP_PX} light-map pixels, so a grazing edge does not
  // alias, and slowly wider with distance. Five interpolated rays under a tent.
  float soft=max(${ROCK_PENUMBRA_MIN_LIGHTMAP_PX.toFixed(1)}*uLamp.w,${ROCK_PENUMBRA_PER_PX.toFixed(3)}*distance);
  float halfTexels=max(.5,soft/distance/(uCone.y/TEXELS));
  float shade=0.0;
  for(int k=0;k<5;k++) {
    float offset=(float(k)-2.0)*.5*halfTexels, weight=3.0-abs(float(k)-2.0);
    float ray=x+offset, base=floor(ray);
    shade+=weight*mix(shadeOf(base,distance),shadeOf(base+1.0,distance),ray-base);
  }
  gl_FragColor=vec4(0.0,0.0,0.0,shade/9.0);
}`;
