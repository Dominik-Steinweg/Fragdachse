import { ROCK_COVERAGE_GLSL } from '../RockPenetrationShader';
import { SURFACE_LIGHT_GLSL } from '../SurfaceLocalLights';

/**
 * Blood field shaders.
 *
 * Accumulation: every mark (see `BloodFieldModel`) is one quad drawn additively into a
 * camera-following texture: R ground density, G rock density, B water cloud density, A freshness
 * times ground/rock density. Each mark has a steep `1 / (1 + x^p)` falloff with x = 1 on its
 * outline, so overlapping marks sum smoothly and only bridge when they nearly touch.
 *
 * Receivers threshold that density into one surface: a crisp anti-aliased outline, thickness from
 * how far the density exceeds the threshold, normals from its gradient for a wet sheen, freshness
 * for glossy red against dried red-brown. Water reads its channel in the water shader itself.
 */

const NOISE = /* glsl */ `
float bloodHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float bloodNoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(bloodHash(i), bloodHash(i + vec2(1.0, 0.0)), f.x),
    mix(bloodHash(i + vec2(0.0, 1.0)), bloodHash(i + vec2(1.0, 1.0)), f.x), f.y);
}`;

export const BLOOD_ACCUMULATION_VERTEX = `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform vec4 uRect;
uniform float uTime;
attribute vec4 inA;
attribute vec4 inB;
attribute vec4 inC;
attribute vec4 inD;
attribute vec4 inCorner;
varying vec2 vLocal;
varying vec4 vB;
varying vec4 vC;
varying vec4 vD;
varying float vKind;
varying vec2 vTint;
void main() {
  float kind = inA.w;
  float r0 = inB.x, r1 = max(inB.x, inB.y);
  vec2 lo, hi;
  if (kind < 0.5 || kind > 2.5) {
    float e = r1 * 2.4 + 2.0; lo = vec2(-e); hi = vec2(e);
  } else if (kind < 1.5) {
    float e = r0 * 2.4 + 1.0; lo = vec2(-e, -e); hi = vec2(r1 * 1.3 + e, e);
  } else {
    float e = r0 * 2.8 + 1.0; lo = vec2(-e, -e); hi = vec2(r1 + e, e);
  }
  vec2 local = mix(lo, hi, inCorner.xy * 0.5 + 0.5);
  float c = cos(inA.z), s = sin(inA.z);
  vec2 world = inA.xy + vec2(local.x * c - local.y * s, local.x * s + local.y * c);
  vec2 uv = (world - uRect.xy) / uRect.zw;
  // Not landed yet or gone: collapse the quad so no fragment runs.
  bool hidden = uTime < inC.x || uTime > inC.w;
  gl_Position = hidden ? vec4(3.0, 3.0, 0.0, 1.0) : vec4(uv * 2.0 - 1.0, 0.0, 1.0);
  vLocal = local; vB = inB; vC = inC; vD = inD; vKind = kind; vTint = inCorner.zw;
}`;

