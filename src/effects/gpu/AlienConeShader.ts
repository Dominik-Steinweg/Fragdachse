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
export const ALIEN_CONE_WAVE_TRAVEL_S = 0.18;
/** Last visible moment of the wave after the impulse. */
export const ALIEN_CONE_WAVE_LIFE_S = 0.62;

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
    float side = range * sin(min(halfArc, 1.5707)) + 44.0;
    lo = vec2(-44.0, -side); hi = vec2(range + 44.0, side);
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
// Cone energy keeps its hue: deep → primary → bright violet, a touch of white only at the peak.
vec3 coneGlow(float e, float allied) {
  float s = 1.0 - exp(-1.35 * max(e, 0.0));
  vec3 deep = mix(vec3(0.42, 0.06, 0.78), vec3(0.04, 0.36, 0.24), allied);
  vec3 mid = mix(vec3(0.70, 0.22, 1.00), vec3(0.16, 0.88, 0.62), allied);
  vec3 hot = mix(vec3(0.90, 0.62, 1.00), vec3(0.62, 1.00, 0.86), allied);
  vec3 c = mix(deep, mid, smoothstep(0.0, 0.55, s));
  c = mix(c, hot, smoothstep(0.68, 0.98, s));
  c = mix(c, vec3(1.0, 0.96, 1.0), 0.14 * smoothstep(0.95, 1.0, s));
  return c * s * 1.45;
}
float fbm2(vec2 v) { return noise(v) * 0.55 + noise(v * 2.1 + 13.7) * 0.3 + noise(v * 4.3 + 41.1) * 0.15; }

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
    // Wave: an energy front races out to the clipped reach and settles into a glowing rim. Behind
    // it a radar lattice (arcs + spokes), branching electric cracks and motes drifting past the
    // edges; every boundary glows softly instead of being cut. Saturated violet, white only in
    // the hottest core. The interior stays translucent so players inside remain readable.
    float aa = abs(ang);
    if (aa > halfArc + 0.3 || r > range + 44.0) discard;
    float reach = reachAt(clamp(ang, -halfArc, halfArc), halfArc) * range;
    float u = clamp(t / TRAVEL, 0.0, 1.0);
    float front = range * (1.0 - pow(1.0 - u, 2.4));
    float fade = 1.0 - smoothstep(TRAVEL * 1.4, LIFE, t);
    float sideDist = (halfArc - aa) * max(r, 1.0);   // >0 inside, px
    float outside = max(r - reach, 0.0) + max(-sideDist, 0.0);
    // Hard gameplay boundary for the lattice, soft glow beyond it.
    float inside = (1.0 - smoothstep(reach - 1.5, reach + 1.5, r)) * smoothstep(-1.5, 1.5, sideDist);
    float bloomOut = exp(-outside / 9.0);
    float hub = smoothstep(4.0, 20.0, r);
    float behind = step(r, front);
    float since = max(front - r, 0.0);
    float edgeR = min(front, reach);
    float settle = smoothstep(TRAVEL * 0.7, TRAVEL * 1.3, t);
    // Leading front with a broad halo; it becomes the rim on arrival and cools down.
    float frontLine = gauss(r - edgeR, 2.0 + 2.0 * u) * (1.0 - 0.5 * settle);
    float frontHalo = gauss(r - edgeR, 11.0 + 8.0 * u);
    float arrived = smoothstep(reach - 10.0, reach, front);
    float rim = arrived * (gauss(r - reach, 2.4) + 0.45 * gauss(r - reach, 12.0));
    // Flanks glow like the rim once the front has passed.
    float flank = behind * (gauss(sideDist, 1.6) + 0.4 * gauss(sideDist, 9.0)) * smoothstep(10.0, 40.0, r);
    // Radar lattice: concentric arcs and radial spokes, slightly wavering, revealed behind the front.
    float wobble = (fbm2(vec2(ang * 9.0, r * 0.02 + seed * 7.0)) - 0.5) * 3.0;
    float arcs = gauss(min(fract((r + wobble) / 34.0), 1.0 - fract((r + wobble) / 34.0)) * 34.0, 0.9);
    float spokeStep = 2.0 * halfArc / 6.0;
    float sp = (ang + halfArc) / spokeStep;
    float spokes = gauss(min(fract(sp), 1.0 - fract(sp)) * spokeStep * r, 0.8) * smoothstep(6.0, 30.0, r);
    float lattice = (arcs * 0.55 + spokes * 0.8) * behind * (0.35 + 0.65 * exp(-since / 160.0));
    // Electric cracks: thin branching ridges of warped noise, flickering, densest near the front.
    vec2 polar = vec2(ang * 6.5, r * 0.018);
    vec2 warp = vec2(fbm2(polar * 1.7 + vec2(t * 3.0, seed * 5.0)), fbm2(polar * 1.7 + vec2(seed * 3.0, t * 2.5) + 9.0));
    float field = fbm2(polar * 2.3 + warp * 1.6 + vec2(floor(t * 24.0) * 0.37, 0.0));
    float crack = 1.0 - smoothstep(0.0, 0.016, abs(field - 0.5));
    crack *= smoothstep(0.35, 0.75, noise(polar * 0.9 + vec2(seed * 11.0, floor(t * 18.0))));
    crack *= behind * (0.4 + 0.6 * exp(-since / 120.0));
    float bolts = 0.0;
    if (uDetail > 0.5) {
      // A few long bolts from the core to the front, re-struck every few frames.
      for (int k = 0; k < 4; k++) {
        float fk = float(k);
        float strike = floor(t * 22.0 + fk * 0.37);
        float base = (hash(vec2(fk, seed + strike)) * 2.0 - 1.0) * halfArc * 0.8;
        float coarse = fbm2(vec2(r * 0.022 + fk * 7.0, strike * 1.3)) - 0.5;
        float fine = noise(vec2(r * 0.19 + fk * 3.0, strike * 2.7)) - 0.5;
        float kink = (hash(vec2(floor(r / 26.0) + fk * 5.0, strike)) - 0.5) * 0.05;
        float path = base + coarse * 0.28 + fine * 0.05 + kink;
        float d = abs(ang - path) * r;
        float live = step(0.3, hash(vec2(strike, fk + seed))) * behind * smoothstep(20.0, 60.0, r);
        // A short branch splits off at a random radius and drifts sideways.
        float splitR = mix(0.35, 0.75, hash(vec2(fk, strike + 3.0))) * range;
        float branchPath = path + (r - splitR) / range * (hash(vec2(fk + 9.0, strike)) > 0.5 ? 0.35 : -0.35);
        float branch = gauss(abs(ang - branchPath) * r, 0.55) * step(splitR, r) * (1.0 - smoothstep(splitR, splitR + 70.0, r));
        bolts += (gauss(d, 0.6) + 0.7 * branch) * live;
      }
    }
    // Motes: sparks along the rim and flanks, drifting outward past the boundary.
    vec2 moteCell = floor(vec2(ang * 34.0, r * 0.07));
    float moteSeed = hash(moteCell + seed * 13.0);
    float drift = t * (40.0 + 60.0 * moteSeed);
    float moteR = (moteCell.y + 0.5) / 0.07 + drift * 0.3;
    float moteA = (moteCell.x + 0.5) / 34.0;
    vec2 motePos = vec2(cos(moteA), sin(moteA)) * moteR;
    float nearEdge = max(smoothstep(reach - 70.0, reach - 8.0, r), gauss(sideDist, 18.0));
    float mote = step(0.8, moteSeed) * gauss(length(p - motePos), 1.5)
      * nearEdge * arrived * (0.6 + 0.4 * sin(t * 40.0 + moteSeed * 30.0));
    // Origin flare with converging spokes.
    float flare = gauss(length(p - vec2(muzzle * 0.6, 0.0)), 7.0) * (1.4 - 0.9 * settle)
      + gauss(r, 26.0) * 0.5 * (1.0 - smoothstep(0.0, 0.12, t));
    // Cover impact flare where the profile clipped the cone.
    float clipped = step(reach, range * 0.97);
    float impact = clipped * arrived * gauss(r - reach, 4.0) * (0.7 + 0.6 * noise(vec2(ang * 60.0, t * 30.0 + seed * 9.0)));
    float body = (lattice * 0.5 + crack * 0.9 + bolts * 1.1) * inside * hub;
    float edges = (frontLine * 1.6 + frontHalo * 0.45 + rim * 1.25 + flank * 0.9 + impact * 1.2) * bloomOut * hub;
    float e = (body + edges + mote * 1.3) * fade * intensity + flare * fade * intensity;
    rgb = coneGlow(e, allied);
    // A translucent violet tint behind the front gives the fan body on bright ground.
    float tint = behind * inside * hub * (0.06 + 0.06 * exp(-since / 90.0));
    alpha = clamp(tint * fade * intensity * (1.0 - allied * 0.6), 0.0, 0.14);
    rgb += mix(vec3(0.42, 0.06, 0.78), vec3(0.04, 0.36, 0.24), allied) * alpha * 0.6;
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
