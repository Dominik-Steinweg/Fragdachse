/**
 * Spawn materialisation of players and enemies, computed entirely on the GPU. The CPU writes each
 * spawn once (one field quad plus its particles, see SpawnInstances); every frame afterwards only
 * the clock uniform moves. Positions, streaks and fades are analytic functions of the spawn's age.
 *
 * Instance layout (16 floats per vertex):
 *   inGeom  [cx, cy, cornerX, cornerY]   spawn centre in world px, quad corner -1..1
 *   inEvent [kind, t0, seed, variant]    t0 on the layer clock in s; variant 0 player, 1 enemy
 *   inColor [r, g, b, scale]             owner colour 0..1, size factor of the whole family
 *   inParam [p1, p2, p3, p4]             per particle, see below
 *
 * kind 0 field   one quad per spawn: gathering haze, flash, afterglow, light pool, light column
 * kind 1 gather  mote spiralling into the centre before the flash; p = [angle, radius px, arrival 0..1, size px]
 * kind 2 spark   streak flung out by the flash, braked by drag;    p = [angle, speed px/s, life s, size px]
 * kind 3 ember   mote lifting off the afterglow towards the camera; p = [angle, delay s, life s, size px]
 * kind 4 dust    soft puff of light pushed outwards by the flash;   p = [angle, reach px, life s, size px]
 * kind 5 orbit   residual light circling the figure, unwinding;     p = [angle, radius px, life s, size px]
 *
 * The look is carried by light particles only, without drawn lines or rings: light gathers from
 * all sides, a column of light focuses onto the spawn point, the flash materialises the figure,
 * sparks and soft puffs of light burst outwards, a few motes circle the new figure, embers rise
 * from the afterglow. The enemy variant is the same family a size smaller, without the column
 * and the circling motes: enemies arrive often and must not outshine the fight.
 *
 * Pass 0 ground (lit material, under the bodies): a soft pool of light on the ground.
 * Pass 1 glow   (emissive, above the light map, under the canopy): every glow and all particles.
 * Pass 2 sky    (emissive, just above the canopy): the falling column of light, players only.
 */
