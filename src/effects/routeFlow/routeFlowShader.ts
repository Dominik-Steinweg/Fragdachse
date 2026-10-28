import { FOG_SHAPE_RANGE } from '../sunlight/fogShape';
import { ROUTE_FLOW_SHAPE } from './RouteFlowStore';

/**
 * Void-Strömung: the enemy routes of the next round as a living void current, one quad per
 * stream segment plus the pressure wave of a breach. Sources and goals have no mark of their own:
 * the current gathers out of its spawn zone's void haze and parts around the base it attacks. No
 * lines, no arrows: direction is the motion of the current. A portal jump is the one exception:
 * nothing walks there, so it is a thin arc of void light with beads racing from entry to exit,
 * without ink or haze.
 *
 * Pass 0 (ground, NORMAL, decal band) soaks the soil with dark void ink.
 * Pass 1 (bed, NORMAL, above water and below rocks) carries the readable stream by day: violet
 * void haze that billows downstream in two layers, with lighter wisps where it rolls over itself.
 * Pass 2 (emissive, ADD with alpha 0, above the canopies and the light map) carries the light of
 * the current and its void motes, so routes stay readable under trees and at night. Where the
 * ground fog lends its shape, thick banks veil that light: the current glows through the fog
 * rather than over it. The streams' own haze tints the fog violet (VoidHazeLines).
 *
 * Every pattern moves along `dist + time · speed`, the arc distance to the route's goal. Routes
 * of one flow field share their distances where they merge, so a trunk flows on without seams.
 * Noise is sampled in World space; adjacent segments split the plane along their joint bisectors,
 * blended over one pixel so rounding can never leave a seam between them.
 * Width and presence are interpolated along each segment: a stroke tapers out of its source,
 * widens where routes join, and frays into wisps where it fades (tributaries, the goal).
 * `uUnit` maps layer units to World pixels (the minimap draws the same data scaled down).
 * Output is premultiplied.
 */

const f = (value: number): string => value.toFixed(1);

export const ROUTE_FLOW_VERTEX_SHADER = `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform mat4 uProjectionMatrix;
uniform mat3 uViewMatrix;
attribute vec2 inPosition;
attribute vec2 inLocal;
attribute vec4 inShape;
attribute vec4 inJoin;
attribute vec4 inFlow;
attribute vec4 inMisc;
varying vec2 vWorld;
varying vec2 vLocal;
varying vec4 vShape;
varying vec4 vJoin;
varying vec4 vFlow;
varying vec4 vMisc;
void main() {
  if (inMisc.y <= 0.0) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
  } else {
    vec3 view = uViewMatrix * vec3(inPosition, 1.0);
    gl_Position = uProjectionMatrix * vec4(view.xy, 0.0, 1.0);
  }
  vWorld = inPosition; vLocal = inLocal; vShape = inShape; vJoin = inJoin; vFlow = inFlow; vMisc = inMisc;
}`;

