/**
 * Armageddon meteor passes. Lengths are in units of the damage radius R; the instance carries
 * (centre, corner, [R, progress, seed, void], age). age < 0: incoming strike, else seconds since impact.
 *
 * Pass 0 (5.12, ground material): scorch, crater bowl and the expanding dust shock ring.
 * Pass 1 (19.7, emissive below canopy): approach heat light on the ground and the cooling molten crater.
 * Pass 2 (20.6, airborne): particle fireball - flickering core, shed flame puffs cooling into smoke,
 *        sparks - and the brief impact flash. No solid body: the strike reads as fire, like the
 *        game's other explosions.
 * Pass 3 (13.38, lit material): smoke wisps rising from the crater.
 * Emissive light is written premultiplied with zero alpha (additive) so scene alpha stays intact.
 * Every quad fades radially before its edge, so no pass can show its rectangle.
 */
const FALL = /* glsl */ `
const float APPROACH = 3.6;   // horizontal approach distance in R
const float FALL_S = 1.25;    // nominal fall time in s, only animates the particles
float headDistance(float progress) { return APPROACH * (1.0 - pow(progress, 1.4)); }
vec2 travelDir(float seed) {
  // Shared sky direction with a little per-strike variation: meteors arrive from the upper left.
  float a = 0.98 + (fract(seed * 0.6180339) - 0.5) * 0.5;
  return vec2(cos(a), sin(a));
}`;

export const METEOR_VERTEX = `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform mat4 uProjectionMatrix;
uniform mat3 uViewMatrix;
uniform float uPass;
attribute vec2 inCenter;
attribute vec2 inCorner;
attribute vec4 inState;
attribute float inAge;
varying vec2 vLocal;
varying vec4 vState;
varying float vAge;
${FALL}
const float PUFF_LIFE = 0.42;
void main() {
  vState = inState; vAge = inAge;
  float R = inState.x, progress = inState.y;
  vec2 world;
  if (uPass > 1.5 && uPass < 2.5 && inAge < 0.0) {
    // Body-relative frame: x runs backwards along the path, y across it.
    vec2 d = travelDir(inState.z), n = vec2(-d.y, d.x);
    float emitted = max(progress - PUFF_LIFE / FALL_S, 0.0);
    float trail = APPROACH * (pow(progress, 1.4) - pow(emitted, 1.4)) + 0.55;
    float along = -0.4 + (inCorner.x * 0.5 + 0.5) * (trail + 0.4);
    float across = inCorner.y * 0.5;
    vLocal = vec2(along, across);
    world = inCenter - d * headDistance(progress) * R + (-d * along + n * across) * R;
  } else {
    float size = uPass < 0.5 ? 2.1 : (uPass < 1.5 ? 1.6 : (uPass < 2.5 ? 1.4 : 2.4));
    vLocal = inCorner * size;
    world = inCenter + vLocal * R;
  }
  gl_Position = uProjectionMatrix * vec4((uViewMatrix * vec3(world, 1.0)).xy, 0.0, 1.0);
}`;

