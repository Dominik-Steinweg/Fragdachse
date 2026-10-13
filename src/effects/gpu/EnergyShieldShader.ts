/**
 * Energy shield membrane (player arc, energy dome, enemy frontal shield) as one instanced pass.
 * One quad per shield, centred on the arc centre and rotated to its facing; local +x is the
 * facing. Instance words:
 *   inA     [cx, cy, angle, radius]
 *   inShape [thickness, halfArc, alpha, flash]
 *   inColor [r, g, b, style]          style 0 player arc, 1 dome, 2 enemy hug
 *   inTime  [impactAge s, life s, fade 0..1, seed]
 *
 * Visual language: a curved pane of hard light, not a stroked line. A crisp rim with a
 * glassy inner falloff (the pane's thickness seen from above), a faint hexagonal lattice that
 * drifts along the arc, current nodes that run along the rim, arc ends that dissolve into
 * sparks instead of hard caps, and on a block an impact ripple that runs out from the centre
 * of the arc with a short spark spray. The enemy style keeps only rim and sheen at low alpha so
 * it hugs the prop. A faint tinted body (alpha) makes the pane read on bright day ground, the
 * emission carries it at night together with the owner's shield light.
 */
export const ENERGY_SHIELD_STYLE = { arc: 0, dome: 1, enemy: 2 } as const;
/** Spawn grow-in and release collapse in seconds; the renderer keeps released shields this long. */
export const ENERGY_SHIELD_GROW_S = 0.16;
export const ENERGY_SHIELD_RELEASE_S = 0.14;
export const ENERGY_SHIELD_IMPACT_S = 0.42;

export const ENERGY_SHIELD_VERTEX = `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform mat4 uProjectionMatrix;
uniform mat3 uViewMatrix;
attribute vec4 inA;
attribute vec2 inCorner;
attribute vec4 inShape;
attribute vec4 inColor;
attribute vec4 inTime;
varying vec2 vLocal;
varying vec4 vA;
varying vec4 vShape;
varying vec4 vColor;
varying vec4 vTime;
void main() {
  vA = inA; vShape = inShape; vColor = inColor; vTime = inTime;
  float extent = inA.w + inShape.x * 3.0 + 14.0;
  vec2 local = inCorner * extent;
  vLocal = local;
  float c = cos(inA.z), s = sin(inA.z);
  vec2 world = inA.xy + vec2(c * local.x - s * local.y, s * local.x + c * local.y);
  gl_Position = uProjectionMatrix * vec4((uViewMatrix * vec3(world, 1.0)).xy, 0.0, 1.0);
}`;

