/**
 * Analytic energy ball and impact burst, one quad per instance.
 *
 * The ball keeps the look of the former classic composition – tinted glow, rotating arc shell
 * and the two particle streams (dense hot core, sparser shell sparks) – but evaluates them here:
 * each stream is replayed deterministically around the ball from time and seed, swarming with
 * it like the former emitter-local particles, with no CPU particles.
 * A turbulent plasma nucleus and anti-aliased, softly blooming arcs refine the former sprites.
 * Gradients reproduce the former canvas textures; output is premultiplied emission for ADD.
 *
 * Attributes per vertex (see EnergyBallGpuStore): geometry (world xy, local xy in px), shape (glow radius, shell scale, seed, kind * 2 + variant), motion
 * (born s, impact scale, core zone, shell zone), glow tint + core particle radius,
 * shell tint + shell particle radius, ball color.
 */
export const ENERGY_BALL_VERTEX_SHADER = `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform mat4 uProjectionMatrix;
uniform mat3 uViewMatrix;
attribute vec4 inGeom;
attribute vec4 inShape;
attribute vec4 inMotion;
attribute vec4 inGlow;
attribute vec4 inShell;
attribute vec3 inCore;
varying vec2 vLocal;
varying vec4 vShape;
varying vec4 vMotion;
varying vec4 vGlow;
varying vec4 vShell;
varying vec3 vCore;
void main() {
  vec3 view = uViewMatrix * vec3(inGeom.xy, 1.0);
  gl_Position = uProjectionMatrix * vec4(view.xy, 0.0, 1.0);
  vLocal = inGeom.zw; vShape = inShape; vMotion = inMotion;
  vGlow = inGlow; vShell = inShell; vCore = inCore;
}`;