export const METEOR_FRAGMENT = `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform float uPass;
uniform float uDetail;
uniform float uAlpha;
varying vec2 vLocal;
varying vec4 vState;
varying float vAge;
${FALL}
const float PUFF_LIFE = 0.42;
const float SPARK_LIFE = 0.3;
float hash(vec2 v) { return fract(sin(dot(v, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 v) {
  vec2 i = floor(v), f = fract(v); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + 1.0), f.x), f.y);
}
float fbm(vec2 v) {
  float sum = noise(v) * 0.5 + noise(v * 2.03 + 17.1) * 0.25;
  if (uDetail > 0.5) sum += noise(v * 4.07 + 41.3) * 0.15 + noise(v * 8.11 + 73.7) * 0.1;
  else sum += 0.25;
  return sum;
}
vec3 heatRamp(float t, float isVoid) {
  // Blackbody-like ramp: dark red -> orange -> yellow -> near white.
  vec3 red = mix(vec3(0.42, 0.06, 0.02), vec3(0.22, 0.05, 0.42), isVoid);
  vec3 orange = mix(vec3(1.0, 0.36, 0.07), vec3(0.58, 0.24, 0.95), isVoid);
  vec3 yellow = mix(vec3(1.0, 0.74, 0.30), vec3(0.84, 0.60, 1.0), isVoid);
  vec3 white = mix(vec3(1.0, 0.95, 0.84), vec3(0.96, 0.90, 1.0), isVoid);
  vec3 c = mix(red, orange, smoothstep(0.0, 0.4, t));
  c = mix(c, yellow, smoothstep(0.35, 0.75, t));
  return mix(c, white, smoothstep(0.75, 1.0, t));
}
void main() {
  float R = vState.x, progress = vState.y, seed = vState.z, isVoid = vState.w, age = vAge;
  vec2 q = vLocal;
  float r = length(q), ang = atan(q.y, q.x);
  vec3 rgb = vec3(0.0); float alpha = 0.0;
  float size = uPass < 0.5 ? 2.1 : (uPass < 1.5 ? 1.6 : (uPass < 2.5 ? 1.4 : 2.4));
  float edgeFade = 1.0 - smoothstep(size * 0.72, size * 0.97, r);

  if (uPass < 0.5) {
    if (age < 0.0) discard;
    float n = fbm(q * 3.2 + seed);
    // Expanding dust shock ring: fast out, thinning, gone before the smoke settles.
    float t = clamp(age / 0.8, 0.0, 1.0);
    float front = mix(0.3, 1.55, 1.0 - pow(1.0 - t, 2.4));
    float ragged = fbm(vec2(ang * 2.6, r * 3.0) + seed * 1.7);
    float ring = exp(-pow((r - front + (ragged - 0.5) * 0.28) / mix(0.3, 0.13, t), 2.0));
    float veil = (1.0 - smoothstep(front * 0.35, front, r)) * 0.45;
    float dustA = clamp(ring * 0.6 + veil * 0.4, 0.0, 0.8) * (0.55 + 0.45 * ragged) * (1.0 - t);
    vec3 dust = mix(vec3(0.36, 0.29, 0.21), vec3(0.58, 0.49, 0.37), ragged);
    // Scorch with ejecta rays, crater bowl and raised rim lit from the upper left.
    float fade = (1.0 - smoothstep(3.5, 7.0, age)) * smoothstep(0.0, 0.1, age);
    float rays = fbm(vec2(ang * 3.8, r * 0.8) + seed * 3.1);
    float edge = r + (n - 0.5) * 0.24 - smoothstep(0.45, 1.0, r) * (rays - 0.45) * 0.55;
    float scorch = 1.0 - smoothstep(0.48, 1.02, edge);
    float bowl = 1.0 - smoothstep(0.3, 0.41, edge);
    float rim = exp(-pow((edge - 0.43) / 0.075, 2.0));
    vec2 toLight = normalize(vec2(-0.6, -0.8));
    vec2 dir = q / max(r, 1e-4);
    float wallLit = -dot(dir, toLight), rimLit = dot(dir, toLight);
    vec3 soot = mix(vec3(0.075, 0.06, 0.05), vec3(0.16, 0.125, 0.09), n);
    vec3 crater = mix(vec3(0.05, 0.04, 0.035), vec3(0.17, 0.13, 0.1), 0.5 + 0.5 * wallLit * smoothstep(0.1, 0.38, r));
    vec3 earth = mix(vec3(0.2, 0.15, 0.1), vec3(0.42, 0.33, 0.23), 0.5 + 0.5 * rimLit);
    vec3 ground = mix(soot, crater, bowl);
    ground = mix(ground, earth, rim * 0.45);
    float groundA = clamp(scorch * (0.32 + 0.3 * smoothstep(0.9, 0.3, edge)) + bowl * 0.3 + rim * 0.12, 0.0, 0.85) * fade;
    alpha = groundA + dustA * (1.0 - groundA);
    rgb = ground * groundA + dust * dustA * (1.0 - groundA);
  } else if (uPass < 1.5) {
    if (age < 0.0) {
      // Approach heat: a warm pool of meteor light tightening and brightening on the landing site.
      float approach = smoothstep(0.06, 1.0, progress);
      float sigma = mix(1.0, 0.45, progress);
      float pool = exp(-r * r / (sigma * sigma));
      float flicker = 1.0 + 0.07 * sin(progress * 61.0 + seed) + 0.05 * sin(progress * 23.0 + seed * 2.0);
      float hint = exp(-pow((r - 1.0) / 0.05, 2.0)) * (0.03 + 0.08 * approach * approach)
        * (0.65 + 0.35 * fbm(vec2(ang * 6.0, progress * 4.0) + seed));
      vec3 warm = heatRamp(0.45 + 0.4 * approach, isVoid);
      rgb = warm * (pool * pow(approach, 1.7) * 0.45 * flicker + hint);
    } else {
      // Molten cracks cooling in the crater bowl; the combat burst owns the flash.
      float cool = exp(-age / 0.85) * (1.0 - smoothstep(2.4, 3.6, age));
      float n = fbm(q * 4.0 + seed * 1.3);
      // A small molten heart with a few glowing seams reaching into the bowl, not a lava disc.
      float heart = exp(-r * r / 0.018);
      float seams = (1.0 - smoothstep(0.0, 0.045, abs(n - 0.5))) * (1.0 - smoothstep(0.08, 0.34, r));
      float molten = (heart * 0.9 + seams * 0.55) * cool;
      rgb = heatRamp(cool * (0.45 + 0.55 * heart), isVoid) * molten;
    }
  } else if (uPass < 2.5) {
    if (age >= 0.0) discard;
    {
      float along = q.x, across = q.y;
      float tau = progress * FALL_S;
      vec3 emit = vec3(0.0);
      float smokeA = 0.0; vec3 smokeRGB = vec3(0.0);
      // Shed flame puffs: emitted continuously at the head, they lag behind the accelerating
      // fireball, swell, cool from yellow through orange into a thin smoke ribbon.
      for (int i = 0; i < 16; i++) {
        float fi = float(i);
        float cycle = tau / PUFF_LIFE + fi / 16.0;
        float ph = fract(cycle), id = floor(cycle);
        float born = progress - ph * PUFF_LIFE / FALL_S;
        if (born < 0.0) continue;
        float h1 = hash(vec2(fi, id) + seed), h2 = hash(vec2(id * 1.7, fi) + seed * 0.37);
        float pAlong = APPROACH * (pow(progress, 1.4) - pow(born, 1.4)) + ph * 0.1 + (h2 - 0.5) * 0.06;
        float pAcross = (h1 - 0.5) * (0.05 + 0.42 * ph);
        float radius = (0.08 + 0.24 * ph) * (0.75 + 0.5 * h2);
        vec2 dv = vec2(along - pAlong, across - pAcross);
        float m = exp(-dot(dv, dv) / (radius * radius));
        float heat = 1.0 - smoothstep(0.0, 0.6, ph);
        emit += heatRamp(0.3 + 0.65 * heat, isVoid) * m * heat * (1.0 - ph) * 0.62;
        float s = m * smoothstep(0.2, 0.65, ph) * (1.0 - ph) * 0.42;
        smokeRGB = smokeRGB * (1.0 - s) + mix(vec3(0.22, 0.19, 0.17), vec3(0.17, 0.13, 0.21), isVoid) * s;
        smokeA = smokeA + s * (1.0 - smokeA);
      }
      // Sparks thrown sideways from the head.
      for (int k = 0; k < 8; k++) {
        float fk = float(k);
        float cycle = tau / SPARK_LIFE + fk / 8.0;
        float ph = fract(cycle), id = floor(cycle);
        float born = progress - ph * SPARK_LIFE / FALL_S;
        if (born < 0.0) continue;
        float h1 = hash(vec2(id, fk * 3.1) + seed), h2 = hash(vec2(fk, id * 2.3) + seed);
        float pAlong = APPROACH * (pow(progress, 1.4) - pow(born, 1.4)) + ph * 0.18 * h2;
        float pAcross = (h1 - 0.5) * 0.85 * ph;
        vec2 dv = vec2(along - pAlong, across - pAcross);
        float m = exp(-dot(dv, dv) / 0.0004);
        emit += heatRamp(0.9 - 0.3 * ph, isVoid) * m * (1.0 - ph) * 1.1;
      }
      // Fireball head: white-hot core inside flickering flame tongues, no solid body.
      float flick = floor(tau * 26.0);
      float tongues = 0.0;
      for (int j = 0; j < 5; j++) {
        float fj = float(j);
        float a = hash(vec2(fj, flick) + seed) * 6.2831853;
        vec2 c = vec2(0.04 + 0.07 * hash(vec2(flick, fj) + seed), 0.0) + 0.07 * vec2(cos(a), sin(a));
        vec2 dv = vec2(along, across) - c;
        tongues += exp(-dot(dv, dv) / 0.011);
      }
      float headR = dot(vec2(along * 1.25, across), vec2(along * 1.25, across));
      float core = exp(-headR / 0.0055);
      float halo = exp(-headR / 0.06) * 0.3;
      emit += heatRamp(0.7, isVoid) * tongues * 0.32 + heatRamp(1.0, isVoid) * core * 0.95 + heatRamp(0.6, isVoid) * halo;
      float appear = smoothstep(0.03, 0.14, progress);
      smokeA = clamp(smokeA, 0.0, 0.55);
      alpha = smokeA * appear;
      rgb = (smokeRGB * smokeA + emit * (1.0 - smokeA * 0.6)) * appear;
    }
  } else {
    if (age < 0.4) discard;
    // Lit smoke wisps leaving the crater and drifting with a per-strike breeze.
    float drift = (fract(seed * 0.381) - 0.5) * 1.2 + 0.6;
    vec2 wind = vec2(cos(drift), sin(drift));
    float life = smoothstep(0.4, 1.1, age) * (1.0 - smoothstep(3.6, 6.5, age));
    vec2 c = wind * 0.22 * age;
    float spread = 0.3 + 0.1 * age;
    float plume = exp(-dot(q - c, q - c) / (spread * spread));
    float tex = fbm((q - wind * age * 0.3) * 2.6 + seed);
    alpha = clamp(plume * (0.15 + 0.6 * tex) * life * 0.55, 0.0, 0.6);
    vec3 smoke = mix(vec3(0.24, 0.22, 0.2), vec3(0.42, 0.39, 0.36), tex);
    smoke = mix(smoke, vec3(0.22, 0.18, 0.26), isVoid);
    rgb = smoke * alpha;
  }
  if (!(uPass > 1.5 && uPass < 2.5 && age < 0.0)) { rgb *= edgeFade; alpha *= edgeFade; }
  rgb *= uAlpha; alpha = clamp(alpha * uAlpha, 0.0, 1.0);
  gl_FragColor = vec4(rgb, alpha);
}`;
