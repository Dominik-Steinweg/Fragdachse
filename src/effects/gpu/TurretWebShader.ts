/**
 * Kabummtula web passes. Segment instance layout like the shield charger layer: a→b with half
 * width w; local u along a→b and v across, in pixels. Instance: seg (a, b), shape [w, kind, t,
 * seed], aux [a1, a2, a3, a4].
 *
 * Visual language: real orb-weaver silk, not a decal. Jittered radial spokes, a sagging capture
 * spiral that steps one ring per turn, a dense hub, sticky beads, anisotropic silk sheen and a dark
 * violet drop shadow. The web unfolds out of the impact splat, breathes faintly while it holds and
 * tears into drooping threads before it expires. Pale lilac silk, void-violet glue; never red/yellow.
 *
 * kind 0 web over a turret   a = b = centre; t = seconds since it landed; a1 = web radius px;
 *                            a2 = seconds left; a3 = spin (rad)
 * kind 1 glob in flight      a = fangs, b = glob; t = seconds since launch; a1 = glob radius px;
 *                            a2 = strand sag px
 *
 * Pass 0 (DEPTH.PLAYERS - 0.3, lit material): the web. Pass 1 (DEPTH.PROJECTILES - 0.65, lit
 * material): strand and glob. Pass 2 (19.7, emissive): void glints of beads, hub and glob core.
 */
export const TURRET_WEB_KIND = { web: 0, glob: 1 } as const;
/** The web unfolds within this time after the impact (also the splat). */
export const TURRET_WEB_UNFOLD_S = 0.22;
/** Threads tear and droop during this last part of the web's life. */
export const TURRET_WEB_TEAR_S = 0.45;

const SHARED = /* glsl */ `
bool drawn(float pass, float kind) {
  if (pass < 0.5) return kind < 0.5;
  if (pass < 1.5) return abs(kind - 1.0) < 0.5;
  return true;
}`;

export const TURRET_WEB_VERTEX = `
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

export const TURRET_WEB_FRAGMENT = `
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
/** Anti-aliased thread of half width hw in screen pixels at world distance d: crisp at every zoom. */
float thread(float d, float hw) {
  float px = 1.0 / max(uZoom, 0.1);
  return 1.0 - smoothstep(hw * px, (hw + 0.9) * px, d);
}
float gauss(float x, float s) { return exp(-x * x / (s * s)); }

float spokeCount() { return uDetail > 0.5 ? 13.0 : 9.0; }
float spokeAngle(float k, float seed, float n) {
  float i = mod(k, n);
  return (k + 0.34 * (hash(vec2(i, seed)) - 0.5)) * TAU / n;
}

/**
 * Silk coverage of the orb web at p (pixels around the hub), radius R. Returns coverage in x,
 * bead strength in y and a thread-direction sheen in z; w is the hub density.
 */
