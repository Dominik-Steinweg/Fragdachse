import { ROCK_COVERAGE_GLSL } from '../RockPenetrationShader';
import { FOG_SHAPE_GLSL, FOG_SHAPE_RANGE } from './fogShape';
import { FOG } from '../groundFog/FogConfig';
import { VOID_TAINT } from '../../arena/VoidTaint';

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
/** Share of the haze that stays over open water (Map 20: the kraken must stay visible in its pond). */
export const OPEN_WATER_HAZE = .2;
/** How much brighter fresh contamination makes the ground veil and the night glow (E12). */
const GROUND_FLARE = .45, GLOW_FLARE = 1.6;

export const VOID_CREEP_GLSL = `
uniform sampler2D uCreep;
uniform vec4 uCreepFrame;
uniform float uCreepTime;
// Shaped fog (fogStyle 1): x on, y the fog's shape time (s), z its drift travel along the wind (px),
// w its time-of-day cover. The haze then draws the fog's own shape (woodlandThickness), so ground
// dust, glow and the violet fog coincide.
uniform vec4 uHazeShape;
${FOG_SHAPE_GLSL}
#ifdef CREEP_LENT_SHAPE
// The fog's own shape pass this frame (GroundFogSystem.getShapeBinding) over the world rect
// uFogShapeView; while lent, the haze reads it instead of evaluating the shape again.
uniform sampler2D uFogShape;
uniform vec4 uFogShapeView;
uniform float uFogShapeLent;
#endif
// Spawn zone warnings (Void-Gefahrenzonen V1): world rectangle and build-up per zone.
uniform vec4 uVoidAlert[8];
uniform float uVoidAlertLevel[8];
// Trails hostile bodies laid this frame (VoidTaintLayer, E12): r haze, g flare, over the world rect
// uVoidTaintView; uVoidTaintOn 0 without trails.
uniform sampler2D uVoidTaint;
uniform vec4 uVoidTaintView;
uniform float uVoidTaintOn;
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
// How strongly announced spawn zones thicken the haze here. A warning gathers in the zone's middle
// and spreads outward as its level rises (user 2026-10-20: the haze must not pop up at once): a
// wide, soft front, broken by two octaves of slowly drifting noise, so it creeps out of the resting
// haze rather than drawing a box. A zone is round: the ellipse in its rectangle, which it covers at
// full level with a feathered rim.
float creepAlert(vec2 world) {
  float clear=1.0;
  for(int i=0;i<8;i++) {
    float level=uVoidAlertLevel[i];
    if(level<=0.0) continue;
    vec4 zone=uVoidAlert[i];
    vec2 radii=zone.zw*.5;
    float d=(length((world-zone.xy-radii)/radii)-1.0)*min(radii.x,radii.y);
    vec2 drift=vec2(uCreepTime*.35,-uCreepTime*.22);
    float rim=(creepNoise((world+drift)*.0055+float(i)*3.7)-.5)*130.0+(creepNoise((world-drift)*.018+float(i)*1.9)-.5)*50.0;
    float front=mix(-.5*min(zone.z,zone.w)-120.0,84.0,level);
    clear*=1.0-sqrt(level)*(1.0-smoothstep(front-170.0,front,d+rim));
  }
  return 1.0-clear;
}
// Haze and flare of the trails at a world point; zero while there are none.
vec2 creepTaint(vec2 world) {
  if(uVoidTaintOn<.5) return vec2(0.0);
  vec2 uv=(world-uVoidTaintView.xy)/uVoidTaintView.zw;
  if(any(lessThan(uv,vec2(0.0)))||any(greaterThan(uv,vec2(1.0)))) return vec2(0.0);
  return texture2D(uVoidTaint,vec2(uv.x,1.0-uv.y)).rg;
}
// Soaked ground (r, a scar that stays), land share (g) and spore haze (b) at a world point. The
// haze follows the danger's presence, thickens over announced spawn zones and joins the trails of
// hostile bodies. It clings to land and banks: over open water only a thin film stays, so what
// lives in the water stays readable; the ink in the water carries the void there. A warning still
// shows over water, a little softer. a: how far the haze lifts the fog's coverage, fully over a
// place, a share of it over a trail (its light veil where no fog lies). \`flare\`: fresh trails.
vec4 creepTexel(vec2 world, out float flare) {
  flare=0.0;
  vec2 uv=(world-uCreepFrame.xy)/uCreepFrame.zw;
  if(any(lessThan(uv,vec2(0.0)))||any(greaterThan(uv,vec2(1.0)))) return vec4(0.0);
  vec3 texel=texture2D(uCreep,vec2(uv.x,1.0-uv.y)).rgb;
  float film=mix(${OPEN_WATER_HAZE.toFixed(2)},1.0,texel.g);
  float place=1.0-(1.0-texel.b*film)*(1.0-.9*creepAlert(world)*mix(.6,1.0,texel.g));
  vec2 taint=creepTaint(world)*film;
  flare=taint.y;
  return vec4(texel.rg,1.0-(1.0-place)*(1.0-taint.x),
    max(smoothstep(0.0,1.0,place),smoothstep(0.0,1.0,taint.x)*${VOID_TAINT.coverShare.toFixed(3)}));
}
vec4 creepTexel(vec2 world) { float flare; return creepTexel(world,flare); }
// Spore haze: x thickness 0..1, y the thick body of the clouds (where light gathers), from two
// drifting layers. Clearings stay open even where the creep is complete. \`coverLift\` is how far
// the haze raises the fog's coverage (creepTexel's a).
vec2 creepHaze(vec2 world, float density, float coverLift) {
  if(uHazeShape.x>.5) {
    vec2 danger=fogShapeDanger(density);
    float share=danger.x;
    if(share<=0.0) return vec2(0.0);
    float core=0.0,thick=-1.0;
#ifdef CREEP_LENT_SHAPE
    vec2 lent=(world-uFogShapeView.xy)/uFogShapeView.zw;
    if(uFogShapeLent>.5&&all(greaterThanEqual(lent,vec2(0.0)))&&all(lessThanEqual(lent,vec2(1.0)))) {
      vec4 shape=texture2D(uFogShape,vec2(lent.x,1.0-lent.y));
      thick=shape.r*shape.r*${FOG_SHAPE_RANGE.toFixed(1)};core=shape.g;
    }
#endif
    if(thick<0.0) {
      // Same coverage as the fog's shape pass (FOG_SHAPE_FRAGMENT).
      float cover=max(uHazeShape.w,mix(uHazeShape.w,${FOG.voidCover.toFixed(3)},coverLift));
      vec2 q=world-vec2(1.0,.23)*uHazeShape.z;
      thick=fogShape(q,uHazeShape.y,cover,0.0,core);
      thick=fogShapeSpores(q,uHazeShape.y,danger.y,core,thick);
    }
    return vec2((1.0-exp(-1.1*thick*mix(1.0,${FOG.voidGain.toFixed(3)},danger.y)))*share,core*share);
  }
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
#define CREEP_LENT_SHAPE
varying vec2 outTexCoord;
// World rectangle this quad covers; world px per screen pixel.
uniform vec4 uView;
uniform float uPixelWorld;
// 1 while the ground fog carries the airborne haze: the ground then keeps to settled dust.
uniform float uAirborne;
${VOID_CREEP_GLSL}
${rock ? ROCK_COVERAGE_GLSL : ''}
void main() {
  vec2 world=uView.xy+vec2(outTexCoord.x,1.0-outTexCoord.y)*uView.zw;
  float flare;
  vec4 texel=creepTexel(world,flare);
  float density=texel.r, haze=texel.b;
  if(max(density,haze)<.006) discard;
  ${rock ? '// A soft fade over the rock rim instead of a cut.\n  float surface=smoothstep(.25,.9,rockCoverage(world));\n  if(surface<.004) discard;' : 'float surface=1.0;'}
  // A faint, broad bruise under the haze, feathered from nothing: no contour of its own.
  float bruise=density*density*${bruise.toFixed(2)}*(.70+.60*creepNoise(world*.0062+5.0))*surface;
  vec2 mist=creepHaze(world,haze,texel.a)*surface;
  // Volume: the haze a few pixels towards the light is the lit top of a cloud, its far side the
  // shaded underside. Soft, so it reads as depth rather than an outline. The shaped fog carries
  // its own relief in the air above.
  vec2 lit=uHazeShape.x>.5?mist:creepHaze(world+vec2(-5.0,-7.0),haze,texel.a)*surface;
  float relief=clamp((lit.x-mist.x)*2.2,-1.0,1.0);
  float grain=creepGrain(world,uPixelWorld);
  // Dense veil: plum-grey in thin haze, paler lilac-grey where the clouds are thick; the grain
  // shades the veil itself instead of adding specks.
  float veil=mist.x*${(haze * 0.50).toFixed(3)}*(.78+.50*grain)*mix(1.0,.55,uAirborne);
  // Fresh contamination glows up a little lighter before it settles.
  vec3 tone=mix(vec3(.24,.11,.31),vec3(.45,.33,.54),mist.y)*(1.0+.16*relief+.26*grain)*(1.0+${GROUND_FLARE.toFixed(2)}*flare);
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
#define CREEP_LENT_SHAPE
varying vec2 outTexCoord;
uniform vec4 uWorld;
uniform vec3 uGlow;
${VOID_CREEP_GLSL}
void main() {
  vec2 world=uWorld.xy+vec2(outTexCoord.x,1.0-outTexCoord.y)*uWorld.zw;
  float flare;
  vec4 texel=creepTexel(world,flare);
  if(texel.b<.006) { gl_FragColor=vec4(0.0,0.0,0.0,1.0); return; }
  vec2 mist=creepHaze(world,texel.b,texel.a);
  float breathe=.80+.20*sin(uCreepTime*.25+creepNoise(world*.0025)*6.2831853);
  // Shaped fog: the light gathers in the dense streaks and patches, so the glow keeps the fog's shape.
  // Fresh contamination lights its surroundings brighter before it settles.
  gl_FragColor=vec4(uGlow*(uHazeShape.x>.5?mist.x*.22+mist.y*.52:mist.x*.34+mist.y*.30)*breathe*(1.0+${GLOW_FLARE.toFixed(2)}*flare),1.0);
}`;
