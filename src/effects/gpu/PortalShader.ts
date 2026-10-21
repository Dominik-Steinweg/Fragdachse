/**
 * Shared portal shaders. One aperture program serves two passes (uPass 0: ground material with the
 * destination view; uPass 1: emissive rim, glow, direction wake, meters and event rings). Particles
 * are a separate instanced program whose motion is analytic in the vertex shader, so the CPU writes
 * each mote once per frame and never simulates it.
 */

const COMMON = `
const float TAU = 6.2831853;
float hash11(float n) { return fract(sin(n * 91.3458) * 47453.5453); }
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
vec3 unpackRgb(float c) {
  float r = floor(c / 65536.0);
  float g = floor((c - r * 65536.0) / 256.0);
  return vec3(r, g, c - r * 65536.0 - g * 256.0) / 255.0;
}
`;

export const PORTAL_APERTURE_VERTEX = `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform mat4 uProjectionMatrix;
uniform mat3 uViewMatrix;
attribute vec4 inGeom, inShape, inLink, inState, inColor, inForm;
varying vec4 vGeo, vShape, vLink, vState, vForm;
varying vec3 vRim, vHot;
${COMMON}
void main() {
  vec3 p = uViewMatrix * vec3(inGeom.xy, 1.0);
  gl_Position = uProjectionMatrix * vec4(p.xy, 0.0, 1.0);
  vGeo = vec4(inGeom.zw, inGeom.xy - inGeom.zw);
  vShape = inShape; vLink = inLink; vState = inState; vForm = inForm;
  vRim = unpackRgb(inColor.x); vHot = unpackRgb(inColor.y);
}`;