vec4 web(vec2 p, float R, float seed, float sag, float tear) {
  float r = length(p);
  float n = spokeCount();
  float a = mod(atan(p.y, p.x), TAU);
  float sector = TAU / n;
  float i0 = floor(a / sector);
  // Jittered spokes: the containing sector is bounded by the nearest spoke below and above.
  float thPrev = spokeAngle(i0 - 1.0, seed, n), th0 = spokeAngle(i0, seed, n), th1 = spokeAngle(i0 + 1.0, seed, n);
  float lo = a >= th0 ? th0 : thPrev, hi = a >= th0 ? th1 : th0;
  float kLo = a >= th0 ? i0 : i0 - 1.0;
  float f = clamp((a - lo) / max(hi - lo, 1e-3), 0.0, 1.0);
  vec2 light = normalize(vec2(-0.55, -0.83));
  float cover = 0.0, bead = 0.0, sheen = 0.0;

  // Radial spokes (the two that bound this sector), each with its own reach; a rare frayed anchor.
  float reachLo = R * (0.84 + 0.16 * hash(vec2(mod(kLo, n), seed + 3.0)));
  float reachHi = R * (0.84 + 0.16 * hash(vec2(mod(kLo + 1.0, n), seed + 3.0)));
  for (int s = 0; s < 2; s++) {
    float k = s == 0 ? kLo : kLo + 1.0;
    float th = s == 0 ? lo : hi;
    float reach = s == 0 ? reachLo : reachHi;
    float anchor = hash(vec2(mod(k, n), seed + 9.0)) > 0.86 ? R * 1.12 : reach;
    float along = r * cos(a - th);
    // Spokes bow slightly; silk is never a ruler line.
    float bow = sin(along / max(R, 1.0) * PI) * R * 0.03 * (hash(vec2(mod(k, n), seed + 4.0)) - 0.5);
    float d = abs(r * sin(a - th) - bow);
    float outside = smoothstep(reach - 1.0, anchor, along);
    float span = smoothstep(-1.0, 1.5, along) * (1.0 - smoothstep(anchor - 3.0, anchor, along)) * (1.0 - 0.75 * outside);
    float thin = along > reach ? 0.3 : 0.5;
    float broken = step(tear, hash(vec2(mod(k, n) * 7.1, seed + 11.0)) * 0.999 + 0.0005);
    float c = thread(d, thin) * span * broken;
    vec2 dir = vec2(cos(th), sin(th));
    sheen = max(sheen, c * pow(abs(dot(dir, light)), 6.0));
    cover = max(cover, c);
  }

  // Frame thread: a sagging chord between neighbouring spoke ends closes the outline like a real orb web.
  vec2 pLo = reachLo * vec2(cos(lo), sin(lo)), pHi = reachHi * vec2(cos(hi), sin(hi));
  vec2 chord = pHi - pLo;
  float h = clamp(dot(p - pLo, chord) / max(dot(chord, chord), 1e-3), 0.0, 1.0);
  vec2 inward = -normalize(pLo + pHi + 1e-3);
  vec2 onFrame = pLo + chord * h + inward * sin(PI * h) * R * (0.035 + sag);
  float frameC = thread(length(p - onFrame), 0.48) * step(tear * 0.8, hash(vec2(mod(kLo, n) * 3.7, seed + 17.0)) * 0.999 + 0.0005);
  vec2 frameDir = normalize(chord + 1e-3);
  sheen = max(sheen, frameC * pow(abs(dot(frameDir, light)), 6.0));
  cover = max(cover, frameC);

  // Capture spiral: one ring per turn, each segment sagging towards the hub between its spokes.
  float drop = 1.0 - (0.085 + sag) * sin(PI * f);
  float rr = r / drop;
  float inner = R * 0.2, outer = R * (0.74 + 0.08 * hash(vec2(mod(kLo, n), seed + 5.0)));
  float rings = uDetail > 0.5 ? 7.0 : 5.0;
  float spacing = (R * 0.8 - inner) / rings;
  float q = (rr - inner) / spacing - a / TAU;
  float ring = floor(q + 0.5);
  float ringD = abs(q - ring) * spacing * drop;
  float inSpiral = smoothstep(inner - 1.0, inner + 1.5, rr) * (1.0 - smoothstep(outer - 1.0, outer + 1.0, rr));
  float cell = ring * 31.0 + mod(kLo, n);
  float gap = step(0.12, hash(vec2(cell, seed + 1.0)));
  float torn = step(tear, hash(vec2(cell, seed + 21.0)) * 0.999 + 0.0005);
  float ringC = thread(ringD, 0.38) * inSpiral * gap * torn * (0.8 + 0.2 * hash(vec2(cell, seed + 8.0)));
  vec2 tangent = vec2(-sin(a), cos(a));
  sheen = max(sheen, ringC * pow(abs(dot(tangent, light)), 6.0));
  cover = max(cover, ringC);

  // Sticky beads strung along the spiral: three slots per ring segment, some empty.
  float slot = floor(f * 3.0);
  float fb = (slot + 0.5 + 0.5 * (hash(vec2(cell, slot + seed)) - 0.5)) / 3.0;
  float arc = (f - fb) * (hi - lo) * rr;
  float beadR = 0.7 + 0.8 * hash(vec2(cell + 3.0, slot));
  float present = step(0.48, hash(vec2(cell + slot * 5.0, seed + 2.0))) * inSpiral * gap * torn;
  bead = gauss(length(vec2(arc, ringD)), beadR) * present;

  // Hub: a dense, irregular knot of silk where the spokes meet.
  float hubR = R * 0.17;
  float hub = (1.0 - smoothstep(hubR * 0.6, hubR, r)) * (0.35 + 0.65 * noise(p * 0.55 + seed));
  float hubRings = thread(abs(fract(r / 2.6 + noise(p * 0.3 + seed) * 0.6) - 0.5) * 2.6, 0.32) * (1.0 - smoothstep(hubR - 1.0, hubR + 1.0, r));
  cover = max(cover, max(hubRings * 0.7, hub * 0.4));
  return vec4(cover, bead, sheen, hub);
}

