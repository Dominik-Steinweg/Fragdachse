/**
 * Shield charger passes. Same segment instance layout as the firestarter layer: a→b with half
 * width w; local u along a→b and v across, in pixels. Instance: seg (a, b), shape [w, kind, t,
 * seed], aux [allied, a1, a2, a3].
 *
 * Visual language (deliberately unlike the firestarter's flame strands and the mortar's rings):
 * a physical warning corridor on the ground. Two rails mark the body-wide lane, the floor fills
 * like a loading bar from the charger to the end bar, and chevrons race toward the end.
 *
 * kind 0 lane telegraph  t = windup progress 0..1; w = corridor half width (body radius)
 * kind 1 run streak      t = seconds since the run started; a = tail, b = body
 * kind 2 skid marks      t = seconds since the run ended (ground scuffs along the travelled lane)
 * kind 3 dust puff       t = seconds since the puff; disc around a; a1 = radius px
 *
 * Pass 0 (5.12, ground material): skid marks. Pass 1 (13.38, lit material): dust.
 * Pass 2 (19.7, emissive overlay): lane telegraph and run streak.
 */
export const SHIELD_CHARGER_KIND = { lane: 0, streak: 1, skid: 2, dust: 3 } as const;
export const SHIELD_CHARGER_SKID_LIFE_S = 2.6;
export const SHIELD_CHARGER_DUST_LIFE_S = 1.1;
/** Corridor margin around the body radius, so the rails sit just outside the body. */
export const SHIELD_CHARGER_LANE_MARGIN_PX = 12;

const SHARED = /* glsl */ `
bool drawn(float pass, float kind) {
  if (pass < 0.5) return abs(kind - 2.0) < 0.5;
  if (pass < 1.5) return abs(kind - 3.0) < 0.5;
  return kind < 1.5;
}`;

export const SHIELD_CHARGER_VERTEX = `
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
varying float vLen;
varying vec4 vShape;
varying vec4 vAux;
${SHARED}
void main() {
  vShape = inShape; vAux = inAux;
  if (!drawn(uPass, inShape.y)) { vUV = vec2(0.0); vLen = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 d = inSeg.zw - inSeg.xy;
  float len = length(d);
  vec2 dir = len > 0.5 ? d / len : vec2(1.0, 0.0);
  len = len > 0.5 ? len : 0.0;
  vec2 n = vec2(-dir.y, dir.x);
  float w = inShape.x;
  float u = inCorner.x < 0.0 ? -w : len + w;
  float v = inCorner.y * w;
  vUV = vec2(u, v); vLen = len;
  vec2 world = inSeg.xy + dir * u + n * v;
  gl_Position = uProjectionMatrix * vec4((uViewMatrix * vec3(world, 1.0)).xy, 0.0, 1.0);
}`;