export const PORTAL_APERTURE_FRAGMENT = `
#pragma phaserTemplate(shaderName)
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform float uTime, uPixel, uPass, uNight, uDetail, uAlpha, uHasTerrain;
uniform vec4 uTerrainRect;
uniform sampler2D uTerrain;
varying vec4 vGeo, vShape, vLink, vState, vForm;
varying vec3 vRim, vHot;
${COMMON}
// Seamless, rotating flow along a ring: noise sampled on a circle never shows a seam.
float ringFlow(float a, float speed, float scale, float seed) {
  vec2 cs = vec2(cos(a - uTime * speed), sin(a - uTime * speed));
  return vnoise(cs * scale + seed);
}
vec4 aperture(vec2 p) {
  float R = vShape.x, open = vShape.y, k = vShape.z, seed = vShape.w;
  vec2 toPartner = vLink.xy; float ground = vLink.z;
  float meter = vState.x, charge = vState.y, flash = vState.z;
  // Muzzle portals are ellipses across their firing line; round portals use angle 0, aspect 1.
  float c = cos(vForm.x), s = sin(vForm.x);
  vec2 q = vec2(c * p.x + s * p.y, -s * p.x + c * p.y);
  vec2 qe = vec2(q.x * vForm.y, q.y);
  float r = length(qe), a = atan(qe.y, qe.x), wa = atan(p.y, p.x);
  float charging = step(0.0, charge);
  float Ro = R * max(open, 0.001);
  float pulse = vForm.z > 0.5 ? 0.72 + 0.28 * sin(uTime * 2.6 + seed * 9.0) : 1.0;
  float strength = k * pulse;
  float dlen = length(toPartner);
  vec2 dir = dlen > 1.0 ? toPartner / dlen : vec2(0.0);
  float lobe = dlen > 1.0 ? pow(max(0.0, dot(normalize(p + 1e-4), dir)), 4.0) : 0.0;
  float fade = smoothstep(0.0, 0.18, open) * clamp(strength * 1.4, 0.0, 1.0);

  if (uPass < 0.5) {
    // Ground material: a soft seat darkens the ground around the aperture; the throat is opaque.
    float inside = 1.0 - smoothstep(Ro - uPixel, Ro + uPixel, r);
    // A narrow dark lip outside the rim sinks the aperture into the ground.
    float seat = (1.0 - smoothstep(Ro, Ro + max(4.0, R * 0.38), r)) * 0.42;
    float rn = clamp(r / max(Ro, 1.0), 0.0, 1.0);
    float swirl = vnoise(vec2(cos(a - uTime * 0.7), sin(a - uTime * 0.7)) * 2.2 + rn * 2.6 + seed * 5.0);
    vec3 deep = mix(vec3(0.008, 0.01, 0.03), vRim * 0.2, (1.0 - rn) * 0.5 * swirl + rn * rn * 0.25);
    vec3 view = deep;
    float g = ground * (1.0 - charging) * uHasTerrain;
    if (g > 0.0 && dlen > 1.0) {
      // Looking through: the destination keeps world orientation; the rim compresses the far side
      // like a lens and a slow ripple shows the surface is not solid ground.
      float lens = 1.1 + 0.7 * rn * rn;
      float sa = 0.22 * (1.0 - rn) * sin(uTime * 0.55 + seed * 6.3);
      vec2 o = p * lens;
      o = vec2(cos(sa) * o.x - sin(sa) * o.y, sin(sa) * o.x + cos(sa) * o.y);
      o += normalize(p + 1e-4) * sin(rn * 10.0 - uTime * 2.6) * 1.1 * rn;
      vec2 w = vGeo.zw + toPartner + o;
      vec3 dest = texture2D(uTerrain, (w - uTerrainRect.xy) / uTerrainRect.zw).rgb;
      // The snapshot is unlit ground albedo; lift it toward the sunlit world it shows.
      dest = pow(dest, vec3(0.85)) * 1.4;
      dest = mix(dest, dest * (0.7 + vRim * 0.5), 0.22);
      // The throat's lip stays dark, so the far side reads as seen through a hole.
      float lip = smoothstep(0.58, 0.93, rn);
      view = mix(deep, dest, g * (1.0 - lip));
    }
    // A forming aperture is a thin veil that thickens with the charge.
    float body = charging > 0.5 ? inside * (0.25 + 0.6 * charge * charge) : inside;
    float alpha = body + seat * (1.0 - body) * (charging > 0.5 ? charge : 1.0);
    return vec4(view * body, alpha) * fade;
  }

  // Emissive: hot rim line, glowing body with flowing energy, light spilling into the throat.
  float rimW = max(0.9, R * 0.04);
  float wobble = (ringFlow(a, 0.9, 4.0, seed * 5.0) - 0.5) * rimW * 0.9 * uDetail;
  float dr = r - Ro - wobble;
  float flow = ringFlow(a, 1.15, 3.0, seed * 7.0) * 0.62 + ringFlow(a, -0.8, 6.5, seed * 3.0) * 0.38 * uDetail;
  float energy = 0.55 + 0.9 * flow;
  // Three bright sparks chase each other around the rim.
  float chase = pow(max(0.0, sin(a * 3.0 - uTime * 3.4 + seed * 2.0)), 18.0) * 1.3 * uDetail;
  // Charging draws the rim clockwise with a soft, bright head; the rest of the ring is a faint promise.
  float around = fract((wa + 1.5707963) / TAU);
  float drawn = charging > 0.5
    ? mix(0.12, 1.0, smoothstep(charge + 0.012, charge - 0.03, around) * smoothstep(0.0, 0.025, around)) : 1.0;
  float head = charging > 0.5 ? exp(-pow((around - charge) * TAU * Ro / 3.0, 2.0)) : 0.0;
  float flicker = charging > 0.5 ? 0.65 + 0.35 * step(0.35, hash11(floor(uTime * 16.0) + seed * 13.0)) : 1.0;
  float core = exp(-dr * dr / (rimW * rimW * 0.35)) * drawn;
  float glow = exp(-dr * dr / (rimW * rimW * 5.0)) * drawn;
  float outer = exp(-pow((dr - rimW * 2.7) / (rimW * 0.45), 2.0)) * 0.32 * drawn * (0.5 + 0.5 * flow);
  float spill = dr < 0.0 ? exp(dr / max(Ro * 0.12, 1.0)) * 0.18 : 0.0;
  float halo = dr > 0.0 ? exp(-dr / (R * 0.4)) * (0.08 + 0.25 * uNight) : 0.0;
  float dirBoost = 1.0 + 0.7 * lobe;
  vec3 rgb = vHot * exp(-dr * dr / (rimW * rimW * 2.0)) * head * 1.6
    + vHot * core * (1.05 * energy + chase) * dirBoost
    + vRim * (glow * 0.75 * energy + outer + spill * (0.6 + 0.4 * energy) + halo) * dirBoost
    + vHot * glow * chase * 0.45;
  if (r < Ro && uDetail > 0.5) {
    // Thin spiral filaments lead the eye into the throat.
    float rn = r / max(Ro, 1.0);
    float arms = sin(a * 3.0 + log(max(rn, 0.04)) * 4.5 + uTime * 2.2 + seed * TAU);
    // Wisps rather than a drawn pinwheel: noise breaks each arm into drifting strands.
    float wisp = vnoise(vec2(a * 2.0 + uTime * 0.8, rn * 6.0 - uTime * 1.6) + seed);
    rgb += vRim * smoothstep(0.8, 1.0, arms) * smoothstep(0.35, 0.85, wisp) * rn * (1.0 - rn) * 1.5 * (1.0 - charging);
  }
  if (meter >= 0.0) {
    // Remaining lifetime, clockwise from the top, just outside the rim.
    float on = step(fract((wa + 1.5707963) / TAU), meter);
    float ringR = Ro + 4.0 + R * 0.08;
    float ring = exp(-pow((r - ringR) / 0.75, 2.0));
    float warn = meter < 0.15 ? 0.55 + 0.45 * sin(uTime * 18.0) : 1.0;
    rgb += mix(vRim * 0.16, mix(vRim, vHot, 0.55) * 0.6, on) * ring * warn;
  }
  rgb *= 1.0 + flash * 1.4;
  rgb += vHot * exp(-pow((r - Ro * (1.0 + (1.0 - flash) * 0.5)) / 2.0, 2.0)) * flash * 0.7;
  rgb *= flicker * fade;
  return vec4(rgb, 0.0);
}
// Short event rings: kind 1 release wave at an exit, kind 2 collapse implosion, kind 3 swallow flare.
vec4 eventRing(vec2 p, float kind) {
  float R = vShape.x, seed = vShape.w, life = vState.x, age = (uTime - vState.w) / max(life, 0.01);
  if (age < 0.0 || age > 1.0) return vec4(0.0);
  vec2 dir = vLink.xy; float strength = vShape.z;
  float r = length(p);
  float facing = dot(normalize(p + 1e-4), dir);
  vec3 rgb = vec3(0.0);
  if (uPass < 0.5) {
    if (kind > 1.5 && kind < 2.5) {
      // The collapse leaves a dark scar that fades.
      float scar = (1.0 - smoothstep(R * 0.2, R * 0.9, r)) * (1.0 - age) * 0.5;
      return vec4(0.0, 0.0, 0.0, scar) * strength;
    }
    return vec4(0.0);
  }
  if (kind < 1.5) {
    float e = 1.0 - pow(1.0 - age, 3.0);
    float ringR = R * (0.9 + 1.4 * e);
    float crescent = pow(max(0.0, facing), 1.6);
    float ring = exp(-pow((r - ringR) / (1.4 + 3.0 * age), 2.0));
    rgb = mix(vRim, vHot, 0.4) * ring * crescent * (1.0 - age) * 1.3;
    rgb += vHot * exp(-r * r / (R * R * 0.35)) * pow(1.0 - age, 4.0) * 0.6;
  } else if (kind < 2.5) {
    float e = age * age;
    float ringR = R * mix(1.0, 0.04, e);
    float ring = exp(-pow((r - ringR) / (1.5 + R * 0.04), 2.0));
    rgb = mix(vRim, vHot, e) * ring * (0.4 + 0.8 * e);
    rgb += vHot * exp(-r * r / 30.0) * smoothstep(0.75, 0.92, age) * (1.0 - smoothstep(0.92, 1.0, age)) * 1.6;
  } else {
    float ring = exp(-pow((r - R * (1.0 - 0.2 * age)) / 1.8, 2.0));
    rgb = mix(vRim, vHot, 0.5) * ring * (1.0 - age) * (0.6 + 0.8 * pow(max(0.0, facing), 2.0));
  }
  return vec4(rgb * strength, 0.0);
}
void main() {
  vec2 p = vGeo.xy;
  float kind = vForm.w;
  vec4 col = kind < 0.5 ? aperture(p) : eventRing(p, kind);
  col *= uAlpha;
  if (uPass > 0.5) col.a = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
  gl_FragColor = col;
}`;