export const ENERGY_SHIELD_FRAGMENT = `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform float uTime;
uniform float uDetail;
uniform float uAlpha;
varying vec2 vLocal;
varying vec4 vA;
varying vec4 vShape;
varying vec4 vColor;
varying vec4 vTime;
const float PI = 3.14159265;
float hash(vec2 v) { return fract(sin(dot(v, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 v) {
  vec2 i = floor(v), f = fract(v); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + 1.0), f.x), f.y);
}
float gauss(float x, float w) { float k = x / w; return exp(-k * k); }
// Distance to the nearest hexagon edge (0 on an edge, ~0.5 in a cell centre) and the cell id.
vec3 hexCell(vec2 p) {
  const vec2 s = vec2(1.0, 1.7320508);
  vec4 c = floor(vec4(p, p - vec2(0.5, 1.0)) / s.xyxy) + 0.5;
  vec4 h = vec4(p - c.xy * s, p - (c.zw + 0.5) * s);
  vec4 g = dot(h.xy, h.xy) < dot(h.zw, h.zw) ? vec4(h.xy, c.xy) : vec4(h.zw, c.zw + 0.5);
  vec2 a = abs(g.xy);
  float edge = 0.5 - max(dot(a, s * 0.5), a.x);
  return vec3(edge, g.zw.x * 7.13 + g.zw.y * 3.71, 0.0);
}

void main() {
  float radius = vA.w;
  float thickness = max(vShape.x, 1.0);
  float halfArc = vShape.y;
  float baseAlpha = clamp(vShape.z, 0.0, 1.0);
  float flash = clamp(vShape.w, 0.0, 1.0);
  vec3 tint = vColor.rgb;
  float style = vColor.a;
  float impactAge = vTime.x, life = vTime.y, fade = clamp(vTime.z, 0.0, 1.0), seed = vTime.w;
  bool dome = abs(style - 1.0) < 0.5;
  bool enemy = style > 1.5;

  float r = length(vLocal);
  float ang = atan(vLocal.y, vLocal.x);
  float aa = abs(ang);
  // Grow in from the arc centre on spawn; collapse back toward it on release.
  float grow = smoothstep(0.0, ${ENERGY_SHIELD_GROW_S.toFixed(2)}, life);
  float reach = dome ? PI + 0.01 : halfArc * (0.25 + 0.75 * grow) * (0.35 + 0.65 * fade);
  float taper = dome ? 0.0 : clamp(halfArc * 0.22, 0.08, 0.35);
  float span = dome ? 1.0 : 1.0 - smoothstep(reach - taper, reach + 0.01, aa);
  float endFlare = dome ? 0.0 : gauss(aa - (reach - taper * 0.55), taper * 0.45);
  float s = ang * radius;             // arc length from the facing, px
  float d = r - radius;               // signed distance to the rim, px
  // Lens profile: the pane is thickest at its centre and thins toward the dissolving ends.
  float lens = dome ? 1.0 : mix(0.45, 1.0, cos(clamp(aa / max(reach, 0.01), 0.0, 1.0) * PI * 0.5));
  thickness *= lens;

  // Rim: crisp hot line plus a soft bloom; the inner side falls off like the pane's thickness.
  float rimW = max(0.7, thickness * 0.22);
  float rim = gauss(d, rimW);
  float bloom = gauss(d, thickness * 1.15 + 1.5) * 0.45 + gauss(max(d, 0.0), thickness * 2.6 + 3.0) * 0.18;
  float depthIn = dome ? radius * 0.45 : thickness * 1.1 + 1.5;
  float inner = (1.0 - smoothstep(0.0, depthIn, -d)) * (1.0 - smoothstep(-0.5, 1.0, d));
  inner *= dome ? (0.25 + 0.75 * smoothstep(radius * 0.25, radius, r)) : 1.0;

  // Hex lattice drifting along the arc, only inside the pane; cells breathe individually.
  float lattice = 0.0; float cellGlow = 0.0;
  if (!enemy) {
    float scale = dome ? 7.5 : max(3.6, thickness * 0.95);
    vec2 hp = vec2(s - uTime * 6.0, d - uTime * 1.5) / scale;
    vec3 hx = hexCell(hp);
    float breathe = 0.5 + 0.5 * sin(uTime * 2.3 + hash(vec2(hx.y, seed)) * 6.28);
    lattice = (1.0 - smoothstep(0.0, uDetail > 0.5 ? 0.07 : 0.12, hx.x)) * inner;
    cellGlow = breathe * breathe * smoothstep(0.62, 1.0, hash(vec2(hx.y + floor(uTime * 0.7), seed))) * inner;
  }

  // Current nodes running along the rim (two directions), and a slow sheen band.
  float runA = fract(uTime * (dome ? 0.11 : 0.42) + seed);
  float runB = fract(-uTime * (dome ? 0.07 : 0.29) + seed * 1.7);
  float sA = dome ? (runA * 2.0 - 1.0) * PI : (runA * 2.0 - 1.0) * reach;
  float sB = dome ? (runB * 2.0 - 1.0) * PI : (runB * 2.0 - 1.0) * reach;
  float nodes = (gauss((ang - sA) * radius, 5.0) + 0.7 * gauss((ang - sB) * radius, 3.5)) * gauss(d, rimW * 1.8);
  float sheen = 0.5 + 0.5 * sin(s * 0.09 - uTime * 2.4 + seed * 6.0);
  float flicker = 0.92 + 0.08 * noise(vec2(s * 0.12 + uTime * 9.0, seed * 13.0));

  // Impact: a ripple ring running out from the arc centre along the pane, a white rim kick
  // and a short spray of sparks off the face.
  float ripple = 0.0; float sparks = 0.0;
  if (impactAge < ${ENERGY_SHIELD_IMPACT_S.toFixed(2)}) {
    float it = impactAge / ${ENERGY_SHIELD_IMPACT_S.toFixed(2)};
    vec2 hit = vec2(radius, 0.0);
    float dh = length(vLocal - hit);
    float front = it * (dome ? radius * 1.6 : radius * 1.9);
    ripple = gauss(dh - front, 2.2 + it * 3.0) * (1.0 - it) * (1.0 - it) * (inner * 0.8 + rim + 0.3 * bloom);
    if (uDetail > 0.5) {
      for (int i = 0; i < 7; i++) {
        float fi = float(i);
        float a = (hash(vec2(fi, seed)) - 0.5) * 1.9;
        vec2 dir = vec2(cos(a), sin(a));
        float travel = (6.0 + hash(vec2(seed, fi)) * 16.0) * sqrt(it);
        vec2 q = vLocal - hit - dir * travel;
        float along = dot(q, dir), across = dot(q, vec2(-dir.y, dir.x));
        sparks += gauss(across, 0.7) * gauss(along, 2.4) * (1.0 - smoothstep(0.35, 1.0, it));
      }
    }
  }

  float energy;
  float body;
  if (enemy) {
    // Hug: rim, sheen and current nodes over the prop, no lattice; a block flares the whole pane.
    energy = (rim * (0.6 + 0.4 * sheen) + bloom * 0.45 + inner * 0.12 + nodes * 0.5) * baseAlpha * 2.6
      + (rim * 1.6 + bloom * 1.2 + inner * 0.9) * flash + ripple * 1.8 + sparks * 1.6;
    body = inner * baseAlpha * 0.25;
  } else {
    float a = 0.55 + 0.45 * baseAlpha;
    energy = (rim * 1.15 + bloom * 0.55 + inner * (dome ? 0.05 : 0.3) * (0.75 + 0.25 * sheen)
      + lattice * 0.30 + cellGlow * 0.35 + nodes * 0.9 + endFlare * gauss(d, thickness) * 0.9) * a * flicker
      + (rim * 1.4 + bloom * 0.6 + inner * 0.7 + lattice * 0.5) * flash + ripple * 2.0 + sparks * 1.6;
    body = inner * (dome ? 0.03 : 0.12) * a;
  }
  float mask = span * fade * (dome ? 1.0 : 1.0);
  energy *= mask; body *= mask;
  // Hot core toward white, tinted falloff; the tinted body gives the pane substance by day.
  float hot = clamp(rim * 0.55 + nodes * 0.6 + flash * rim + ripple * 0.6 + sparks, 0.0, 1.0);
  // Keep the hue: only the hottest core (rim crest, impact) runs toward white.
  vec3 light = mix(tint, vec3(1.0), 0.12 + 0.5 * hot * hot);
  float glowE = 1.0 - exp(-1.6 * energy);
  vec3 rgb = light * glowE * 1.15 + tint * body * 0.6;
  float alpha = clamp(body + glowE * 0.08, 0.0, 0.6);
  gl_FragColor = vec4(rgb * uAlpha, alpha * uAlpha);
}`;
