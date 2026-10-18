import { ROCK_COVERAGE_GLSL } from '../RockPenetrationShader';

/** Fixed program keys: one linked program each per renderer, warmed while loading. */
export const VOID_CREEP_GROUND_SHADER_NAME = 'VoidCreepGround';
export const VOID_CREEP_ROCK_SHADER_NAME = 'VoidCreepRock';
export const VOID_CREEP_GLOW_SHADER_NAME = 'VoidCreepGlow';

/** World px per glint cell at night; a glint stays well inside its cell. */
const GLINT_CELL = 9;

/**
 * Shared shape of the void creep (GDD Nachtsicht N-6, user 2026-10-18: "eher Sporen als
 * Schlieren", "feiner Dunst statt großer Kreise"). The World's creep field becomes a fine spore
 * haze: soft clouds of powder that drift very slowly over a faint bruise, with a fine static grain
 * so it reads as dust settled on the ground. Every term fades from nothing; nothing draws an edge.
 * Ground, rock and the night glow evaluate the same haze, so the glow sits on the drawn dust.
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
// Spore haze 0..1: the creep gathered into soft drifting clouds of powder with clearings between.
float creepHaze(vec2 world, float density) {
  vec2 drift=vec2(uCreepTime*.9,uCreepTime*.55);
  mat2 turn=mat2(.8,.6,-.6,.8);
  float cloud=creepNoise((world+drift)*.0105+3.0)*.52+creepNoise(turn*(world-drift*.6)*.026+8.0)*.30
    +creepNoise(turn*turn*(world+drift*.3)*.061+1.7)*.18;
  // Clouds with clearings even where the creep is complete; the creep itself fades them in.
  return smoothstep(.02,.85,density)*smoothstep(.30,.74,cloud);
}
// Fine static grain of settled spores, about a pixel across.
float creepGrain(vec2 world) {
  return smoothstep(.50,.86,creepNoise(world*.42+2.7)*.62+creepNoise(world*.93+6.1)*.38);
}`;

const surfaceFragment = (rock: boolean, bruise: number, haze: number): string => `
#pragma phaserTemplate(shaderName)
precision highp float;
varying vec2 outTexCoord;
// World rectangle this quad covers.
uniform vec4 uView;
${VOID_CREEP_GLSL}
${rock ? ROCK_COVERAGE_GLSL : ''}
void main() {
  vec2 world=uView.xy+vec2(outTexCoord.x,1.0-outTexCoord.y)*uView.zw;
  float density=creepTexel(world).r;
  if(density<.006) discard;
  ${rock ? '// A soft fade over the rock rim instead of a cut.\n  float surface=smoothstep(.25,.9,rockCoverage(world));\n  if(surface<.004) discard;' : 'float surface=1.0;'}
  // A faint, broad bruise under the dust, feathered from nothing: no contour of its own.
  float bruise=density*density*${bruise.toFixed(2)}*(.70+.60*creepNoise(world*.0062+5.0))*surface;
  float mist=creepHaze(world,density)*surface;
  // A thin lilac-grey veil where the haze lies, and fine settled powder within it.
  float veil=mist*${(haze * 0.24).toFixed(3)};
  float powder=creepGrain(world)*mist*${(haze * 0.34).toFixed(3)};
  vec3 color=vec3(.11,.035,.13)*bruise;
  float alpha=bruise;
  color=vec3(.27,.15,.32)*veil+color*(1.0-veil); alpha=veil+alpha*(1.0-veil);
  color=vec3(.50,.39,.56)*powder+color*(1.0-powder); alpha=powder+alpha*(1.0-powder);
  if(alpha<.004) discard;
  gl_FragColor=vec4(color,alpha);
}`;

/** Ground creep below tracks, bases and decals; material, lit by sun, light map and fog like soil. */
export const VOID_CREEP_GROUND_FRAGMENT = surfaceFragment(false, .26, 1);
/** Rock-top creep inside the V7 contour, a little lighter so the rock's own relief stays readable. */
export const VOID_CREEP_ROCK_FRAGMENT = surfaceFragment(true, .18, .85);

/**
 * Night glow of the creep in light-map space, added like the moon islands: the spore haze glows
 * softly and breathes, and fine glints flicker in it, each on its own slow phase. The light map
 * lights ground, water, rock and fog with it; the bleed makes the haze luminous. Glints are land
 * growth; over open water only the haze remains.
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
  float mist=creepHaze(world,texel.r);
  float breathe=.70+.30*sin(uCreepTime*.32+creepNoise(world*.003)*6.2831853);
  // Fine glints: at most one per cell, inside its middle, a gaussian of about two world pixels.
  vec2 q=world/${GLINT_CELL.toFixed(1)}+(vec2(creepNoise(world*.017),creepNoise(world*.017+41.0))-.5)*.8;
  vec2 id=floor(q);
  vec2 centre=id+.3+.4*vec2(creepHash(id),creepHash(id+17.17));
  float d=length(q-centre)*${GLINT_CELL.toFixed(1)};
  float twinkle=smoothstep(.55,1.0,sin(uCreepTime*(.5+.9*creepHash(id+2.2))+creepHash(id+9.1)*41.0));
  float glint=exp(-d*d*.35)*twinkle*step(creepHash(id+31.7),mist*.6)*smoothstep(.6,.95,texel.g);
  gl_FragColor=vec4(uGlow*(mist*.42*breathe+glint*1.4),1.0);
}`;
