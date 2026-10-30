/**
 * Zone-lit heat emission of heat-burst bodies (the Demon Badger), one quad per body on its current
 * sheet frame, ADD above the light map.
 *
 * The emission sheet (encoding `srgb-zone-alpha-coverage`) stores the stage of every heat surface in
 * red (k / zones) and its coverage in alpha; the texture is premultiplied, so the zone is red over
 * alpha. A body lights the zones up to its stage in its glow colour; the zone of its last step flares
 * in its flare colour. Through the meltdown, glowing fissures open over the body: cells of a hashed
 * Voronoi pattern in the body's frame (so they turn with it), kept inside the silhouette by the beauty
 * sheet's alpha at the same UV.
 *
 * Attributes per vertex: world position, sheet UV, local (frame-relative x/y in [-0.5, 0.5], seed,
 * spare), colour (glow rgb, strength), stage (lit stage, fresh stage, flare, fissures), the flare colour
 * (also the fissures' core) and the fissure colour, both in the body's faction palette.
 */
export const HEAT_EMISSION_VERTEX_SHADER = `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform mat4 uProjectionMatrix;
uniform mat3 uViewMatrix;
attribute vec2 inPosition;
attribute vec2 inUv;
attribute vec4 inLocal;
attribute vec4 inColor;
attribute vec4 inStage;
attribute vec4 inFresh;
attribute vec4 inFissure;
varying vec2 vUv;
varying vec4 vLocal;
varying vec4 vColor;
varying vec4 vStage;
varying vec3 vFresh;
varying vec3 vFissure;
void main() {
  vec3 view = uViewMatrix * vec3(inPosition, 1.0);
  gl_Position = uProjectionMatrix * vec4(view.xy, 0.0, 1.0);
  vUv = inUv; vLocal = inLocal; vColor = inColor; vStage = inStage; vFresh = inFresh.rgb; vFissure = inFissure.rgb;
}`;

export const HEAT_EMISSION_FRAGMENT_SHADER = `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform sampler2D uEmission;
uniform sampler2D uBeauty;
uniform float uZones;
uniform float uTime;
varying vec2 vUv;
varying vec4 vLocal;
varying vec4 vColor;
varying vec4 vStage;
varying vec3 vFresh;
varying vec3 vFissure;

vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}

// Distance to the nearest Voronoi border: small along the fissure lines.
float border(vec2 p, float seed) {
  vec2 n = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = hash2(n + g + seed);
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
  }
  return sqrt(d2) - sqrt(d1);
}

void main() {
  vec4 e = texture2D(uEmission, vUv);
  float coverage = e.a;
  float lit = 0.0, fresh = 0.0;
  if (coverage > 0.004) {
    float zone = uZones > 0.5 ? floor(clamp(e.r / coverage, 0.0, 1.0) * uZones + 0.5) : 0.0;
    lit = step(zone, vStage.x + 0.01);
    fresh = abs(zone - vStage.y) < 0.5 ? vStage.z : 0.0;
  }
  float strength = vColor.a;
  vec3 color = vColor.rgb * coverage * lit * strength + vFresh * coverage * fresh * strength;
  float alpha = coverage * max(lit, fresh) * strength;

  // Fissures over the body through the meltdown; only well inside the silhouette.
  float open = vStage.w;
  if (open > 0.001) {
    float body = smoothstep(0.72, 0.97, texture2D(uBeauty, vUv).a);
    vec2 p = vLocal.xy * 7.5;
    float width = mix(0.015, 0.075, open);
    float line = 1.0 - smoothstep(width * 0.45, width, border(p, vLocal.z));
    // A slow pulse along the lines, so they read as molten, not drawn.
    float pulse = 0.75 + 0.25 * sin(uTime * 0.012 + dot(p, vec2(2.3, 1.7)));
    float fissure = line * body * open * pulse;
    float core = 1.0 - smoothstep(width * 0.12, width * 0.5, border(p, vLocal.z));
    color += mix(vFissure, vFresh, core * open) * fissure * strength;
    alpha = max(alpha, fissure * strength);
  }
  gl_FragColor = vec4(color, alpha);
}`;
