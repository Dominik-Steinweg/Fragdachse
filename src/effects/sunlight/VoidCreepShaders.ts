import { ROCK_COVERAGE_GLSL } from '../RockPenetrationShader';

/** Fixed program keys: one linked program each per renderer, warmed while loading. */
export const VOID_CREEP_GROUND_SHADER_NAME = 'VoidCreepGround';
export const VOID_CREEP_ROCK_SHADER_NAME = 'VoidCreepRock';
export const VOID_CREEP_GLOW_SHADER_NAME = 'VoidCreepGlow';

/**
 * Shared shape of the void creep (GDD Nachtsicht N-6): the World's creep field, slowly drifting,
 * frays into ink, a mycelium of curved branching veins that runs out beyond the ink, and sparse
 * spore specks. Ground, rock and the night glow evaluate the same function, so glowing threads
 * lie exactly on the drawn ones.
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
float creepField(vec2 p) {
  mat2 turn=mat2(.8,.6,-.6,.8);
  return creepNoise(p)*.58+creepNoise(turn*p*2.03+17.3)*.28+creepNoise(turn*turn*p*4.07+8.1)*.14;
}
// Land share; the shoreline itself never drifts.
float creepLand(vec2 world) {
  vec2 uv=(world-uCreepFrame.xy)/uCreepFrame.zw;
  if(any(lessThan(uv,vec2(0.0)))||any(greaterThan(uv,vec2(1.0)))) return 0.0;
  return texture2D(uCreep,vec2(uv.x,1.0-uv.y)).g;
}
float creepDensity(vec2 world) {
  vec2 drift=vec2(creepNoise(world*.0045+vec2(uCreepTime*.006,3.1)),creepNoise(world*.0045+vec2(7.7,-uCreepTime*.005)))-.5;
  vec2 uv=(world+drift*70.0-uCreepFrame.xy)/uCreepFrame.zw;
  if(any(lessThan(uv,vec2(0.0)))||any(greaterThan(uv,vec2(1.0)))) return 0.0;
  return texture2D(uCreep,vec2(uv.x,1.0-uv.y)).r;
}
// Mycelium: a few curved, branching strands from domain-warped ridges, broken along their length so
// the creep follows channels rather than a closed net. sharpness 1 draws the strands, 0 their glow.
float creepVeins(vec2 world, float sharpness) {
  vec2 w=world+(vec2(creepNoise(world*.009+1.3),creepNoise(world*.009+9.1))-.5)*46.0;
  float ridge=1.0-abs(creepField(w*.0085)*2.0-1.0);
  float hair=1.0-abs(creepField(w*.022+4.2)*2.0-1.0);
  float run=smoothstep(.34,.56,creepNoise(world*.0052+vec2(3.3,8.8)));
  float from=mix(.875,.925,sharpness);
  return (smoothstep(from,.992,ridge)+smoothstep(from+.025,.995,hair)*.45)*run;
}
// x soaked ground, y strands, z strand cores (lilac, glowing at night), w spore specks.
vec4 creepShape(vec2 world, float sharpness) {
  float density=creepDensity(world);
  if(density<.008) return vec4(0.0);
  // Lobes with dry gaps: the soak spreads in tongues, not as one flat stain.
  float lobes=creepField(world*.0062+5.0), grain=creepField(world*.021+9.0);
  float soak=smoothstep(.22,.82,density*(.30+.95*lobes))*(.62+.38*grain);
  // Strands gather at the spreading rim and reach into healthy ground; the soaked core has fewer.
  // They are land growth: none in open water, thinning out at the waterline.
  float rim=smoothstep(.04,.30,density)*(1.0-.45*smoothstep(.55,.95,density));
  float land=creepLand(world);
  float strands=creepVeins(world,sharpness)*rim*land;
  float cores=smoothstep(.55,1.0,strands);
  float specks=smoothstep(.975,.997,creepNoise(world*.29+11.0))*smoothstep(.45,.90,density)*land;
  return vec4(soak,strands,cores,specks);
}`;

const surfaceFragment = (rock: boolean, soak: number, strand: number): string => `
#pragma phaserTemplate(shaderName)
precision highp float;
varying vec2 outTexCoord;
// World rectangle this quad covers.
uniform vec4 uView;
${VOID_CREEP_GLSL}
${rock ? ROCK_COVERAGE_GLSL : ''}
void main() {
  vec2 world=uView.xy+vec2(outTexCoord.x,1.0-outTexCoord.y)*uView.zw;
  vec4 shape=creepShape(world,1.0);
  ${rock ? 'shape*=smoothstep(.55,.88,rockCoverage(world)); // Only inside the visible contour: crisp silhouettes.' : ''}
  float soak=shape.x*${soak.toFixed(2)}, strand=shape.y*${strand.toFixed(2)}, core=shape.z*.55, speck=shape.w*.60;
  if(soak+strand+speck<.004) discard;
  // Bruised, rotting ground: translucent plum soak that keeps the soil's own texture, dark
  // root-like strands with a thin lilac core (the night glow lights it), pale spore specks.
  // Translucent: the soil's own texture keeps reading through the bruise.
  vec3 color=vec3(.13,.045,.15)*(.80+.40*creepField(world*.024+2.0))*soak;
  float alpha=soak;
  color=vec3(.20,.075,.24)*strand+color*(1.0-strand); alpha=strand+alpha*(1.0-strand);
  color=vec3(.52,.32,.64)*core+color*(1.0-core); alpha=core+alpha*(1.0-core);
  color=vec3(.62,.46,.74)*speck+color*(1.0-speck); alpha=speck+alpha*(1.0-speck);
  gl_FragColor=vec4(color,alpha);
}`;

/** Ground ink below tracks, bases and decals; material, lit by sun, light map and fog like soil. */
export const VOID_CREEP_GROUND_FRAGMENT = surfaceFragment(false, .60, .95);
/** Rock-top ink inside the V7 contour, lighter so the rock's own relief stays readable. */
export const VOID_CREEP_ROCK_FRAGMENT = surfaceFragment(true, .44, .80);

/**
 * Night glow of the creep in light-map space, added like the moon islands: soft light along the
 * strand cores and spores, breathing slowly; the soaked ground itself stays dark. The light map
 * lights ground, water, rock and fog with it; the bleed turns the threads luminous.
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
  vec4 shape=creepShape(world,0.0);
  float breathe=.78+.22*sin(uCreepTime*.5+creepNoise(world*.004)*6.2831853);
  // Only the strand cores and spores glow; the soaked ground stays dark.
  gl_FragColor=vec4(uGlow*(shape.z*.7+shape.y*.40+shape.w*.6+shape.x*.05)*breathe,1.0);
}`;
