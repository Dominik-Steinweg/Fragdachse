import { CLAW_VFX_FAN_RAYS } from '../enemyClaw/EnemyClawVfxStore';

/**
 * Alien energy cone ("Energie-Fächer") – one emissive pass above the night lightmap.
 *
 * One quad per item in the cone frame (local +x = cone axis, origin = caster). Instance words:
 *   inA     [originX, originY, angle, range]
 *   inShape [halfArc, kind, t, seed]
 *   inAux   [allied, intensity, muzzlePx, unused]
 *   inClipA/B      packed cover reaches, two per float (q0 * 256 + q1, 0..255 = fraction of
 *                  range), 16 rays from the left to the right edge.
 *
 * kind 0 charge   t = windup progress 0..1: motes spiral into a pulsing core at the muzzle inside
 *                 a turning rune ring; a faint glow already leaks along the axis.
 * kind 1 wave     t = seconds since the impulse: a star flare and shock ring at the muzzle, then
 *                 a thick, turbulent plasma shell expands to the clipped reach with echo rings,
 *                 outward energy streams, branching bolts and streaked sparks; flanks fray into
 *                 wisps instead of lines, and embers drift on after the shell has passed.
 * kind 2 quiet    t = windup progress: faint jade glow of an allied cone (no warning role).
 *
 * The red ground telegraph is the gameplay contract; this layer is presentation and favours a
 * beautiful, organic void-energy look (saturated violet, white only in the hottest core).
 */
export const ALIEN_CONE_KIND = { charge: 0, wave: 1, quiet: 2 } as const;
/** The shell reaches the full (clipped) reach after this long. */
export const ALIEN_CONE_WAVE_TRAVEL_S = 0.22;
/** Last visible moment of the wave (embers included) after the impulse. */
export const ALIEN_CONE_WAVE_LIFE_S = 0.9;

const RAYS = CLAW_VFX_FAN_RAYS;
/** Quad margin around the fan for bloom, wisps, sparks and embers. */
const MARGIN = 64;

export const ALIEN_CONE_VERTEX = `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform mat4 uProjectionMatrix;
uniform mat3 uViewMatrix;
attribute vec4 inA;
attribute vec2 inCorner;
attribute vec4 inShape;
attribute vec4 inAux;
attribute vec4 inClipA;
attribute vec4 inClipB;
varying vec2 vLocal;
varying vec4 vA;
varying vec4 vShape;
varying vec4 vAux;
varying vec4 vRays0;
varying vec4 vRays1;
varying vec4 vRays2;
varying vec4 vRays3;
vec2 unpack(float p) { float hi = floor(p / 256.0); return vec2(hi, p - hi * 256.0) / 255.0; }
void main() {
  vA = inA; vShape = inShape; vAux = inAux;
  vRays0 = vec4(unpack(inClipA.x), unpack(inClipA.y));
  vRays1 = vec4(unpack(inClipA.z), unpack(inClipA.w));
  vRays2 = vec4(unpack(inClipB.x), unpack(inClipB.y));
  vRays3 = vec4(unpack(inClipB.z), unpack(inClipB.w));
  float range = inA.w, halfArc = inShape.x, kind = inShape.y;
  vec2 lo, hi;
  if (kind < 0.5) {
    // Charge: a square around the muzzle socket, stretched a little along the axis.
    lo = vec2(inAux.z - 64.0, -64.0); hi = vec2(inAux.z + 90.0, 64.0);
  } else {
    float side = range * sin(min(halfArc, 1.5707)) + ${MARGIN.toFixed(1)};
    lo = vec2(-${(MARGIN + 30).toFixed(1)}, -side); hi = vec2(range + ${MARGIN.toFixed(1)}, side);
  }
  vec2 local = mix(lo, hi, inCorner * 0.5 + 0.5);
  vLocal = local;
  float c = cos(inA.z), s = sin(inA.z);
  vec2 world = inA.xy + vec2(c * local.x - s * local.y, s * local.x + c * local.y);
  gl_Position = uProjectionMatrix * vec4((uViewMatrix * vec3(world, 1.0)).xy, 0.0, 1.0);
}`;

