import { ROCK_COVERAGE_GLSL } from '../RockPenetrationShader';

/** Fixed program keys: one linked program each per renderer, warmed while loading. */
export const VOID_CREEP_GROUND_SHADER_NAME = 'VoidCreepGround';
export const VOID_CREEP_ROCK_SHADER_NAME = 'VoidCreepRock';
export const VOID_CREEP_GLOW_SHADER_NAME = 'VoidCreepGlow';

/**
 * Shared shape of the void creep (GDD Nachtsicht N-6, user 2026-10-18: "feiner Dunst statt großer
 * Kreise", then "dichter, weniger flimmernd, hochwertiger"). The World's creep field becomes a
 * spore haze in two layers: broad banks drifting one way and finer wisps drifting another, so the
 * haze reads as volume. Every term fades in from nothing and nothing draws an edge. Anything finer
 * than a screen pixel is faded out by the camera's pixel size instead of shimmering. Ground, rock
 * and the night glow evaluate the same haze, so the glow sits on the drawn dust.
 */
const VOID_CREEP_GLSL = `
uniform sampler2D uCreep;
uniform vec4 uCreepFrame;
uniform float uCreepTime;
float creepHash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
// Gradient noise on a triangular lattice: no square plateaus, no shared grid direction.
float creepNoise(vec2 p) {
  vec2 cell=floor(p+(p.x+p.y)*.3660254);
  vec2 v0=p-cell+(cell.x+cell.y)*.2113249;
  vec2 corner=v0.x>v0.y ? vec2(1.0,0.0) : vec2(0.0,1.0);
  vec2 v1=v0-corner+.2113249, v2=v0-1.0+.4226497;
  vec3 angle=vec3(creepHash(cell),creepHash(cell+corner),creepHash(cell+1.0))*6.2831853;
  vec3 weight=max(.5-vec3(dot(v0,v0),dot(v1,v1),dot(v2,v2)),0.0);
  weight*=weight; weight*=weight;
  return .5+35.0*dot(weight,cos(angle)*vec3(v0.x,v1.x,v2.x)+sin(angle)*vec3(v0.y,v1.y,v2.y));
}
// Creep (r) and land share (g) at a world point.
vec2 creepTexel(vec2 world) {
  vec2 uv=(world-uCreepFrame.xy)/uCreepFrame.zw;
  if(any(lessThan(uv,vec2(0.0)))||any(greaterThan(uv,vec2(1.0)))) return vec2(0.0);
  return texture2D(uCreep,vec2(uv.x,1.0-uv.y)).rg;
}
// Spore haze: x thickness 0..1, y the thick body of the clouds (where light gathers), from two
// drifting layers. Clearings stay open even where the creep is complete.
vec2 creepHaze(vec2 world, float density) {
  mat2 turn=mat2(.8,.6,-.6,.8);
  vec2 driftA=vec2(uCreepTime*.75,uCreepTime*.42), driftB=vec2(-uCreepTime*.55,uCreepTime*.85);
  float banks=creepNoise((world+driftA)*.0072+3.0)*.62+creepNoise(turn*(world+driftA)*.017+8.0)*.38;
  float wisps=creepNoise(turn*(world+driftB)*.031+1.7)*.60+creepNoise(turn*turn*(world+driftB)*.064+5.9)*.40;
  float cloud=banks*.66+wisps*.34;
  float fade=smoothstep(.02,.80,density);
  return vec2(smoothstep(.20,.64,cloud)*fade,smoothstep(.44,.78,cloud)*fade);
}
// Settled spore powder: octaves of a few pixels each, every octave faded out before it gets finer
// than about two screen pixels, so the grain never shimmers when the camera moves.
float creepGrain(vec2 world, float pixel) {
  float sum=0.0, weight=0.0, frequency=.16, amplitude=1.0;
  for(int i=0;i<3;i++) {
    float keep=1.0-smoothstep(.22,.42,frequency*pixel);
    sum+=(creepNoise(world*frequency+float(i)*7.3)-.5)*amplitude*keep;
    weight+=amplitude*keep;
    frequency*=2.07; amplitude*=.62;
  }
  return weight>0.0 ? sum/weight : 0.0;
}`;

