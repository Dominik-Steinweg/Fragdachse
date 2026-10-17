import { ALLIED_PALETTE } from '../../config';

/**
 * Rest heal passes (Quacksalber toad). Segment instance layout like the turret web layer: a→b with
 * half width w; local u along a→b and v across, in pixels. Instance: seg (a, b), shape [w, kind, t,
 * seed], aux [a1, a2, a3, a4].
 *
 * Visual language: a living, sickly jade-mint remedy, never red (telegraph) or void violet (danger).
 * A rune sigil breathes on the ground under the channelling toad; from its back cross a braided
 * stream of light flows to each healed ally, carrying one bright dose per heal tick that lands at
 * the ally in a small absorbing flash; the ally's ground ring draws the light in. The CPU adds the
 * free particles (spores, peeling motes, rising sparkles) through the shared GPU particle backend.
 *
 * kind 0 link        a = back cross, b = ally; t = reach 0..1 (grows from the cross, withdraws to it);
 *                    a1 = sag px (signed); a2 = heal tick phase 0..1 (0 = a dose lands); a3 = palette
 *                    (0 plague, 1 allied); a4 = tick interval s
 * kind 1 sigil       a = b = toad centre; t = intensity 0..1; a1 = ring radius px; a2 = s since the
 *                    rest began; a3 = palette
 * kind 2 receiver    a = b = ally centre; t = intensity 0..1; a1 = ring radius px; a2 = tick phase;
 *                    a3 = palette
 * kind 3 back cross  a = b = cross; t = intensity; a1 = arm px; a2 = tick phase; a3 = palette; a4 = facing
 * kind 4 eye rings   a = b = eye; t = intensity; a1 = outer ring px; a2 = s since the rest began;
 *                    a3 = colour 0xRRGGBB
 *
 * Pass 0 (DEPTH.PLAYERS - 0.35, lit material): ground sigil and receiver rings under the bodies.
 * Pass 1 (DEPTH.PLAYERS + 0.04, lit material): the stream's dark bed and lit core, readable by day.
 * Pass 2 (DEPTH_LIGHTING + 0.07, emissive): every glow, readable at night.
 */
export const REST_HEAL_KIND = { link: 0, sigil: 1, receiver: 2, cross: 3, eyes: 4 } as const;
/** Speed of the doses along the stream; one dose lands per heal tick. */
export const REST_HEAL_DOSE_SPEED_PX_S = 300;

const vec3 = (color: number) => `vec3(${((color >> 16) & 255) / 255}, ${((color >> 8) & 255) / 255}, ${(color & 255) / 255})`;
/** Sickly jade-mint of the plague heal. */
const PLAGUE = { glow: 0x3dff8f, core: 0xd8ffe2, bed: 0x0c3420 } as const;
const ALLIED = { glow: ALLIED_PALETTE.primary, core: ALLIED_PALETTE.core, bed: ALLIED_PALETTE.shadow } as const;

const SHARED = /* glsl */ `
bool drawn(float pass, float kind) {
  if (pass < 0.5) return abs(kind - 1.0) < 0.5 || abs(kind - 2.0) < 0.5;
  if (pass < 1.5) return kind < 0.5;
  return true;
}`;

