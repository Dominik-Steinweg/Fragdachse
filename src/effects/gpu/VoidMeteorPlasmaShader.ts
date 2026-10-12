/** One overhead plasma mass. +X is travel; -X contains its analytic wake.
 * Local lengths are multiples of the supplied core radius. All animation is a pure
 * function of intro age and seed, including the torn silhouette seen by late observers. */
export const VOID_METEOR_PLASMA_VERTEX = /* glsl */ `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform mat4 uProjectionMatrix;
uniform mat3 uViewMatrix;
uniform vec4 uGeometry;
attribute vec2 inCorner;
varying vec2 vLocal;
void main() {
  vLocal = vec2(mix(-4.8, 1.55, inCorner.x * 0.5 + 0.5), inCorner.y * 1.65);
  float c = cos(uGeometry.w), s = sin(uGeometry.w);
  vec2 offset = vec2(c * vLocal.x - s * vLocal.y, s * vLocal.x + c * vLocal.y);
  vec2 world = uGeometry.xy + offset * uGeometry.z;
  vec3 view = uViewMatrix * vec3(world, 1.0);
  gl_Position = uProjectionMatrix * vec4(view.xy, 0.0, 1.0);
}`;

export const VOID_METEOR_PLASMA_FRAGMENT = /* glsl */ `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform vec4 uPlasma; // age seconds, seed, compression, alpha
varying vec2 vLocal;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float value = 0.0, weight = 0.53;
  for (int i = 0; i < 4; i++) {
    value += noise(p) * weight;
    p = mat2(1.78, -0.93, 0.93, 1.78) * p + vec2(7.3, 3.1);
    weight *= 0.48;
  }
  return value;
}
vec3 heatColor(float heat) {
  vec3 color = mix(vec3(0.07, 0.008, 0.17), vec3(0.35, 0.035, 0.73), smoothstep(0.0, 0.48, heat));
  color = mix(color, vec3(0.88, 0.20, 0.83), smoothstep(0.38, 0.85, heat));
  return mix(color, vec3(1.0, 0.90, 1.0), smoothstep(0.79, 1.20, heat));
}

void main() {
  vec2 p = vLocal;
  float age = uPlasma.x, seed = uPlasma.y, compression = uPlasma.z;
  vec2 drift = vec2(age * 0.48, seed * 0.173);
  // Slow domain-warped billows carry broad pools of molten heat, not threshold ridges.
  float coarse = fbm(p * 1.9 + drift);
  float crossFlow = fbm(p.yx * 2.1 + vec2(-age * 0.35, seed * 0.319));
  vec2 warped = p + vec2(coarse - 0.48, crossFlow - 0.48) * 0.48;
  float folding = fbm(warped * 3.1 + vec2(age * 0.65, seed * 0.071));
  float billow = smoothstep(0.22, 0.77, folding);
  float radius = length(vec2(warped.x, warped.y * 1.04));
  float unevenEdge = 0.88 + (coarse - 0.45) * 0.26;
  float body = 1.0 - smoothstep(unevenEdge - 0.23, unevenEdge + 0.15, radius);
  vec2 corePoint = (warped - vec2(0.10, 0.0)) * vec2(1.0, 1.08);
  float center = exp(-dot(corePoint, corePoint) * 4.2);
  float heat = 0.20 + 0.44 * billow + center * (0.89 + 0.18 * compression);
  // Broad, cooler crust pools remain buried in the outer molten mantle.
  float crust = smoothstep(0.35, 0.75, coarse) * (1.0 - center) * 0.15;
  heat -= crust;
  vec3 emission = heatColor(heat) * body * (0.43 + heat * 0.32) * (0.80 + billow * 0.30);

  // A volume of compressed gas on the front, with a soft inside and outside edge.
  float frontX = 0.59 - p.y * p.y * 0.38;
  float frontDist = p.x - frontX + (folding - 0.48) * 0.15;
  float bowWidth = 0.25 + compression * 0.06;
  float bow = exp(-frontDist * frontDist / (bowWidth * bowWidth));
  bow *= smoothstep(-0.08, 0.42, p.x) * exp(-p.y * p.y * 3.0);
  bow *= 0.50 + 0.50 * billow;
  emission += vec3(0.84, 0.55, 1.0) * bow * (0.25 + compression * 0.25);

  // Analytic rear ablation exists independently of a particle history. Broken channels and
  // asymmetric wandering widths prevent the wake from becoming a solid cone or ribbon.
  float back = max(0.0, -p.x);
  float tailT = clamp(back / 3.5, 0.0, 1.0);
  float wander = sin(back * 2.3 - age * 1.0 + seed) * (0.055 + tailT * 0.18);
  float tailWidth = mix(0.62, 0.23, tailT) + (coarse - 0.42) * 0.25;
  float side = (p.y - wander) / max(0.07, tailWidth);
  float crossSection = exp(-side * side * 1.45);
  float channels = fbm(vec2(p.x * 1.35 + age * 1.2, p.y * 5.4 + seed * 0.231));
  float shreds = smoothstep(0.23 + tailT * 0.11, 0.72, channels + folding * 0.23);
  float tail = crossSection * shreds * smoothstep(0.20, 0.92, back)
    * (1.0 - smoothstep(2.35, 3.50, back));
  // Avoid fully populated old trails at the first flight instant.
  tail *= smoothstep(back * 0.16, back * 0.16 + 0.16, max(0.0, age));
  float tailHeat = (0.80 - tailT * 0.66) * (0.72 + channels * 0.56);
  emission += heatColor(tailHeat) * tail * (0.70 - tailT * 0.48);

  // Low, irregular corona stays coloured instead of whitening the full silhouette.
  float fringe = exp(-radius * radius * 1.65) * (0.28 + coarse * 0.18);
  emission += vec3(0.31, 0.025, 0.68) * fringe;
  float edgeFade = smoothstep(-4.8, -4.45, p.x) * (1.0 - smoothstep(1.25, 1.55, p.x))
    * (1.0 - smoothstep(1.30, 1.65, abs(p.y)));
  // PMA material plus emission: the body has density in daylight and the corona adds light.
  // Outside that body alpha remains zero, preserving destination alpha for later ADD passes.
  float opacity = body * 0.55;
  vec3 material = vec3(0.055, 0.006, 0.10) * opacity;
  gl_FragColor = vec4((material + emission) * edgeFade * uPlasma.w, opacity * edgeFade * uPlasma.w);
}`;
