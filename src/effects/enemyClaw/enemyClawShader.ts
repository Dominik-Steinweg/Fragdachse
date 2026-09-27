import { CLAW_VFX_SLASH_MS, CLAW_VFX_TELEGRAPH_FADE_MS } from './EnemyClawVfxStore';

/**
 * Analytic claw visuals, all passes reading the same instance buffer:
 * 0 ground telegraph below the figures, 1 rakes and contact marks above them (both lit by
 * the lightmap), 2 an additive emissive trace of everything above the lightmap, so the
 * warning stays readable at night; its alpha follows `emissiveAlpha` and fades by day.
 *
 * Attributes per vertex: world position, quad-local px (x = attack direction), timing
 * (start, strike, hit, end), shape (range or mark size, half arc, kind, seed), color.
 */
export const ENEMY_CLAW_VERTEX_SHADER = `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform mat4 uProjectionMatrix;
uniform mat3 uViewMatrix;
uniform float uTime;
uniform float uPass;
attribute vec2 inPosition;
attribute vec2 inLocal;
attribute vec4 inTiming;
attribute vec4 inShape;
attribute vec4 inColor;
varying vec2 vLocal;
varying vec4 vTiming;
varying vec4 vShape;
varying vec4 vColor;
void main() {
  bool contact = inShape.z > 0.5;
  // Cull whole quads outside their pass/phase before any fragment work.
  bool live = uPass > 1.5 ? true : uPass < 0.5
    ? (!contact && uTime < inTiming.z + ${CLAW_VFX_TELEGRAPH_FADE_MS.toFixed(1)})
    : (contact || uTime >= inTiming.z);
  if (!live || uTime > inTiming.w) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
  } else {
    vec3 view = uViewMatrix * vec3(inPosition, 1.0);
    gl_Position = uProjectionMatrix * vec4(view.xy, 0.0, 1.0);
  }
  vLocal = inLocal; vTiming = inTiming; vShape = inShape; vColor = inColor;
}`;

