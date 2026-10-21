/**
 * Spawn materialisation of players and enemies, computed entirely on the GPU. The CPU writes each
 * spawn once (one field quad plus its particles); every frame afterwards only the clock uniform
 * moves. Positions, streaks, rings and fades are analytic functions of the spawn's age.
 *
 * Instance layout (16 floats per vertex):
 *   inGeom  [cx, cy, cornerX, cornerY]   spawn centre in world px, quad corner -1..1
 *   inEvent [kind, t0, seed, variant]    t0 on the layer clock in s; variant 0 player, 1 enemy
 *   inColor [r, g, b, scale]             owner colour 0..1, size factor of the whole family
 *   inParam [p1, p2, p3, p4]             per particle, see below
 *
 * kind 0 field   one quad per spawn: gather ring, flash, shock rings, sigil, column, afterglow
 * kind 1 gather  mote spiralling into the centre before the flash; p = [angle, radius px, arrival 0..1, size px]
 * kind 2 spark   streak flung out by the flash, braked by drag;    p = [angle, speed px/s, life s, size px]
 * kind 3 ember   mote lifting off the afterglow towards the camera; p = [angle, delay s, life s, size px]
 *
 * Choreography (player): light gathers and the sigil draws itself for SPAWN_FLASH_S, the column of
 * light focuses onto the spawn point, the flash materialises the figure, shock rings and sparks
 * carry it outwards, the afterglow keeps marking "someone stands here now" and the sigil fades.
 * The enemy variant is the same family a size smaller, without sigil and column: enemies arrive
 * often and must not outshine the fight.
 *
 * Pass 0 ground (lit material, under the bodies): the sigil's paint, its ionised bed, shock dust.
 * Pass 1 glow   (emissive, above the light map, under the canopy): every glow and all particles.
 * Pass 2 sky    (emissive, just above the canopy): the falling column of light, players only.
 */
export const SPAWN_KIND = { field: 0, gather: 1, spark: 2, ember: 3 } as const;
export const SPAWN_VARIANT = { player: 0, enemy: 1 } as const;
/** Time from the spawn event to the materialising flash, per variant (player, enemy). */
export const SPAWN_FLASH_S = [0.15, 0.08] as const;
/** Lifetime of the field quad (the afterglow is the last part to go), per variant. */
export const SPAWN_FIELD_LIFE_S = [2.0, 1.35] as const;
/** Half extent of the field quad at scale 1; covers the outermost ripple and its soft edge. */
export const SPAWN_FIELD_EXTENT_PX = 124;
/**
 * Radius of the sigil's main ring. Its innermost line sits just outside the local player's status
 * ring (HP/armour, outer radius about 41 px), so the two frame each other instead of overlapping.
 */
const SIGIL_RADIUS_PX = 52;

const SHARED = /* glsl */ `
const float TAU = 6.2831853;
float flashOf(float variant) { return variant > 0.5 ? ${SPAWN_FLASH_S[1].toFixed(3)} : ${SPAWN_FLASH_S[0].toFixed(3)}; }
float fieldLifeOf(float variant) { return variant > 0.5 ? ${SPAWN_FIELD_LIFE_S[1].toFixed(3)} : ${SPAWN_FIELD_LIFE_S[0].toFixed(3)}; }`;