const surfaceFragment = (rock: boolean, bruise: number, haze: number): string => `
#pragma phaserTemplate(shaderName)
precision highp float;
varying vec2 outTexCoord;
// World rectangle this quad covers; world px per screen pixel.
uniform vec4 uView;
uniform float uPixelWorld;
${VOID_CREEP_GLSL}
${rock ? ROCK_COVERAGE_GLSL : ''}
void main() {
  vec2 world=uView.xy+vec2(outTexCoord.x,1.0-outTexCoord.y)*uView.zw;
  float density=creepTexel(world).r;
  if(density<.006) discard;
  ${rock ? '// A soft fade over the rock rim instead of a cut.\n  float surface=smoothstep(.25,.9,rockCoverage(world));\n  if(surface<.004) discard;' : 'float surface=1.0;'}
  // A faint, broad bruise under the haze, feathered from nothing: no contour of its own.
  float bruise=density*density*${bruise.toFixed(2)}*(.70+.60*creepNoise(world*.0062+5.0))*surface;
  vec2 mist=creepHaze(world,density)*surface;
  // Volume: the haze a few pixels towards the light is the lit top of a cloud, its far side the
  // shaded underside. Soft, so it reads as depth rather than an outline.
  vec2 lit=creepHaze(world+vec2(-5.0,-7.0),density)*surface;
  float relief=clamp((lit.x-mist.x)*2.2,-1.0,1.0);
  float grain=creepGrain(world,uPixelWorld);
  // Dense veil: plum-grey in thin haze, paler lilac-grey where the clouds are thick; the grain
  // shades the veil itself instead of adding specks.
  float veil=mist.x*${(haze * 0.50).toFixed(3)}*(.78+.50*grain);
  vec3 tone=mix(vec3(.24,.11,.31),vec3(.45,.33,.54),mist.y)*(1.0+.16*relief+.26*grain);
  vec3 color=vec3(.11,.035,.13)*bruise;
  float alpha=bruise;
  color=tone*veil+color*(1.0-veil); alpha=veil+alpha*(1.0-veil);
  if(alpha<.004) discard;
  gl_FragColor=vec4(color,alpha);
}`;

/** Ground creep below tracks, bases and decals; material, lit by sun, light map and fog like soil. */
export const VOID_CREEP_GROUND_FRAGMENT = surfaceFragment(false, .24, 1);
/** Rock-top creep inside the V7 contour, a little lighter so the rock's own relief stays readable. */
export const VOID_CREEP_ROCK_FRAGMENT = surfaceFragment(true, .16, .85);

/**
 * Night glow of the creep in light-map space, added like the moon islands: the spore haze glows
 * softly from its thick body and breathes slowly. Only broad, smooth light lives here: the light
 * map is coarser than the screen, so anything fine would shimmer. The light map lights ground,
 * water, rock and fog with it; the bleed makes the haze luminous.
 */
export const VOID_CREEP_GLOW_FRAGMENT = `
#pragma phaserTemplate(shaderName)
precision highp float;
varying vec2 outTexCoord;
uniform vec4 uWorld;
uniform vec3 uGlow;
${VOID_CREEP_GLSL}
void main() {
  vec2 world=uWorld.xy+vec2(outTexCoord.x,1.0-outTexCoord.y)*uWorld.zw;
  vec2 texel=creepTexel(world);
  if(texel.r<.006) { gl_FragColor=vec4(0.0,0.0,0.0,1.0); return; }
  vec2 mist=creepHaze(world,texel.r);
  float breathe=.80+.20*sin(uCreepTime*.25+creepNoise(world*.0025)*6.2831853);
  gl_FragColor=vec4(uGlow*(mist.x*.34+mist.y*.30)*breathe,1.0);
}`;