export const REST_HEAL_VERTEX = `
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

export const REST_HEAL_FRAGMENT = `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform float uPass;
uniform float uDetail;
uniform float uAlpha;
uniform float uTime;
uniform float uEmissive;
uniform float uZoom;
varying vec2 vUV;
varying float vLen;
varying vec4 vShape;
varying vec4 vAux;
${SHARED}
const float TAU = 6.2831853;
const float PI = 3.1415927;
float hash(vec2 v) { return fract(sin(dot(v, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 v) {
  vec2 i = floor(v), f = fract(v); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + 1.0), f.x), f.y);
}
float gauss(float x, float s) { return exp(-x * x / (s * s)); }
/** Anti-aliased line of half width hw (world px) that never thins below ~0.7 screen px. */
float line(float d, float hw) {
  float px = 1.0 / max(uZoom, 0.1);
  float h = max(hw, 0.7 * px);
  return (1.0 - smoothstep(h, h + 1.1 * px, abs(d))) * min(1.0, hw / h + 0.25);
}
vec3 glowOf(float p) { return p > 0.5 ? ${vec3(ALLIED.glow)} : ${vec3(PLAGUE.glow)}; }
vec3 coreOf(float p) { return p > 0.5 ? ${vec3(ALLIED.core)} : ${vec3(PLAGUE.core)}; }
vec3 bedOf(float p) { return p > 0.5 ? ${vec3(ALLIED.bed)} : ${vec3(PLAGUE.bed)}; }
vec3 unpack(float c) {
  float r = floor(c / 65536.0), g = floor(mod(c, 65536.0) / 256.0), b = mod(c, 256.0);
  return vec3(r, g, b) / 255.0;
}
/** Small plus glyph centred at q (local px), arm length a, half width hw. */
float plusGlyph(vec2 q, float a, float hw) {
  float h = line(q.y, hw) * (1.0 - smoothstep(a - 1.0, a + 0.6, abs(q.x)));
  float v = line(q.x, hw) * (1.0 - smoothstep(a - 1.0, a + 0.6, abs(q.y)));
  return max(h, v);
}