void main() {
  float w = vShape.x, kind = vShape.y, t = vShape.z, seed = vShape.w;
  float u = vUV.x, v = vUV.y;
  vec3 rgb = vec3(0.0);
  float alpha = 0.0;
  vec3 silk = vec3(0.80, 0.76, 0.92), sheenC = vec3(1.0, 0.97, 1.0), glue = vec3(0.70, 0.28, 1.0);
  vec3 shadowC = vec3(0.07, 0.03, 0.11);

  if (kind < 0.5) {
    float R = vAux.x, left = vAux.y, spin = vAux.z;
    // Unfold out of the splat with a slight overshoot; tear and droop at the end of its life.
    float g = clamp(t / ${TURRET_WEB_UNFOLD_S.toFixed(2)}, 0.0, 1.0);
    float e = g - 1.0;
    float scale = 1.0 + 2.2 * e * e * e + 1.2 * e * e;
    scale = mix(0.3, 1.0, clamp(scale, 0.0, 1.15));
    float tear = 1.0 - clamp(left / ${TURRET_WEB_TEAR_S.toFixed(2)}, 0.0, 1.0);
    float sag = tear * 0.14;
    // A faint breath of wind; it never moves the hub.
    float sway = 0.02 * sin(uTime * 2.3 + seed * 6.0) * smoothstep(0.0, R, length(vUV));
    float c = cos(spin + sway), s = sin(spin + sway);
    vec2 p = mat2(c, -s, s, c) * vUV / max(scale, 0.05);
    vec4 silkW = web(p, R, seed, sag, tear * 1.05);
    vec4 shadowW = web(p - vec2(1.4, 2.2) / max(scale, 0.05), R, seed, sag, tear * 1.05);
    float reveal = R * 1.3 * smoothstep(0.0, ${TURRET_WEB_UNFOLD_S.toFixed(2)}, t);
    float shown = 1.0 - smoothstep(reveal - 5.0, reveal, length(p));
    float fade = smoothstep(0.0, 0.05, t) * smoothstep(0.0, ${TURRET_WEB_TEAR_S.toFixed(2)} * 0.4, left);
    float splatAge = t / 0.3;
    float splatR = R * (0.25 + 1.1 * splatAge);
    float splat = splatAge < 1.0 ? gauss(length(vUV) - splatR, 1.6) * (1.0 - splatAge)
      * (0.45 + 0.55 * noise(vec2(atan(vUV.y, vUV.x) * 4.0, seed))) : 0.0;
    float cover = silkW.x * shown, beads = silkW.y * shown;
    if (uPass < 0.5) {
      float shade = clamp(shadowW.x * shown * 0.34 + shadowW.y * shown * 0.25, 0.0, 0.4);
      vec3 silkCol = mix(silk, sheenC, clamp(silkW.z * 1.4, 0.0, 1.0));
      silkCol = mix(silkCol, glue, 0.10 + 0.25 * silkW.w);
      // Translucent silk: the turret stays visible underneath, the sheen carries the threads.
      float silkA = clamp(cover * (0.55 + 0.35 * silkW.z) + beads * 0.8 + splat * 0.6, 0.0, 1.0);
      vec3 beadCol = mix(vec3(0.95, 0.92, 1.0), glue, 0.18);
      vec3 col = mix(silkCol, beadCol, clamp(beads, 0.0, 1.0));
      alpha = silkA + shade * (1.0 - silkA);
      rgb = col * silkA + shadowC * shade * (1.0 - silkA);
      rgb *= fade; alpha *= fade;
    } else {
      // Glue glints and a quiet void shimmer over the disabled turret; readable at night.
      float r = length(vUV);
      float halo = gauss(r, R * 0.9) * (0.045 + 0.02 * sin(uTime * 3.1 + seed * 5.0));
      vec3 glow = glue * (beads * 0.28 + silkW.w * 0.12 + halo) + vec3(0.9, 0.75, 1.0) * splat * 0.3;
      rgb = glow * fade * uEmissive; alpha = 0.0;
    }
  } else {
    // Glob in flight on its silk strand: the strand sags between the fangs and the glob.
    float gR = vAux.x, sagPx = vAux.y;
    float x = clamp(u / max(vLen, 1.0), 0.0, 1.0);
    float centre = sagPx * sin(PI * x);
    float strandC = thread(abs(v - centre), 0.55) * smoothstep(-0.5, 2.0, u) * (1.0 - smoothstep(vLen - gR * 0.8, vLen - gR * 0.3, u));
    vec2 q = vec2(u - vLen, v);
    float ang = atan(q.y, q.x);
    float wob = gR * (1.0 + 0.13 * sin(3.0 * ang + t * 31.0 + seed * 9.0) + 0.08 * sin(5.0 * ang - t * 23.0));
    float d = length(q);
    float body = 1.0 - smoothstep(wob - 0.9, wob + 0.7, d);
    vec2 spec = q - vec2(-0.32, -0.38) * gR;
    float hi = gauss(length(spec), gR * 0.32);
    float rim = smoothstep(wob * 0.45, wob, d) * body;
    if (uPass < 1.5) {
      vec3 globCol = mix(glue * 0.62, silk, 0.55 + 0.35 * rim);
      globCol = mix(globCol, sheenC, hi * 0.8);
      float shade = (1.0 - smoothstep(wob - 0.5, wob + 1.6, length(q - vec2(1.2, 1.8)))) * 0.45;
      float strandA = strandC * 0.85;
      float globA = body * 0.95;
      float a = max(globA, strandA);
      vec3 col = globA >= strandA ? globCol : mix(silk, sheenC, 0.3);
      alpha = a + shade * (1.0 - a);
      rgb = col * a + shadowC * shade * (1.0 - a);
    } else {
      float core = gauss(d, gR * 1.5) * 0.55 + body * 0.25;
      rgb = glue * core * uEmissive; alpha = 0.0;
    }
  }
  rgb *= uAlpha; alpha = clamp(alpha * uAlpha, 0.0, 1.0);
  gl_FragColor = vec4(rgb, alpha);
}`;
