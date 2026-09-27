import { FISSURE_SPACING_HINT, FISSURE_TIMING } from './EarthbreakFissureStore';

/**
 * Procedural Earthbreak ground: one quad per trace segment plus one emergence crater, all
 * evaluated from the same instance buffer in two passes.
 *
 * Pass 0 (ground, NORMAL, below actors) draws the physical ground: a jagged fissure that grows
 * behind the digging badger and sprouts hairline cracks, a glowing ignition front that races
 * back along the trace after emergence, and the collapse itself – ground plates breaking into
 * a sunken rubble trench with a crumbled lip, glowing seams and a lateral dust shock.
 * Pass 1 (emissive, ADD, above the lightmap) repeats only the glow terms so the warning and the
 * collapse stay readable at night.
 *
 * Every pattern is sampled in world space, so neighbouring segments share one continuous crack
 * network. Adjacent segments partition the plane along their joint bisectors (`vJoin`) and
 * never draw a pixel twice. Output is premultiplied.
 *
 * Attributes per vertex: world position, segment-local px (x along travel, y left), shape
 * (length or crater radius, arc start, world axis), joint normals, timing (born, successor
 * born, collapse at a/b), misc (cancelled at, detonated at, seed, kind), earth colour.
 */

const f = (value: number): string => value.toFixed(1);

const COMMON = `
const float NONE_LIMIT = -1.0e6;
const float GROW_MS = ${f(FISSURE_TIMING.growMs)};
const float HOLD_MS = ${f(FISSURE_TIMING.holdMs)};
const float FADE_MS = ${f(FISSURE_TIMING.fadeMs)};
const float CANCEL_MS = ${f(FISSURE_TIMING.cancelMs)};
const float IGNITION_LEAD = ${FISSURE_TIMING.ignitionLead.toFixed(3)};
`;

export const EARTHBREAK_FISSURE_VERTEX_SHADER = `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform mat4 uProjectionMatrix;
uniform mat3 uViewMatrix;
uniform float uTime;
attribute vec2 inPosition;
attribute vec2 inLocal;
attribute vec4 inShape;
attribute vec4 inJoin;
attribute vec4 inTime;
attribute vec4 inMisc;
attribute vec4 inColor;
varying vec2 vWorld;
varying vec2 vLocal;
varying vec4 vShape;
varying vec4 vJoin;
varying vec4 vTime;
varying vec4 vMisc;
varying vec4 vColor;
${COMMON}
void main() {
  float collapseEnd = max(inTime.z, inTime.w);
  bool cancelled = inMisc.x > NONE_LIMIT && uTime > inMisc.x + CANCEL_MS;
  bool settled = collapseEnd > NONE_LIMIT && uTime > collapseEnd + HOLD_MS + FADE_MS;
  // Cull whole quads before birth and after their last visible frame.
  if (uTime < inTime.x || cancelled || settled) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
  } else {
    vec3 view = uViewMatrix * vec3(inPosition, 1.0);
    gl_Position = uProjectionMatrix * vec4(view.xy, 0.0, 1.0);
  }
  vWorld = inPosition; vLocal = inLocal; vShape = inShape; vJoin = inJoin;
  vTime = inTime; vMisc = inMisc; vColor = inColor;
}`;

