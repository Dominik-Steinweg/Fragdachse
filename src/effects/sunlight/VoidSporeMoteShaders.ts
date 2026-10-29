import { FOG_AIR_GLSL } from '../groundFog/FogAirBinding';
import { VOID_CREEP_GLSL } from './VoidCreepShaders';

/** Lifting waves the motes follow at once (VoidCreepPresentation keeps as many slots). */
export const VOID_MOTE_LIFTS = 8;
/** How much brighter motes glow in fresh contamination (E12); violet, never towards white. */
const MOTE_FLARE = .6;

/** Fixed program key: one linked program per renderer, warmed while loading. */
export const VOID_SPORE_MOTES_SHADER_NAME = 'VoidSporeMotes';

/**
 * Luminous spore motes in the void haze (GDD Void-Gefahrenzonen V1, E9; user 2026-10-19: "feiner,
 * weniger weiß und dezenter, aber eine Leuchtwirkung behalten; reagieren auf Explosionen").
 *
 * - Two world-anchored layers of jittered cells, one candidate mote per cell. Each pixel visits
 *   the 3x3 neighbourhood; the haze channel decides how many cells carry a mote and how bright.
 * - A mote is a tiny core in a soft halo. One finer than a screen pixel keeps its size and loses
 *   brightness instead, so the field never sparkles when the camera moves.
 * - Violet between the void's primary and bright tones, never white.
 * - The fog's air carries them and its disturbance fades them: explosions and passing figures
 *   push the motes away and dim them, and they settle back as the fog does. On high quality the
 *   disturbance's gradient pushes them outwards as well.
 * - Additive above the light map, so they glow at night without lighting anything.
 */
export const VOID_SPORE_MOTES_FRAGMENT = `
#pragma phaserTemplate(shaderName)
precision highp float;
varying vec2 outTexCoord;
uniform vec4 uView;
uniform float uPixelWorld;
// Overall glow: subtle by day, luminous at night.
uniform float uGlow;
uniform float uLayers;
uniform float uGradient;
uniform float uHasAir;
uniform vec3 uMoteDeep,uMoteBright;
// Lifting waves over deactivated places: centre x, y, front radius, strength.
uniform vec4 uVoidLift[${VOID_MOTE_LIFTS}];
${VOID_CREEP_GLSL}
${FOG_AIR_GLSL}
// The wave that lifts the haze of a deactivated place: a soft band at its front, and the outward
// push it gives the motes just behind it, so they are swept along before the patches settle.
float liftWave(vec2 world, out vec2 push) {
  float wave=0.0;
  push=vec2(0.0);
  for(int i=0;i<${VOID_MOTE_LIFTS};i++) {
    vec4 lift=uVoidLift[i];
    if(lift.w<=0.0) continue;
    vec2 away=world-lift.xy;
    float dist=length(away);
    float band=(dist-lift.z)/72.0, wake=(dist-lift.z+50.0)/80.0;
    wave=max(wave,exp(-band*band)*lift.w);
    if(dist>1.0) push+=away/dist*exp(-wake*wake)*lift.w*36.0;
  }
  return wave;
}
float moteHash(vec2 p, float salt) { return fract(sin(dot(p,vec2(127.1+salt,311.7-salt*1.7)))*43758.5453); }
vec3 moteLayer(vec2 p, float cellSize, float radius, float salt, float share) {
  vec2 cell=floor(p/cellSize);
  vec3 light=vec3(0.0);
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++) {
    vec2 c=cell+vec2(float(i),float(j));
    float h0=moteHash(c,salt),h1=moteHash(c,salt+1.3),h2=moteHash(c,salt+2.7),h3=moteHash(c,salt+4.1);
    if(h0>share) continue;
    // A slow hover around its own place; it never leaves its cell.
    vec2 hover=vec2(sin(uCreepTime*(.19+h1*.23)+h2*6.2831853),cos(uCreepTime*(.15+h3*.21)+h1*6.2831853))*.26;
    vec2 centre=(c+.5+(vec2(h1,h3)-.5)*.46+hover)*cellSize;
    vec2 d=p-centre;
    float nominal=radius*(.7+.6*h2), r=max(nominal,uPixelWorld*.9);
    float d2=dot(d,d)/(r*r);
    float shape=exp(-d2*1.7)+exp(-d2*.16)*.20;
    float breathe=.58+.42*sin(uCreepTime*(.45+h3*.6)+h0*37.0);
    light+=mix(uMoteDeep,uMoteBright,h2*.85)*shape*breathe*min(1.0,nominal*nominal/(r*r));
  }
  return light;
}
void main() {
  vec2 world=uView.xy+vec2(outTexCoord.x,1.0-outTexCoord.y)*uView.zw;
  vec2 push;
  float wave=liftWave(world,push);
  float flare;
  float here=creepTexel(world,flare).b;
  if(here<.02&&wave<.01) discard;
  // A mote swept outward by a lifting wave is drawn ahead of where it hovered.
  vec2 p=world-push;
  float calm=1.0;
  if(uHasAir>.5) {
    vec3 air=fogAt(world);
    p-=air.xy*.45;
    calm=1.0-.9*smoothstep(.03,.45,air.z);
    if(uGradient>.5) {
      // Pushed away from the most disturbed air.
      vec2 slope=vec2(fogStir(world+vec2(16.0,0.0)),fogStir(world+vec2(0.0,16.0)))-air.z;
      float steep=length(slope);
      if(steep>.002) p+=slope/steep*min(1.0,steep*12.0)*26.0;
    }
  }
  float thick=smoothstep(.04,.62,creepTexel(p).b);
  vec3 light=moteLayer(p,28.0,1.15,0.0,.48*thick);
  if(uLayers>1.5) light+=moteLayer(p,19.0,.8,17.0,.32*thick)*.7;
  // Motes caught by the wave flare briefly as they are carried off.
  // Fresh contamination makes its motes glow up before they settle.
  light*=thick*calm*uGlow*(1.0+1.8*wave);
  light+=uMoteDeep*max(light.r,max(light.g,light.b))*${MOTE_FLARE.toFixed(2)}*flare;
  // The wave itself: a faint, wispy shimmer where haze is being lifted, never a hard ring.
  float wisp=.55+.45*creepNoise(world*.011+vec2(uCreepTime*.35,-uCreepTime*.2));
  light+=mix(uMoteDeep,uMoteBright,.6)*wave*wisp*smoothstep(.0,.35,here)*uGlow*.38;
  if(max(light.r,max(light.g,light.b))<.003) discard;
  gl_FragColor=vec4(light,0.0);
}`;