export const SPAWN_VERTEX = `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform mat4 uProjectionMatrix;
uniform mat3 uViewMatrix;
uniform float uPass;
uniform float uTime;
attribute vec4 inGeom;
attribute vec4 inEvent;
attribute vec4 inColor;
attribute vec4 inParam;
varying vec2 vLocal;
varying vec4 vEvent;
varying vec4 vColor;
varying vec4 vShape;
${SHARED}
vec2 dirOf(float a) { return vec2(cos(a), sin(a)); }

/** Offset of a particle from the spawn centre at age a (s). */
vec2 pathOf(float kind, float a, vec4 p, float flash, float scale, float seed) {
  if (kind < 1.5) {
    // Gather: drifts in slowly, then rushes into the core and arrives with the flash.
    float e = clamp(a / max(flash * p.z, 0.01), 0.0, 1.0);
    float swirl = (seed > 0.5 ? 1.0 : -1.0) * 1.8 * e * e;
    return dirOf(p.x + swirl) * p.y * (1.0 - pow(e, 2.3));
  }
  float tau = max(a - flash, 0.0);
  if (kind < 2.5) {
    // Spark: flung out by the flash and braked by drag, curling a little.
    float dist = 5.0 * scale + p.y / 4.6 * (1.0 - exp(-4.6 * tau));
    return dirOf(p.x + (seed - 0.5) * 1.6 * tau) * dist;
  }
  // Ember: lifts off the afterglow and drifts slowly outwards, swaying.
  float u = max(tau - p.y, 0.0);
  vec2 d = dirOf(p.x);
  float dist = (5.0 + 10.0 * seed) * scale + 20.0 * scale * u;
  return d * dist + vec2(-d.y, d.x) * 3.0 * scale * sin(u * 4.2 + seed * TAU);
}

void main() {
  float kind = inEvent.x, age = uTime - inEvent.y, seed = inEvent.z, variant = inEvent.w;
  float scale = inColor.a, flash = flashOf(variant);
  vEvent = vec4(kind, age, seed, variant);
  vColor = inColor;
  vShape = vec4(0.0);
  vLocal = vec2(0.0);
  // The field feeds all three passes (the sky only for players), particles only the glow pass.
  bool drawn = kind < 0.5 ? (uPass < 1.5 || variant < 0.5) : (uPass > 0.5 && uPass < 1.5);
  float start = 0.0, end = fieldLifeOf(variant);
  if (kind > 0.5 && kind < 1.5) end = flash * inParam.z;
  else if (kind > 1.5 && kind < 2.5) { start = flash; end = flash + inParam.z; }
  else if (kind > 2.5) { start = flash + inParam.y; end = start + inParam.z; }
  if (!drawn || age < start || age > end) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 world;
  if (kind < 0.5) {
    vLocal = inGeom.zw * ${SPAWN_FIELD_EXTENT_PX.toFixed(1)} * scale;
    world = inGeom.xy + vLocal;
  } else {
    float life = clamp((age - start) / max(end - start, 0.001), 0.0, 1.0);
    // Motes carry a short comet tail, sparks a longer streak; both are capped so the fastest
    // moments read as light and never as sticks.
    float trail = kind < 1.5 ? 0.024 : (kind < 2.5 ? 0.05 : 0.0);
    float maxLen = (kind < 1.5 ? 8.0 : 20.0) * scale;
    vec2 p1 = pathOf(kind, age, inParam, flash, scale, seed);
    vec2 p0 = pathOf(kind, max(age - trail, start), inParam, flash, scale, seed);
    vec2 axis = p1 - p0;
    float len = length(axis);
    vec2 dir = len > 0.001 ? axis / len : vec2(1.0, 0.0);
    if (len > maxLen) { p0 = p1 - dir * maxLen; len = maxLen; }
    // Embers rise towards the camera: they grow while they fade.
    float size = inParam.w * scale * (kind > 2.5 ? 1.0 + 0.7 * life : 1.0);
    float halfLen = len * 0.5;
    float pad = size * 2.6 + 1.0;
    vLocal = vec2(inGeom.z * (halfLen + pad), inGeom.w * pad);
    vShape = vec4(halfLen, size, life, 0.0);
    world = inGeom.xy + (p0 + p1) * 0.5 + dir * vLocal.x + vec2(-dir.y, dir.x) * vLocal.y;
  }
  gl_Position = uProjectionMatrix * vec4((uViewMatrix * vec3(world, 1.0)).xy, 0.0, 1.0);
}`;