export const EARTHBREAK_FISSURE_FRAGMENT_SHADER = `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform float uTime;
uniform float uPass;
uniform float uPixel;
uniform float uAlpha;
uniform float uDetail;
varying vec2 vWorld;
varying vec2 vLocal;
varying vec4 vShape;
varying vec4 vJoin;
varying vec4 vTime;
varying vec4 vMisc;
varying vec4 vColor;
${COMMON}
const float TAU = 6.28318530718;
// Top-down key light from the north-west (screen y points south).
const vec2 TO_LIGHT = vec2(-0.5547, -0.8321);
const vec3 EMBER = vec3(1.0, 0.42, 0.08);
const vec3 GLOW = vec3(1.0, 0.62, 0.2);
const vec3 HOT = vec3(1.0, 0.93, 0.72);

float hash21(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
vec2 hash22(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.xx + q.yz) * q.zy);
}
float noise(vec2 p) {
  vec2 i = floor(p), g = fract(p);
  g = g * g * (3.0 - 2.0 * g);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), g.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + 1.0), g.x), g.y);
}
float sq(float x) { return x * x; }
float easeOut(float x) { x = clamp(x, 0.0, 1.0); return 1.0 - (1.0 - x) * (1.0 - x) * (1.0 - x); }
float band(float d, float halfWidth) {
  return 1.0 - smoothstep(halfWidth - uPixel, halfWidth + uPixel, d);
}
// Premultiplied "over".
void over(inout vec4 acc, vec3 color, float alpha) {
  acc = vec4(color * alpha, alpha) + acc * (1.0 - alpha);
}

// Cellular pattern. x = distance to the nearest cell border (cell units), y = cell id,
// z = id of the border shared with the nearest neighbour (same from both sides), w = distance
// to the cell site.
vec4 cells(vec2 p) {
  vec2 n = floor(p), g = fract(p);
  vec2 mg = vec2(0.0), mr = vec2(0.0);
  float md = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 c = vec2(float(i), float(j));
    vec2 r = c + hash22(n + c) * 0.8 + 0.1 - g;
    float d = dot(r, r);
    if (d < md) { md = d; mr = r; mg = c; }
  }
  float border = 8.0;
  vec2 pair = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 c = mg + vec2(float(i), float(j));
    vec2 r = c + hash22(n + c) * 0.8 + 0.1 - g;
    vec2 dr = r - mr;
    if (dot(dr, dr) > 1.0e-5) {
      float b = dot(0.5 * (mr + r), normalize(dr));
      if (b < border) { border = b; pair = c; }
    }
  }
  return vec4(border, hash21(n + mg + 7.31), hash21(2.0 * n + mg + pair + 3.7), sqrt(md));
}

struct Site {
  float cd;        // distance to the jagged crack centre line (px)
  float dist;      // distance to the straight path or crater centre (px)
  vec2 normal;     // world direction from the path to the pixel
  float u;         // arc length at the nearest path point
  float front;     // arc length the crack has grown to
  float born;      // time the crack front passed this point
  float collapse;  // local collapse time on the axis, or NONE
  float ignite;    // local ignition time, or NONE
};

// Crack network around the fissure: a warped cellular pattern with roughly half of its
// borders dropped, denser and thicker next to the opening.
float hairlines(vec2 w, float d, float reach, float seed, float boost) {
  float mask = 1.0 - smoothstep(reach * 0.4, reach, d + (noise(w * 0.09 + seed * 5.0) - 0.5) * 10.0);
  if (mask <= 0.0) return 0.0;
  vec2 warp = vec2(noise(w * 0.16 + seed), noise(w * 0.16 + seed + 7.7)) - 0.5;
  vec4 net = cells(w / 12.0 + warp * 0.28 + seed * 17.0);
  float nearness = clamp(d / max(reach, 1.0), 0.0, 1.0);
  float keep = step(net.z, mix(0.66, 0.22, nearness));
  float thickness = mix(0.85, 0.25, nearness) * boost;
  return band(net.x * 12.0, thickness) * mask * keep;
}

vec4 shade(Site s, bool crater, out vec3 glowOut) {
  float t = uTime;
  vec3 earth = vColor.rgb;
  vec3 deep = earth * 0.14;
  float seed = vMisc.z;
  vec2 w = vWorld;
  vec4 acc = vec4(0.0);
  vec3 glow = vec3(0.0);
  float lightSide = dot(s.normal, TO_LIGHT);
  float age = t - s.born;
  float radius = vShape.x;

  bool detonated = s.collapse > NONE_LIMIT;
  // The collapse spreads sideways from the axis: its front trails behind as a soft V.
  float lateral = crater ? s.dist * 0.9 : s.dist * 1.4;
  float axisSince = detonated ? t - s.collapse : -1.0e6;
  float since = axisSince - lateral;
  float ignition = detonated ? smoothstep(s.ignite, s.collapse, t) : 0.0;
  float collapsed = detonated ? step(0.0, since) : 0.0;
  // Once the collapse has played, the ground settles into a faint, lighter scar.
  float rest = detonated ? smoothstep(250.0, 900.0, axisSince) : 0.0;
  float cancel = vMisc.x > NONE_LIMIT ? 1.0 - smoothstep(0.0, CANCEL_MS, t - vMisc.x) : 1.0;
  // Heat builds up with the ignition and dies away quickly once the ground has come down.
  float heat = ignition * (collapsed > 0.5 ? exp(-since / 300.0) : 1.0);
  // The rubble covers the old opening; the crack itself must not show through the settled scar.
  float intact = 1.0 - collapsed * smoothstep(0.0, 140.0, since);

  // Tremble before the collapse: the ground jitters in place, strongest near the fissure.
  vec2 jitter = (hash22(floor(w * 0.35) + floor(t * 0.06)) - 0.5) * 1.2 * ignition * (1.0 - collapsed);
  float cd = s.cd + dot(jitter, s.normal);

  // Lateral dust shock (below everything else).
  if (axisSince > 0.0) {
    float prog = clamp(axisSince / 380.0, 0.0, 1.0);
    float reach = crater ? radius : 42.0;
    float front = reach * easeOut(prog);
    float appear = smoothstep(0.0, 45.0, axisSince);
    float wave = exp(-sq((s.dist - front) / (3.0 + 8.0 * prog))) * appear;
    float dust = noise(w * 0.11 + seed * 13.0 + axisSince * 0.003);
    over(acc, mix(earth, vec3(0.86, 0.79, 0.64), 0.6), wave * (0.42 * (1.0 - prog) + 0.08) * (0.55 + 0.45 * dust));
    float wake = smoothstep(front, front - 18.0, s.dist) * (1.0 - prog) * appear;
    over(acc, deep, wake * 0.1);
  }

  // Growing fissure.
  float taper = crater ? 0.0 : smoothstep(0.0, 14.0, s.u) * smoothstep(0.0, 9.0, s.front - s.u);
  float widen = 1.0 + 0.7 * ignition;
  float halfWidth = (2.4 + 2.0 * noise(w * 0.06 + seed) + 1.0 * smoothstep(0.0, 2500.0, age)) * taper * widen;
  if (!crater && halfWidth > 0.05) {
    // Raised shoulder: pushed-up ground either side of the opening.
    float shoulder = exp(-sq((cd - halfWidth - 2.6) / 2.6)) * taper;
    over(acc, lightSide > 0.0 ? mix(earth, vec3(1.0), 0.3) : earth * 0.5, shoulder * 0.3 * intact);
    // Shadow falls into the opening from the wall nearer to the light.
    float shadow = lightSide > 0.0 ? 1.0 - smoothstep(halfWidth, halfWidth + 3.0, cd) : 0.0;
    over(acc, deep, shadow * 0.4 * intact);
    float core = band(cd, halfWidth);
    over(acc, mix(deep, earth * 0.32, smoothstep(0.0, halfWidth, cd)), core * 0.95 * intact);
    // The sunlit far wall catches a thin highlight just inside the edge.
    float rim = lightSide < 0.0 ? core * smoothstep(halfWidth * 0.4, halfWidth, cd) : 0.0;
    over(acc, mix(earth, vec3(1.0), 0.35), rim * 0.5 * intact);
    float depth = 1.0 - smoothstep(0.0, halfWidth * 0.75 + uPixel, cd);
    float pulse = 0.7 + 0.3 * sin(t * 0.005 + s.u * 0.09 + seed * 6.0);
    float tip = exp(-sq((s.front - s.u) / 8.0)) * (1.0 - smoothstep(0.0, 260.0, age));
    glow += EMBER * depth * (0.05 * pulse + 0.55 * heat) * taper;
    // Under the night lightmap a dark crack vanishes: the emissive copy keeps a faint ember.
    if (uPass > 0.5) glow += EMBER * depth * 0.14 * pulse * taper * (1.0 - collapsed);
    glow += GLOW * depth * tip * 0.5;
  }

  if (uDetail > 0.5) {
    float reach = crater
      ? radius * (0.3 + 0.55 * easeOut(axisSince / 240.0))
      : (10.0 + 18.0 * easeOut(age / 450.0) + 8.0 * smoothstep(0.0, 3000.0, age)) * taper;
    float line = hairlines(w, crater ? s.dist : cd, reach, seed, 1.0 + 0.5 * ignition);
    over(acc, deep, line * 0.75 * mix(1.0, 0.25, rest));
    glow += EMBER * line * 0.35 * heat;
  }

  // Crater: radial splits from the emergence point.
  if (crater) {
    float r = s.dist;
    float a = atan(vLocal.y, vLocal.x) + (noise(w * 0.05 + seed) - 0.5) * 0.7;
    float spokes = 7.0 + floor(seed * 4.0);
    float sector = a / TAU * spokes + seed;
    float k = abs(fract(sector) - 0.5) * r * TAU / spokes;
    float len = radius * (0.5 + 0.45 * hash21(vec2(floor(sector), seed * 31.0)));
    float width = 2.8 * (1.0 - smoothstep(0.0, len * easeOut(axisSince / 200.0), r));
    float spoke = band(k, width);
    over(acc, deep, spoke * 0.9 * mix(1.0, 0.3, rest));
    glow += EMBER * spoke * 0.5 * exp(-axisSince / 380.0);
  }

  // Collapse: plates break, tilt and sink into a rubble trench.
  if (collapsed > 0.5) {
    float open = easeOut(since / 170.0);
    float edgeNoise = noise(w * 0.045 + seed * 9.0);
    float trenchR = crater ? radius * 0.34 + 9.0 * edgeNoise : 15.0 + 6.0 * edgeNoise;
    float trench = trenchR * open;
    float d = crater ? s.dist : cd;
    if (d < trench + 16.0) {
      float inner = clamp(1.0 - d / max(trench, 1.0), 0.0, 1.0);
      // Plates slide toward the axis while they sink.
      vec2 pull = s.normal * (crater ? 5.0 : 3.5) * open * (1.0 - inner * 0.4);
      vec4 plate = cells((w - pull) / 9.5 + seed * 29.0);
      float sink = open * mix(0.4, 1.0, inner) * mix(1.0, 0.3, rest);
      vec2 tilt = normalize(hash22(vec2(plate.y, seed) * 91.7) - 0.5 + s.normal * 0.9);
      float lambert = dot(tilt, TO_LIGHT);
      vec3 rubble = earth * mix(0.95, 0.38, sink) * (0.76 + 0.36 * plate.y) * (1.0 + 0.35 * lambert);
      // The settled scar blends into the surrounding ground instead of keeping a cut edge.
      float inside = 1.0 - smoothstep(trench - 1.2 - 6.0 * rest, trench + 1.2 + 1.5 * rest, d);
      // Crumbled raised rim just outside the trench.
      float lip = exp(-sq((d - trench - 2.2) / 2.8)) * open;
      vec3 lipColor = lightSide > 0.0 ? mix(earth, vec3(1.0), 0.25) : earth * 0.48;
      over(acc, lipColor, lip * 0.6 * (0.6 + 0.4 * edgeNoise) * mix(1.0, 0.45, rest));
      // Pebbles thrown onto the surrounding ground.
      vec4 grit = cells(w / 3.4 + seed * 41.0);
      float pebble = (1.0 - smoothstep(0.1, 0.24, grit.w)) * step(0.7, grit.y)
        * smoothstep(trench + 14.0, trench + 2.0, d) * (1.0 - inside) * open;
      over(acc, mix(earth * 0.62, earth * 1.15, grit.y), pebble * 0.92 * mix(1.0, 0.7, rest));
      over(acc, rubble, inside * mix(1.0, 0.5, rest));
      float gap = (0.06 + 0.12 * sink) * (1.0 + 0.7 * inner);
      float seam = (1.0 - smoothstep(gap * 0.5, gap, plate.x)) * inside;
      over(acc, deep * 0.55, seam * 0.95 * mix(1.0, 0.18, rest));
      float cool = exp(-since / 320.0);
      float flicker = 0.7 + 0.3 * noise(w * 0.4 + t * 0.006);
      glow += mix(EMBER * 0.8, GLOW, cool * cool) * seam * cool * flicker * 0.5;
      glow += EMBER * inside * inner * inner * cool * 0.12;
    }
    // Detonation flash: short, narrow and softly ramped so the travelling front stays smooth.
    float flash = smoothstep(0.0, 30.0, since) * exp(-since / 110.0);
    float reachFlash = crater ? radius * 0.3 : 9.0;
    glow += mix(GLOW, HOT, flash) * flash * exp(-sq(d / reachFlash)) * 0.7;
  } else if (!crater && detonated) {
    // The ignition front races back along the trace ahead of the collapse.
    float fuse = exp(-sq((t - s.ignite) / 40.0));
    glow += GLOW * fuse * exp(-sq(cd / 4.5)) * 0.6;
    glow += EMBER * ignition * exp(-sq(cd / (4.0 + 6.0 * ignition))) * 0.22;
  }

  // Dissolve: the scar crumbles away in patches, outer ground first, the trench axis last,
  // and a thin veil of settling dust marks each receding edge.
  float fade = detonated ? clamp((axisSince - HOLD_MS) / FADE_MS, 0.0, 1.0) : 0.0;
  float extent = clamp(crater ? s.dist / radius : s.dist / 32.0, 0.0, 1.0);
  float grain = 0.5 * noise(w * 0.1 + seed * 7.0) + 0.3 * noise(w * 0.33 + seed * 2.0) + 0.2 * (1.0 - extent);
  float survive = smoothstep(fade * 1.3 - 0.25, fade * 1.3 - 0.05, grain);
  float crumble = fade > 0.0 ? survive * (1.0 - survive) * 4.0 : 0.0;
  float veil = crumble * acc.a * 0.35;
  acc *= survive;
  over(acc, mix(earth, vec3(0.86, 0.79, 0.64), 0.55), veil);
  glowOut = glow * survive * cancel;
  return acc * cancel;
}

void main() {
  bool crater = vMisc.w > 0.5;
  Site s;
  float t = uTime;
  float det = vMisc.y;
  vec2 p = vLocal;
  if (crater) {
    s.dist = length(p);
    if (s.dist > vShape.x + 6.0) discard;
    s.normal = s.dist > 1.0e-3 ? p / s.dist : vec2(0.0, 1.0);
    s.cd = s.dist; s.u = 0.0; s.front = 0.0;
    s.born = vTime.x; s.collapse = vTime.z; s.ignite = vTime.z;
  } else {
    float len = vShape.x;
    // Joint bisectors: a pixel belongs to exactly one of two adjacent segments.
    if (dot(p, vJoin.xy) < 0.0 || dot(p - vec2(len, 0.0), vJoin.zw) > 0.0) discard;
    float along = clamp(p.x, 0.0, len);
    vec2 offset = p - vec2(along, 0.0);
    s.dist = length(offset);
    // Nothing a segment draws reaches further than its lateral shock band.
    if (s.dist > 47.0) discard;
    vec2 local = s.dist > 1.0e-3 ? offset / s.dist : vec2(0.0, 1.0);
    vec2 axis = vShape.zw;
    s.normal = vec2(axis.x * local.x - axis.y * local.y, axis.y * local.x + axis.x * local.y);
    s.u = vShape.y + along;
    // World-space warp keeps the jagged centre line continuous across segments.
    float warp = (noise(vWorld * 0.07 + vMisc.z * 11.0) - 0.5) * 7.0
      + (noise(vWorld * 0.29 + vMisc.z * 3.0) - 0.5) * 2.2;
    float side = p.y >= 0.0 ? 1.0 : -1.0;
    s.cd = abs(side * s.dist + warp);
    float q = along / max(len, 1.0e-3);
    s.born = vTime.x + q * GROW_MS;
    float grown = clamp((t - vTime.x) / GROW_MS, 0.0, 1.0) * len;
    float next = vTime.y > NONE_LIMIT ? clamp((t - vTime.y) / GROW_MS, 0.0, 1.0) * ${f(FISSURE_SPACING_HINT)} : 0.0;
    s.front = vShape.y + grown + next;
    if (s.u > s.front + 0.5) discard;
    if (det > NONE_LIMIT) {
      s.collapse = mix(vTime.z, vTime.w, q);
      s.ignite = det + (s.collapse - det) * IGNITION_LEAD;
    } else {
      s.collapse = -1.0e7; s.ignite = -1.0e7;
    }
  }
  vec3 glow;
  vec4 color = shade(s, crater, glow);
  if (uPass > 0.5) color = vec4(glow, 0.0);
  else color = vec4(color.rgb + glow * 0.7, min(1.0, color.a + dot(glow, vec3(0.08))));
  if (color.a <= 0.003 && max(color.r, max(color.g, color.b)) <= 0.003) discard;
  gl_FragColor = color * uAlpha;
}`;
