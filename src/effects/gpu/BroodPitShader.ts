import { VOID_PALETTE } from '../../config';

/**
 * Brood pool surface (GDD Spawnbauwerk V1). One quad per pit, centred on the pool; local p in px.
 * Instance: a [cx, cy, cornerX, cornerY], b [quad half px, pool radius px, charge 0..1, state],
 * c [swell0 x, y, t, seed], d [swell1 x, y, t, swell2 x], e [swell2 y, t, -, -].
 * state: 0 sealed, 1 active, 2 dry. Swell t < 0 is unused; 0..0.75 the black ooze heaves over a
 * rising body, 0.75..1 it parts, throws droplets that land as splats, and closes again.
 *
 * Visual language: viscous black-violet ooze, lit by the world. No ring, no rim glow, no swirl, no
 * stream: the only light is a violet glow from the depth that shows through the thinned ooze and
 * the opening. Droplets rise and fall back (they fly out and land), never orbit.
 *
 * Pass 0 (DEPTH.BASE_GROUNDING + 0.12, lit material): heaving surface, swells, opening, droplets.
 * Pass 1 (DEPTH_LIGHTING + 0.07, emissive): depth glow under swells, in the opening and on charge.
 */
const vec3 = (color: number) => `vec3(${((color >> 16) & 255) / 255}, ${((color >> 8) & 255) / 255}, ${(color & 255) / 255})`;

export const BROOD_PIT_VERTEX = `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform mat4 uProjectionMatrix;
uniform mat3 uViewMatrix;
attribute vec4 inA;
attribute vec4 inB;
attribute vec4 inC;
attribute vec4 inD;
attribute vec4 inE;
varying vec2 vP;
varying vec4 vB;
varying vec4 vC;
varying vec4 vD;
varying vec4 vE;
void main() {
  vB = inB; vC = inC; vD = inD; vE = inE;
  vP = inA.zw * inB.x;
  vec2 world = inA.xy + vP;
  gl_Position = uProjectionMatrix * vec4((uViewMatrix * vec3(world, 1.0)).xy, 0.0, 1.0);
}`;

