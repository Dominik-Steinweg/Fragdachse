/**
 * Firestarter passes. Every instance is a segment a→b with a half width w; the quad covers
 * [-w, len + w] along the segment and ±w across it, so local coordinates are in pixels:
 * u along a→b, v across. A zero-length segment is a disc around a.
 * Instance: seg (a, b), shape [w, kind, t, seed], aux [allied, a1, a2, a3].
 *
 * Signature motif: two braided void-flame strands (a helix seen from above). They converge
 * while the lance charges, fuse into one steady core at the commit and unwind when it fires.
 *
 * kind 0 telegraph  t = charge progress 0..1, a1 = commit start (fraction of the charge)
 * kind 1 lance      t = seconds since the shot; a → b is the resolved trace
 * kind 2 orb        a = ball, b = end of its tail (behind it); a1 = body radius px
 * kind 3 combo      t = seconds since the detonation; a1 = blast radius px
 *
 * Pass 0 (5.12, ground material): orb drop shadow, lance char streak, combo scorch.
 * Pass 1 (15.05, projectile body): the orb, dark eclipse core inside a burning rim, and its tail.
 * Pass 2 (19.7, emissive overlay): telegraph, lance and combo signature above every body.
 * Emissive light is premultiplied with zero alpha (additive); dark underlays carry alpha.
 */
export const FIRESTARTER_KIND = { telegraph: 0, lance: 1, orb: 2, combo: 3 } as const;
/** Emissive life of a lance; embers and the char streak outlive it. */
export const FIRESTARTER_LANCE_FLASH_S = 0.34;
export const FIRESTARTER_LANCE_LIFE_S = 1.8;
export const FIRESTARTER_COMBO_LIFE_S = 3;

const SHARED = /* glsl */ `
const vec2 SHADOW_DIR = vec2(0.6, 0.8);
// Which kinds a pass draws; anything else collapses to a degenerate quad.
bool drawn(float pass, float kind) {
  if (pass < 0.5) return kind > 0.5;
  if (pass < 1.5) return abs(kind - 2.0) < 0.5;
  return abs(kind - 2.0) > 0.5;
}
// The orb's shadow is offset, so its ground quad is wider.
float pad(float pass, float kind) { return pass < 0.5 && abs(kind - 2.0) < 0.5 ? 1.7 : 1.0; }`;

export const FIRESTARTER_VERTEX = `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform mat4 uProjectionMatrix;
uniform mat3 uViewMatrix;
uniform float uPass;
attribute vec4 inSeg;
attribute vec2 inCorner;
attribute vec4 inShape;
attribute vec4 inAux;
varying vec2 vUV;
varying vec2 vDir;
varying float vLen;
varying vec4 vShape;
varying vec4 vAux;
${SHARED}
void main() {
  vShape = inShape; vAux = inAux;
  if (!drawn(uPass, inShape.y)) { vUV = vec2(0.0); vDir = vec2(1.0, 0.0); vLen = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 d = inSeg.zw - inSeg.xy;
  float len = length(d);
  vec2 dir = len > 0.5 ? d / len : vec2(1.0, 0.0);
  len = len > 0.5 ? len : 0.0;
  vec2 n = vec2(-dir.y, dir.x);
  float w = inShape.x * pad(uPass, inShape.y);
  float u = inCorner.x < 0.0 ? -w : len + w;
  float v = inCorner.y * w;
  vUV = vec2(u, v); vDir = dir; vLen = len;
  vec2 world = inSeg.xy + dir * u + n * v;
  gl_Position = uProjectionMatrix * vec4((uViewMatrix * vec3(world, 1.0)).xy, 0.0, 1.0);
}`;

