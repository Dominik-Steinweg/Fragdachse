/**
 * One SDF program for every bar presentation: HUD troughs and fills, world health bars and the
 * living field window. Each quad carries its own rounded-rectangle shape in local units; the
 * fragment shader derives coverage analytically, so corners and fill edges stay antialiased at
 * any zoom without tiles, crops or masks.
 *
 * Eight varyings at most (the WebGL 1 minimum). Colours travel as normalized byte attributes.
 * Kinds (`vShape.w`):
 *   0 trough  – vertical backing gradient c0→c1, inner top shadow, border ring c2, outline c3
 *   1 fill    – dark/mid/light gradient c0/c1/c2 over the full width, trail c3, gloss, edge
 *   2 world   – flat fill c0, trail c1, backing c2, border c3 and a dark outline in one quad
 *   3 living  – additive window of the shared living field, tinted c0→c1 over the fill
 */
export const BAR_SDF_VERTEX = /* glsl */ `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform mat4 uProjectionMatrix;
attribute vec2 inPosition;
attribute vec2 inLocal;
attribute vec4 inSize;
attribute vec4 inA;
attribute vec4 inB;
attribute vec2 inMeta;
attribute vec4 inColor0;
attribute vec4 inColor1;
attribute vec4 inColor2;
attribute vec4 inColor3;
varying vec4 vRect;
varying vec4 vShape;
varying vec4 vA;
varying vec4 vB;
varying vec4 vC0;
varying vec4 vC1;
varying vec4 vC2;
varying vec4 vC3;
void main() {
  gl_Position = uProjectionMatrix * vec4(inPosition, 1.0, 1.0);
  vRect = vec4(inLocal, inSize.xy);
  vShape = vec4(inSize.zw, inMeta);
  vA = inA; vB = inB;
  vC0 = inColor0; vC1 = inColor1; vC2 = inColor2; vC3 = inColor3;
}`;

