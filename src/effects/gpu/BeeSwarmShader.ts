/**
 * Bees of reactive hives, drawn analytically on the GPU without a texture. A bee is ~3.6 px long
 * (about 10 cm at the arena scale): the shapes are signed distances with pixel-wide antialiasing,
 * so they stay soft at 1x and gain detail when the camera zooms in.
 *
 * Instance layout (16 floats per vertex):
 *   inGeom  [x, y, cornerX, cornerY]   bee position in world px, quad corner -1..1
 *   inBee   [heading, wing, size, alpha] heading in rad, wing phase in rad, body length in px
 *   inColor [r, g, b, hostile]          body gold 0..1, hostile 0/1 (violet rim)
 *   inParam [kind, blur, altitude, seed] kind 0 bee, 1 veil; blur 0..1 from speed; altitude in px
 *
 * Pass 0 shadow (ground, material): one soft dot per bee, offset by its altitude.
 * Pass 1 bees   (low flight band, material, lit like the ground): veils first, then bees with
 *               striped body, dark head, shimmering wing blur, glint and a short motion streak.
 * Pass 2 glow   (above the light map, emissive): honey light streaming out of a struck hive in
 *               flickering rays through the straw, strongest at the entrance (kind 2 only).
 */
export const BEE_KIND = { bee: 0, veil: 1, glow: 2 } as const;

export const BEE_SWARM_VERTEX = `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform mat4 uProjectionMatrix;
uniform mat3 uViewMatrix;
uniform float uPass;
attribute vec4 inGeom;
attribute vec4 inBee;
attribute vec4 inColor;
attribute vec4 inParam;
varying vec2 vLocal;
varying vec4 vBee;
varying vec4 vColor;
varying vec4 vParam;
void main() {
  float kind = inParam.x;
  vec2 centre = inGeom.xy;
  vec2 local;
  // The glow kind draws only in the glow pass, and the glow pass draws nothing else.
  if ((uPass > 1.5) != (kind > 1.5)) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
  if (uPass > 1.5) {
    local = inGeom.zw * inBee.z;
    vLocal = local;
  } else if (uPass < 0.5) {
    // Shadows: veils cast none; the dot falls away from the sun with the flight altitude.
    if (kind > 0.5) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
    float extent = inBee.z * 1.1;
    local = inGeom.zw * extent;
    centre += vec2(0.45, 0.8) * inParam.z;
    vLocal = local;
  } else if (kind > 0.5) {
    local = inGeom.zw * inBee.z;
    vLocal = local;
  } else {
    // Bee quads are aligned with the heading; the streak extends them backwards with speed.
    float extent = inBee.z * (1.25 + inParam.y * 1.3);
    vec2 corner = inGeom.zw * vec2(extent, inBee.z * 1.05);
    corner.x -= inParam.y * inBee.z * 0.9 * (inGeom.z < 0.0 ? 1.0 : 0.0);
    vLocal = corner;
    float c = cos(inBee.x), s = sin(inBee.x);
    local = vec2(corner.x * c - corner.y * s, corner.x * s + corner.y * c);
  }
  vec3 view = uViewMatrix * vec3(centre + local, 1.0);
  gl_Position = uProjectionMatrix * vec4(view.xy, 0.0, 1.0);
  vBee = inBee; vColor = inColor; vParam = inParam;
}`;