export const FIRESTARTER_FRAGMENT = `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform float uPass;
uniform float uDetail;
uniform float uAlpha;
uniform float uTime;
varying vec2 vUV;
varying vec2 vDir;
varying float vLen;
varying vec4 vShape;
varying vec4 vAux;
${SHARED}
const float TAU = 6.2831853;
float hash(vec2 v) { return fract(sin(dot(v, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 v) {
  vec2 i = floor(v), f = fract(v); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + 1.0), f.x), f.y);
}
float fbm(vec2 v) {
  float sum = noise(v) * 0.5 + noise(v * 2.03 + 17.1) * 0.25;
  if (uDetail > 0.5) sum += noise(v * 4.07 + 41.3) * 0.15 + noise(v * 8.11 + 73.7) * 0.1;
  else sum += 0.25;
  return sum;
}
float gauss(float x, float w) { float k = x / w; return exp(-k * k); }
// Faction ramp: 0 shadow, 0.25 deep, 0.5 primary, 0.75 bright, 1 core (VOID_PALETTE / ALLIED_PALETTE).
vec3 heat(float h, float allied) {
  vec3 c0 = mix(vec3(0.141, 0.039, 0.220), vec3(0.020, 0.188, 0.122), allied);
  vec3 c1 = mix(vec3(0.435, 0.086, 0.659), vec3(0.047, 0.561, 0.373), allied);
  vec3 c2 = mix(vec3(0.702, 0.278, 1.000), vec3(0.122, 0.890, 0.604), allied);
  vec3 c3 = mix(vec3(0.851, 0.549, 1.000), vec3(0.541, 1.000, 0.812), allied);
  vec3 c4 = mix(vec3(0.976, 0.910, 1.000), vec3(0.910, 1.000, 0.961), allied);
  float x = clamp(h, 0.0, 1.0) * 4.0;
  if (x < 1.0) return mix(c0, c1, x);
  if (x < 2.0) return mix(c1, c2, x - 1.0);
  if (x < 3.0) return mix(c2, c3, x - 2.0);
  return mix(c3, c4, x - 3.0);
}
// Emissive flame of strength e, soft-saturating: deep violet when faint, bright violet when strong.
// White is reserved for explicit hot cores (hot()), so overlapping layers never bloom into a white slab.
vec3 flame(float e, float allied) { float s = 1.0 - exp(-1.3 * max(e, 0.0)); return heat(0.12 + 0.68 * s, allied) * s * 1.3; }
vec3 hot(float e, float allied) { return heat(1.0, allied) * clamp(e, 0.0, 1.0) * 0.85; }
// One braid strand: crisp line plus soft glow at distance d (px).
float strand(float d, float width) { return gauss(d, width) + 0.32 * gauss(d, width * 3.4); }
// Sparse embers riding along u at the given speed (px/s); returns brightness.
float embers(float u, float v, float speed, float spacing, float spread, float seed) {
  float s = u - uTime * speed;
  float cell = floor(s / spacing);
  float r = hash(vec2(cell, seed));
  if (r < 0.45) return 0.0;
  float cu = (cell + 0.2 + 0.6 * hash(vec2(seed, cell))) * spacing;
  float cv = (hash(vec2(cell * 1.7, seed + 3.1)) - 0.5) * 2.0 * spread;
  vec2 q = vec2(s - cu, v - cv);
  return exp(-dot(q, q) / 2.2) * (0.5 + 0.5 * r);
}

void main() {
  float w = vShape.x, kind = vShape.y, t = vShape.z, seed = vShape.w;
  float allied = vAux.x;
  float u = vUV.x, v = vUV.y, len = vLen;
  vec3 rgb = vec3(0.0);
  float alpha = 0.0;

  if (kind < 0.5) {
    // Telegraph: braid converging over the whole range; one steady fused core in the commit.
    float c = clamp(vAux.y, 0.05, 1.0);
    float p = clamp(t / c, 0.0, 1.0);
    float commit = smoothstep(c - 0.015, c + 0.015, t);
    float flash = commit * exp(-max(t - c, 0.0) * 22.0);
    float reach = smoothstep(-6.0, 10.0, u) * (1.0 - smoothstep(len - 30.0, len, u));
    float along = clamp(u / max(len, 1.0), 0.0, 1.0);
    float emerge = smoothstep(0.0, 70.0, u);
    float amp = mix(15.0, 2.6, p * p) * emerge * (1.0 - commit);
    float phase = u * 0.042 - uTime * 7.5 + seed;
    float wobble = (noise(vec2(u * 0.05 - uTime * 3.0, seed)) - 0.5) * 5.0 * (1.0 - p);
    float y = amp * sin(phase) + wobble;
    float width = mix(1.7, 1.15, p);
    float flick = 0.62 + 0.5 * fbm(vec2(u * 0.03 - uTime * 2.6, abs(v) * 0.1 + seed));
    float braid = (strand(abs(v - y), width) + strand(abs(v + y), width)) * flick * (0.32 + 0.68 * p) * (1.0 - commit);
    // Hairline guide: the full range is always legible, faint until the commit.
    float guide = gauss(v, 0.9) * (0.16 + 0.22 * p) * (1.0 - commit);
    float sparks = embers(u, v, 230.0, 34.0, amp * 0.6 + 1.5, seed) * (0.25 + 0.75 * p) * (1.0 - commit);
    // Commit: fused, steady and hotter, with fine tongues licking off both edges.
    float pressure = clamp((t - c) / max(1.0 - c, 0.01), 0.0, 1.0);
    float tongue = smoothstep(0.52, 0.86, fbm(vec2(u * 0.045 - uTime * 6.5, abs(v) * 0.16 + seed * 1.7)));
    float core = (gauss(v, 1.9) * 1.05 + gauss(v, 6.5) * 0.48 + gauss(v, 15.0) * 0.16
      + tongue * gauss(abs(v) - 5.0, 3.2) * 0.42) * commit * (0.9 + 0.25 * pressure) + flash * gauss(v, 9.0) * 0.6;
    float lineE = (braid * 0.85 + guide + sparks * 0.9 + core) * reach * mix(1.0, mix(0.5, 0.8, commit), along);
    // Muzzle: a swirling flame knot that swells with the charge.
    float r0 = length(vec2(u, v));
    float knotR = mix(3.0, 6.0, p) + 1.5 * commit;
    float swirl = noise(vec2(atan(v, u) * 2.0 + uTime * 6.0, r0 * 0.16 - uTime * 5.0));
    float knot = gauss(r0, knotR) * (0.55 + 0.6 * swirl) * (0.45 + 0.55 * p) + gauss(r0, knotR * 0.38) * (0.4 + 0.8 * commit);
    float e = lineE + knot * (1.0 + flash);
    rgb = flame(e, allied) + hot((gauss(v, 1.1) * commit * reach + gauss(r0, knotR * 0.3) * (0.2 + 0.35 * commit)) * (0.75 + 0.4 * flash), allied);
    // A thin dark seat under the fused core keeps it readable on bright ground.
    alpha = gauss(v, 5.0) * 0.22 * commit * reach;
    rgb += heat(0.0, allied) * alpha * 0.6;
  } else if (kind < 1.5) {
    if (uPass < 0.5) {
      // Char streak where the lance burned through, breaking up as it cools.
      float life = 1.0 - smoothstep(0.2, ${FIRESTARTER_LANCE_LIFE_S.toFixed(2)}, t);
      float span = smoothstep(-2.0, 6.0, u) * (1.0 - smoothstep(len - 4.0, len + 2.0, u));
      float breakUp = 0.55 + 0.45 * fbm(vec2(u * 0.08, v * 0.4 + seed));
      alpha = gauss(v, 3.2) * 0.42 * life * span * breakUp;
      rgb = vec3(0.05, 0.035, 0.06) * alpha;
    } else {
      float e = clamp(t / ${FIRESTARTER_LANCE_FLASH_S.toFixed(2)}, 0.0, 1.0);
      float live = 1.0 - e;
      float span = smoothstep(-3.0, 5.0, u) * (1.0 - smoothstep(len - 1.0, len + 5.0, u));
      float flow = fbm(vec2(u * 0.035 - uTime * 14.0, v * 0.12 + seed));
      float body = gauss(v, (6.0 + 6.0 * flow) * (1.0 - 0.5 * e));
      float coreW = mix(3.2, 1.0, e);
      float core = gauss(v, coreW);
      float jets = smoothstep(0.5, 0.9, fbm(vec2(u * 0.06 - uTime * 9.0, (abs(v) - t * 95.0) * 0.08 + seed * 3.0)))
        * exp(-pow(max(abs(v) - 4.0, 0.0) / (8.0 + 48.0 * e), 2.0));
      // The braid unwinds outward as the shot spends itself.
      float amp = 3.0 + 26.0 * pow(e, 0.7);
      float y = amp * sin(u * 0.042 + seed * 2.0 + t * 6.0);
      float braid = (strand(abs(v - y), 1.5) + strand(abs(v + y), 1.5)) * pow(live, 1.5) * 0.75;
      float lance = (core * 0.9 + body * 0.5 * live + jets * 0.6 * live + braid * 0.8) * span * (live + 0.08);
      float ri = length(vec2(u - len, v));
      float impact = gauss(ri, 7.0 + 16.0 * e) * live * live * 0.9 + gauss(ri - (6.0 + 34.0 * e), 2.4 + 3.0 * e) * live * 0.6;
      float rm = length(vec2(u, v));
      float muzzle = gauss(rm, 5.0 + 8.0 * e) * pow(live, 1.5) * 0.7;
      float glow = (t < ${FIRESTARTER_LANCE_FLASH_S.toFixed(2)}) ? lance + impact + muzzle : 0.0;
      // Embers settle on the burned line and cool after the flash.
      float cool = 1.0 - smoothstep(0.15, 1.2, t);
      float settle = embers(u, v, 0.0, 11.0, 3.0, seed) * cool * span * smoothstep(0.02, 0.12, t);
      float white = (t < ${FIRESTARTER_LANCE_FLASH_S.toFixed(2)}) ? (gauss(v, coreW * 0.45) * span + gauss(ri, 4.0 + 6.0 * e) * 0.8) * live * live : 0.0;
      rgb = flame(glow, allied) + hot(white, allied) + flame(settle * 1.2, allied);
    }
  } else if (kind < 2.5) {
    float radius = max(vAux.y, 2.0);
    float bodyR = radius * 0.7;
    vec2 q = vec2(u, v);
    float r = length(q);
    if (uPass < 0.5) {
      vec2 off = vec2(dot(SHADOW_DIR, vDir), dot(SHADOW_DIR, vec2(-vDir.y, vDir.x))) * radius * 0.85;
      alpha = gauss(length(q - off), bodyR * 1.05) * 0.3;
      rgb = vec3(0.03, 0.02, 0.04) * alpha;
    } else {
      // Eclipse: a near-black core whose rim burns; tongues lean back into the tail.
      float ang = atan(v, u);
      float swirl = fbm(vec2(ang * 1.6 + uTime * 3.2 + seed, r * 0.18 - uTime * 2.4));
      float body = 1.0 - smoothstep(bodyR - 1.1, bodyR + 0.7, r);
      float rim = smoothstep(bodyR * 0.45, bodyR, r) * body;
      vec3 inner = mix(heat(0.02, allied) * 0.5, heat(0.32, allied), smoothstep(0.4, 0.85, swirl) * (0.35 + 0.65 * r / bodyR));
      float back = 0.5 + 0.5 * cos(ang);        // 1 toward the tail (+u), 0 facing the flight
      float tongues = fbm(vec2(ang * 2.6 - uTime * 1.6, uTime * 2.2 + seed));
      float coronaR = bodyR + 2.5 + 4.5 * tongues * (0.6 + 1.0 * back);
      float corona = (1.0 - smoothstep(bodyR, coronaR, r)) * step(bodyR * 0.9, r);
      float tailLen = max(len, 1.0);
      float k = clamp(u / tailLen, 0.0, 1.0);
      float tw = bodyR * 0.95 * pow(1.0 - k, 0.7) * (0.8 + 0.45 * fbm(vec2(u * 0.05 - uTime * 7.0, seed)));
      float lick = fbm(vec2(u * 0.06 - uTime * 6.5, v * 0.18 + seed));
      float tail = gauss(v, max(tw, 0.6)) * smoothstep(bodyR * 0.2, bodyR * 1.1, u) * (1.0 - k) * (0.45 + 0.85 * lick);
      float sparks = embers(u, v, 70.0, 9.0, bodyR * 0.8, seed) * smoothstep(bodyR, bodyR * 2.0, u) * (1.0 - k);
      float e = corona * (0.9 + 0.7 * tongues) + rim * (0.55 + 0.35 * swirl) + tail * 1.1 + sparks * 0.9;
      vec3 glow = flame(e, allied) + hot(rim * smoothstep(0.7, 1.0, swirl) * 0.35, allied);
      rgb = inner * body + glow * (1.0 - body * 0.35);
      alpha = body * 0.96;
    }
  } else {
    float radius = max(vAux.y, 4.0);
    float r = length(vec2(u, v));
    float ang = atan(v, u);
    if (uPass < 0.5) {
      // Scorch with radial streaks along the burst's lances.
      float life = 1.0 - smoothstep(0.6, ${FIRESTARTER_COMBO_LIFE_S.toFixed(1)}, t);
      float streak = smoothstep(0.35, 0.9, noise(vec2(ang * 6.0, seed * 7.0)));
      float disc = 1.0 - smoothstep(radius * 0.25, radius * (0.5 + 0.25 * streak), r);
      alpha = disc * 0.38 * life * (0.7 + 0.3 * fbm(vec2(u, v) * 0.06 + seed));
      rgb = vec3(0.05, 0.03, 0.06) * alpha;
    } else {
      // Implosion → star of flame lances → hot shock ring.
      float implode = 1.0 - smoothstep(0.0, 0.09, t);
      float ringIn = gauss(r - mix(radius * 0.12, radius * 0.95, implode), 3.5) * implode * smoothstep(0.0, 0.03, t);
      float n = 9.0;
      float sector = TAU / n;
      float idx = floor((ang + seed * TAU) / sector);
      float jitter = hash(vec2(idx, seed));
      float axis = (idx + 0.5 + (jitter - 0.5) * 0.5) * sector - seed * TAU;
      float reach = radius * (0.7 + 0.45 * jitter) * smoothstep(0.06, 0.16, t);
      float perp = r * abs(sin(ang - axis));
      float lick = 0.6 + 0.8 * fbm(vec2(r * 0.07 - t * 18.0, idx * 3.7 + seed));
      float taper = max((3.0 + 0.05 * radius) * (1.0 - r / max(reach, 1.0)) * lick, 0.0);
      float lances = gauss(perp, max(taper, 0.35)) * step(r, reach) * step(0.0, cos(ang - axis))
        * (1.0 - smoothstep(0.18, 0.5, t));
      float shockR = radius * (0.2 + smoothstep(0.06, 0.55, t) * 0.95);
      float shock = gauss(r - shockR, 4.0 + 7.0 * t) * (1.0 - smoothstep(0.25, 0.65, t))
        * (0.55 + 0.45 * fbm(vec2(ang * 3.0, t * 4.0 + seed)));
      float core = gauss(r, radius * 0.16) * exp(-pow((t - 0.09) / 0.05, 2.0));
      float spine = gauss(perp, 0.7) * step(r, reach * 0.85) * step(0.0, cos(ang - axis)) * (1.0 - smoothstep(0.12, 0.3, t));
      rgb = flame(ringIn * 1.1 + lances * 1.3 + shock * 0.8 + core * 0.8, allied) + hot(core * 0.9 + spine * 0.6, allied);
    }
  }
  rgb *= uAlpha; alpha = clamp(alpha * uAlpha, 0.0, 1.0);
  gl_FragColor = vec4(rgb, alpha);
}`;
