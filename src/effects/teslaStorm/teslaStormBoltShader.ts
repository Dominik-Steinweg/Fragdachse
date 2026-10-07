/**
 * Analytic Tesla storm discharge (Diablo-like charged bolt), one quad per discharge.
 *
 * Three zig-zag filaments run across the flight direction, each with an optional thin branch;
 * a soft halo and short-lived sparks sit at the core. Shapes jump to a new random form about
 * 26 times per second, derived from time and the per-discharge seed, so the CPU never rebuilds
 * geometry. Output is premultiplied emission for the additive layer.
 *
 * Attributes per vertex: world position, local position in discharge sizes (x = flight
 * direction), shape (size px, seed, alpha, unused) and the weapon color.
 */
export const TESLA_STORM_VERTEX_SHADER = `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform mat4 uProjectionMatrix;
uniform mat3 uViewMatrix;
attribute vec2 inPosition;
attribute vec2 inLocal;
attribute vec4 inShape;
attribute vec4 inColor;
varying vec2 vLocal;
varying vec4 vShape;
varying vec4 vColor;
void main() {
  vec3 view = uViewMatrix * vec3(inPosition, 1.0);
  gl_Position = uProjectionMatrix * vec4(view.xy, 0.0, 1.0);
  vLocal = inLocal; vShape = inShape; vColor = inColor;
}`;