export const BLOOD_ACCUMULATION_FRAGMENT = `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform float uTime;
uniform float uThreshold;
uniform float uPower;
uniform vec2 uDry;
uniform float uMode;
varying vec2 vLocal;
varying vec4 vB;
varying vec4 vC;
varying vec4 vD;
varying float vKind;
varying vec2 vTint;
${NOISE}
float falloff(float x) {
  return 1.0 / (1.0 + pow(max(x, 0.0), uPower)) * (1.0 - smoothstep(1.6, 2.0, x));
}
float lobes(float a, float seed) {
  return sin(a * 2.0 + seed * 6.283) * 0.42 + sin(a * 3.0 + seed * 17.1) * 0.3
    + sin(a * 5.0 + seed * 31.7) * 0.18 + sin(a * 8.0 + seed * 53.3) * 0.1;
}
void main() {
  float t = uTime, age = t - vC.x, seed = vB.w;
  // The last part of a life lowers the peak towards the threshold: the outline withdraws.
  float life = clamp((vC.w - t) / max(vD.z, 0.001), 0.0, 1.0);
  life = life * life * (3.0 - 2.0 * life);
  float amount = vD.y * mix(uThreshold * 0.9, 1.0, life);
  float d = 0.0;
  vec2 p = vLocal;
  if (vKind < 0.5) {
    // Pool: spreads from r0 to r1 (eased), lobed outline, a bulging front while it still flows.
    float k = clamp((t - vC.y) / max(vC.z, 0.001), 0.0, 1.0);
    float r = mix(vB.x, vB.y, 1.0 - pow(1.0 - k, 3.0));
    float a = atan(p.y, p.x);
    // Larger pools get bolder lobes: blood finds the low spots of the ground.
    float bold = mix(0.12, 0.22, smoothstep(8.0, 30.0, r));
    float edge = 1.0 + bold * lobes(a, seed) + 0.08 * (bloodNoise(p * 0.3 + seed * 41.0) - 0.5);
    float x = length(p) / max(r * edge, 0.5);
    d = falloff(x) * amount;
    d += 0.16 * amount * (1.0 - k) * exp(-pow((x - 0.93) / 0.11, 2.0));
  } else if (vKind < 1.5) {
    // Splat: round head at the origin, a tapering tail along +x (the flight), a bead at its end.
    float pop = clamp(age / max(vC.z, 0.001), 0.0, 1.0);
    float w = vB.x * mix(0.55, 1.0, pop), L = vB.y * mix(0.4, 1.0, pop);
    float x;
    if (vB.z > 0.5) {
      x = length(vec2(p.x / max(L * 0.75, 0.3), p.y / max(w, 0.3)));
    } else {
      float head = length(vec2(p.x / (w * 1.12), p.y / w));
      float span = max(L - w, 0.001);
      float tu = clamp(p.x / span, 0.0, 1.0);
      float tw = w * mix(0.8, 0.2, tu) * (1.0 + 0.3 * (bloodNoise(vec2(p.x * 0.45, seed * 31.0)) - 0.5));
      float tail = (p.x > 0.0 && p.x < span) ? abs(p.y) / max(tw, 0.25) : 99.0;
      float bead = length(vec2(p.x - span, p.y)) / max(w * 0.42, 0.3);
      x = min(head, min(tail, bead * 1.05));
      x *= 1.0 + 0.1 * (bloodNoise(p * 0.7 + seed * 23.0) - 0.5);
    }
    d = falloff(x) * amount;
  } else if (vKind < 2.5) {
    // Rivulet: a thin trail runs down the face along +x and hangs as a bead at its tip; pointed
    // where it left the splash.
    float run = clamp(age / max(vC.z, 0.001), 0.0, 1.0);
    float L = vB.y * (1.0 - (1.0 - run) * (1.0 - run));
    float along = clamp(p.x / max(vB.y, 0.001), 0.0, 1.0);
    float w = vB.x * mix(0.42, 0.75, along) * (1.0 + 0.18 * sin(p.x * 0.6 + seed * 19.0));
    float body = p.x < 0.0 ? length(vec2(p.x * 1.8, p.y)) / (vB.x * 0.42) : (p.x > L ? 99.0 : abs(p.y) / max(w, 0.3));
    float tip = length(vec2(p.x - L, p.y)) / (vB.x * 1.2);
    d = falloff(min(body, tip)) * amount;
  } else {
    // Cloud in water: quick bloom, then slow drift outwards; it thins as it grows.
    float grow = 1.0 - exp(-3.0 * max(age, 0.0) / max(vC.z, 0.001));
    float r = mix(vB.x, vB.y, grow);
    float a = atan(p.y, p.x);
    float edge = 1.0 + 0.24 * lobes(a + age * 0.06, seed) + 0.12 * (bloodNoise(p * 0.12 + seed * 13.0 + age * 0.2) - 0.5);
    float x = length(p) / max(r * edge, 0.5);
    float dilution = mix(0.45, 1.0, clamp(vB.x / r, 0.0, 1.0));
    d = exp(-x * x * 1.7) * (1.0 - smoothstep(1.6, 2.0, x)) * vD.y * dilution * life * clamp(age * 6.0, 0.0, 1.0);
  }
  if (d <= 0.002) discard;
  if (uMode > 0.5) {
    // Colour pass (MAX blend): where a coloured mark is present its hue wins; it never saturates.
    if (vTint.y < 0.5) discard;
    float rg = floor(vTint.x + 0.5), r = floor(rg / 256.0);
    vec3 tint = vec3(r, rg - r * 256.0, floor(vTint.y + 0.5) - 1.0) / 255.0;
    float weight = smoothstep(0.02, 0.2, d);
    gl_FragColor = vec4(tint * weight, weight);
    return;
  }
  float fresh = 1.0 - smoothstep(uDry.x, uDry.y, t - vD.w);
  vec4 o = vec4(0.0);
  if (vD.x < 0.5) o.r = d; else if (vD.x < 1.5) o.g = d; else o.b = d;
  o.a = vD.x < 1.5 ? d * fresh : 0.0;
  gl_FragColor = o;
}`;

