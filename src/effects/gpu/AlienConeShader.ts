import { CLAW_VFX_FAN_RAYS } from '../enemyClaw/EnemyClawVfxStore';

/**
 * Alien energy cone ("Energie-Fächer") – one emissive pass above the night lightmap.
 *
 * One quad per item in the cone frame (local +x = cone axis, origin = caster). Instance words:
 *   inA     [originX, originY, angle, range]
 *   inShape [halfArc, kind, t, seed]
 *   inAux   [allied, intensity, muzzlePx, unused]
 *   inClipA/B/C/D  four packed cover reaches each (q * 256^k is not exact in float32, so two
 *                  per float: q0 * 256 + q1, 0..255 = fraction of range), 16 rays left → right.
 *
 * kind 0 charge   t = windup progress 0..1: void energy converging into a core at the muzzle.
 * kind 1 wave     t = seconds since the impulse: a hot wavefront races to the clipped reach,
 *                 filaments and interference trail it, sparks flare where cover stopped it,
 *                 then everything dissolves within ALIEN_CONE_WAVE_LIFE_S (no residue).
 * kind 2 quiet    t = windup progress: faint jade outline of an allied cone (no warning role).
 *
 * Visual language: precise sci-fi energy (clean fronts, thin filaments, interference rings), not
 * fire or smoke; clearly larger and flatter than the alien's plasma balls.
 */
export const ALIEN_CONE_KIND = { charge: 0, wave: 1, quiet: 2 } as const;
/** The front reaches the full (clipped) reach after this long. */
export const ALIEN_CONE_WAVE_TRAVEL_S = 0.2;
/** Last visible moment of the wave after the impulse. */
export const ALIEN_CONE_WAVE_LIFE_S = 0.48;

const RAYS = CLAW_VFX_FAN_RAYS;

export const ALIEN_CONE_VERTEX = `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform mat4 uProjectionMatrix;
uniform mat3 uViewMatrix;
attribute vec4 inA;
attribute vec2 inCorner;
attribute vec4 inShape;
attribute vec4 inAux;
attribute vec4 inClipA;
attribute vec4 inClipB;
varying vec2 vLocal;
varying vec4 vA;
varying vec4 vShape;
varying vec4 vAux;
varying vec4 vRays0;
varying vec4 vRays1;
varying vec4 vRays2;
varying vec4 vRays3;
vec2 unpack(float p) { float hi = floor(p / 256.0); return vec2(hi, p - hi * 256.0) / 255.0; }
void main() {
  vA = inA; vShape = inShape; vAux = inAux;
  vRays0 = vec4(unpack(inClipA.x), unpack(inClipA.y));
  vRays1 = vec4(unpack(inClipA.z), unpack(inClipA.w));
  vRays2 = vec4(unpack(inClipB.x), unpack(inClipB.y));
  vRays3 = vec4(unpack(inClipB.z), unpack(inClipB.w));
  float range = inA.w, halfArc = inShape.x, kind = inShape.y;
  vec2 lo, hi;
  if (kind < 0.5) {
    // Charge: a square around the muzzle socket.
    float s = 46.0;
    lo = vec2(inAux.z - s, -s); hi = vec2(inAux.z + s, s);
  } else {
    float side = range * sin(min(halfArc, 1.5707)) + 24.0;
    lo = vec2(-24.0, -side); hi = vec2(range + 24.0, side);
  }
  vec2 local = mix(lo, hi, inCorner * 0.5 + 0.5);
  vLocal = local;
  float c = cos(inA.z), s = sin(inA.z);
  vec2 world = inA.xy + vec2(c * local.x - s * local.y, s * local.x + c * local.y);
  gl_Position = uProjectionMatrix * vec4((uViewMatrix * vec3(world, 1.0)).xy, 0.0, 1.0);
}`;

