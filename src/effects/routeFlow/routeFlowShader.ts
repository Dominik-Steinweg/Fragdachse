import { ROUTE_FLOW_SHAPE } from './RouteFlowStore';

/**
 * Void-Strömung: the enemy routes of the next round as a living void current, one quad per
 * stream segment plus swirls at the sources, glows where routes enter the build area and the
 * pressure wave of a breach. No lines, no arrows: direction is the motion of the current.
 *
 * Pass 0 (ground, NORMAL, decal band) soaks the soil with dark void ink.
 * Pass 1 (bed, NORMAL, above water and below rocks) carries the readable stream by day: violet
 * void haze that billows downstream in two layers, with lighter wisps where it rolls over itself.
 * Pass 2 (emissive, ADD with alpha 0, above the canopies) repeats only the light of the current,
 * so routes under trees stay readable.
 *
 * Every pattern moves along `dist + time · speed`, the arc distance to the route's goal. Routes
 * of one flow field share their distances where they merge, so a trunk flows on without seams.
 * Noise is sampled in World space; adjacent segments split the plane along their joint bisectors.
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
    float hw = vShape.y / uUnit;
    if (dot(p, vJoin.xy) < 0.0 || dot(p - vec2(len, 0.0), vJoin.zw) > 0.0) discard;
    float along = clamp(p.x / max(len, 0.001), 0.0, 1.0);
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
      float density = mix(smoothstep(0.3, 0.8, puff * 0.7 + drift * 0.4), 0.6, far);
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
      glow += mix(VOID_MID, light, wisp) * (haze * density * 0.32 + wisp * 0.3) * (1.0 + 0.5 * fresh);
      glow += mix(VOID_MID, HOT, heat) * body * 0.45 * far;
      // Breach routes boil against the wall.
      glow += HOT * heat * heat * haze * (0.25 + 0.25 * sin(uTime * 0.012 - dist * 0.08));
    }
  } else {
    float radius = vShape.x / uUnit;
    float r = length(p);
    float a = atan(p.y, p.x);
    if (r > radius * 1.25) discard;
    if (kind < 1.5) {
      // Source: a slow void swirl over a dark pool.
      float pool = 1.0 - smoothstep(radius * 0.45, radius, r + (noise(w * 0.09) - 0.5) * radius * 0.4);
      if (uPass < 0.5) over(acc, INK, pool * 0.42 * strength);
      else {
        float arms = 0.5 + 0.5 * sin(a * 3.0 - r * 0.12 + uTime * 0.0024);
        float swirl = smoothstep(0.55, 1.0, arms) * pool * smoothstep(0.0, radius * 0.2, r);
        if (uPass < 1.5) over(acc, VOID_MID, swirl * 0.45 * strength);
        glow += VOID_LIGHT * swirl * 0.5 + VOID_MID * exp(-sq(r / (radius * 0.3))) * 0.6;
      }
    } else if (kind < 2.5) {
      // Entry into the build area: the haze pools here and swells outward in soft waves.
      float phase = fract(uTime / 1800.0);
      float billow = fbm(w * 0.06 + vec2(uTime * 0.0004, 0.0));
      float ring = exp(-sq((r - radius * (0.25 + 0.75 * phase)) / (radius * 0.16 + px))) * (1.0 - phase) * (0.5 + 0.5 * billow);
      float core = exp(-sq(r / (radius * (0.35 + 0.15 * billow))));
      if (uPass < 0.5) over(acc, INK, core * 0.25 * strength);
      else {
        if (uPass < 1.5) over(acc, VOID_MID, core * 0.4 * strength);
        glow += mix(VOID_MID, VOID_LIGHT, billow) * (ring * 0.6 + core * 0.5) * (1.0 + 0.6 * fresh);
      }
    } else {
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
  if (uPass > 1.5) color = vec4(glow * strength * uGlow, 0.0);
  if (color.a <= 0.003 && max(color.r, max(color.g, color.b)) <= 0.003) discard;
  gl_FragColor = color * uAlpha;
}`;
