/**
 * Grave lights of the Grave Titan, analytic and additive above the lightmap. One quad per item
 * spans a segment tail -> head (a = tail, b = head) widened by its half width.
 * Kind 0: a grave light (bright yellow-green core, soft green halo, two fluttering wings and a
 *         wispy haze trail behind the head along the segment).
 * Kind 1: the soul puff of a light that struck (a soft expanding ring, a fading flash and a few
 *         motes thrown outwards; `t` runs 0..1).
 * Shape: halfWidth, kind, t, seed. Aux: size (core scale in world px), intensity.
 */
export const GRAVE_WISP_VERTEX = `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform mat4 uProjectionMatrix;
uniform mat3 uViewMatrix;
attribute vec4 inSeg;
attribute vec2 inCorner;
attribute vec4 inShape;
attribute vec4 inAux;
varying vec2 vLocal;
varying vec4 vShape;
varying vec4 vAux;
varying float vLength;
void main() {
  vec2 a = inSeg.xy;
  vec2 d = inSeg.zw - a;
  float len = length(d);
  vec2 dir = len > 0.001 ? d / len : vec2(1.0, 0.0);
  vec2 across = vec2(-dir.y, dir.x);
  float hw = inShape.x;
  float u = inCorner.x < 0.0 ? -hw : len + hw;
  float v = inCorner.y * hw;
  vLocal = vec2(u, v);
  vLength = len;
  vShape = inShape;
  vAux = inAux;
  vec3 view = uViewMatrix * vec3(a + dir * u + across * v, 1.0);
  gl_Position = uProjectionMatrix * vec4(view.xy, 0.0, 1.0);
}`;

export const GRAVE_WISP_FRAGMENT = `
#pragma phaserTemplate(shaderName)
precision mediump float;
uniform float uTime;
uniform float uAlpha;
uniform float uEmissive;
varying vec2 vLocal;
varying vec4 vShape;
varying vec4 vAux;
varying float vLength;
const vec3 HALO = vec3(0.24, 0.92, 0.36);
const vec3 CORE = vec3(0.80, 1.00, 0.52);
const vec3 WING = vec3(0.62, 0.96, 0.70);
void main() {
  float kind = vShape.y, t = vShape.z, seed = vShape.w;
  float size = vAux.x, intensity = vAux.y;
  vec2 p = vec2(vLocal.x - vLength, vLocal.y);
  float r = length(p);
  vec3 color;
  float cover;
  if (kind < 0.5) {
    float flicker = 0.80 + 0.20 * sin(uTime * 23.0 + seed * 31.0);
    float halo = exp(-r * r / (size * size * 1.9)) * 0.55;
    float core = smoothstep(size * 0.46, size * 0.10, r);
    float flap = 0.50 + 0.50 * abs(sin(uTime * 34.0 + seed * 17.0));
    vec2 w = vec2(p.x + size * 0.18, abs(p.y) - size * 0.58 * flap);
    float wing = exp(-(w.x * w.x / (size * size * 0.13) + w.y * w.y / (size * size * 0.05))) * 0.42;
    float along = vLength > 0.5 ? clamp(vLocal.x / vLength, 0.0, 1.0) : 0.0;
    float wobble = sin(vLocal.x * 0.15 + uTime * 9.0 + seed * 7.0) * size * 0.40 * (1.0 - along);
    float spread = size * (0.30 + 0.80 * along);
    float off = vLocal.y - wobble;
    float inside = step(0.0, vLocal.x) * step(vLocal.x, vLength);
    float trail = inside * exp(-off * off / (spread * spread)) * along * along * 0.55;
    color = (HALO * (halo + trail) + CORE * core + WING * wing) * flicker;
    cover = max(max(halo, trail), max(core, wing));
  } else {
    float fade = (1.0 - t) * (1.0 - t);
    float radius = size * (0.6 + 2.8 * t);
    float ring = exp(-pow((r - radius) / (size * 0.38), 2.0)) * fade;
    float flash = exp(-r * r / (size * size * (0.6 + 2.4 * t))) * fade * 0.85;
    float motes = 0.0;
    for (int i = 0; i < 7; i++) {
      float angle = float(i) * 0.8976 + seed * 6.2832;
      vec2 m = vec2(cos(angle), sin(angle)) * radius * 1.25;
      vec2 q = p - m;
      motes += exp(-dot(q, q) / (size * size * 0.06));
    }
    motes *= fade;
    color = HALO * (ring + flash) + CORE * (motes * 0.9 + flash * 0.4);
    cover = max(ring, max(flash, motes));
  }
  float k = intensity * uAlpha * uEmissive;
  gl_FragColor = vec4(color * k, min(1.0, cover * k));
}`;