export const ALIEN_CONE_FRAGMENT = `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform float uTime;
uniform float uDetail;
uniform float uAlpha;
varying vec2 vLocal;
varying vec4 vA;
varying vec4 vShape;
varying vec4 vAux;
varying vec4 vRays0;
varying vec4 vRays1;
varying vec4 vRays2;
varying vec4 vRays3;
const float PI = 3.14159265;
const float TRAVEL = ${ALIEN_CONE_WAVE_TRAVEL_S.toFixed(3)};
const float LIFE = ${ALIEN_CONE_WAVE_LIFE_S.toFixed(3)};
float hash(vec2 v) { return fract(sin(dot(v, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 v) {
  vec2 i = floor(v), f = fract(v); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + 1.0), f.x), f.y);
}
float gauss(float x, float w) { float k = x / w; return exp(-k * k); }
float ray(int i) {
  if (i < 4) return i == 0 ? vRays0.x : i == 1 ? vRays0.y : i == 2 ? vRays0.z : vRays0.w;
  if (i < 8) return i == 4 ? vRays1.x : i == 5 ? vRays1.y : i == 6 ? vRays1.z : vRays1.w;
  if (i < 12) return i == 8 ? vRays2.x : i == 9 ? vRays2.y : i == 10 ? vRays2.z : vRays2.w;
  return i == 12 ? vRays3.x : i == 13 ? vRays3.y : i == 14 ? vRays3.z : vRays3.w;
}
// Clipped reach (fraction of range) at angle offset a; matches energyConeReachAt on the CPU.
float reachAt(float a, float halfArc) {
  float g = clamp((a + halfArc) / (2.0 * halfArc), 0.0, 1.0) * ${(RAYS - 1).toFixed(1)};
  float i0 = min(floor(g), ${(RAYS - 2).toFixed(1)});
  float f = g - i0;
  float r0 = 0.0, r1 = 0.0;
  for (int i = 0; i < ${RAYS - 1}; i++) {
    if (float(i) == i0) { r0 = ray(i); r1 = ray(i + 1); }
  }
  return mix(r0, r1, f);
}
// Void ramp deep → primary → bright → core; allied uses jade.
vec3 ramp(float h, float allied) {
  vec3 c0 = mix(vec3(0.435, 0.086, 0.659), vec3(0.04, 0.32, 0.22), allied);
  vec3 c1 = mix(vec3(0.702, 0.278, 1.0), vec3(0.18, 0.86, 0.62), allied);
  vec3 c2 = mix(vec3(0.851, 0.549, 1.0), vec3(0.55, 1.0, 0.82), allied);
  vec3 c3 = mix(vec3(0.976, 0.910, 1.0), vec3(0.90, 1.0, 0.96), allied);
  float x = clamp(h, 0.0, 1.0) * 3.0;
  if (x < 1.0) return mix(c0, c1, x);
  if (x < 2.0) return mix(c1, c2, x - 1.0);
  return mix(c2, c3, x - 2.0);
}
vec3 glow(float e, float allied) { float s = 1.0 - exp(-1.5 * max(e, 0.0)); return ramp(0.2 + 0.8 * s, allied) * s * 1.3; }

void main() {
  float range = vA.w, halfArc = vShape.x, kind = vShape.y, t = vShape.z, seed = vShape.w;
  float allied = vAux.x, intensity = vAux.y, muzzle = vAux.z;
  vec2 p = vLocal;
  float r = length(p);
  float ang = atan(p.y, p.x);
  vec3 rgb = vec3(0.0);
  float alpha = 0.0;

  if (kind < 0.5) {
    // Charge: rings of energy spiral into a core at the muzzle; the core swells toward the impulse.
    vec2 q = p - vec2(muzzle, 0.0);
    float rho = length(q), phi = atan(q.y, q.x);
    float pr = clamp(t, 0.0, 1.0);
    float core = gauss(rho, 2.5 + 6.5 * pr) * (0.5 + 1.2 * pr);
    float rings = 0.0;
    for (int k = 0; k < 3; k++) {
      float fk = float(k);
      float cycle = fract(uTime * (1.4 + 1.6 * pr) + fk / 3.0);
      float radius = mix(40.0, 5.0, cycle);
      float dash = smoothstep(0.35, 0.8, noise(vec2(phi * 3.0 + uTime * 6.0 * (fk + 1.0), fk * 7.0 + seed * 13.0)));
      rings += gauss(rho - radius, 1.1) * dash * (1.0 - cycle) * cycle * 3.0;
    }
    // A thin forward aperture arc shows where the fan will open.
    float aperture = gauss(rho - (10.0 + 6.0 * pr), 0.9) * smoothstep(0.6, 0.0, abs(phi)) * pr;
    float flicker = 0.85 + 0.15 * sin(uTime * 47.0 + seed * 30.0);
    float e = (core * 1.4 + rings * 0.55 * (0.4 + pr) + aperture * 0.9) * flicker * intensity;
    rgb = glow(e, allied);
  } else if (kind < 1.5) {
    // Wave: the front races out, clipped by cover; filaments and interference trail it.
    float aa = abs(ang);
    if (aa > halfArc + 0.04 || r > range + 24.0) discard;
    float reach = reachAt(ang, halfArc) * range;
    float u = clamp(t / TRAVEL, 0.0, 1.0);
    float front = range * (1.0 - pow(1.0 - u, 2.2));
    float fade = 1.0 - smoothstep(TRAVEL * 0.9, LIFE, t);
    float within = 1.0 - smoothstep(reach - 1.0, reach + 1.5, r);
    float sideDist = (halfArc - aa) * r;
    float sides = smoothstep(-1.0, 2.0, sideDist);
    float hub = smoothstep(8.0, 26.0, r);
    float mask = within * sides * hub;
    float behind = step(r, front);
    // Hot leading edge.
    float frontW = 3.0 + 7.0 * u;
    float lead = gauss(r - min(front, reach), frontW) * smoothstep(0.0, 0.05, t) * (1.0 - smoothstep(TRAVEL, TRAVEL + 0.12, t));
    // Interference rings trailing the front, sliding outward.
    float rings = (0.5 + 0.5 * sin((front - r) * 0.22 - t * 55.0)) * exp(-max(front - r, 0.0) / 90.0) * behind;
    // Filaments: thin jittering arcs along rays from the core to the front.
    float fil = 0.0;
    if (uDetail > 0.5) {
      for (int k = 0; k < 5; k++) {
        float fk = float(k);
        float base = (hash(vec2(fk, seed)) * 2.0 - 1.0) * halfArc * 0.85;
        float jitter = (noise(vec2(r * 0.045 + fk * 11.0, t * 26.0 + seed * 5.0)) - 0.5) * 0.16;
        float d = abs(ang - base - jitter) * r;
        fil += gauss(d, 0.8) * behind * smoothstep(front, front - 40.0, r) * (0.6 + 0.4 * hash(vec2(fk, floor(t * 40.0))));
      }
    }
    // Flank glints keep both edges readable while the wave is alive.
    float flank = gauss(sideDist, 1.6) * behind * 0.6;
    // Cover impact: where the profile clipped the cone, the front flares against the obstacle.
    float clipped = step(reach, range * 0.97);
    float arrive = smoothstep(reach - 12.0, reach, front);
    float impact = clipped * arrive * gauss(r - reach, 3.5 + 6.0 * u)
      * (0.8 + 0.6 * noise(vec2(ang * 60.0, t * 30.0 + seed * 9.0)));
    float sweep = behind * exp(-max(front - r, 0.0) / 140.0);
    float e = (lead * 2.2 + rings * 0.35 + fil * 1.1 + flank + sweep * 0.25) * mask + impact * 1.6 * sides * hub;
    e *= fade * intensity;
    rgb = glow(e, allied);
    // A violet veil under the energy gives it body on bright daylight ground.
    alpha = clamp(sweep * mask * fade * 0.14 * intensity * (1.0 - allied * 0.6), 0.0, 0.2);
    rgb += ramp(0.05, allied) * alpha * 0.4;
  } else {
    // Allied windup: a faint outline only, no warning role.
    float aa = abs(ang);
    if (aa > halfArc + 0.04) discard;
    float reach = reachAt(ang, halfArc) * range;
    float sideDist = (halfArc - aa) * r;
    float inside = (1.0 - smoothstep(reach - 1.0, reach + 1.0, r)) * smoothstep(-1.0, 1.0, sideDist) * smoothstep(12.0, 30.0, r);
    float outline = max(gauss(r - reach, 1.0), gauss(sideDist, 0.9)) * inside;
    float e = (outline * 0.5 + inside * 0.05) * (0.3 + 0.7 * clamp(t, 0.0, 1.0)) * intensity;
    rgb = glow(e, 1.0);
  }
  rgb *= uAlpha; alpha = clamp(alpha * uAlpha, 0.0, 1.0);
  gl_FragColor = vec4(rgb, alpha);
}`;