export const ENEMY_CLAW_FRAGMENT_SHADER = `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform float uTime;
uniform float uPass;
uniform float uPixel;
uniform float uAlpha;
varying vec2 vLocal;
varying vec4 vTiming;
varying vec4 vShape;
varying vec4 vColor;

const float SLASH_MS = ${CLAW_VFX_SLASH_MS.toFixed(1)};
const float FADE_MS = ${CLAW_VFX_TELEGRAPH_FADE_MS.toFixed(1)};
const float PI = 3.14159265;
const vec3 HOT = vec3(1.0, 0.95, 0.88);

float line(float d, float halfWidth) {
  return 1.0 - smoothstep(halfWidth - uPixel, halfWidth + uPixel, abs(d));
}

// Output is premultiplied; alpha below the color weight reads as a soft additive glow.
vec4 telegraph(float wash) {
  float range = vShape.x;
  float halfArc = vShape.y;
  float r = length(vLocal);
  float ang = abs(atan(vLocal.y, vLocal.x));
  float dRad = r - range;
  float dAng = (ang - halfArc) * r;
  float inside = 1.0 - smoothstep(-uPixel, uPixel, max(dRad, dAng));
  if (inside <= 0.0) return vec4(0.0);

  float charge = clamp((uTime - vTiming.x) / max(1.0, vTiming.z - vTiming.x), 0.0, 1.0);
  float strike = smoothstep(vTiming.y, vTiming.z, uTime);
  float vis = smoothstep(vTiming.x, vTiming.x + 70.0, uTime)
    * (1.0 - smoothstep(vTiming.z, vTiming.z + FADE_MS, uTime));
  float rn = r / range;
  // The attacker's body covers the hub; fading it keeps the sector from reading as a disc.
  float hub = smoothstep(0.14, 0.46, rn);

  float front = charge * range;
  float behind = front - r;
  float filled = smoothstep(-uPixel, uPixel, behind);
  // Kept thin so dozens of overlapping sectors stay separable by their rims.
  float base = (0.03 + 0.06 * rn) * hub;
  float fill = filled * (0.05 + 0.16 * exp(-max(behind, 0.0) / (0.2 * range))) * hub;
  float wave = line(behind, 0.7) * smoothstep(0.05, 0.2, charge) * hub;
  float rim = line(dRad + 1.1, 0.8);
  float side = line(dAng + 0.7, 0.5) * smoothstep(0.3, 0.95, rn);
  float edge = max(rim * (0.4 + 0.45 * charge + 0.15 * strike), side * 0.32);

  float a = ((base + fill + 0.14 * strike * hub) * wash + 0.5 * wave + edge) * inside * vis;
  float heat = clamp(wave * 0.8 + rim * (0.25 + 0.75 * strike), 0.0, 1.0);
  vec3 color = mix(vColor.rgb, HOT, heat * 0.7);
  a = min(a, 0.9);
  return vec4(color * a, a);
}

// Two mirrored paws closing like a pincer: each drags three stacked claw arcs from the
// flank of the sector toward its centre line, reaching slightly further as it closes.
vec4 rake() {
  float t = uTime - vTiming.z;
  if (t < 0.0 || t > SLASH_MS) return vec4(0.0);
  float range = vShape.x;
  float halfArc = min(vShape.y, 1.35);
  vec2 p = vec2(vLocal.x, abs(vLocal.y));
  float r = max(length(p), 0.001);
  float ang = atan(p.y, p.x);
  float thetaStart = halfArc * 0.92;
  float thetaEnd = halfArc * 0.06;
  float q = (thetaStart - ang) / (thetaStart - thetaEnd);
  if (q < -0.02 || q > 1.02) return vec4(0.0);

  float reveal = 1.0 - pow(1.0 - clamp(t / 60.0, 0.0, 1.0), 2.0);
  float life = t / SLASH_MS;
  float fade = 1.0 - smoothstep(0.25, 1.0, life);
  float halfWidth = max(1.0, range * 0.026);
  float gap = max(3.0, range * 0.08);
  // Radius grows along the sweep; its angular rate sets the stroke's slant against the arc.
  float radiusGain = range * 0.26 / (thetaStart - thetaEnd);
  float norm = inversesqrt(1.0 + (radiusGain / r) * (radiusGain / r));

  float body = 0.0; float core = 0.0; float shade = 0.0; float tip = 0.0;
  for (int k = 0; k < 3; k++) {
    float o = float(k) - 1.0;
    float q0 = abs(o) * 0.08;
    float qq = (q - q0) / (1.0 - q0 - abs(o) * 0.1);
    if (qq < 0.0 || qq > 1.0) continue;
    float head = reveal * 1.15 - qq;
    if (head < 0.0) continue;
    float radius = range * (0.6 + 0.26 * q) + o * gap;
    float d = abs((r - radius) * norm);
    float w = halfWidth * pow(max(sin(PI * qq), 0.0), 0.55) * (1.0 - 0.2 * abs(o));
    body = max(body, 1.0 - smoothstep(w - uPixel, w + uPixel, d));
    core = max(core, 1.0 - smoothstep(0.0, max(w * 0.5, uPixel), d));
    shade = max(shade, 1.0 - smoothstep(w, w + 1.5 + uPixel * 2.0, d));
    tip = max(tip, 1.0 - smoothstep(0.0, 0.22, head));
  }
  float a = body * fade;
  vec3 color = mix(vColor.rgb, HOT, clamp(core * (1.0 - 0.7 * life) + tip * 0.5, 0.0, 1.0));
  // A thin dark shoulder separates the rake from bright ground without a hard outline.
  float shadow = max(shade - body, 0.0) * 0.32 * fade;
  return vec4(color * a, a * 0.92 + shadow);
}

// Short three-claw mark across the struck target plus a quick contact ring.
vec4 contact() {
  float size = vShape.x;
  float life = vTiming.w - vTiming.x;
  float t = uTime - vTiming.x;
  if (t < 0.0 || t > life) return vec4(0.0);
  vec2 p = vLocal;
  float fade = 1.0 - smoothstep(0.3, 1.0, t / life);
  float reveal = 1.0 - pow(1.0 - clamp(t / 45.0, 0.0, 1.0), 2.0);
  vec2 axis = normalize(vec2(0.5, 1.0));
  float along = dot(p, axis);
  float across = dot(p, vec2(-axis.y, axis.x));
  float gap = size * 0.26;
  float halfWidth = max(1.0, size * 0.075);

  float body = 0.0; float core = 0.0;
  for (int k = 0; k < 3; k++) {
    float o = float(k) - 1.0;
    float len = size * (0.8 - 0.16 * abs(o));
    float qq = (along + len) / (2.0 * len);
    if (qq < 0.0 || qq > 1.0 || qq > reveal * 1.1) continue;
    float w = halfWidth * pow(max(sin(PI * qq), 0.0), 0.55);
    float d = abs(across - o * gap + 0.12 * size * o * (qq - 0.5));
    body = max(body, 1.0 - smoothstep(w - uPixel, w + uPixel, d));
    core = max(core, 1.0 - smoothstep(0.0, max(w * 0.5, uPixel), d));
  }
  float r = length(p);
  float ringT = clamp(t / 190.0, 0.0, 1.0);
  float ringR = size * (0.3 + 0.6 * (1.0 - (1.0 - ringT) * (1.0 - ringT)));
  float ring = line(r - ringR, 0.9) * 0.5 * (1.0 - ringT);
  // Purely additive: brightens the struck body instead of veiling it.
  float flash = exp(-(r * r) / (size * size * 0.05)) * 0.3 * (1.0 - smoothstep(0.0, 90.0, t));

  float a = body * fade;
  vec3 color = mix(vColor.rgb, HOT, clamp(core * (1.0 - 0.6 * t / life), 0.0, 1.0));
  vec3 rgb = color * a + mix(vColor.rgb, HOT, 0.6) * ring + mix(vColor.rgb, HOT, 0.5) * flash;
  return vec4(rgb, a * 0.92 + ring * 0.45);
}

void main() {
  vec4 color;
  if (uPass < 0.5) color = telegraph(1.0);
  else if (uPass < 1.5) color = vShape.z < 0.5 ? rake() : contact();
  // Emissive trace: outlines and strokes carry the warning, the area wash stays faint.
  else color = vShape.z < 0.5 ? telegraph(0.3) + rake() : contact();
  if (color.a <= 0.003 && max(color.r, max(color.g, color.b)) <= 0.003) discard;
  gl_FragColor = color * uAlpha;
}`;