export const BROOD_PIT_FRAGMENT = `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform float uPass;
uniform float uDetail;
uniform float uAlpha;
uniform float uTime;
uniform float uEmissive;
varying vec2 vP;
varying vec4 vB;
varying vec4 vC;
varying vec4 vD;
varying vec4 vE;
const float TAU = 6.2831853;
const vec3 LIGHT = vec3(-0.5, -0.56, 0.66);
const vec3 HIGHLIGHT = vec3(0.62, 0.42, 0.66);
const vec3 SHADOW = vec3(0.05, 0.02, 0.07);
const vec3 THROAT = vec3(0.06, 0.02, 0.09);
const vec3 DROP = vec3(0.21, 0.07, 0.25);
const vec3 GLOW = ${vec3(VOID_PALETTE.primary)};
const vec3 GLOW_HOT = ${vec3(VOID_PALETTE.bright)};
float hash(vec2 v) { return fract(sin(dot(v, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 v) {
  vec2 i = floor(v), f = fract(v); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + 1.0), f.x), f.y);
}

// Accumulated per fragment: membrane slope, tint toward the stretched highlight, throat, droplets, glow.
vec2 slope; float stretch; float throat; float rim; float drops; float glow; float hot;

void bulge(vec2 c, float t, float seed, float R) {
  if (t < 0.0) return;
  vec2 d = vP - c;
  float swell = smoothstep(0.0, 0.75, t);
  float tear = clamp((t - 0.75) / 0.25, 0.0, 1.0);
  float sinks = t < 0.75 ? 1.0 : 1.0 - smoothstep(0.0, 0.35, tear);
  float rb = mix(5.0, 11.0, swell);
  float h = swell * sinks * exp(-dot(d, d) / (rb * rb));
  slope += -2.0 * d / (rb * rb) * h * 7.0;
  stretch += h * 0.85;
  glow += h * h * (0.35 + 0.65 * swell);
  if (tear <= 0.0) return;
  // Ragged tear: opens fast, holds while the body climbs out, then reseals.
  float open = smoothstep(0.0, 0.18, tear) * (1.0 - smoothstep(0.5, 1.0, tear));
  float ang = atan(d.y, d.x);
  float rag = 0.72 + 0.4 * noise(vec2(ang * 2.2 + seed * 13.0, seed * 7.0));
  float rh = 9.5 * open * rag;
  float r = length(d);
  throat = max(throat, 1.0 - smoothstep(rh - 1.0, rh + 0.6, r));
  rim = max(rim, open * exp(-pow((r - rh - 1.4) / 1.6, 2.0)));
  hot += open * (1.0 - smoothstep(0.0, rh + 2.0, r)) * (1.0 - tear * 0.6);
  // Droplets thrown up and out; they land as splats and soak away.
  for (int i = 0; i < 9; i++) {
    float fi = float(i);
    float a = seed * TAU + fi * 2.39996 + (hash(vec2(seed, fi)) - 0.5) * 0.6;
    float reach = mix(16.0, 30.0, hash(vec2(fi, seed + 3.0))) * (uDetail > 0.5 ? 1.0 : 0.8);
    float k = clamp((tear - 0.04) / 0.42, 0.0, 1.0);
    if (tear < 0.04) continue;
    float flight = 1.0 - (1.0 - k) * (1.0 - k);
    vec2 pos = c + vec2(cos(a), sin(a)) * (3.0 + reach * flight);
    float airborne = 1.0 - step(1.0, k);
    float size = airborne > 0.5 ? mix(2.6, 1.9, k) + 0.9 * sin(k * 3.14159) : 2.3;
    float fade = airborne > 0.5 ? 1.0 : 1.0 - smoothstep(0.46, 1.0, tear);
    float dd = length(vP - pos);
    drops = max(drops, (1.0 - smoothstep(size - 0.8, size + 0.5, dd)) * fade);
  }
}

void main() {
  float R = vB.y, charge = vB.z, state = vB.w;
  vec3 rgb = vec3(0.0); float alpha = 0.0;
  if (state > 1.5) { gl_FragColor = vec4(0.0); return; }
  slope = vec2(0.0); stretch = 0.0; throat = 0.0; rim = 0.0; drops = 0.0; glow = 0.0; hot = 0.0;
  float r = length(vP);
  float inside = 1.0 - smoothstep(R - 3.0, R + 0.5, r);
  float active = state > 0.5 ? 1.0 : 0.0;
  // Wet membrane breathes; an announced release makes it heave faster and stronger.
  float speed = mix(0.18, 0.75, charge) * active + 0.05;
  vec2 q = vP / 8.5;
  float n0 = noise(q + vec2(uTime * speed, uTime * speed * 0.6));
  float n1 = noise(q * 1.9 - vec2(uTime * speed * 0.8, -uTime * speed * 0.4) + 5.3);
  float heave = (0.35 + 0.9 * charge) * mix(0.25, 1.0, active);
  slope += (vec2(n0 - noise(q + vec2(0.35, 0.0) + vec2(uTime * speed, uTime * speed * 0.6)),
                 n0 - noise(q + vec2(0.0, 0.35) + vec2(uTime * speed, uTime * speed * 0.6))) * 3.0 + (n1 - 0.5) * 0.3) * heave;
  glow += charge * 0.18 * (0.55 + 0.45 * n1) * active;
  if (active > 0.5) {
    bulge(vC.xy, vC.z, vC.w, R);
    bulge(vec2(vD.x, vD.y), vD.z, vC.w + 0.37, R);
    bulge(vec2(vD.w, vE.x), vE.y, vC.w + 0.71, R);
  }
  vec3 n = normalize(vec3(slope, 1.0));
  float lit = dot(n, normalize(LIGHT)) - normalize(LIGHT).z;
  if (uPass < 0.5) {
    // Lit material: highlight and shadow of the moving surface over the pit sprite, then the torn
    // throat, its membrane lip and the droplets on top.
    float hi = clamp(lit * 2.2, 0.0, 1.0) * inside;
    float lo = clamp(-lit * 2.4, 0.0, 1.0) * inside;
    float hiA = clamp(hi * 0.42 + stretch * 0.32 * inside, 0.0, 0.7);
    rgb = HIGHLIGHT * hiA; alpha = hiA;
    float loA = lo * 0.5 * (1.0 - alpha);
    rgb += SHADOW * loA; alpha += loA;
    float tA = throat * 0.96;
    rgb = mix(rgb, THROAT * tA, tA); alpha = mix(alpha, tA, tA);
    float rimA = rim * 0.55 * (1.0 - throat);
    rgb = mix(rgb, HIGHLIGHT * 0.8 * rimA, rimA); alpha = mix(alpha, rimA, rimA);
    float dA = drops * 0.92;
    rgb = mix(rgb, DROP * dA, dA); alpha = mix(alpha, dA, dA);
  } else {
    // Emissive: the violet below shows through stretched membrane, the open tear and on charge.
    float g = clamp(glow, 0.0, 1.2) * inside;
    rgb = GLOW * g * 0.55 + GLOW_HOT * clamp(hot, 0.0, 1.0) * 0.9 + GLOW * throat * 0.35;
    rgb *= uEmissive;
  }
  rgb *= uAlpha; alpha = clamp(alpha * uAlpha, 0.0, 1.0);
  gl_FragColor = vec4(rgb, alpha);
}`;