export const SPAWN_FRAGMENT = `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform float uPass;
uniform float uDetail;
uniform float uAlpha;
uniform float uEmissive;
uniform float uPixel;
varying vec2 vLocal;
varying vec4 vEvent;
varying vec4 vColor;
varying vec4 vShape;
${SHARED}
float hash(vec2 v) { return fract(sin(dot(v, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 v) {
  vec2 i = floor(v), f = fract(v); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + 1.0), f.x), f.y);
}
float gauss(float x, float s) { return exp(-x * x / max(s * s, 1e-4)); }
/** Anti-aliased line of half width hw (world px) that never thins below ~0.7 screen px. */
float line(float d, float hw) {
  float h = max(hw, 0.7 * uPixel);
  return (1.0 - smoothstep(h, h + 1.1 * uPixel, abs(d))) * min(1.0, hw / h + 0.25);
}
/** Shock front: a crisp leading edge with a soft wake behind it. */
float shock(float r, float R, float w) {
  float d = r - R;
  return gauss(d, w * 0.6) + gauss(d, w * 1.6) * 0.3 * (1.0 - smoothstep(-0.5 * w, 0.5 * w, d));
}
float easeOut3(float u) { float v = 1.0 - clamp(u, 0.0, 1.0); return 1.0 - v * v * v; }
/** The owner colour at full value, so dark team colours still glow. */
vec3 hueOf(vec3 c) { float m = max(max(c.r, c.g), c.b); return m > 0.001 ? c / m : vec3(1.0); }

/** The teleport sigil on the ground, drawn on, rotating; returns line coverage 0..1. */
float sigil(vec2 p, float r, float t, float seed, float R) {
  float rot = seed * TAU + t * 0.75;
  float rotIn = -seed * TAU * 0.7 - t * 1.1;
  vec2 dir = p / max(r, 0.001);
  float ang = atan(p.y, p.x);
  // Draw-on: the circle closes once around within the gather.
  float sweep = easeOut3(t / 0.32) * 1.06;
  float a01 = fract((ang - rot) / TAU);
  float reveal = 1.0 - smoothstep(sweep - 0.05, sweep, a01);
  // Outer ring with three gaps, a dashed rim, an inner ring and twelve counter-rotating ticks.
  float g = fract((ang - rot) / TAU * 3.0);
  float outer = line(r - R, 0.85) * smoothstep(0.015, 0.05, min(g, 1.0 - g));
  float dash = 1.0 - smoothstep(0.22, 0.28, abs(fract((ang - rot * 0.5) / TAU * 36.0) - 0.5));
  float rim = line(r - R * 1.12, 0.45) * dash;
  float inner = line(r - R * 0.84, 0.55);
  float f = fract((ang - rotIn) / TAU * 12.0);
  float band = clamp((r - R * 0.88) / uPixel, 0.0, 1.0) * clamp((R * 0.96 - r) / uPixel, 0.0, 1.0);
  float ticks = line((f - 0.5) * TAU * r / 12.0, 0.55) * band;
  // Three bold diamonds sit in the gaps: one clear symbol each, readable from playing distance.
  float glyphs = 0.0;
  for (int i = 0; i < 3; i++) {
    float a = rot + float(i) * TAU / 3.0;
    vec2 c = vec2(cos(a), sin(a)) * R;
    vec2 q = mat2(cos(a), -sin(a), sin(a), cos(a)) * (p - c);
    float dia = abs(q.x) / 5.2 + abs(q.y) / 3.0;
    glyphs += 1.0 - smoothstep(1.0 - 1.2 * uPixel / 3.0, 1.0, dia);
  }
  return clamp(outer + rim * 0.7 + inner * 0.8 + ticks * 0.75 + glyphs, 0.0, 1.0) * reveal;
}

void main() {
  float kind = vEvent.x, t = vEvent.y, seed = vEvent.z, variant = vEvent.w;
  float s = vColor.a;
  bool enemy = variant > 0.5;
  vec3 glow = hueOf(vColor.rgb);
  vec3 core = mix(glow, vec3(1.0), 0.6);
  vec3 rgb = vec3(0.0);
  float alpha = 0.0;

  if (kind > 0.5) {
    // ── Particles: capsules along their motion, bright head, fading tail ─────────────────
    float halfLen = vShape.x, size = max(vShape.y, 0.35), life = vShape.z;
    vec2 q = vLocal;
    float d = length(vec2(max(abs(q.x) - halfLen, 0.0), q.y));
    float head = halfLen > 0.01 ? clamp(q.x / halfLen * 0.5 + 0.5, 0.0, 1.0) : 1.0;
    float shape = (gauss(d, size) + gauss(d, size * 2.2) * 0.35) * mix(0.12, 1.0, head * head);
    vec3 col; float k;
    if (kind < 1.5) {
      k = smoothstep(0.0, 0.35, life) * (0.55 + 0.45 * life);
      col = mix(glow, core, 0.35 + 0.5 * life);
    } else if (kind < 2.5) {
      k = pow(1.0 - life, 1.5) * 1.7;
      col = mix(vec3(1.0, 0.98, 0.92), glow, smoothstep(0.0, 0.55, life));
    } else {
      float twinkle = 0.75 + 0.25 * sin(t * 13.0 + seed * 40.0);
      k = smoothstep(0.0, 0.15, life) * (1.0 - smoothstep(0.55, 1.0, life)) * 0.75 * twinkle;
      col = mix(core, glow, 0.5);
    }
    rgb = col * shape * k * uEmissive;
  } else {
    vec2 p = vLocal;
    float r = length(p);
    float flash = flashOf(variant), tf = t - flash, after = step(0.0, tf);
    float u1 = clamp(tf / 0.55, 0.0, 1.0);
    float R1 = mix(9.0, 70.0, easeOut3(u1)) * s;
    float w1 = mix(6.5, 1.6, u1) * s;
    float I1 = pow(1.0 - u1, 1.7) * after;
    float sigR = ${SIGIL_RADIUS_PX.toFixed(1)} * s * (1.0 + 0.06 * exp(-max(tf, 0.0) * 7.0) * after);
    float sigLife = enemy ? 0.0 : smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(1.0, 1.55, t));
    float runes = sigLife > 0.0 && uPass < 1.5 ? sigil(p, r, t, seed, sigR) : 0.0;

    if (uPass < 0.5) {
      // ── Ground: the sigil painted in light on ionised, darkened ground; dust thrown by the shock.
      vec3 bed = glow * 0.12;
      float litA = clamp(runes * 0.72, 0.0, 0.9) * sigLife;
      float bedA = (gauss(r - sigR * 0.98, 9.0 * s) * 0.2 + gauss(r, sigR * 0.8) * 0.08) * sigLife * smoothstep(0.0, 0.25, t);
      bedA += shock(r, R1, w1 * 1.6) * I1 * (enemy ? 0.12 : 0.18);
      bedA = clamp(bedA, 0.0, 0.5);
      vec3 lit = mix(glow, core, 0.25);
      alpha = litA + bedA * (1.0 - litA);
      rgb = lit * litA + bed * bedA * (1.0 - litA);
    } else if (uPass < 1.5) {
      // ── Glow: gather, flash, shock rings, unwinding filaments, sigil light, afterglow ─────
      float strength = enemy ? 0.7 : 1.0;
      vec3 col = vec3(0.0);
      if (t < flash) {
        float g = t / flash;
        float Rg = mix(enemy ? 46.0 : 92.0, 9.0, g * g) * s;
        float wg = mix(0.9, 2.2, g) * s;
        // A faint, broken circle of light contracting with the motes: drawn in, not stamped.
        float gBreak = 0.55 + 0.45 * noise(p / max(r, 0.001) * 3.4 + seed * 11.0 + t * 6.0);
        col += mix(glow, core, 0.4) * (line(r - Rg, wg * 0.45) * 0.3 + gauss(r - Rg, wg * 2.4) * 0.2) * gBreak
          * smoothstep(0.0, 0.35, g) * strength;
      }
      float pre = pow(clamp(t / flash, 0.0, 1.0), 3.0) * 0.45;
      float fl = t < flash ? pre : exp(-tf * 11.0) * 0.9;
      float spread = 1.0 - exp(-max(tf, 0.0) * 16.0);
      col += mix(core, vec3(1.0), 0.5) * (gauss(r, (6.0 + 14.0 * spread) * s) + gauss(r, (16.0 + 30.0 * spread) * s) * 0.3) * fl * strength;
      // The shock rings break up a little along their circumference; noise on the unit
      // direction instead of the angle keeps the atan seam invisible.
      float breakup = 0.8 + 0.2 * noise(p / max(r, 0.001) * 2.6 + seed * 7.0 + t * 0.8);
      col += mix(glow, core, 0.35) * (shock(r, R1, w1) * I1 * breakup * 0.85 + (1.0 - smoothstep(R1 * 0.4, R1, r)) * I1 * 0.03) * strength;
      float u2 = clamp(tf / 0.34, 0.0, 1.0);
      float v2 = 1.0 - u2;
      col += core * line(r - mix(7.0, 50.0, 1.0 - v2 * v2 * v2 * v2) * s, mix(1.3, 0.45, u2) * s) * v2 * v2 * 0.85 * after * strength;
      float tr = tf - 0.12;
      float u3 = clamp(tr / 0.85, 0.0, 1.0);
      col += glow * shock(r, mix(22.0, 108.0, easeOut3(u3)) * s, mix(2.4, 1.0, u3) * s) * pow(1.0 - u3, 1.3) * 0.42 * step(0.0, tr) * breakup * strength;
      if (!enemy && uDetail > 0.5 && tf > 0.0 && tf < 0.75) {
        // Three filaments of light unwind outwards from the materialised figure.
        float e = tf / 0.75;
        float ang = atan(p.y, p.x);
        float fil = 0.0;
        for (int i = 0; i < 3; i++) {
          float phi = mod(ang - seed * TAU - float(i) * TAU / 3.0 - tf * 2.4, TAU);
          float Rs = (8.0 + 46.0 * easeOut3(e * 1.4)) * s + phi * 4.2 * s;
          fil += line(r - Rs, 0.6 * s) * smoothstep(0.0, 0.25, phi) * (1.0 - smoothstep(1.4, 2.3, phi));
        }
        col += mix(glow, core, 0.5) * fil * (1.0 - e) * (1.0 - e) * 0.6;
      }
      if (sigLife > 0.0) {
        float pulse = 1.0 + 0.8 * exp(-max(tf, 0.0) * 6.0) * after;
        col += (glow * (runes * 0.55 + gauss(r - sigR, 4.0 * s) * 0.12) + core * runes * 0.15) * pulse * sigLife;
      }
      float ag = smoothstep(flash, flash + 0.2, t) * (1.0 - smoothstep(0.45, fieldLifeOf(variant) * 0.95, t));
      col += glow * (gauss(r, 38.0 * s) * 0.28 + gauss(r, 15.0 * s) * 0.22) * ag * (0.9 + 0.1 * sin(t * 6.0)) * strength;
      rgb = col * uEmissive;
    } else {
      // ── Sky: the column of light seen from straight above. It focuses onto the spawn point
      // as it falls, then thins and goes out, scattering a few rays.
      float colIn = smoothstep(0.0, flash, t);
      float Rc = (t < flash ? mix(30.0, 9.0, colIn * colIn) : mix(9.0, 3.0, clamp(tf / 0.4, 0.0, 1.0))) * s;
      float colI = t < flash ? colIn * colIn * 0.8 : exp(-tf * 4.2);
      vec3 col = core * (gauss(r, Rc * 0.6) + gauss(r, Rc * 1.8) * 0.3) * colI;
      if (uDetail > 0.5) {
        // Integer angular frequencies keep the rays continuous across the atan seam.
        float a2 = atan(p.y, p.x) + t * 0.7 + seed * 5.0;
        float streak = pow(max(0.0, sin(a2 * 7.0)), 5.0) * 0.6 + pow(max(0.0, sin(a2 * 11.0 + 1.7)), 7.0) * 0.4;
        float rays = streak * exp(-r / (20.0 * s)) * smoothstep(5.0 * s, 12.0 * s, r)
          * smoothstep(flash - 0.06, flash, t) * exp(-max(tf, 0.0) * 5.0);
        col += mix(glow, core, 0.5) * rays * 0.5;
      }
      rgb = col * uEmissive;
    }
  }
  rgb *= uAlpha;
  gl_FragColor = vec4(rgb, clamp(alpha * uAlpha, 0.0, 1.0));
}`;