export const ALIEN_CONE_FRAGMENT = `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform float uTime;
uniform float uDetail;
uniform float uAlpha;
varying vec2 vLocal;
varying vec4 vA;
varying vec4 vShape;
varying vec4 vAux;
varying vec4 vRays0;
varying vec4 vRays1;
varying vec4 vRays2;
varying vec4 vRays3;
const float PI = 3.14159265;
const float TRAVEL = ${ALIEN_CONE_WAVE_TRAVEL_S.toFixed(3)};
const float LIFE = ${ALIEN_CONE_WAVE_LIFE_S.toFixed(3)};

float hash(vec2 v) { return fract(sin(dot(v, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 v) {
  vec2 i = floor(v), f = fract(v); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + 1.0), f.x), f.y);
}
float fbm(vec2 v) {
  float sum = noise(v) * 0.5 + noise(v * 2.03 + 17.1) * 0.27;
  if (uDetail > 0.5) sum += noise(v * 4.11 + 41.3) * 0.15 + noise(v * 8.27 + 73.7) * 0.08;
  else sum += 0.23;
  return sum;
}
float gauss(float x, float w) { float k = x / w; return exp(-k * k); }
float ray(int i) {
  if (i < 4) return i == 0 ? vRays0.x : i == 1 ? vRays0.y : i == 2 ? vRays0.z : vRays0.w;
  if (i < 8) return i == 4 ? vRays1.x : i == 5 ? vRays1.y : i == 6 ? vRays1.z : vRays1.w;
  if (i < 12) return i == 8 ? vRays2.x : i == 9 ? vRays2.y : i == 10 ? vRays2.z : vRays2.w;
  return i == 12 ? vRays3.x : i == 13 ? vRays3.y : i == 14 ? vRays3.z : vRays3.w;
}
// Clipped reach (fraction of range) at angle offset a; matches energyConeReachAt on the CPU.
float reachAt(float a, float halfArc) {
  float g = clamp((a + halfArc) / (2.0 * halfArc), 0.0, 1.0) * ${(RAYS - 1).toFixed(1)};
  float i0 = min(floor(g), ${(RAYS - 2).toFixed(1)});
  float f = g - i0;
  float r0 = 0.0, r1 = 0.0;
  for (int i = 0; i < ${RAYS - 1}; i++) {
    if (float(i) == i0) { r0 = ray(i); r1 = ray(i + 1); }
  }
  return mix(r0, r1, f);
}
// Void energy: deep violet glow → magenta-violet body → light violet core, a touch of white at
// the very peak. Allied casters use the jade family.
vec3 energy(float e, float allied) {
  float s = 1.0 - exp(-1.3 * max(e, 0.0));
  vec3 deep = mix(vec3(0.36, 0.04, 0.72), vec3(0.03, 0.32, 0.22), allied);
  vec3 body = mix(vec3(0.74, 0.20, 1.00), vec3(0.14, 0.86, 0.60), allied);
  vec3 core = mix(vec3(0.93, 0.68, 1.00), vec3(0.64, 1.00, 0.88), allied);
  vec3 c = mix(deep, body, smoothstep(0.0, 0.5, s));
  c = mix(c, core, 0.85 * smoothstep(0.7, 0.99, s));
  c = mix(c, vec3(1.0, 0.97, 1.0), 0.08 * smoothstep(0.97, 1.0, s));
  return c * s * 1.5;
}
// Glints: a cell grid of short radial streaks (motion-blurred sparks).
float streaks(vec2 p, float ang, float r, float density, float len, float t, float seed) {
  vec2 cell = vec2(floor(ang * density), floor(r / len));
  float h = hash(cell + seed * 19.0);
  if (h < 0.82) return 0.0;
  float ca = (cell.x + 0.3 + 0.4 * hash(cell + 3.1)) / density;
  float cr = (cell.y + 0.5) * len;
  vec2 dir = vec2(cos(ca), sin(ca));
  vec2 q = p - dir * cr;
  float along = dot(q, dir), across = dot(q, vec2(-dir.y, dir.x));
  float flick = 0.55 + 0.45 * sin(t * 50.0 + h * 40.0);
  return gauss(across, 0.9) * gauss(along, len * 0.32) * flick;
}

void main() {
  float range = vA.w, halfArc = vShape.x, kind = vShape.y, t = vShape.z, seed = vShape.w;
  float allied = vAux.x, intensity = vAux.y, muzzle = vAux.z;
  vec2 p = vLocal;
  float r = length(p);
  float ang = atan(p.y, p.x);
  vec3 rgb = vec3(0.0);
  float alpha = 0.0;

  if (kind < 0.5) {
    // ---------------------------------------------------------------- charge
    vec2 q = p - vec2(muzzle, 0.0);
    float rho = length(q), phi = atan(q.y, q.x);
    float pr = clamp(t, 0.0, 1.0);
    float pulse = 0.85 + 0.15 * sin(uTime * (10.0 + 18.0 * pr));
    float core = gauss(rho, 2.5 + 7.5 * pr) * (0.6 + 1.6 * pr) * pulse
      + gauss(rho, 16.0 + 14.0 * pr) * 0.35 * pr;
    // Motes spiralling inward on six arms, faster toward the impulse.
    float motes = 0.0;
    for (int k = 0; k < 6; k++) {
      float fk = float(k);
      float cycle = fract(uTime * (0.9 + 1.4 * pr) + hash(vec2(fk, seed)));
      float rad = mix(58.0, 3.0, cycle * cycle);
      float a = fk * 1.0472 + cycle * 3.2 + seed * 6.0;
      vec2 mp = vec2(cos(a), sin(a)) * rad;
      vec2 dirIn = normalize(-mp + vec2(0.0001));
      vec2 d = q - mp;
      float along = dot(d, dirIn), across = dot(d, vec2(-dirIn.y, dirIn.x));
      motes += gauss(across, 1.1) * gauss(along + 3.0, 5.0 + 6.0 * cycle) * smoothstep(0.0, 0.25, cycle) * (1.0 - cycle * 0.5);
    }
    // A turning rune ring of broken arc segments.
    float ringR = 22.0 - 6.0 * pr;
    float seg = step(0.42, fract((phi + uTime * (1.2 + 2.0 * pr)) * 6.0 / (2.0 * PI)));
    float runes = gauss(rho - ringR, 0.9) * seg * smoothstep(0.1, 0.5, pr);
    float runes2 = gauss(rho - ringR * 1.45, 0.7) * step(0.7, fract((phi - uTime * 1.6) * 10.0 / (2.0 * PI))) * smoothstep(0.4, 0.9, pr) * 0.6;
    // Energy already leaking forward along the axis.
    float leak = gauss(p.y, 6.0 + 10.0 * pr) * smoothstep(muzzle, muzzle + 10.0, p.x) * exp(-(p.x - muzzle) / (40.0 + 60.0 * pr))
      * pr * pr * (0.6 + 0.4 * noise(vec2(p.x * 0.08 - uTime * 8.0, seed)));
    float e = (core * 1.5 + motes * 1.1 + runes * 0.9 + runes2 + leak * 0.8) * intensity;
    rgb = energy(e, allied);
  } else if (kind < 1.5) {
    // ---------------------------------------------------------------- wave
    float aa = abs(ang);
    // The muzzle flare spans every direction; elsewhere only the fan and its margin are shaded.
    if ((aa > halfArc + 0.45 && r > 80.0) || r > range + ${MARGIN.toFixed(1)}) discard;
    float angN = ang / halfArc;
    float reach = reachAt(clamp(ang, -halfArc, halfArc), halfArc) * range;
    float u = clamp(t / TRAVEL, 0.0, 1.0);
    float front = range * (1.0 - pow(1.0 - u, 2.3));
    float shellFade = 1.0 - smoothstep(TRAVEL * 0.9, TRAVEL * 2.4, t);
    float lifeFade = 1.0 - smoothstep(LIFE * 0.6, LIFE, t);

    // Soft, frayed envelope: flanks dissolve into wisps, the reach blooms past the cover line.
    float erosion = fbm(vec2(r * 0.028 - t * 3.0, angN * 5.0 + seed * 7.0));
    float flankEdge = 0.86 + 0.28 * (erosion - 0.5);
    float angEnv = 1.0 - smoothstep(flankEdge - 0.45, flankEdge + 0.08, abs(angN));
    float radEnv = 1.0 - smoothstep(reach - 22.0, reach + 10.0 + 14.0 * erosion, r);
    float hub = smoothstep(2.0, 18.0, r);
    float env = angEnv * radEnv * hub;
    float wisp = (1.0 - smoothstep(0.0, 0.3, abs(abs(angN) - flankEdge))) * radEnv * hub
      * smoothstep(0.45, 0.85, fbm(vec2(r * 0.05 - t * 6.0, angN * 9.0 + seed)));

    // Turbulent plasma flowing outward, domain-warped.
    vec2 q = vec2(angN * 3.2, r * 0.022 - t * 5.5);
    vec2 warp = vec2(fbm(q * 1.4 + seed * 3.0), fbm(q * 1.4 + vec2(5.2, 1.3) + seed));
    float turb = fbm(q * 2.1 + warp * 1.9);
    float plasma = smoothstep(0.32, 0.9, turb);
    float ridge = pow(1.0 - abs(fbm(q * 3.4 + warp * 2.4) * 2.0 - 1.0), 7.0);

    // Shell: a thick luminous band riding the front, widening as it expands.
    float shellW = 10.0 + 34.0 * u;
    float shellPos = min(front, reach + 6.0);
    float shell = gauss(r - shellPos, shellW) * shellFade;
    float crest = gauss(r - shellPos, 2.6 + 3.0 * u) * shellFade;
    // Echo rings trailing the shell.
    float echoes = 0.0;
    for (int k = 1; k <= 2; k++) {
      float fk = float(k);
      float tk = max(t - 0.06 * fk, 0.0);
      float uk = clamp(tk / TRAVEL, 0.0, 1.0);
      float fr = range * (1.0 - pow(1.0 - uk, 2.3));
      echoes += gauss(r - min(fr, reach), 2.0 + 4.0 * uk) * (0.45 / fk) * step(0.001, tk) * (1.0 - smoothstep(TRAVEL, TRAVEL * 2.6, tk));
    }
    // Trail behind the shell: dissipating plasma and outward energy streams.
    float behind = 1.0 - smoothstep(front - 6.0, front + 6.0, r);
    float since = max(front - r, 0.0);
    float trail = behind * exp(-since / (50.0 + 90.0 * u)) * (1.0 - smoothstep(TRAVEL * 0.6, TRAVEL * 3.2, t));
    float streams = pow(noise(vec2(angN * 26.0 + seed * 9.0, r * 0.018 - t * 9.0)), 5.0) * 2.2 * trail;

    // Branching bolts from the core into the field.
    float bolts = 0.0;
    if (uDetail > 0.5) {
      for (int k = 0; k < 3; k++) {
        float fk = float(k);
        float strike = floor(t * 18.0 + fk * 0.41);
        float base = (hash(vec2(fk, seed + strike)) * 2.0 - 1.0) * halfArc * 0.7;
        float path = base + (fbm(vec2(r * 0.02 + fk * 7.0, strike * 1.3)) - 0.5) * 0.3
          + (noise(vec2(r * 0.17 + fk * 3.0, strike * 2.7)) - 0.5) * 0.05;
        float d = abs(ang - path) * r;
        float splitR = mix(0.3, 0.7, hash(vec2(fk, strike + 3.0))) * range;
        float bend = hash(vec2(fk + 9.0, strike)) > 0.5 ? 0.4 : -0.4;
        float branchD = abs(ang - path - (r - splitR) / range * bend) * r;
        float branch = gauss(branchD, 0.6) * step(splitR, r) * (1.0 - smoothstep(splitR, splitR + 80.0, r));
        float live = step(0.25, hash(vec2(strike, fk + seed))) * behind * smoothstep(16.0, 50.0, r);
        bolts += (gauss(d, 0.7) + gauss(d, 4.0) * 0.25 + 0.7 * branch) * live;
      }
      bolts *= 1.0 - smoothstep(TRAVEL, TRAVEL * 2.8, t);
    }

    // Sparks: streaked glints on the shell and spraying past the edges.
    float sparkField = streaks(p, ang, r, 34.0 / halfArc, 18.0, t, seed);
    float sparks = sparkField * (shell * 1.6 + wisp * 0.8 + gauss(r - reach, 26.0) * smoothstep(0.6, 1.0, u) * shellFade);

    // Embers: slow motes drifting on after the shell has passed.
    float emberLife = clamp((t - TRAVEL * 0.8) / (LIFE - TRAVEL * 0.8), 0.0, 1.0);
    vec2 ecell = floor(vec2(angN * 11.0, r / 26.0));
    float eh = hash(ecell + seed * 23.0);
    vec2 epos = vec2(cos((ecell.x + 0.5) / 11.0 * halfArc), sin((ecell.x + 0.5) / 11.0 * halfArc))
      * ((ecell.y + 0.5) * 26.0 + emberLife * 22.0 * eh) + vec2(-sin(eh * 6.3), cos(eh * 6.3)) * 5.0;
    float embers = step(0.62, eh) * gauss(length(p - epos), 1.5 + 1.0 * eh) * (1.0 - emberLife) * smoothstep(0.0, 0.15, emberLife)
      * (0.5 + 0.5 * sin(t * 30.0 + eh * 50.0)) * radEnv * angEnv;

    // Muzzle: star flare and an expanding shock ring at release.
    vec2 m = p - vec2(muzzle * 0.6, 0.0);
    float mr = length(m), ma = atan(m.y, m.x);
    float flareT = 1.0 - smoothstep(0.0, 0.18, t);
    float star = gauss(mr, 5.0) * 2.2 + gauss(mr, 22.0) * 0.6
      + pow(abs(cos(ma * 2.0)), 60.0) * exp(-mr / 14.0) * 0.9;
    float shockR = 44.0 * smoothstep(0.0, 0.14, t);
    float shock = gauss(mr - shockR, 3.0 + 14.0 * t) * (1.0 - smoothstep(0.03, 0.13, t)) * 0.3
      * (0.7 + 0.3 * noise(vec2(ma * 6.0, seed * 5.0)));

    // Cover: where the profile clipped the fan, the shell splashes against the obstacle.
    float clipped = step(reach, range * 0.97);
    float arrived = smoothstep(reach - 14.0, reach, front);
    // Broken, flickering splash instead of a continuous line along the stepped cover profile.
    float splashNoise = smoothstep(0.35, 0.9, fbm(vec2(ang * 40.0 + seed * 5.0, r * 0.08 - t * 12.0)));
    float splash = clipped * arrived * gauss(r - reach, 7.0 + 6.0 * u) * splashNoise * shellFade;

    float field = (shell * (0.55 + 1.1 * plasma) + crest * 1.2 + echoes + trail * (0.35 * plasma + ridge * 0.9)
      + streams * 0.5 + bolts * 1.15) * env;
    float e = (field * 0.72 + wisp * (0.5 + plasma) * shellFade * 0.7 + sparks * 1.2 + splash * 1.3 + embers * 1.3) * lifeFade
      + (star * flareT + shock) * 1.1;
    e *= intensity;
    rgb = energy(e, allied);
    // A translucent violet haze where the plasma passes gives the fan body on bright ground.
    alpha = clamp((shell * 0.5 + trail * 0.35) * env * (0.4 + 0.6 * plasma) * 0.22 * intensity * (1.0 - allied * 0.6), 0.0, 0.2);
    rgb += mix(vec3(0.30, 0.03, 0.60), vec3(0.03, 0.28, 0.20), allied) * alpha * 0.8;
  } else {
    // ---------------------------------------------------------------- allied quiet windup
    float aa = abs(ang);
    if (aa > halfArc + 0.2) discard;
    float angN = ang / halfArc;
    float reach = reachAt(clamp(ang, -halfArc, halfArc), halfArc) * range;
    float env = (1.0 - smoothstep(reach - 30.0, reach, r)) * (1.0 - smoothstep(0.6, 1.0, abs(angN))) * smoothstep(12.0, 40.0, r);
    float drift = fbm(vec2(angN * 4.0, r * 0.02 - uTime * 1.5));
    float e = env * (0.08 + 0.12 * drift) * (0.3 + 0.7 * clamp(t, 0.0, 1.0)) * intensity;
    rgb = energy(e, 1.0);
  }
  rgb *= uAlpha; alpha = clamp(alpha * uAlpha, 0.0, 1.0);
  gl_FragColor = vec4(rgb, alpha);
}`;