export const SHIELD_CHARGER_FRAGMENT = `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform float uPass;
uniform float uDetail;
uniform float uAlpha;
uniform float uTime;
varying vec2 vUV;
varying float vLen;
varying vec4 vShape;
varying vec4 vAux;
${SHARED}
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
// Hostile warning ramp (ember red → amber → hot white); allied uses the jade family, quietly.
vec3 warn(float h, float allied) {
  vec3 h0 = mix(vec3(0.38, 0.05, 0.02), vec3(0.02, 0.19, 0.12), allied);
  vec3 h1 = mix(vec3(0.95, 0.22, 0.08), vec3(0.12, 0.89, 0.60), allied);
  vec3 h2 = mix(vec3(1.00, 0.62, 0.26), vec3(0.54, 1.00, 0.81), allied);
  vec3 h3 = mix(vec3(1.00, 0.93, 0.80), vec3(0.91, 1.00, 0.96), allied);
  float x = clamp(h, 0.0, 1.0) * 3.0;
  if (x < 1.0) return mix(h0, h1, x);
  if (x < 2.0) return mix(h1, h2, x - 1.0);
  return mix(h2, h3, x - 2.0);
}
vec3 glow(float e, float allied) { float s = 1.0 - exp(-1.4 * max(e, 0.0)); return warn(0.15 + 0.75 * s, allied) * s * 1.25; }

void main() {
  float w = vShape.x, kind = vShape.y, t = vShape.z, seed = vShape.w;
  float allied = vAux.x;
  float u = vUV.x, v = vUV.y, len = vLen;
  vec3 rgb = vec3(0.0);
  float alpha = 0.0;

  if (kind < 0.5) {
    // Lane telegraph. body = corridor half width without the margin.
    float body = max(w - ${SHIELD_CHARGER_LANE_MARGIN_PX.toFixed(1)}, 4.0);
    float av = abs(v);
    float span = smoothstep(-2.0, 4.0, u) * (1.0 - smoothstep(len, len + 3.0, u));
    float p = clamp(t, 0.0, 1.0);
    float urgent = smoothstep(0.78, 1.0, p);
    float pulse = 0.85 + 0.15 * sin(uTime * mix(9.0, 26.0, urgent));
    // Rails just outside the body: crisp line plus a soft halo.
    float railD = av - (body + 4.0);
    float rails = (gauss(railD, 1.1) + 0.3 * gauss(railD, 4.0)) * span;
    // Loading fill: the floor lights up from the charger to the end bar as the windup runs out.
    float front = p * len;
    float inside = 1.0 - smoothstep(body + 2.0, body + 4.0, av);
    float filled = (1.0 - smoothstep(front - 1.0, front + 1.0, u)) * inside * span;
    float frontBand = gauss(u - front, 5.0) * inside * span * (1.0 - urgent * 0.5);
    // Chevrons racing toward the end; faster as the start approaches.
    float spacing = 30.0;
    float c = fract((u - av * 0.7 - uTime * mix(140.0, 520.0, p)) / spacing);
    float chevron = (smoothstep(0.0, 0.06, c) * (1.0 - smoothstep(0.14, 0.22, c))) * inside * span
      * smoothstep(body * 0.15, body * 0.5, body - av + 2.0);
    // End bar: where the run will stop.
    float endBar = gauss(u - len, 2.2) * (1.0 - smoothstep(body + 6.0, body + 9.0, av))
      + gauss(av - (body + 6.0), 1.4) * gauss(u - len + 6.0, 6.0) * 0.8;
    float quiet = mix(1.0, 0.3, allied);
    float e = (rails * (0.75 + 0.35 * p) + filled * (0.16 + 0.24 * urgent) + frontBand * 0.7
      + chevron * (0.35 + 0.35 * p) * (1.0 - allied) + endBar * (0.8 + 0.4 * urgent)) * pulse * quiet;
    rgb = glow(e, allied);
    // Dark seat under the rails and fill keeps the warning readable on bright ground.
    alpha = clamp((gauss(railD, 3.0) * 0.28 + filled * 0.1) * span * (1.0 - allied), 0.0, 0.35);
    rgb += vec3(0.05, 0.01, 0.0) * alpha;
  } else if (kind < 1.5) {
    // Run streak: speed lines behind the body, brightest at the body, broken by noise.
    float k = clamp(u / max(len, 1.0), 0.0, 1.0);          // 0 tail → 1 body
    float lines = 0.0;
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      float offset = (hash(vec2(fi, seed)) - 0.5) * 1.6 * w;
      float breakUp = smoothstep(0.35, 0.75, noise(vec2(u * 0.05 + fi * 7.0 - t * 40.0, seed + fi)));
      lines += gauss(v - offset, 1.0) * breakUp;
    }
    float core = gauss(v, w * 0.55) * 0.35;
    float fade = (1.0 - smoothstep(0.25, 0.6, t)) * smoothstep(0.0, 0.04, t);
    float e = (lines * 0.6 + core) * k * k * fade * mix(1.0, 0.5, allied);
    rgb = mix(vec3(1.0, 0.92, 0.82), warn(0.55, allied), 0.35) * e;
  } else if (kind < 2.5) {
    // Ground scuffs: two dragged-paw streaks along the travelled lane, cooling to dust.
    float life = 1.0 - smoothstep(0.4, ${SHIELD_CHARGER_SKID_LIFE_S.toFixed(1)}, t);
    float span = smoothstep(0.0, 18.0, u) * (1.0 - smoothstep(len - 6.0, len + 2.0, u));
    float tracks = gauss(abs(v) - w * 0.45, 2.2);
    float grit = 0.45 + 0.55 * fbm(vec2(u * 0.09, v * 0.5 + seed));
    alpha = tracks * span * life * grit * 0.38;
    rgb = vec3(0.12, 0.09, 0.06) * alpha;
  } else {
    // Dust puff: soft lit cloud that spreads and settles.
    float radius = max(vAux.y, 4.0);
    float r = length(vec2(u, v));
    float life = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.3, ${SHIELD_CHARGER_DUST_LIFE_S.toFixed(1)}, t));
    float spread = radius * (0.55 + 0.6 * t);
    float cloud = exp(-r * r / (spread * spread));
    float tex = fbm(vec2(u, v) * 0.07 + seed * 3.1 + vec2(t * 0.6, -t * 0.4));
    alpha = clamp(cloud * (0.25 + 0.6 * tex) * life * 0.5, 0.0, 0.5);
    rgb = mix(vec3(0.42, 0.37, 0.30), vec3(0.62, 0.57, 0.48), tex) * alpha;
  }
  rgb *= uAlpha; alpha = clamp(alpha * uAlpha, 0.0, 1.0);
  gl_FragColor = vec4(rgb, alpha);
}`;