export const ENERGY_BALL_FRAGMENT_SHADER = `
#pragma phaserTemplate(shaderName)
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform float uTime;
uniform float uWrap;
uniform float uPixel;
uniform float uEmission;
uniform float uDetail;
uniform float uAlpha;
varying vec2 vLocal;
varying vec4 vShape;
varying vec4 vMotion;
varying vec4 vGlow;
varying vec4 vShell;
varying vec3 vCore;
const float PI = 3.14159265359;
const float TAU = 6.28318530718;
const vec3 CYAN = vec3(0.643, 0.867, 0.859);

// Former emitters: core 2 particles / 16 ms, 110-220 ms, +-14 px/s;
// shell 1 particle / 28 ms, 160-320 ms, +-26 px/s. Particles keep a fixed radius over life,
// tuned against captures of the former shrinking sprites so the core reads equally solid.
const float CORE_PERIOD = 0.016;
const float CORE_LIFE_MIN = 0.11;
const float CORE_LIFE_MAX = 0.22;
const float CORE_DRIFT = 14.0;
const float SHELL_PERIOD = 0.028;
const float SHELL_LIFE_MIN = 0.16;
const float SHELL_LIFE_MAX = 0.32;
const float SHELL_DRIFT = 26.0;

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
vec4 hash41(float n) {
  vec4 p = fract(vec4(n) * vec4(0.1031, 0.1030, 0.0973, 0.1099));
  p += dot(p, p.wzxy + 33.33);
  return fract((p.xxyz + p.yzzw) * p.zywx);
}
float noise(vec2 v) {
  vec2 i = floor(v), f = fract(v);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash11(dot(i, vec2(1.0, 57.0)));
  float b = hash11(dot(i + vec2(1.0, 0.0), vec2(1.0, 57.0)));
  float c = hash11(dot(i + vec2(0.0, 1.0), vec2(1.0, 57.0)));
  float d = hash11(dot(i + vec2(1.0, 1.0), vec2(1.0, 57.0)));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Four-stop gradient (0, p1, p2, 1) in straight rgb + alpha, like the former canvas textures.
vec4 ramp(float x, vec4 c0, vec4 c1, vec4 c2, vec4 c3, float p1, float p2) {
  x = clamp(x, 0.0, 1.0);
  if (x < p1) return mix(c0, c1, x / p1);
  if (x < p2) return mix(c1, c2, (x - p1) / (p2 - p1));
  return mix(c2, c3, (x - p2) / (1.0 - p2));
}
vec3 glowTex(float x, bool plasma) {
  vec4 c = plasma
    ? ramp(x, vec4(1.0, 1.0, 1.0, 0.5), vec4(1.0, 1.0, 1.0, 0.22), vec4(0.706, 0.706, 0.706, 0.08), vec4(0.0), 0.32, 0.66)
    : ramp(x, vec4(CYAN, 0.55), vec4(0.451, 0.745, 0.827, 0.28), vec4(0.27, 0.44, 0.52, 0.14), vec4(0.09, 0.125, 0.22, 0.0), 0.45, 0.725);
  return c.rgb * c.a;
}
vec3 coreTex(float x, bool plasma) {
  vec4 c = plasma
    ? ramp(x, vec4(1.0), vec4(1.0, 1.0, 1.0, 0.82), vec4(0.839, 0.839, 0.839, 0.34), vec4(0.157, 0.157, 0.157, 0.0), 0.28, 0.56)
    : ramp(x, vec4(1.0), vec4(0.769, 0.965, 1.0, 0.95), vec4(0.451, 0.745, 0.827, 0.3), vec4(0.31, 0.561, 0.729, 0.0), 0.35, 0.7);
  return c.rgb * c.a;
}
vec3 sparkTex(float x, bool plasma) {
  vec4 c = plasma
    ? ramp(x, vec4(1.0, 1.0, 1.0, 0.96), vec4(1.0, 1.0, 1.0, 0.7), vec4(0.745, 0.745, 0.745, 0.2), vec4(0.196, 0.196, 0.196, 0.0), 0.38, 0.72)
    : ramp(x, vec4(1.0), vec4(CYAN, 0.65), vec4(0.475, 0.714, 0.796, 0.33), vec4(0.31, 0.561, 0.729, 0.0), 0.5, 0.75);
  return c.rgb * c.a;
}

// Particle tints, chosen per particle like the former emitter tint arrays.
vec3 coreTint(float h, bool plasma) {
  if (plasma) return h < 0.333 ? mix(vCore, vec3(1.0), 0.12) : (h < 0.667 ? vCore : vCore * 0.84);
  return h < 0.333 ? vec3(1.0) : (h < 0.667 ? vCore : vGlow.rgb);
}
vec3 shellTint(float h, bool plasma) {
  if (plasma) return h < 0.333 ? mix(vCore, vec3(1.0), 0.08) : (h < 0.667 ? vCore * 0.88 : mix(vCore, vec3(1.0), 0.03));
  return h < 0.333 ? vec3(1.0) : (h < 0.667 ? vGlow.rgb : vCore);
}
vec3 sparkTint(float h, bool plasma) {
  if (plasma) return h < 0.333 ? vec3(1.0) : (h < 0.667 ? mix(vCore, vec3(1.0), 0.18) : vCore * 0.85);
  return h < 0.333 ? vec3(1.0) : (h < 0.667 ? vCore : vGlow.rgb);
}

// Anti-aliased stroke of half width w at radius R, plus a faint bloom around it.
float stroke(float r, float R, float w, float px) {
  float d = abs(r - R);
  return clamp((w - d) / px + 0.5, 0.0, 1.0) + exp(-(d * d) / (w * w * 6.0)) * 0.22;
}
float arc(float a, float start, float end, float soft) {
  float u = mod(a - start, TAU);
  float span = end - start;
  return smoothstep(0.0, soft, u) * (1.0 - smoothstep(span - soft, span, u));
}
// The former shell textures, radii in px at shell scale 1. Returns tint-ready premultiplied rgb.
vec3 shell(vec2 p, float scale, float rot, bool plasma) {
  float r = length(p) / scale;
  if (r > 16.0) return vec3(0.0);
  float a = atan(p.y, p.x) - rot;
  float soft = clamp(uPixel / max(scale * 9.0, 1.0), 0.02, 0.3);
  float ripple = uDetail > 0.5 ? 0.82 + 0.36 * noise(vec2(a * 2.6 + uTime * 7.0, vShape.z)) : 1.0;
  float w = 1.0 / scale;
  float px = uPixel / scale;
  if (plasma) {
    float l = stroke(r, 8.4, max(1.0, 0.5 * w), px) * 0.82 * arc(a, 0.18 * PI, 1.72 * PI, soft)
      + stroke(r, 10.7, max(0.65, 0.5 * w), px) * 0.42 * arc(a, 0.78 * PI, 2.04 * PI, soft)
      + stroke(r, 6.4, max(0.5, 0.5 * w), px) * 0.28 * arc(a, 1.2 * PI, 2.3 * PI, soft);
    return vec3(l * ripple);
  }
  float ring = stroke(r, 9.0, max(1.25, 0.5 * w), px) * 0.9;
  float outer = stroke(r, 11.5, max(0.75, 0.5 * w), px) * 0.45 * arc(a, 0.2 * PI, 1.55 * PI, soft);
  return (vec3(ring) + CYAN * outer) * ripple;
}

void main() {
  vec2 p = vLocal;
  float r = length(p);
  float state = vShape.w;
  bool impact = state > 1.5;
  bool plasma = mod(state, 2.0) > 0.5;
  float seed = vShape.z;
  float t = uTime;
  // Former additive images (glow, shell) took the daylight emission scale; particles did not.
  vec3 rgb = vec3(0.0);
  vec3 part = vec3(0.0);

  if (!impact) {
    float pulse = sin(t * 20.0 + seed * 0.7);
    float glowPulse = max(0.3, 1.0 + pulse * (plasma ? 0.16 : 0.0));
    float shellPulse = max(0.4, 1.0 + cos(t * 16.0 + seed * 0.4) * (plasma ? 0.1 : 0.0));
    float glowAlpha = (plasma ? 0.84 : 0.72) * (0.92 + pulse * 0.05);
    float shellAlpha = (plasma ? 0.62 : 0.85) * (0.95 + pulse * 0.04);

    rgb += glowTex(r / (vShape.x * glowPulse), plasma) * vGlow.rgb * glowAlpha;

    // Phaser particles are emitter-local: both streams swarm around the ball and follow it.
    // Nothing is older than the ball itself, so a fresh ball builds up like a started emitter.
    float ballAge = t - vMotion.x;
    if (ballAge < 0.0) ballAge += uWrap;
    float coreZone = vMotion.z, shellZone = vMotion.w;
    float coreR = vGlow.a, shellR = vShell.a;

    // Shell sparks: only where a spark can reach.
    float shellReach = shellZone + SHELL_DRIFT * SHELL_LIFE_MAX + shellR;
    if (r < shellReach) {
      float clock = t + seed * 0.0131;
      float last = floor(clock / SHELL_PERIOD);
      for (int i = 0; i < 12; i++) {
        float k = last - float(i);
        float age = clock - k * SHELL_PERIOD;
        if (age > ballAge) break;
        vec4 h = hash41(k * 1.37 + seed * 17.0);
        float life = mix(SHELL_LIFE_MIN, SHELL_LIFE_MAX, h.x);
        if (age >= life) continue;
        float u = age / life;
        vec4 g = hash41(k * 2.11 + seed * 29.0 + 5.0);
        vec2 spawn = vec2(cos(g.x * TAU), sin(g.x * TAU)) * shellZone * sqrt(g.y);
        vec2 pos = spawn + (h.yz * 2.0 - 1.0) * SHELL_DRIFT * age;
        float d = length(p - pos) / shellR;
        if (d < 1.0) part += sparkTex(d, plasma) * shellTint(h.w, plasma) * mix(0.8, 0.0, u);
      }
    }

    // Hot core stream: two particles per emission, half the stream on low detail.
    float coreReach = coreZone + CORE_DRIFT * CORE_LIFE_MAX + coreR;
    if (r < coreReach) {
      float clock = t + seed * 0.0173;
      float last = floor(clock / CORE_PERIOD);
      for (int i = 0; i < 14; i++) {
        float k = last - float(i);
        float age = clock - k * CORE_PERIOD;
        if (age > ballAge) break;
        for (int j = 0; j < 2; j++) {
          if (j == 1 && uDetail < 0.5) break;
          float n = k * 2.0 + float(j);
          vec4 h = hash41(n * 1.73 + seed * 13.0 + 3.0);
          float life = mix(CORE_LIFE_MIN, CORE_LIFE_MAX, h.x);
          if (age >= life) continue;
          float u = age / life;
          vec4 g = hash41(n * 2.39 + seed * 31.0 + 11.0);
          vec2 spawn = vec2(cos(g.x * TAU), sin(g.x * TAU)) * coreZone * sqrt(g.y);
          vec2 pos = spawn + (h.yz * 2.0 - 1.0) * CORE_DRIFT * age;
          float d = length(p - pos) / coreR;
          if (d < 1.0) part += coreTex(d, plasma) * coreTint(h.w, plasma) * mix(0.95, 0.0, u);
        }
      }
    }

    // Plasma nucleus: a slowly churning hot centre that keeps the core solid between particles.
    float nucleus = coreZone + coreR * 0.55;
    if (r < nucleus) {
      float x = r / nucleus;
      float churn = 0.75;
      if (uDetail > 0.5) {
        float c = cos(t * 2.3 + seed), s = sin(t * 2.3 + seed);
        vec2 q = mat2(c, -s, s, c) * (p / nucleus);
        churn = 0.5 + 0.5 * noise(q * 2.4 + vec2(t * 3.1, seed)) + 0.25 * noise(q * 5.1 - t * 4.3);
      }
      float body = (1.0 - x * x) * (1.0 - x * x);
      part += mix(vCore, vec3(1.0), 0.55 + 0.45 * (1.0 - x)) * body * churn * 0.55;
    }

    float rotation = t * 6.0 + seed * 0.15;
    rgb += shell(p, vShape.y * shellPulse, rotation, plasma) * vShell.rgb * shellAlpha;
  } else {
    float age = t - vMotion.x;
    if (age < 0.0) age += uWrap;
    float scale = vMotion.y;

    float q = clamp(age / (plasma ? 0.18 : 0.24), 0.0, 1.0);
    float e = 1.0 - (1.0 - q) * (1.0 - q);
    rgb += glowTex(r / (vShape.x * mix(1.0, 1.6, e)), plasma) * vGlow.rgb * (plasma ? 0.72 : 0.64) * (1.0 - e);

    float q2 = clamp(age / (plasma ? 0.16 : 0.22), 0.0, 1.0);
    float e2 = 1.0 - (1.0 - q2) * (1.0 - q2) * (1.0 - q2);
    if (e2 < 1.0) {
      rgb += shell(p, vShape.y * mix(1.0, 1.9, e2), seed * 0.15 + 0.65 * PI * e2, plasma)
        * vShell.rgb * (plasma ? 0.82 : 0.76) * (1.0 - e2);
    }

    // Burst sparks, stretched along their flight by one frame of motion.
    float count = plasma ? 12.0 : 16.0;
    float lifeMin = plasma ? 0.12 : 0.16, lifeMax = plasma ? 0.28 : 0.34;
    float sparkR = vShell.a;
    for (int i = 0; i < 16; i++) {
      if (float(i) >= count) break;
      vec4 h = hash41(float(i) * 3.17 + seed * 7.0 + 1.0);
      float life = mix(lifeMin, lifeMax, h.x);
      if (age >= life) continue;
      float u = age / life;
      float angle = h.y * TAU;
      vec2 dir = vec2(cos(angle), sin(angle));
      float sp = mix(40.0, 180.0, h.z) * scale;
      vec2 head = dir * sp * age;
      float streak = min(sp * 0.016, sp * age);
      vec2 rel = p - head;
      float along = clamp(dot(rel, -dir), 0.0, streak);
      float radius = mix(sparkR, 0.16, u);
      float d = length(rel + dir * along) / radius;
      if (d < 1.0) part += sparkTex(d, plasma) * sparkTint(h.w, plasma) * mix(0.95, 0.0, u);
    }
  }

  rgb = (rgb * uEmission + part) * uAlpha;
  gl_FragColor = vec4(rgb, clamp(max(rgb.r, max(rgb.g, rgb.b)), 0.0, 1.0));
}`;