export const TESLA_STORM_FRAGMENT_SHADER = `
#pragma phaserTemplate(shaderName)
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform float uTime;
uniform float uPixel;
uniform float uEmission;
uniform float uDetail;
uniform float uAlpha;
varying vec2 vLocal;
varying vec4 vShape;
varying vec4 vColor;
const float PI = 3.14159265359;
const float TAU = 6.28318530718;
const float SPAN = 0.86;
const float AMP = 0.13;

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
vec3 hash31(float n) {
  vec3 p = fract(vec3(n) * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yzx + 33.33);
  return fract((p.xxy + p.yzz) * p.zyx);
}

// Width-conserving line profile: below the pixel floor the line gets dimmer instead of wider.
// Callers pass about 0.6 of the authored ribbon half width, so the soft tails keep its weight.
float line(float d, float w, float aa) {
  float sigma = max(w, aa);
  return exp(-(d * d) / (sigma * sigma)) * clamp(w / aa, 0.0, 1.0);
}

// Node offset of the zig-zag; the ends keep a small swing like the authored shape.
float node(float j, float k, float fi, float seed) {
  float e = 0.16 + 0.84 * sin(PI * j / 6.0);
  return (hash11(k * 3.17 + j * 11.31 + fi * 5.73 + seed) * 2.0 - 1.0) * e;
}

// Offset (x) and slope (y) of a filament at normalized position t.
vec2 zigzag(float t, float k, float fi, float seed) {
  float s = clamp(t, 0.0, 1.0) * 6.0;
  float i0 = min(floor(s), 5.0);
  float n0 = node(i0, k, fi, seed);
  float n1 = node(i0 + 1.0, k, fi, seed);
  return vec2(mix(n0, n1, s - i0) * AMP, (n1 - n0) * AMP * 6.0 / SPAN);
}

void main() {
  vec2 p = vLocal;
  float size = max(vShape.x, 1.0);
  float seed = mod(vShape.y, 997.0);
  float aa = max(uPixel, 0.5) / size;
  float T = uTime;
  float r = length(p);

  float glow = 0.0;
  float core = 0.0;
  float flickerSum = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float ph = fract(seed * 0.618 + fi * 0.33) * TAU;
    float flicker = 0.88 + 0.08 * sin(T * 73.0 + ph) + 0.04 * sin(T * 119.0 + ph * 1.7);
    flickerSum += flicker;
    // Each filament changes its form on its own beat.
    float k = floor(T * (22.0 + 8.0 * hash11(seed + fi * 7.3)) + fi * 0.37);
    vec3 h = hash31(mod(k, 211.0) * 1.37 + fi * 17.1 + seed);
    float rot = (h.x - 0.5) * 0.6;
    float cs = cos(rot);
    float sn = sin(rot);
    // Filament frame: a along the filament (across the flight), c along the flight.
    float a = -p.x * sn + p.y * cs;
    float c = p.x * cs + p.y * sn - (fi - 1.0) * 0.2;
    float t = a / SPAN + 0.5;
    vec2 z = zigzag(t, k, fi, seed);
    float d = abs(c - z.x) * inversesqrt(1.0 + z.y * z.y);
    float env = t > 0.0 && t < 1.0 ? sin(PI * t) : 0.0;
    float along = (0.2 + 0.8 * env) * flicker * (1.0 - smoothstep(0.43, 0.5, r));
    float w = 0.08 * env;
    glow += (line(d, 0.72 * w, aa) * 0.09 + line(d, 0.44 * w, aa) * 0.23) * along;
    core += line(d, 0.2 * w, aa) * 0.64 * along;

    // A thin side branch on three of four forms.
    if (h.y < 0.75) {
      float bt = 0.25 + 0.5 * h.z;
      vec2 start = vec2((bt - 0.5) * SPAN, zigzag(bt, k, fi, seed).x);
      vec3 hb = hash31(mod(k, 211.0) * 2.91 + fi * 5.3 + seed * 1.7);
      float angle = (hb.x < 0.5 ? -1.0 : 1.0) * (0.5 + 1.1 * hb.y);
      float len = SPAN * (0.18 + 0.16 * hb.z);
      vec2 bd = vec2(cos(angle), sin(angle));
      vec2 bq = vec2(a, c) - start;
      float u = dot(bq, bd);
      float tb = u / len;
      if (tb > 0.0 && tb < 1.0) {
        float v = dot(bq, vec2(-bd.y, bd.x)) - sin(PI * tb) * len * 0.18;
        float benv = sin(PI * tb) * (1.0 - tb);
        float bw = 0.035 * benv;
        float bAlong = 0.38 * flicker * (0.2 + 0.8 * benv) * (1.0 - smoothstep(0.62, 0.7, r));
        glow += (line(v, 0.72 * bw, aa) * 0.09 + line(v, 0.44 * bw, aa) * 0.23) * bAlong;
        core += line(v, 0.2 * bw, aa) * 0.64 * bAlong;
      }
    }
  }

  // Soft halo; replaces three overlapping halo sprites of the former CPU renderer.
  float x = r / 0.65;
  float halo = 0.25 * flickerSum * 0.34 * exp(-3.2 * x * x) * (1.0 - smoothstep(0.7, 1.0, x));

  // Short sparks crowd the core, two decorate the rim.
  float sparks = 0.0;
  float sparkScale = sqrt(size / 32.0) / size;
  float sparkCount = uDetail > 0.5 ? 18.0 : 9.0;
  for (int j = 0; j < 18; j++) {
    float fj = float(j);
    if (fj >= sparkCount) break;
    bool outer = j >= 16;
    vec3 hj = hash31(seed * 1.7 + fj * 13.1);
    float life = 0.07 + 0.11 * hj.x;
    float cycle = T / life + hj.y;
    float age = fract(cycle);
    vec3 hn = hash31(mod(floor(cycle), 389.0) * 0.731 + fj * 7.7 + seed * 3.3);
    float ang = hn.x * TAU;
    float rad = (outer ? 0.42 + 0.12 * hn.y : pow(hn.y, 1.5) * 0.32) + age * 0.02;
    float diameter = (outer ? 1.6 + 1.1 * hn.z : 2.0 + 1.6 * hn.z) * sparkScale * (1.0 - age * 0.25);
    float ds = length(p - vec2(cos(ang), sin(ang)) * rad);
    float envelope = min(1.0, age / 0.12) * (1.0 - age * age) * (outer ? 0.55 : 0.95);
    sparks += line(ds, diameter * 0.35, aa) * envelope;
  }

  vec3 color = vColor.rgb;
  vec3 hot = mix(color, vec3(1.0), 0.78);
  vec3 haloColor = mix(color, vec3(0.561, 0.847, 1.0), 0.5) * vec3(0.82, 0.94, 1.0);
  vec3 sparkColor = mix(color, vec3(1.0), 0.85);
  vec3 rgb = hot * glow + vec3(core) + haloColor * halo + sparkColor * sparks;
  rgb *= uEmission * uAlpha * vShape.z;
  gl_FragColor = vec4(rgb, clamp(max(rgb.r, max(rgb.g, rgb.b)), 0.0, 1.0));
}`;