/**
 * Own blood colours: the colour pass holds the presence of coloured marks per texel (colour × presence,
 * presence). The authored colour stands for fresh thin blood (the red film's lightness, 0.21); the
 * palette's darker and lighter tones scale it, so deep pools and dried stains darken it alike.
 */
export const BLOOD_RECOLOR_GLSL = /* glsl */ `
vec3 bloodRecolor(vec3 c, vec4 tint) {
  float share = clamp(tint.a, 0.0, 1.0);
  if (share <= 0.001) return c;
  vec3 hue = tint.rgb / max(tint.a, 0.001);
  return mix(c, min(hue * (dot(c, vec3(0.299, 0.587, 0.114)) / 0.21), vec3(1.0)), share);
}`;

/** Receiver passes: 0 ground, 1 bridge deck, 2 rock. */
export const BloodReceiverPass = { Ground: 0, Deck: 1, Rock: 2 } as const;
export type BloodReceiverPass = typeof BloodReceiverPass[keyof typeof BloodReceiverPass];
export const BLOOD_MAX_DECKS = 6;

/** Receiver layers: the soaked stain (MULTIPLY, the ground shows through) and the wet film on top (NORMAL). */
export const BloodReceiverLayer = { Stain: 0, Film: 1 } as const;

function receiverFragment(rock: boolean): string {
  return `
#pragma phaserTemplate(shaderName)
precision highp float;
varying vec2 outTexCoord;
uniform sampler2D uField;
uniform vec4 uQuad;
uniform vec4 uFieldRect;
uniform vec2 uFieldTexel;
uniform float uThreshold;
uniform vec4 uSun;
uniform float uNight;
uniform float uDetail;
uniform float uPass;
uniform float uLayer;
uniform vec4 uDecks[${BLOOD_MAX_DECKS}];
uniform float uDeckCount;
uniform float uLampOn;
uniform float uPixelsPerWorld;
uniform sampler2D uTint;
uniform float uTintOn;
${SURFACE_LIGHT_GLSL}
${rock ? ROCK_COVERAGE_GLSL : ''}
${NOISE}
${BLOOD_RECOLOR_GLSL}
float channel(vec4 f) { return uPass > 1.5 ? f.g : f.r; }
void main() {
  vec2 world = uQuad.xy + vec2(outTexCoord.x, 1.0 - outTexCoord.y) * uQuad.zw;
  vec2 uv = (world - uFieldRect.xy) / uFieldRect.zw;
  vec4 f = texture2D(uField, uv);
  float d = channel(f);
  float low = uThreshold * 0.5;
  if (d < low) discard;
  float mask = 1.0;
  ${rock ? 'mask = smoothstep(0.42, 0.6, rockCoverage(world));' : `
  if (uPass > 0.5) {
    mask = 0.0;
    for (int i = 0; i < ${BLOOD_MAX_DECKS}; i++) {
      if (float(i) >= uDeckCount) break;
      vec4 r = uDecks[i];
      if (world.x >= r.x && world.y >= r.y && world.x <= r.x + r.z && world.y <= r.y + r.w) mask = 1.0;
    }
  }`}
  if (mask <= 0.001) discard;
  // Density slope per world px: outline anti-aliasing and the film's normal.
  vec2 tx = vec2(uFieldTexel.x, 0.0), ty = vec2(0.0, uFieldTexel.y);
  vec2 texelPx = uFieldRect.zw * uFieldTexel;
  vec2 slope = vec2(channel(texture2D(uField, uv + tx)) - channel(texture2D(uField, uv - tx)),
    channel(texture2D(uField, uv + ty)) - channel(texture2D(uField, uv - ty))) / (2.0 * texelPx);
  // Blood soaks unevenly into soil and grass: a ragged, grainy outline instead of a smooth wax edge.
  float grain = bloodNoise(world * 0.42) * 0.6 + bloodNoise(world * 0.95 + 3.7) * 0.4 - 0.5;
  float edgeZone = 1.0 - smoothstep(uThreshold + 0.05, uThreshold + 0.28, d);
  float soaked = d + grain * 0.16 * edgeZone * (0.5 + 0.5 * uDetail);
  float aa = clamp(length(slope) * 0.75 / max(uPixelsPerWorld, 0.25), 0.006, 0.09);
  // The edge fades into the soil over a fixed density span: wide pools (gentle slope) soften over a few
  // pixels, small drops (steep slope) stay crisp. Much firmer than blood in water.
  float feather = 0.13 * (0.6 + 0.4 * uDetail);
  float cover = smoothstep(uThreshold - max(feather, aa), uThreshold + max(0.035, aa), soaked) * mask;
  float thick = clamp((d - uThreshold) / (1.0 - uThreshold), 0.0, 1.0);
  // Thin blood is flat and evenly coloured; only wide pools darken towards their middle. A single drop's
  // centre is as dense as a pool's, so depth also asks whether the blood still lies a few pixels away:
  // a bright rim around a dark centre would read as a glossy bead, i.e. plastic.
  // Mean density on a 10 px ring: rises smoothly from a pool's edge inwards, stays low on drops.
  vec2 ring = 10.0 / uFieldRect.zw;
  float wide = (channel(texture2D(uField, uv + ring * vec2(1.0, 0.0))) + channel(texture2D(uField, uv + ring * vec2(-1.0, 0.0)))
    + channel(texture2D(uField, uv + ring * vec2(0.5, 0.866))) + channel(texture2D(uField, uv + ring * vec2(-0.5, 0.866)))
    + channel(texture2D(uField, uv + ring * vec2(0.5, -0.866))) + channel(texture2D(uField, uv + ring * vec2(-0.5, -0.866)))) / 6.0;
  float depth = smoothstep(0.35, 1.0, thick) * smoothstep(uThreshold + 0.05, 1.0, wide);
  float fresh = clamp(f.a / max(f.r + f.g, 0.02), 0.0, 1.0);
  // Broad, world-anchored unevenness: clotting and soaking vary across a pool.
  float mottle = bloodNoise(world * 0.05) * 0.55 + bloodNoise(world * 0.12 + 7.1) * 0.45;
  vec4 tint = uTintOn > 0.5 ? texture2D(uTint, uv) : vec4(0.0);

  if (uLayer < 0.5) {
    // Stain (MULTIPLY): the ground keeps its texture, darkened and dyed red; deep blood nearly black-red.
    vec3 thin = mix(vec3(0.66, 0.18, 0.13), vec3(0.86, 0.22, 0.17), fresh);
    vec3 deep = mix(vec3(0.22, 0.05, 0.04), vec3(0.34, 0.035, 0.04), fresh);
    vec3 dye = mix(thin, deep, depth) * (0.9 + 0.2 * mottle);
    ${rock ? 'dye *= 0.92;' : ''}
    // Drying draws a darker ring where the edge clots first.
    float ring = smoothstep(0.0, 0.06, thick) * (1.0 - smoothstep(0.06, 0.25, thick));
    dye *= 1.0 - ring * (1.0 - fresh) * 0.35;
    float alpha = cover * mix(0.88, 1.0, depth);
    dye = bloodRecolor(dye, tint);
    // Around it, blood seeps into the soil: a soft, uneven red-brown darkening (ground and decks only).
    // Only wide pools seep (gentle edge slope); drops would gain a drawn-looking outline.
    float seep = ${rock ? '0.0' : 'smoothstep(low, uThreshold - 0.03, soaked) * (1.0 - cover) * mask * 0.5 * (1.0 - smoothstep(0.03, 0.1, length(slope)))'};
    vec3 soil = bloodRecolor(vec3(0.74, 0.5, 0.46), tint);
    // MULTIPLY with full alpha writes the factor itself: ground × seep × stain, per channel.
    gl_FragColor = vec4(mix(vec3(1.0), soil, seep) * mix(vec3(1.0), dye, alpha), 1.0);
    return;
  }

  // Film (NORMAL): fresh blood stands as a thin, dark, translucent layer on deep spots, so the colour
  // still reads on dark soil; its surface is uneven, catching small sharp highlights, never a sheen.
  // The film thins out towards the edge, so the outline is mostly soaked stain, not a hard skin.
  float film = cover * (0.52 + 0.3 * depth) * mix(0.6, 1.0, fresh) * (0.88 + 0.24 * mottle);
  vec3 body = mix(vec3(0.66, 0.036, 0.05), vec3(0.28, 0.008, 0.02), depth) * (0.85 + 0.3 * mottle);
  body = bloodRecolor(body, tint);
  vec2 bumps = (vec2(bloodNoise(world * 0.21), bloodNoise(world * 0.21 + 11.3)) - 0.5) * 0.9
    + (vec2(bloodNoise(world * 0.47 + 5.0), bloodNoise(world * 0.47 + 19.0)) - 0.5) * 0.45;
  vec3 n = normalize(vec3(-slope * 3.0 + bumps * 0.35 * depth * uDetail, 1.0));
  vec3 halfVector = normalize(normalize(uSun.xyz) + vec3(0.0, 0.0, 1.0));
  // Glints only on the broad, flat surface of real pools: drops and edges (steep density) stay matte.
  float wet = fresh * cover * smoothstep(0.3, 0.7, thick) * (1.0 - smoothstep(0.015, 0.06, length(slope)));
  float glints = pow(max(dot(n, halfVector), 0.0), 90.0) * wet * uSun.w;
  vec3 light = vec3(1.0, 0.9, 0.84) * glints * 0.9;
  // Night: small glints on the slopes facing a lamp; the light map keeps everything else dark.
  if (uLampOn > 0.5) {
    float glint = 0.0;
    float tilted = length(n.xy);
    for (int i = 0; i < 4; i++) {
      if (float(i) >= uSurfaceLightCount) break;
      vec4 lp = uSurfaceLightPos[i];
      float amount = surfaceLampAmount(lp, uSurfaceLightCone[i], uSurfaceLightProfile[i], world);
      if (amount <= 0.0) continue;
      float dominance = amount / (amount + uSurfaceAmbient + 0.0001);
      float towards = tilted > 0.001 ? dot(n.xy / tilted, normalize(lp.xy - world + vec2(0.0001))) : 0.0;
      glint = max(glint, dominance * smoothstep(0.55, 0.95, towards) * smoothstep(0.08, 0.35, tilted));
    }
    light += vec3(1.0, 0.9, 0.8) * glint * wet * uNight * 1.4;
  }
  if (film <= 0.002 && dot(light, light) <= 0.00001) discard;
  gl_FragColor = vec4(body * film + light, film);
}`;
}

export const BLOOD_GROUND_FRAGMENT = receiverFragment(false);
export const BLOOD_ROCK_FRAGMENT = receiverFragment(true);