export const BAR_SDF_FRAGMENT = /* glsl */ `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform sampler2D uField;
uniform vec2 uFieldSize;
varying vec4 vRect;
varying vec4 vShape;
varying vec4 vA;
varying vec4 vB;
varying vec4 vC0;
varying vec4 vC1;
varying vec4 vC2;
varying vec4 vC3;

float sdRound(vec2 p, vec2 size, float r) {
  vec2 h = size * 0.5;
  vec2 q = abs(p - h) - h + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
float cover(float d, float aa) { return clamp(0.5 - d / aa, 0.0, 1.0); }
float span(float x, float a, float b, float aa) {
  return clamp((x - a) / aa + 0.5, 0.0, 1.0) * clamp((b - x) / aa + 0.5, 0.0, 1.0);
}
float clipSpan(float x, float a, float b, float extent, float aa) {
  float lo = a <= aa ? 1.0 : clamp((x - a) / aa + 0.5, 0.0, 1.0);
  float hi = b >= extent - aa ? 1.0 : clamp((b - x) / aa + 0.5, 0.0, 1.0);
  return lo * hi;
}
void over(inout vec4 dst, vec3 color, float alpha) {
  alpha = clamp(alpha, 0.0, 1.0);
  dst = vec4(color * alpha, alpha) + dst * (1.0 - alpha);
}
// Value shading shared by HUD and world fills: a soft lit upper third, a shaded lower edge.
vec3 shadeFill(vec3 c, float vy, float gloss, float shade) {
  c += vec3(1.0, 0.97, 0.9) * gloss * (1.0 - smoothstep(0.0, 0.48, vy));
  return c * (1.0 - shade * smoothstep(0.52, 1.0, vy));
}

void main() {
  vec2 p = vRect.xy;
  vec2 size = vRect.zw;
  float r = min(vShape.x, min(size.x, size.y) * 0.5);
  float aa = max(vShape.y, 1e-3);
  float alpha = vShape.z;
  float kind = vShape.w;
  float d = sdRound(p, size, r);
  vec4 o = vec4(0.0);

  if (kind < 0.5) {
    float inside = cover(d, aa);
    over(o, vC3.rgb, vC3.a * cover(d - vA.y, aa) * (1.0 - inside));
    vec3 back = mix(vC0.rgb, vC1.rgb, clamp(p.y / size.y, 0.0, 1.0));
    float topShadow = 1.0 - smoothstep(0.0, max(vA.z, aa), p.y);
    back *= 1.0 - 0.45 * topShadow * step(1e-3, vA.z);
    over(o, back, vC0.a * inside);
    over(o, vC2.rgb, vC2.a * inside * (1.0 - cover(d + vA.x, aa)));
    gl_FragColor = o * alpha;
    return;
  }

  if (kind > 2.5) {
    // Fill edges lying on the clip contour leave that edge to the rounded clip alone; a second
    // ramp there would halve the boundary coverage.
    float mask = cover(d, aa) * clipSpan(p.x, vA.x, vA.y, size.x, aa) * clipSpan(p.y, vA.z, vA.w, size.y, aa);
    vec2 q = p - vA.xz;
    vec2 texel = vB.xy + q * vB.z;
    vec2 uv = vec2(fract(texel.x / uFieldSize.x), clamp(texel.y / uFieldSize.y, 0.0, 1.0));
    float field = texture2D(uField, uv).a;
    float t = clamp(q.x / max(vA.y - vA.x, 1.0), 0.0, 1.0);
    float a = field * alpha * mask;
    gl_FragColor = vec4(mix(vC0.rgb, vC1.rgb, t) * a, a);
    return;
  }

  bool world = kind > 1.5;
  float inset = world ? 0.0 : vA.w;
  float fillStart = world ? 0.0 : vA.x;
  float fillEnd = world ? vA.x : vA.y;
  float trailEnd = world ? vA.y : vA.z;
  float gloss = vB.x;
  float edge = vB.y;
  float flash = world ? 0.0 : vB.z;
  float shade = world ? vB.z : vB.w;

  if (world) {
    float inside = cover(d, aa);
    // A narrow dark rim separates the bar from any ground: meadow, gravel, fog or void.
    over(o, vec3(0.035, 0.026, 0.02), vB.w * cover(d - vA.w, aa) * (1.0 - inside));
    vec3 back = vC2.rgb * (1.0 - 0.32 * clamp(p.y / size.y, 0.0, 1.0));
    over(o, back, vC2.a * inside);
  }

  float shape = cover(d + inset, aa);
  float vy = clamp((p.y - inset) / max(size.y - 2.0 * inset, 1e-3), 0.0, 1.0);
  float fill = span(p.x, fillStart, fillEnd, aa) * shape;
  float trail = trailEnd > fillEnd + 1e-3 ? span(p.x, fillEnd, trailEnd, aa) * shape : 0.0;

  vec3 fillColor;
  vec3 trailColor;
  float trailAlpha;
  vec3 light;
  if (world) {
    fillColor = vC0.rgb;
    light = vC0.rgb;
    trailColor = vC1.rgb;
    trailAlpha = vC1.a;
  } else {
    float t = clamp(p.x / size.x, 0.0, 1.0);
    fillColor = t < 0.5 ? mix(vC0.rgb, vC1.rgb, t * 2.0) : mix(vC1.rgb, vC2.rgb, t * 2.0 - 1.0);
    light = vC2.rgb;
    trailColor = vC3.rgb;
    trailAlpha = vC3.a;
  }
  fillColor = shadeFill(fillColor, vy, gloss, shade);
  // The leading edge reads the level: a narrow lifted band right behind the fill end.
  float lead = edge * (1.0 - smoothstep(0.0, 1.6 * aa + 0.08 * size.y, fillEnd - p.x))
    * step(fillStart + 2.0 * aa, fillEnd);
  fillColor = mix(fillColor, mix(light, vec3(1.0), 0.5), clamp(lead, 0.0, 1.0));
  fillColor = mix(fillColor, vec3(1.0), clamp(flash, 0.0, 1.0));
  trailColor = shadeFill(trailColor, vy, gloss * 0.5, shade * 0.6);

  vec4 content = vec4(0.0);
  over(content, trailColor, trailAlpha * trail);
  over(content, fillColor, fill);
  content *= alpha;
  o = content + o * (1.0 - content.a);

  if (world) {
    float inside = cover(d, aa);
    over(o, vC3.rgb, vC3.a * inside * (1.0 - cover(d + vA.z, aa)));
  }
  gl_FragColor = o;
}`;