export const SPAWN_KIND = { field: 0, gather: 1, spark: 2, ember: 3, dust: 4, orbit: 5 } as const;
export const SPAWN_VARIANT = { player: 0, enemy: 1 } as const;
/** Time from the spawn event to the materialising flash, per variant (player, enemy). */
export const SPAWN_FLASH_S = [0.18, 0.09] as const;
/** Lifetime of the field quad (the afterglow is the last part to go), per variant. */
export const SPAWN_FIELD_LIFE_S = [1.9, 1.3] as const;
/** Half extent of the field quad at scale 1; covers the gathering haze and its soft edge. */
export const SPAWN_FIELD_EXTENT_PX = 124;

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
    float swirl = (seed > 0.5 ? 1.0 : -1.0) * 2.2 * e * e;
    return dirOf(p.x + swirl) * p.y * (1.0 - pow(e, 2.2));
  }
  float tau = max(a - flash, 0.0);
  if (kind < 2.5) {
    // Spark: flung out by the flash and braked by drag, curling a little.
    float dist = 4.0 * scale + p.y / 4.2 * (1.0 - exp(-4.2 * tau));
    return dirOf(p.x + (seed - 0.5) * 1.8 * tau) * dist;
  }
  if (kind < 3.5) {
    // Ember: lifts off the afterglow and drifts slowly outwards, swaying.
    float u = max(tau - p.y, 0.0);
    vec2 d = dirOf(p.x);
    float dist = (6.0 + 14.0 * seed) * scale + 22.0 * scale * u;
    return d * dist + vec2(-d.y, d.x) * 3.5 * scale * sin(u * 3.6 + seed * TAU);
  }
  if (kind < 4.5) {
    // Dust: pushed out hard by the flash, then hanging in the air.
    return dirOf(p.x + (seed - 0.5) * 0.8 * tau) * (5.0 * scale + p.y * (1.0 - exp(-5.0 * tau)));
  }
  // Orbit: circles the figure fast, slows down and unwinds outwards.
  float spin = (seed > 0.5 ? 1.0 : -1.0) * (2.2 + 2.4 * fract(seed * 7.31)) * (1.0 - exp(-1.8 * tau));
  return dirOf(p.x + spin) * p.y * (0.55 + 0.8 * clamp(tau / max(p.z, 0.01), 0.0, 1.0));
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
  else if (kind > 2.5 && kind < 3.5) { start = flash + inParam.y; end = start + inParam.z; }
  else if (kind > 1.5) { start = flash; end = flash + inParam.z; }
  if (!drawn || age < start || age > end) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 world;
  if (kind < 0.5) {
    vLocal = inGeom.zw * ${SPAWN_FIELD_EXTENT_PX.toFixed(1)} * scale;
    world = inGeom.xy + vLocal;
  } else {
    float life = clamp((age - start) / max(end - start, 0.001), 0.0, 1.0);
    // Motes carry a short comet tail, sparks a longer streak, circling motes an arc; all are
    // capped so the fastest moments read as light and never as sticks. Puffs and embers are round.
    float trail = kind < 1.5 ? 0.03 : (kind < 2.5 ? 0.05 : (kind > 4.5 ? 0.07 : 0.0));
    float maxLen = (kind < 1.5 ? 9.0 : (kind < 2.5 ? 22.0 : 12.0)) * scale;
    vec2 p1 = pathOf(kind, age, inParam, flash, scale, seed);
    vec2 p0 = pathOf(kind, max(age - trail, start), inParam, flash, scale, seed);
    vec2 axis = p1 - p0;
    float len = length(axis);
    vec2 dir = len > 0.001 ? axis / len : vec2(1.0, 0.0);
    if (len > maxLen) { p0 = p1 - dir * maxLen; len = maxLen; }
    // Embers rise towards the camera and puffs spread: both grow while they fade.
    float grow = kind > 3.5 && kind < 4.5 ? 1.0 + 1.3 * life : (kind > 2.5 && kind < 3.5 ? 1.0 + 0.7 * life : 1.0);
    float size = inParam.w * scale * grow;
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
uniform float uAlpha;
uniform float uEmissive;
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
/** The owner colour at full value, so dark team colours still glow. */
vec3 hueOf(vec3 c) { float m = max(max(c.r, c.g), c.b); return m > 0.001 ? c / m : vec3(1.0); }

void main() {
  float kind = vEvent.x, t = vEvent.y, seed = vEvent.z, variant = vEvent.w;
  float s = vColor.a;
  bool enemy = variant > 0.5;
  float strength = enemy ? 0.7 : 1.0;
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
      // Motes merge into the core instead of piling up into a hard white spot.
      k = smoothstep(0.0, 0.3, life) * (0.5 + 0.5 * life) * (1.0 - 0.6 * smoothstep(0.75, 1.0, life));
      col = mix(glow, core, 0.3 + 0.5 * life);
    } else if (kind < 2.5) {
      // Sparks light up as they leave the core; starting at full strength they would stack
      // into a white disc in the middle.
      k = pow(1.0 - life, 1.5) * 1.5 * smoothstep(0.0, 0.14, life);
      col = mix(vec3(1.0, 0.98, 0.92), glow, smoothstep(0.0, 0.55, life));
    } else if (kind < 3.5) {
      float twinkle = 0.75 + 0.25 * sin(t * 13.0 + seed * 40.0);
      k = smoothstep(0.0, 0.15, life) * (1.0 - smoothstep(0.55, 1.0, life)) * 0.8 * twinkle;
      col = mix(core, glow, 0.5);
    } else if (kind < 4.5) {
      // A puff has no hard core: two wide falloffs. It shows once it has left the centre, where
      // all puffs start on top of each other, and fades as it spreads.
      shape = gauss(d, size) * 0.6 + gauss(d, size * 1.9) * 0.4;
      k = smoothstep(0.04, 0.3, life) * pow(1.0 - life, 1.4) * 0.42;
      col = mix(glow, core, 0.3);
    } else {
      k = smoothstep(0.0, 0.12, life) * (1.0 - smoothstep(0.45, 1.0, life));
      col = mix(core, vec3(1.0), 0.2);
    }
    // Small particles cannot wash bright ground out like wide glows, so they keep more of their
    // light by day and the burst stays readable.
    rgb = col * shape * k * strength * mix(1.0, uEmissive, 0.5);
  } else {
    vec2 p = vLocal;
    float r = length(p);
    float flash = flashOf(variant), tf = t - flash, after = step(0.0, tf);
    if (uPass < 0.5) {
      // ── Ground: a soft, mottled pool of light where the figure appears ─────────────────
      float env = smoothstep(flash - 0.08, flash + 0.08, t) * (1.0 - smoothstep(0.55, 1.5, t));
      float gathering = smoothstep(0.0, flash, t) * (1.0 - after) * 0.4;
      float mottle = 0.7 + 0.3 * noise(p / (9.0 * s) + seed * 13.0);
      float pool = (gauss(r, 28.0 * s) * 0.5 + gauss(r, 11.0 * s) * 0.3) * mottle;
      alpha = clamp(pool * (env + gathering) * strength, 0.0, 0.5);
      rgb = mix(glow, vec3(1.0), 0.45) * alpha;
    } else if (uPass < 1.5) {
      // ── Glow: the gathering haze, the flash bloom, the afterglow ────────────────────────
      vec3 col = vec3(0.0);
      if (t < flash) {
        float g = t / flash;
        col += mix(glow, core, 0.3) * gauss(r, mix(60.0, 14.0, g) * s) * g * g * 0.28;
      }
      // A soft bloom, never a disc: the peak stays below white clipping together with the column.
      float fl = (t < flash ? pow(clamp(t / flash, 0.0, 1.0), 3.0) * 0.3 : exp(-tf * 10.0)) * 0.62;
      float spread = 1.0 - exp(-max(tf, 0.0) * 14.0);
      col += mix(core, vec3(1.0), 0.45) * (gauss(r, (5.0 + 10.0 * spread) * s) + gauss(r, (16.0 + 26.0 * spread) * s) * 0.4) * fl;
      float ag = smoothstep(flash, flash + 0.25, t) * (1.0 - smoothstep(0.5, fieldLifeOf(variant) * 0.95, t));
      col += glow * (gauss(r, 36.0 * s) * 0.24 + gauss(r, 14.0 * s) * 0.2) * ag * (0.9 + 0.1 * sin(t * 6.0));
      rgb = col * strength * uEmissive;
    } else {
      // ── Sky: the column of light seen from straight above. It focuses onto the spawn point
      // as it falls, then thins and goes out.
      float colIn = smoothstep(0.0, flash, t);
      float Rc = (t < flash ? mix(30.0, 8.0, colIn * colIn) : mix(8.0, 3.0, clamp(tf / 0.4, 0.0, 1.0))) * s;
      float colI = (t < flash ? colIn * colIn * 0.7 : exp(-tf * 4.5)) * 0.6;
      rgb = core * (gauss(r, Rc * 0.6) + gauss(r, Rc * 1.9) * 0.3) * colI * uEmissive;
    }
  }
  rgb *= uAlpha;
  gl_FragColor = vec4(rgb, clamp(alpha * uAlpha, 0.0, 1.0));
}`;