export const PORTAL_PARTICLE_VERTEX = `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform mat4 uProjectionMatrix;
uniform mat3 uViewMatrix;
uniform float uTime;
attribute vec4 inGeom, inMote, inDir, inColor;
varying vec2 vUv;
varying vec3 vRim, vHot;
varying float vAlpha, vHotMix;
${COMMON}
vec2 rot(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
// Position (xy) and alpha (z) of one mote at time t; w = core heat. Link motes (2, 3) run on their
// end's integrated link phase instead of the clock; 'life' is then their phase rate and 'reach'
// the end's link activity.
vec4 mote(float t, float R, float kind, float seed, float t0, vec2 d, float life, float reach) {
  float h1 = hash11(seed), h2 = hash11(seed + 17.0), h3 = hash11(seed + 41.0);
  if (kind < 1.5) {
    // Ambient spiral: in (kind 0) toward the throat, out (kind 1) from it.
    float period = mix(1.5, 2.7, h1);
    float u = fract(t / period + h2);
    float v = kind < 0.5 ? u : 1.0 - u;
    float radius = R * mix(1.55, 0.1, pow(v, 1.4));
    float angle = h3 * TAU + (1.0 - pow(1.0 - v, 2.0)) * 2.4 + t * 0.3;
    float alpha = smoothstep(0.0, 0.2, u) * (1.0 - smoothstep(0.8, 1.0, u));
    return vec4(radius * vec2(cos(angle), sin(angle)), alpha, v);
  }
  if (kind < 3.5) {
    // Link motes stream along the connection: out (2) leaves the rim toward the partner, in (3)
    // arrives from the partner's side and sinks into the throat. A transfer through this end
    // raises its activity: the stream speeds up, tightens into a beam and stretches into comets.
    float act = reach;
    float period = mix(2.2, 3.2, h1);
    float u = fract(t / period + h2);
    float span = R * mix(mix(2.4, 3.6, h1), mix(4.4, 5.8, h1), act);
    float spread = (h3 - 0.5) * mix(0.55, 0.1, act);
    float along, alpha;
    if (kind < 2.5) {
      along = R * 0.9 + u * span;
      alpha = smoothstep(0.0, 0.1, u) * pow(1.0 - u, 1.2);
      spread *= 1.0 - 0.4 * u;
    } else {
      along = R * 0.2 + (1.0 - u) * (span + R * 0.7);
      alpha = smoothstep(0.0, 0.25, u) * (1.0 - smoothstep(0.82, 1.0, u));
      spread *= 0.6 + 0.4 * u;
    }
    vec2 dd = rot(d, spread);
    vec2 side = vec2(-dd.y, dd.x) * sin(u * 5.0 + seed) * R * 0.06 * (1.0 - act);
    return vec4(dd * along + side, alpha * mix(1.3, 1.65, act), mix(0.55, 1.0, act));
  }
  float age = (t - t0) / max(life, 0.01);
  if (age < 0.0 || age > 1.0) return vec4(0.0, 0.0, -1.0, 0.0);
  if (kind < 4.5) {
    // Swallow: motes converge into the throat with a slight swirl.
    float r0 = R * mix(1.05, 2.0, h1);
    float e = age * age * (3.0 - 2.0 * age);
    vec2 start = rot(vec2(r0, 0.0), h2 * TAU);
    vec2 pos = rot(start * (1.0 - e), e * 1.3);
    return vec4(pos, sin(age * 3.14159) * 1.1, e);
  }
  if (kind < 5.5) {
    // Release: motes leave the exit in a cone along the travel direction and decelerate.
    vec2 dd = rot(d, (h2 - 0.5) * 2.3);
    float e = 1.0 - pow(1.0 - age, 2.6);
    float dist = R * mix(0.15, 0.35, h3) + e * R * mix(1.1, 2.7, h1);
    return vec4(dd * dist, pow(1.0 - age, 1.4) * 1.1, 1.0 - age);
  }
  // Collapse: everything within the pull radius is drawn in.
  float r0 = mix(R * 0.8, max(reach, R * 1.2), h1);
  float e = pow(age, 1.6);
  vec2 pos = rot(rot(vec2(r0, 0.0), h2 * TAU) * (1.0 - e), e * 2.0);
  return vec4(pos, sin(age * 3.14159) * 1.2, e);
}
void main() {
  vec2 centre = inGeom.xy, corner = inGeom.zw;
  float R = inMote.x, kind = inMote.y, seed = inMote.z, t0 = inMote.w;
  vec2 d = inDir.xy; float strength = inDir.z, size = inDir.w;
  float life = inColor.z, reach = inColor.w;
  bool link = kind > 1.5 && kind < 3.5;
  // Link motes advance on their end's phase; the derivative uses that phase's own rate.
  float t = link ? t0 : uTime, dt = link ? life * 0.016 : 0.016;
  vec4 m = mote(t, R, kind, seed, t0, d, life, reach);
  vec4 m2 = mote(t + dt, R, kind, seed, t0, d, life, reach);
  vec2 vel = (m2.xy - m.xy) / 0.016;
  float speed = length(vel);
  vec2 ax = speed > 0.001 ? vel / speed : vec2(1.0, 0.0);
  float stretch = 1.0 + clamp(speed * 0.006, 0.0, 2.2) + (link ? reach * 4.5 : 0.0);
  vec2 offset = ax * corner.x * size * stretch + vec2(-ax.y, ax.x) * corner.y * size;
  float alive = m.z < 0.0 ? 0.0 : 1.0;
  vec3 p = uViewMatrix * vec3(centre + m.xy + offset * alive, 1.0);
  gl_Position = uProjectionMatrix * vec4(p.xy, 0.0, 1.0);
  vUv = corner;
  vAlpha = max(m.z, 0.0) * strength;
  vHotMix = m.w;
  vRim = unpackRgb(inColor.x); vHot = unpackRgb(inColor.y);
}`;

export const PORTAL_PARTICLE_FRAGMENT = `
#pragma phaserTemplate(shaderName)
precision mediump float;
uniform float uAlpha;
varying vec2 vUv;
varying vec3 vRim, vHot;
varying float vAlpha, vHotMix;
void main() {
  float d2 = dot(vUv, vUv);
  float glow = exp(-d2 * 3.2), core = exp(-d2 * 14.0);
  vec3 rgb = (vRim * glow * 0.75 + vHot * core * (0.55 + 0.45 * vHotMix)) * vAlpha * uAlpha;
  gl_FragColor = vec4(rgb, clamp(max(rgb.r, max(rgb.g, rgb.b)), 0.0, 1.0));
}`;