export const BEE_SWARM_FRAGMENT = `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform float uPass;
uniform float uPixel;
uniform float uTime;
uniform float uShadow;
uniform float uAlpha;
uniform float uEmissive;
varying vec2 vLocal;
varying vec4 vBee;
varying vec4 vColor;
varying vec4 vParam;

// Coverage of a signed distance in bee units; aa is one screen pixel in the same units.
float cover(float d, float aa) { return 1.0 - smoothstep(-0.5 * aa, 0.5 * aa, d); }
float ellipse(vec2 p, vec2 c, vec2 r) { vec2 q = (p - c) / r; return (length(q) - 1.0) * min(r.x, r.y); }
vec2 rotate(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x + s * p.y, -s * p.x + c * p.y); }
vec4 over(vec4 dst, vec3 rgb, float a) { return vec4(rgb * a + dst.rgb * (1.0 - a), a + dst.a * (1.0 - a)); }

void main() {
  float alpha = vBee.w * uAlpha;
  if (uPass > 1.5) {
    // Light streaming out of the skep: a warm core, flickering rays through the straw gaps and a
    // brighter beam out of the entrance (heading). Additive (premultiplied, alpha 0).
    float r = length(vLocal) / vBee.z;
    if (r >= 1.0) discard;
    float angle = atan(vLocal.y, vLocal.x);
    float t = uTime;
    float rays = 0.0;
    for (int k = 0; k < 3; k++) {
      float n = 9.0 + float(k) * 4.0;
      float phase = vParam.w + float(k) * 1.7 + t * (0.35 + 0.15 * float(k));
      rays += pow(max(0.0, sin(angle * n + phase + 0.6 * sin(t * 1.3 + float(k)))), 6.0) / 3.0;
    }
    float flicker = 0.85 + 0.15 * sin(t * 7.3 + vParam.w) * sin(t * 3.1);
    float entrance = pow(max(0.0, cos(angle - vBee.x)), 10.0);
    // The skep (radius ~0.25) glows softly through the straw; the rays start at its edge.
    float body = smoothstep(0.3, 0.08, r);
    float out_ = smoothstep(0.14, 0.3, r) * (1.0 - smoothstep(0.3, 1.0, r));
    float reach = out_ * (0.4 * rays + 0.85 * entrance) + 0.3 * body;
    float a = reach * alpha * flicker * uEmissive;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vColor.rgb * a, 0.0);
    return;
  }
  if (uPass < 0.5) {
    float r = vBee.z * 0.42;
    float a = exp(-dot(vLocal, vLocal) / (r * r)) * 0.34 * alpha * uShadow;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vec3(0.02, 0.028, 0.043) * a, a);
    return;
  }
  if (vParam.x > 0.5) {
    // Veil: the warm shimmer of many wings, so a dense swarm reads as one cloud from afar.
    float d = length(vLocal) / vBee.z;
    float a = exp(-d * d * 2.4) * 0.16 * alpha;
    if (a < 0.003) discard;
    vec3 tint = mix(vec3(0.62, 0.5, 0.2), vec3(0.5, 0.32, 0.62), vColor.a);
    gl_FragColor = vec4(tint * a, a);
    return;
  }
  // Bee units: body length 3.6 from tail (-1.8) to head (+1.8); +x is the heading.
  float unit = 3.6 / vBee.z;
  vec2 p = vLocal * unit;
  float aa = uPixel * unit;
  float blur = vParam.y;
  vec4 col = vec4(0.0);

  // Motion streak behind the body: the eye reads speed before shape.
  float streak = ellipse(p, vec2(-1.3 - 1.6 * blur, 0.0), vec2(1.2 + 1.7 * blur, 0.42));
  col = over(col, mix(vColor.rgb, vec3(0.25, 0.2, 0.1), 0.5), cover(streak, aa) * 0.28 * blur);

  // Wing blur: two pale ovals sweeping with the wing phase; time-averaged, so no strobing at 60 Hz.
  float sweep = 0.42 + 0.16 * sin(vBee.y);
  float shimmer = 0.24 + 0.1 * sin(uTime * 31.0 + vParam.w * 17.0);
  for (int side = 0; side < 2; side++) {
    float sgn = side == 0 ? 1.0 : -1.0;
    vec2 q = rotate(p - vec2(0.35, 0.55 * sgn), -sgn * sweep);
    float wing = ellipse(q, vec2(-0.15, 0.62 * sgn), vec2(1.05, 0.62));
    col = over(col, vec3(0.86, 0.9, 0.95), cover(wing, aa * 1.6) * shimmer);
  }

  // Abdomen with dark bands, thorax, head.
  float abdomen = ellipse(p, vec2(-0.55, 0.0), vec2(1.25, 0.8));
  // Narrow dark bands on bright gold: at 3-4 px a bee must still read as a bright speck.
  float bands = smoothstep(0.58, 0.74, fract((p.x + 1.95) * 1.15));
  vec3 gold = vColor.rgb;
  vec3 dark = vec3(0.1, 0.07, 0.035);
  vec3 abdomenColor = mix(gold, dark, bands * 0.78);
  float thorax = ellipse(p, vec2(0.62, 0.0), vec2(0.62, 0.6));
  float head = ellipse(p, vec2(1.32, 0.0), vec2(0.42, 0.42));
  // Soft top light: brighter crown, darker flanks.
  float shade = 0.82 + 0.18 * clamp(1.0 - abs(p.y) * 0.9, 0.0, 1.0);
  col = over(col, abdomenColor * shade, cover(abdomen, aa));
  col = over(col, mix(gold, dark, 0.55) * shade, cover(thorax, aa));
  col = over(col, dark, cover(head, aa));
  float glint = ellipse(p, vec2(0.75, -0.22), vec2(0.22, 0.16));
  col = over(col, vec3(1.0, 0.97, 0.86), cover(glint, aa) * 0.55);
  if (vColor.a > 0.5) {
    // Hostile swarm: a faint violet rim around the body (violet means danger).
    float rim = min(abdomen, thorax);
    float edge = cover(rim - 0.35, aa) * (1.0 - cover(rim, aa));
    col = over(col, vec3(0.66, 0.36, 0.95), edge * 0.7);
  }
  col *= alpha;
  if (col.a < 0.003) discard;
  gl_FragColor = col;
}`;
