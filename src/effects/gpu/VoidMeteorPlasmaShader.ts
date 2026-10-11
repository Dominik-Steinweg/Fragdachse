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
  vec3 color = mix(vec3(0.10, 0.006, 0.28), vec3(0.46, 0.075, 0.96), smoothstep(0.0, 0.42, heat));
  color = mix(color, vec3(0.83, 0.36, 1.0), smoothstep(0.35, 0.78, heat));
  return mix(color, vec3(1.0, 0.93, 1.0), smoothstep(0.76, 1.18, heat));
}

void main() {
  vec2 p = vLocal;
  float age = uPlasma.x, seed = uPlasma.y, compression = uPlasma.z;
  vec2 drift = vec2(age * 2.1, seed * 0.173);
  // Unequal, counter-rolling turbulence breaks both the contour and its interior.
  float coarse = fbm(p * 2.6 + drift);
  float crossFlow = fbm(p.yx * 3.4 + vec2(-age * 1.4, seed * 0.319));
  vec2 warped = p + vec2(coarse - 0.48, crossFlow - 0.48) * 0.38;
  float folding = fbm(warped * 6.5 + vec2(age * 3.3, seed * 0.071));
  float radius = length(vec2(warped.x * 1.04, warped.y * 1.22));
  float unevenEdge = 0.80 + (coarse - 0.45) * 0.32 + (folding - 0.45) * 0.13;
  float body = 1.0 - smoothstep(unevenEdge - 0.25, unevenEdge + 0.13, radius);
  // Bright folds alternate with cooler, deep violet cavities; there is no flat filled disc.
  float ridge = pow(max(0.0, 1.0 - abs(folding - 0.52) * 3.2), 3.2);
  float heat = body * (0.25 + 0.55 * coarse + 0.52 * ridge);
  float center = exp(-dot(warped * vec2(1.2, 1.65), warped * vec2(1.2, 1.65)) * 4.4);
  heat += center * (0.28 + 0.24 * compression);
  vec3 emission = heatColor(heat) * body * (0.45 + heat * 0.55);

  // Leading pressure front occupies only the forward sector, never a complete glowing ring.
  float frontX = 0.78 - p.y * p.y * 0.66;
  float frontDist = p.x - frontX + (folding - 0.48) * 0.09;
  float bowWidth = 0.045 + compression * 0.035;
  float bow = exp(-frontDist * frontDist / (bowWidth * bowWidth));
  bow *= smoothstep(0.03, 0.35, p.x) * (1.0 - smoothstep(0.44, 0.82, abs(p.y)));
  bow *= 0.45 + 0.55 * coarse;
  emission += mix(vec3(0.66, 0.18, 1.0), vec3(1.0, 0.90, 1.0), 0.55 + compression * 0.4)
    * bow * (0.70 + compression * 0.85);

  // Analytic rear ablation exists independently of a particle history. Broken channels and
  // asymmetric wandering widths prevent the wake from becoming a solid cone or ribbon.
  float back = max(0.0, -p.x);
  float tailT = clamp(back / 4.5, 0.0, 1.0);
  float wander = sin(back * 3.0 - age * 3.5 + seed) * (0.055 + tailT * 0.18);
  float tailWidth = mix(0.42, 0.19, tailT) + (coarse - 0.42) * 0.25;
  float side = (p.y - wander) / max(0.07, tailWidth);
  float crossSection = exp(-side * side * 1.45);
  float channels = fbm(vec2(p.x * 1.35 + age * 3.4, p.y * 8.4 + seed * 0.231));
  float shreds = smoothstep(0.23 + tailT * 0.11, 0.72, channels + folding * 0.23);
  float tail = crossSection * shreds * smoothstep(0.20, 0.92, back)
    * (1.0 - smoothstep(3.15, 4.50, back));
  // Avoid fully populated old trails at the first flight instant.
  tail *= smoothstep(back * 0.16, back * 0.16 + 0.16, max(0.0, age));
  float tailHeat = (0.87 - tailT * 0.58) * (0.72 + channels * 0.56);
  emission += heatColor(tailHeat) * tail * (0.88 - tailT * 0.36);

  // Low, irregular corona stays coloured instead of whitening the full silhouette.
  float fringe = exp(-radius * radius * 1.9) * (0.20 + coarse * 0.14);
  emission += vec3(0.31, 0.025, 0.68) * fringe;
  float edgeFade = smoothstep(-4.8, -4.45, p.x) * (1.0 - smoothstep(1.25, 1.55, p.x))
    * (1.0 - smoothstep(1.30, 1.65, abs(p.y)));
  // PMA material plus emission: the body has density in daylight and the corona adds light.
  // Outside that body alpha remains zero, preserving destination alpha for later ADD passes.
  float opacity = body * 0.55;
  vec3 material = vec3(0.055, 0.006, 0.10) * opacity;
  gl_FragColor = vec4((material + emission) * edgeFade * uPlasma.w, opacity * edgeFade * uPlasma.w);
}`;