void main() {
  float kind = vShape.y, t = vShape.z, seed = vShape.w;
  vec3 rgb = vec3(0.0);
  float alpha = 0.0;

  if (kind < 0.5) {
    // ── Link: braided stream from the back cross to the ally ─────────────────────────────
    float len = max(vLen, 1.0);
    float u = vUV.x, x = clamp(u / len, 0.0, 1.0);
    float sag = vAux.x, phase = vAux.y, palette = vAux.z, tickS = max(vAux.w, 0.05);
    float env = sin(PI * x);
    float centre = sag * env + 2.4 * sin(uTime * 2.1 + x * 6.0 + seed * 17.0) * env;
    float slope = sag * PI / len * cos(PI * x);
    float d = (vUV.y - centre) / sqrt(1.0 + slope * slope);
    float tipU = t * len;
    float grown = 1.0 - smoothstep(tipU - 3.0, tipU + 1.0, u);
    float inside = smoothstep(-2.0, 1.5, u) * (1.0 - smoothstep(len - 1.0, len + 2.5, u)) * grown;
    float width = mix(3.0, 1.9, x);
    // Clumps of light stream towards the ally; two thin strands braid around the core.
    float clumps = 0.5 + 0.5 * noise(vec2(u / 15.0 - uTime * 2.6, seed * 7.0));
    float twist = u / 16.0 - uTime * 5.0 + seed * 9.0;
    float amp = 1.2 + 1.7 * env;
    float s1 = line(d - amp * sin(twist), 0.5) * (0.5 + 0.5 * cos(twist));
    float s2 = line(d + amp * sin(twist), 0.5) * (0.5 - 0.5 * cos(twist));
    float strands = uDetail > 0.5 ? s1 + s2 : 0.5 * (s1 + s2);
    // The stream wells up out of the cross instead of starting at full strength over the body.
    float emerge = mix(0.3, 1.0, smoothstep(0.0, 12.0, u));
    float core = gauss(d, width * 0.72) * emerge;
    strands *= emerge;
    float halo = gauss(d, width * 3.4);
    // One dose per heal tick: doses ride the stream and the leading one lands when the tick applies.
    float spacing = ${REST_HEAL_DOSE_SPEED_PX_S.toFixed(1)} * tickS;
    float lead = len - spacing * (1.0 - phase);
    float k = floor((lead - u) / spacing + 0.5);
    float doseU = lead - k * spacing;
    float dose = k >= 0.0 ? gauss(u - doseU, 6.5) * gauss(d, 4.2) : 0.0;
    float trail = k >= 0.0 && u < doseU ? gauss(u - doseU, 18.0) * gauss(d, 2.4) * 0.45 : 0.0;
    float landed = (1.0 - smoothstep(0.0, 0.32, phase)) * gauss(u - len, 8.0) * gauss(d, 8.0) * step(0.999, t);
    float source = gauss(u, 6.0) * gauss(d, 5.5);
    float tip = t < 0.999 ? gauss(u - tipU, 4.5) * gauss(d, 3.5) : 0.0;
    float motes = 0.0;
    if (uDetail > 0.5) for (int i = 0; i < 4; i++) {
      float fi = float(i);
      float mu = fract(uTime * (0.42 + 0.07 * fi) + fi * 0.27 + seed) * len;
      float mv = 2.6 * sin(uTime * (3.3 + fi) + fi * 2.1 + seed * 5.0);
      motes += gauss(u - mu, 2.2) * gauss(d - mv, 1.9);
    }
    vec3 glow = glowOf(palette), coreC = coreOf(palette), bed = bedOf(palette);
    if (uPass < 1.5) {
      // Daylight: a dark translucent bed carries a lit core so the stream reads on bright ground.
      // The bed fades at both ends: the sigil and the receiver ring carry the joints.
      float bedA = gauss(d, width * 1.55) * 0.38 * inside * smoothstep(0.0, 0.14, x) * (1.0 - smoothstep(0.78, 0.98, x));
      float litA = clamp((core * (0.5 + 0.4 * clumps) + strands * 0.4 + dose * 0.8) * inside, 0.0, 1.0) * 0.62;
      vec3 lit = mix(glow, coreC, clamp(dose * 0.8 + core * 0.15, 0.0, 1.0));
      alpha = litA + bedA * (1.0 - litA);
      rgb = lit * litA + bed * bedA * (1.0 - litA);
    } else {
      vec3 col = glow * (halo * 0.2 + core * 0.55 * clumps + strands * 0.5 + trail)
        + coreC * (core * 0.22 + motes * 0.7 + dose * 1.0 + source * 0.35);
      col *= inside;
      col += coreC * (landed * 0.9 + tip * 1.1) * grown;
      rgb = col * uEmissive; alpha = 0.0;
    }
  } else if (kind < 1.5) {
    // ── Sigil: a breathing rune circle on the ground under the channelling toad ───────────
    vec2 p = vUV; float r = length(p), R = vAux.x, rest = vAux.y, palette = vAux.z;
    float ang = atan(p.y, p.x);
    float rot = uTime * 0.32 + seed * TAU;
    float breath = 0.82 + 0.18 * sin(uTime * 2.6 + seed * 4.0);
    float gaps = smoothstep(0.12, 0.34, abs(sin(2.0 * (ang - rot))));
    float outer = line(r - R, 0.75) * gaps;
    float cells = 18.0, ri = R * 0.7;
    float s = fract((ang + rot * 1.7) / TAU * cells);
    float dots = gauss((s - 0.5) * TAU * ri / cells, 0.95) * gauss(r - ri, 0.95);
    float glyphs = 0.0;
    for (int i = 0; i < 4; i++) {
      float a = rot + float(i) * PI * 0.5;
      vec2 c = vec2(cos(a), sin(a)) * R;
      vec2 q = mat2(cos(a), -sin(a), sin(a), cos(a)) * (p - c);
      glyphs += plusGlyph(q, 3.4, 0.65);
    }
    // The rest opens with one ring rolling outwards from under the body.
    float open = clamp(rest / 0.55, 0.0, 1.0);
    float openRing = (1.0 - open) * line(r - mix(R * 0.35, R * 1.45, 1.0 - (1.0 - open) * (1.0 - open)), 1.3);
    float reveal = smoothstep(0.0, 0.3, rest);
    float runes = (outer + dots * 0.8 + glyphs) * breath * reveal;
    vec3 glow = glowOf(palette), coreC = coreOf(palette), bed = bedOf(palette);
    if (uPass < 0.5) {
      float litA = clamp(runes * 0.62 + openRing * 0.5, 0.0, 0.85) * t;
      float bedA = clamp(gauss(r - R, 3.0) * 0.18 + gauss(r, R * 0.9) * 0.12, 0.0, 0.3) * t * reveal;
      vec3 lit = mix(bed, glow, 0.6);
      alpha = litA + bedA * (1.0 - litA);
      rgb = lit * litA + bed * bedA * (1.0 - litA);
    } else {
      float bloom = gauss(r, R * 0.85) * 0.16 * breath * reveal;
      rgb = (glow * (runes * 0.55 + openRing * 0.8 + bloom) + coreC * glyphs * 0.25 * reveal) * t * uEmissive;
    }
  } else if (kind < 2.5) {
    // ── Receiver: the ally's ground ring draws the stream's light in ──────────────────────
    vec2 p = vUV; float r = length(p), R = vAux.x, phase = vAux.y, palette = vAux.z;
    float ang = atan(p.y, p.x);
    float swirl = fract((ang / TAU) * 6.0 + r / R * 0.6 + uTime * 0.9 + seed);
    float dashes = gauss(swirl - 0.5, 0.16) * gauss(r - R * 0.92, 2.0);
    float ring = line(r - R, 0.6);
    // Every tick: a soft ring contracts into the body.
    float pull = clamp(phase / 0.4, 0.0, 1.0);
    float absorb = (1.0 - pull) * line(r - mix(R * 1.5, R * 0.45, pull), 1.2);
    vec3 glow = glowOf(palette), coreC = coreOf(palette), bed = bedOf(palette);
    if (uPass < 0.5) {
      float litA = clamp(ring * 0.5 + dashes * 0.55, 0.0, 0.7) * t;
      vec3 lit = mix(bed, glow, 0.55);
      alpha = litA; rgb = lit * litA;
    } else {
      float halo = gauss(r - R * 0.6, R * 0.5) * 0.1;
      rgb = (glow * (ring * 0.35 + dashes * 0.6 + halo) + coreC * absorb * 0.75) * t * uEmissive;
    }
  } else if (kind < 3.5) {
    // ── Back cross: a soft plus on the toad's back that swells with every tick ────────────
    vec2 p = vUV; float arm = vAux.x, phase = vAux.y, palette = vAux.z, facing = vAux.w;
    vec2 q = mat2(cos(facing), -sin(facing), sin(facing), cos(facing)) * p;
    float pulse = exp(-phase * 3.2);
    float a = arm * (1.0 + 0.45 * pulse);
    float glyph = plusGlyph(q, a, 0.85);
    float soft = plusGlyph(q, a + 2.0, 2.6) * 0.5;
    float bloom = gauss(length(p), arm * 1.3) * (0.15 + 0.35 * pulse);
    rgb = (glowOf(palette) * (soft * (0.3 + 0.5 * pulse) + bloom) + coreOf(palette) * glyph * (0.5 + 0.5 * pulse)) * t * uEmissive;
  } else {
    // ── Eye rings: a nod to the hypnotic toad while it channels ────────────────────────────
    float r = length(vUV), R = vAux.x, rest = vAux.y;
    float rings = 0.0;
    for (int i = 0; i < 3; i++) {
      float f = fract(rest / 0.9 + float(i) / 3.0);
      rings += line(r - (1.5 + f * (R - 1.5)), 0.45) * (1.0 - f) * 0.65;
    }
    rgb = unpack(vAux.z) * rings * t * uEmissive;
  }
  rgb *= uAlpha; alpha = clamp(alpha * uAlpha, 0.0, 1.0);
  gl_FragColor = vec4(rgb, alpha);
}`;