export const ROUTE_FLOW_FRAGMENT_SHADER = `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform float uTime;
uniform float uPass;
uniform float uPixel;
uniform float uAlpha;
uniform float uDetail;
uniform float uUnit;
uniform float uGlow;
// The ground fog's shape after its draw this frame (World px rect), lent while uFogShapeLent is 1.
uniform sampler2D uFogShape;
uniform vec4 uFogShapeView;
uniform float uFogShapeLent;
varying vec2 vWorld;
varying vec2 vLocal;
varying vec4 vShape;
varying vec4 vJoin;
varying vec4 vFlow;
varying vec4 vMisc;
const float TAU = 6.28318530718;
const float SPEED = 0.07;
const float STAIN_REACH = ${ROUTE_FLOW_SHAPE.stainReach.toFixed(2)};
const float HEAT_RANGE = ${f(ROUTE_FLOW_SHAPE.heatRange)};
const vec3 INK = vec3(0.07, 0.03, 0.10);
const vec3 VOID_DEEP = vec3(0.20, 0.07, 0.30);
const vec3 VOID_MID = vec3(0.44, 0.20, 0.64);
const vec3 VOID_LIGHT = vec3(0.70, 0.46, 0.98);
const vec3 HOT = vec3(1.0, 0.34, 0.50);
// VOID_PALETTE primary and bright: the void fog's spores, never white.
const vec3 MOTE_DEEP = vec3(0.702, 0.278, 1.0);
const vec3 MOTE_BRIGHT = vec3(0.851, 0.549, 1.0);
const vec3 HOT_CORE = vec3(1.0, 0.62, 0.72);

float hash21(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float noise(vec2 p) {
  vec2 i = floor(p), g = fract(p);
  g = g * g * (3.0 - 2.0 * g);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), g.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + 1.0), g.x), g.y);
}
float sq(float x) { return x * x; }
float fbm(vec2 p) {
  float value = 0.0, amplitude = 0.5;
  for (int i = 0; i < 3; i++) {
    if (i == 2 && uDetail < 0.5) break;
    value += amplitude * noise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    amplitude *= 0.5;
  }
  return value / 0.875;
}
// Void motes like the void fog's spores, carried by the current: at most one per cell of stream
// space (along, across), each orbiting a little and breathing. Smaller than a screen pixel, a mote
// keeps that size and dims instead of sparkling.
float streamMotes(vec2 q, float cell, float share, float radius, float px) {
  vec2 c = q / cell, base = floor(c);
  float light = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 id = base + vec2(float(i), float(j));
    float h0 = hash21(id), h1 = hash21(id + 17.3), h2 = hash21(id + 41.7), h3 = hash21(id + 73.1);
    if (h0 < share) {
      vec2 centre = id + .5 + (vec2(h1, h3) - .5) * .5
        + vec2(sin(uTime * (.0011 + h1 * .0013) + h2 * TAU), cos(uTime * (.0009 + h3 * .0012) + h1 * TAU)) * .22;
      float nominal = radius * (.7 + .6 * h2), r = max(nominal, px * .9);
      vec2 d = (c - centre) * cell / r;
      float d2 = dot(d, d);
      float breath = .58 + .42 * sin(uTime * (.0026 + h3 * .003) + h0 * 37.0);
      light += (exp(-d2 * 1.7) + exp(-d2 * .16) * .2) * breath * sq(nominal / r);
    }
  }
  return light;
}
// How much of the light below a fog bank still passes: 1 in clear air, about a third in thick banks.
float fogPass(vec2 world) {
  if (uFogShapeLent < 0.5) return 1.0;
  vec2 lent = (world - uFogShapeView.xy) / uFogShapeView.zw;
  if (any(lessThan(lent, vec2(0.0))) || any(greaterThan(lent, vec2(1.0)))) return 1.0;
  vec4 shape = texture2D(uFogShape, vec2(lent.x, 1.0 - lent.y));
  float thick = shape.r * shape.r * ${f(FOG_SHAPE_RANGE)};
  return mix(1.0, 0.35, 1.0 - exp(-thick * 0.8));
}
// Premultiplied "over".
void over(inout vec4 acc, vec3 color, float alpha) {
  alpha = clamp(alpha, 0.0, 1.0);
  acc = vec4(color * alpha, alpha) + acc * (1.0 - alpha);
}

void main() {
  vec2 w = vWorld / uUnit;
  vec2 p = vLocal / uUnit;
  float px = uPixel / uUnit;
  float kind = vFlow.w;
  float age = uTime - vMisc.x;
  float appear = smoothstep(0.0, 500.0, age);
  // A rerouted stream surges for a moment, so the change reads.
  float fresh = 1.0 - smoothstep(400.0, 1800.0, age);
  float strength = vMisc.y * appear;
  vec4 acc = vec4(0.0);
  vec3 glow = vec3(0.0);

  if (kind < 0.5) {
    float len = vShape.x / uUnit;
    // Joints hand over across one pixel: both sides' weights add up to one, whatever the rounding.
    float seam = 1.0;
    if (dot(vJoin.xy, vJoin.xy) > 0.5) seam *= clamp(dot(p, vJoin.xy) / px + 0.5, 0.0, 1.0);
    if (dot(vJoin.zw, vJoin.zw) > 0.5) seam *= clamp(0.5 - dot(p - vec2(len, 0.0), vJoin.zw) / px, 0.0, 1.0);
    if (seam <= 0.0) discard;
    float along = clamp(p.x / max(len, 0.001), 0.0, 1.0);
    float hw = mix(vShape.y, vShape.z, along) / uUnit;
    // Presence carries the route's strength; below it the current fades and frays.
    float presence = mix(vShape.w, vFlow.z, along);
    float fray = 1.0 - clamp(presence / max(vMisc.y, 0.001), 0.0, 1.0);
    strength = presence * appear * seam;
    float dist = mix(vFlow.x, vFlow.y, along);
    float heat = mix(vMisc.z, vMisc.w, along);
    // A slow meander keeps the stream organic; World-space noise so joints agree.
    float wobble = (noise(w * 0.022) - 0.5) * hw * 1.1 + (noise(w * 0.07 + 5.3) - 0.5) * hw * 0.3;
    float lateral = p.y - wobble;
    float cd = length(vec2(p.x - clamp(p.x, 0.0, len), lateral));
    // Open ends (sources, goals, junctions) round off; the current itself fades into the cap.
    float cap = (dot(vJoin.xy, vJoin.xy) < 0.5 ? smoothstep(-hw * 0.6, hw * 0.1, p.x) : 1.0)
      * (dot(vJoin.zw, vJoin.zw) < 0.5 ? smoothstep(len + hw * 0.6, len - hw * 0.1, p.x) : 1.0);
    float s = dist + uTime * SPEED;

    if (uPass < 0.5) {
      // Soaked soil: ragged dark ink a little wider than the stream.
      float edge = noise(w * 0.055) * 0.6 + noise(w * 0.16) * 0.4;
      float reach = hw * (STAIN_REACH - 0.75 + 0.75 * edge);
      float stain = 1.0 - smoothstep(reach * 0.4, reach, cd);
      over(acc, INK, stain * 0.36 * strength);
      over(acc, mix(INK, HOT * 0.25, heat), (1.0 - smoothstep(0.0, hw, cd)) * 0.2 * strength);
    } else {
      // Void haze drifting downstream. Two layers move at their own pace and warp each other, so
      // the current billows and rolls instead of sliding; no sparks, no lines.
      float breadth = hw * (0.9 + 0.5 * noise(w * 0.04 + vec2(0.0, uTime * 0.0003)));
      float across = lateral / breadth;
      float slow = dist + uTime * SPEED * 0.6;
      float drift = fbm(vec2(slow * 0.022 + 7.3, across * 1.3 + 2.1));
      float puff = fbm(vec2(s * 0.014, across * 0.8) + vec2(drift * 1.2, drift * 0.5));
      // Scaled far down (minimap) the billows would only shimmer: the haze evens out.
      float far = smoothstep(2.0, 8.0, px);
      float density = mix(smoothstep(0.3 + 0.3 * fray, 0.8 + 0.1 * fray, puff * 0.7 + drift * 0.4), 0.6, far);
      // Across the stream the haze itself frays the edge.
      float body = exp(-sq(cd / (breadth * (0.7 + 0.5 * puff)))) * cap;
      float haze = body * mix(0.3, 1.0, density);
      // Lighter wisps where the haze rolls over itself, stretched along the current.
      float wisp = pow(1.0 - abs(2.0 * noise(vec2(s * 0.026 + drift * 2.0, across * 1.8 + 4.7)) - 1.0), 5.0)
        * body * density * (1.0 - far);
      vec3 deep = mix(VOID_DEEP, HOT * 0.4, heat);
      vec3 light = mix(VOID_LIGHT, HOT, heat);
      vec3 tone = mix(deep, mix(VOID_MID, light, wisp), clamp(density * 0.8 + wisp * 0.6, 0.0, 1.0));
      if (uPass < 1.5) over(acc, tone, (haze * (0.48 + 0.12 * fresh) + wisp * 0.12) * strength);
      glow += mix(VOID_MID, mix(MOTE_DEEP, light, wisp), .4 + .6 * wisp) * (haze * density * 0.42 + wisp * 0.34) * (1.0 + 0.5 * fresh);
      glow += mix(MOTE_DEEP, HOT, heat) * body * 0.5 * far;
      // Motes drift downstream with the haze, thickest where it is dense; two layers at full detail.
      if (uPass > 1.5 && far < .99) {
        float gate = body * (.35 + .65 * density) * (1.0 - far);
        vec3 motes = mix(MOTE_DEEP, HOT, heat) * streamMotes(vec2(s, lateral), 22.0, .5, 1.6, px);
        if (uDetail > .5) motes += mix(MOTE_BRIGHT, HOT_CORE, heat) * streamMotes(vec2(s * 1.37 + 11.0, lateral * 1.2 + 3.0), 15.0, .35, 1.1, px) * .7;
        glow += motes * gate * 1.2;
      }
      // Breach routes boil against the wall.
      glow += HOT * heat * heat * haze * (0.25 + 0.25 * sin(uTime * 0.012 - dist * 0.08));
    }
  } else if (kind < 2.0) {
    // Portal jump: a parabola off the straight line (lift at its middle), rising out of the entry
    // and sinking into the exit.
    float len = vShape.x / uUnit, hw = vShape.y / uUnit, lift = vShape.z / uUnit;
    float t = clamp(p.x / max(len, 0.001), 0.0, 1.0);
    float slope = lift * 4.0 * (1.0 - 2.0 * t) / max(len, 0.001);
    float d = abs(p.y + lift * 4.0 * t * (1.0 - t)) / sqrt(1.0 + slope * slope);
    float ease = min(40.0, len * 0.2);
    float rise = smoothstep(0.0, ease, p.x) * smoothstep(len, len - ease, p.x);
    float r = max(hw, px * 0.9);
    float thread = exp(-sq(d / (r * 0.55))) * rise;
    float halo = exp(-sq(d / (r * 3.2))) * rise;
    // Beads drift and comets race along the arc length (close enough for a flat parabola).
    float arc = p.x * (1.0 + 2.67 * sq(lift / max(len, 1.0)));
    float gap = max(15.0, px * 6.0);
    float bead = fract(arc / gap - uTime * 0.0011);
    float beads = exp(-sq((bead - 0.5) * gap / (r * 1.1))) * exp(-sq(d / (r * 1.1))) * rise;
    float comet = fract(arc / 260.0 - uTime * 0.0009);
    float rush = smoothstep(0.55, 0.96, comet) * (1.0 - smoothstep(0.96, 1.0, comet)) * rise;
    if (uPass > 0.5) {
      if (uPass < 1.5) over(acc, VOID_LIGHT, (thread * 0.35 + beads * 0.75 + rush * thread * 0.5) * strength);
      glow += MOTE_BRIGHT * (halo * 0.18 + beads * 0.9 + rush * (thread * 1.6 + halo * 0.45));
    }
  } else {
    float radius = vShape.x / uUnit;
    float r = length(p);
    float a = atan(p.y, p.x);
    if (r > radius * 1.25) discard;
    {
      // Breach: no free path. Hot core and a segmented pressure wave against the wall.
      float core = exp(-sq(r / (radius * 0.28)));
      float waves = 0.0;
      for (int k = 0; k < 2; k++) {
        float phase = fract(uTime / 1100.0 + float(k) * 0.5);
        float front = radius * (0.2 + 0.8 * (1.0 - sq(1.0 - phase)));
        float segment = step(0.24, fract(a / TAU * 11.0 + phase * 0.6 + noise(w * 0.08) * 0.4));
        waves += exp(-sq((r - front) / (2.8 + px))) * (1.0 - phase) * segment;
      }
      if (uPass < 0.5) over(acc, INK, (1.0 - smoothstep(radius * 0.3, radius, r)) * 0.4 * strength);
      else {
        if (uPass < 1.5) over(acc, HOT * 0.7, (core * 0.55 + waves * 0.5) * strength);
        glow += HOT * waves * 0.9 + HOT_CORE * core * (0.4 + 0.15 * sin(uTime * 0.02));
      }
    }
  }

  vec4 color = acc;
  if (uPass > 1.5) color = vec4(glow * strength * uGlow * fogPass(vWorld), 0.0);
  if (color.a <= 0.003 && max(color.r, max(color.g, color.b)) <= 0.003) discard;
  gl_FragColor = color * uAlpha;
}`;
