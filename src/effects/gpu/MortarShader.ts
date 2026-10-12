/**
 * Mortar strike passes. Lengths are in units of the damage radius R; the instance carries
 * (centre, corner, [R, timeline, seed, allied], age).
 * timeline: 0..1 windup progress (interruptible), 1..2 = 1 + flight progress (committed).
 * age < 0: incoming strike, else seconds since the replicated impact.
 *
 * Pass 0 (5.12, ground material): telegraph groove and area shade, the descending shell's drop
 *        shadow (sliding in against the sun as the shell loses height), then scorch, a small
 *        blast crater and the ragged dust front.
 * Pass 1 (19.7, emissive): segmented windup track, committed energy ring with contraction, and
 *        cooling void embers in the crater. The ring's outer edge is exactly R.
 * Pass 2 (20.6, airborne): the shell seen from above, tail first, losing height until it meets
 *        its shadow. Never a horizontal projectile path across the map.
 * Pass 3 (13.38, lit material): smoke rising from the crater.
 * Emissive light is written premultiplied with zero alpha (additive) so scene alpha stays intact.
 */
const SHARED = /* glsl */ `
const vec2 SHADOW_DIR = vec2(0.6, 0.8); // Shared top-left sun: shadows fall to the lower right.
float passSize(float pass) { return pass < 0.5 ? 2.05 : (pass < 1.5 ? 2.05 : (pass < 2.5 ? 0.5 : 2.1)); }`;

export const MORTAR_VERTEX = `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform mat4 uProjectionMatrix;
uniform mat3 uViewMatrix;
uniform float uPass;
attribute vec2 inCenter;
attribute vec2 inCorner;
attribute vec4 inState;
attribute float inAge;
attribute float inDir;
varying vec2 vLocal;
varying vec4 vState;
varying float vAge;
varying float vDir;
${SHARED}
void main() {
  vState = inState; vAge = inAge; vDir = inDir;
  vLocal = inCorner * passSize(uPass);
  vec2 world = inCenter + vLocal * inState.x;
  gl_Position = uProjectionMatrix * vec4((uViewMatrix * vec3(world, 1.0)).xy, 0.0, 1.0);
}`;

export const MORTAR_FRAGMENT = `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform float uPass;
uniform float uDetail;
uniform float uAlpha;
uniform float uTime;
varying vec2 vLocal;
varying vec4 vState;
varying float vAge;
varying float vDir;
${SHARED}
const float TAU = 6.2831853;
const float SEGMENTS = 24.0;
const float RING = 0.972;
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
float band(float r, float at, float width) { float d = (r - at) / width; return exp(-d * d); }
// Shot frame: x points from the aim point toward the shooter, y across that line.
vec2 shotFrame(vec2 q, float dir) { vec2 d = vec2(cos(dir), sin(dir)); return vec2(dot(q, d), dot(q, vec2(-d.y, d.x))); }
// Three chevrons outside the ring on the shooter's side, apex toward the centre, drifting inward:
// they read as "incoming from there". flow advances them; stroke is the half line width.
// Returns the crisp stroke in x and a soft glow around it in y.
vec2 incomingChevrons(vec2 s, float flow, float stroke) {
  vec2 sum = vec2(0.0);
  for (int k = 0; k < 3; k++) {
    float p = fract(float(k) / 3.0 - flow);
    float c = mix(1.6, 1.07, p);
    // Fade in far out, full in the middle, dissolve into the ring.
    float life = smoothstep(0.0, 0.25, p) * (1.0 - smoothstep(0.82, 1.0, p));
    float d = abs((s.x - c) - abs(s.y) * 0.85) * 0.76;
    // Arms taper from a strong apex to soft tips instead of ending in square cuts.
    float t = clamp(abs(s.y) / 0.12, 0.0, 1.0);
    float w = stroke * (1.0 - 0.55 * t);
    float tip = 1.0 - smoothstep(0.55, 1.0, t);
    float line = (1.0 - smoothstep(w, w + 0.012, d)) * tip * (1.0 - 0.3 * t);
    float halo = exp(-d * d / 0.0018) * (1.0 - smoothstep(0.3, 1.25, t));
    sum += vec2(line, halo) * life;
  }
  return min(sum, vec2(1.0));
}
// Soft guide along the shot line, from the ring outward, tapering away from the target.
float shotLane(vec2 s) {
  float width = mix(0.05, 0.022, smoothstep(1.0, 1.65, s.x));
  return exp(-s.y * s.y / (width * width)) * smoothstep(0.95, 1.03, s.x) * (1.0 - smoothstep(1.2, 1.68, s.x));
}
// Bright gate on the ring where the shot line crosses it.
float ringNotch(vec2 s, float r) {
  float a = atan(s.y, s.x);
  return exp(-a * a / 0.018) * band(r, 0.958, 0.04);
}
// Faction palette: void (hostile) or allied. Index 0 deep .. 3 core.
vec3 palette(float k, float allied) {
  vec3 v = k < 0.5 ? vec3(0.435, 0.086, 0.659) : (k < 1.5 ? vec3(0.702, 0.278, 1.0)
    : (k < 2.5 ? vec3(0.851, 0.549, 1.0) : vec3(0.976, 0.910, 1.0)));
  vec3 a = k < 0.5 ? vec3(0.04, 0.42, 0.28) : (k < 1.5 ? vec3(0.122, 0.890, 0.604)
    : (k < 2.5 ? vec3(0.541, 1.0, 0.812) : vec3(0.910, 1.0, 0.961)));
  return mix(v, a, allied);
}
vec3 ramp(float t, float allied) {
  vec3 c = mix(palette(0.0, allied), palette(1.0, allied), smoothstep(0.0, 0.4, t));
  c = mix(c, palette(2.0, allied), smoothstep(0.35, 0.75, t));
  return mix(c, palette(3.0, allied), smoothstep(0.75, 1.0, t));
}

void main() {
  float R = vState.x, timeline = vState.y, seed = vState.z, allied = vState.w, age = vAge;
  bool incoming = age < 0.0;
  bool committed = incoming && timeline >= 1.0;
  float windup = clamp(timeline, 0.0, 1.0);
  float flight = clamp(timeline - 1.0, 0.0, 1.0);
  vec2 q = vLocal;
  float r = length(q);
  // Clockwise from noon in screen space (y grows downwards).
  float u = fract(atan(q.x, -q.y) / TAU + 1.0);
  vec3 rgb = vec3(0.0); float alpha = 0.0;
  float size = passSize(uPass);
  float edgeFade = 1.0 - smoothstep(size * 0.8, size * 0.98, r);
  // Direction of fire, shown at the aim point: calm while interruptible, fast once committed.
  vec2 shot = shotFrame(q, vDir);
  float flow = uTime * (committed ? 1.7 : 0.55);
  float dirStrength = committed ? 1.0 : 0.35 + 0.65 * windup;

  if (uPass < 0.5) {
    if (incoming) {
      // Area shade: a slightly mottled darkening that deepens once the shot is committed.
      float mottle = fbm(q * 3.4 + seed);
      float inside = 1.0 - smoothstep(0.86, RING, r);
      float shadeA = inside * (committed ? 0.16 + 0.12 * flight : 0.07 + 0.08 * windup) * (0.75 + 0.5 * mottle);
      // Dark groove under the emissive ring keeps the boundary readable on bright ground.
      float grooveA = band(r, RING - 0.012, committed ? 0.05 : 0.04) * (committed ? 0.55 : 0.4);
      vec3 shadeC = mix(vec3(0.02, 0.012, 0.03), vec3(0.0, 0.025, 0.018), allied);
      alpha = clamp(shadeA + grooveA, 0.0, 0.75);
      rgb = shadeC * alpha;
      // Dark under-stroke for the direction chevrons and lane, so they read on bright ground too.
      vec2 under = incomingChevrons(shot, flow, 0.028);
      float underA = clamp(under.x * 0.5 + under.y * 0.18 + shotLane(shot) * 0.22, 0.0, 0.6) * dirStrength;
      alpha = underA + alpha * (1.0 - underA);
      rgb = shadeC * underA + rgb * (1.0 - underA);
      if (committed) {
        // Drop shadow: soft and displaced while high, contracting and sharpening onto the
        // aim point as the shell descends. Only the last part of the fall is visible.
        float descent = smoothstep(0.35, 1.0, flight);
        float height = 1.0 - flight;
        vec2 offset = SHADOW_DIR * 0.62 * height * height;
        float d = length(q - offset);
        float radius = mix(0.34, 0.14, descent);
        float soft = mix(0.75, 0.22, descent);
        float shadowA = (1.0 - smoothstep(radius * (1.0 - soft), radius * (1.0 + soft), d))
          * mix(0.22, 0.85, descent * descent);
        alpha = shadowA + alpha * (1.0 - shadowA);
        rgb = vec3(0.012, 0.01, 0.016) * shadowA + rgb * (1.0 - shadowA);
      }
    } else {
      float n = fbm(q * 3.6 + seed);
      // Dust front: fast out to just beyond the damage edge, thinning and gone early.
      float t = clamp(age / 0.65, 0.0, 1.0);
      float ang = u * TAU;
      float front = mix(0.25, 1.22, 1.0 - pow(1.0 - t, 2.6));
      float ragged = fbm(vec2(ang * 2.4, r * 3.2) + seed * 1.7);
      float ring = band(r - (ragged - 0.5) * 0.24, front, mix(0.24, 0.1, t));
      float veil = (1.0 - smoothstep(front * 0.3, front, r)) * 0.5;
      float dustA = clamp(ring * 0.7 + veil * 0.4, 0.0, 0.85) * (0.55 + 0.45 * ragged) * (1.0 - t);
      vec3 dust = mix(vec3(0.33, 0.27, 0.2), vec3(0.55, 0.47, 0.36), ragged);
      // Scorch with ejecta rays, a compact crater bowl and its raised rim lit from the upper left.
      float fade = (1.0 - smoothstep(3.0, 6.0, age)) * smoothstep(0.0, 0.06, age);
      float rays = fbm(vec2(ang * 4.2, r * 0.9) + seed * 3.1);
      float edge = r + (n - 0.5) * 0.22 - smoothstep(0.3, 0.85, r) * (rays - 0.45) * 0.6;
      float scorch = 1.0 - smoothstep(0.42, 0.82, edge);
      float bowl = 1.0 - smoothstep(0.18, 0.26, edge);
      float rim = band(edge, 0.27, 0.06);
      vec2 toLight = normalize(-SHADOW_DIR);
      vec2 dir = q / max(r, 1e-4);
      float wallLit = -dot(dir, toLight), rimLit = dot(dir, toLight);
      vec3 soot = mix(vec3(0.06, 0.05, 0.05), vec3(0.15, 0.12, 0.09), n);
      soot = mix(soot, palette(0.0, allied) * 0.22, 0.25 * (1.0 - smoothstep(0.2, 0.6, edge)));
      vec3 crater = mix(vec3(0.045, 0.035, 0.035), vec3(0.16, 0.12, 0.09), 0.5 + 0.5 * wallLit * smoothstep(0.06, 0.24, r));
      vec3 earth = mix(vec3(0.2, 0.15, 0.1), vec3(0.44, 0.35, 0.24), 0.5 + 0.5 * rimLit);
      // Thrown-out soil: darker ejecta streaks reaching past the scorch toward the damage edge.
      float streaks = smoothstep(0.62, 0.8, fbm(vec2(ang * 7.0, r * 1.4) + seed * 5.3))
        * smoothstep(0.25, 0.4, r) * (1.0 - smoothstep(0.6, 0.95, r));
      vec3 ground = mix(soot, crater, bowl);
      ground = mix(ground, earth, rim * 0.75);
      ground = mix(ground, vec3(0.1, 0.075, 0.055), streaks * 0.7);
      float groundA = clamp(scorch * (0.38 + 0.34 * smoothstep(0.75, 0.2, edge)) + bowl * 0.38 + rim * 0.3
        + streaks * 0.35, 0.0, 0.9) * fade;
      alpha = groundA + dustA * (1.0 - groundA);
      rgb = ground * groundA + dust * dustA * (1.0 - groundA);
    }
  } else if (uPass < 1.5) {
    if (incoming && !committed) {
      // Windup: one open segmented track. Segments fill clockwise from noon; permanent gaps keep
      // it visibly unfinished, so it can never be mistaken for the committed ring.
      float pulse = 0.5 + 0.5 * sin(TAU * (windup * 2.0 + windup * windup * windup * 2.0));
      float seg = floor(u * SEGMENTS), local = fract(u * SEGMENTS);
      float body = smoothstep(0.0, 0.05, local) * (1.0 - smoothstep(0.66, 0.72, local));
      float fill = clamp(windup * SEGMENTS - seg, 0.0, 1.0);
      float lit = body * (1.0 - smoothstep(fill * 0.72 - 0.02, fill * 0.72, local - 0.0));
      lit *= step(0.001, fill);
      float track = band(r, RING - 0.012, 0.016);
      float halo = band(r, RING - 0.012, 0.05);
      // The advancing head flares slightly so the eye can follow progress.
      float headD = abs(fract(u - windup + 0.5) - 0.5);
      float head = exp(-headD * headD / 0.00018) * step(0.002, windup) * band(r, RING - 0.012, 0.03);
      vec3 dim = palette(0.0, allied) * 0.42;
      vec3 hot = mix(palette(1.0, allied), palette(2.0, allied), 0.35 + 0.35 * pulse);
      rgb = dim * track * body * (1.0 - lit) + hot * (track * lit * (0.9 + 0.25 * pulse) + halo * lit * 0.22)
        + palette(3.0, allied) * head * 0.8;
      // Inward area ticks.
      float tickA = fract(u * 8.0 + 0.5) - 0.5;
      float tick = exp(-tickA * tickA / 0.0004) * (smoothstep(0.82, 0.86, r) - smoothstep(0.9, 0.93, r));
      rgb += palette(1.0, allied) * tick * 0.22;
      // Faint charge haze builds inside the area.
      float haze = (1.0 - smoothstep(0.55, RING, r)) * fbm(q * 2.6 + vec2(uTime * 0.25, -uTime * 0.18) + seed);
      rgb += palette(0.0, allied) * haze * windup * windup * 0.12;
      // Direction of fire: calm chevrons that strengthen while the shot charges.
      vec2 chev = incomingChevrons(shot, flow, 0.014);
      rgb += (hot * chev.x * (0.6 + 0.3 * pulse) + palette(1.0, allied) * chev.y * 0.3) * dirStrength
        + palette(1.0, allied) * shotLane(shot) * 0.2 * dirStrength
        + palette(2.0, allied) * ringNotch(shot, r) * 0.6 * dirStrength;
    } else if (committed) {
      // Committed: closed, brighter, faster. Energy crawls along the ring and a contraction
      // front pulls toward the aim point until impact.
      float fast = 0.5 + 0.5 * sin(TAU * flight * 5.0);
      float launchFlash = 1.0 - smoothstep(0.0, 0.12, flight);
      float crawl = fbm(vec2(u * 26.0 - uTime * 4.0, r * 9.0) + seed);
      float core = band(r, RING - 0.016, 0.022);
      float glow = band(r, RING - 0.02, 0.085);
      vec3 ringC = mix(palette(2.0, allied), palette(3.0, allied), 0.35 + 0.4 * fast);
      rgb = ringC * core * (1.0 + 0.45 * (crawl - 0.5) + 0.5 * launchFlash)
        + palette(1.0, allied) * glow * (0.38 + 0.22 * fast + 0.5 * launchFlash);
      // The front stops short of the aim point and fades, so it never frames the shell like a reticle.
      float rc = mix(0.93, 0.24, pow(flight, 0.85));
      float contraction = band(r, rc, 0.016) * (0.55 + 0.25 * fast) * (1.0 - smoothstep(0.7, 0.92, flight));
      float wake = (smoothstep(rc, rc + 0.18, r) - smoothstep(rc + 0.18, RING, r)) * 0.08;
      rgb += palette(2.0, allied) * contraction + palette(1.0, allied) * wake * (0.6 + crawl * 0.8);
      // Direction of fire: bright, fast chevrons; a flash when the shot is fired.
      vec2 chev = incomingChevrons(shot, flow, 0.016);
      rgb += mix(palette(2.0, allied), palette(3.0, allied), 0.2) * chev.x * (1.0 + launchFlash)
        + palette(1.0, allied) * chev.y * (0.5 + 0.4 * launchFlash)
        + palette(1.0, allied) * shotLane(shot) * (0.32 + 0.4 * launchFlash)
        + palette(3.0, allied) * ringNotch(shot, r) * (0.75 + launchFlash);
      // Approach heat on the aim point.
      // Broad and faint, so it lights the ground without haloing the shell into a ring.
      float pool = exp(-r * r / mix(0.35, 0.18, flight));
      rgb += ramp(0.4 + 0.4 * flight, allied) * pool * pow(flight, 2.0) * 0.14;
      float tickA = fract(u * 8.0 + 0.5) - 0.5;
      rgb += palette(2.0, allied) * exp(-tickA * tickA / 0.0004)
        * (smoothstep(0.8, 0.84, r) - smoothstep(0.9, 0.93, r)) * 0.4;
    } else {
      // Impact: one bright confirmation of the exact damage edge, then cooling void embers.
      float edgeFlash = band(r, RING - 0.02, 0.07) * exp(-age / 0.08) * 0.6;
      float pool = exp(-r * r / 0.22) * exp(-age / 0.3) * 0.55;
      float cool = exp(-age / 0.8) * (1.0 - smoothstep(1.8, 3.0, age));
      float n = fbm(q * 5.0 + seed * 1.3);
      float heart = exp(-r * r / 0.006);
      float seams = (1.0 - smoothstep(0.0, 0.05, abs(n - 0.5))) * (1.0 - smoothstep(0.05, 0.3, r));
      rgb = palette(2.0, allied) * edgeFlash + palette(1.0, allied) * pool
        + ramp(cool * (0.4 + 0.6 * heart), allied) * (heart * 0.8 + seams * 0.6) * cool;
    }
  } else if (uPass < 2.5) {
    if (!committed) discard;
    // Shell from directly above, tail toward the camera: it appears high and soft, then shrinks
    // and sharpens while dropping onto its shadow.
    float appear = smoothstep(0.5, 0.64, flight);
    float descent = smoothstep(0.5, 1.0, flight);
    float scale = mix(2.3, 1.0, pow(descent, 1.3));
    vec2 p = q / scale;
    float pr = length(p);
    float spin = seed * TAU + flight * 2.2;
    vec2 rp = vec2(cos(spin) * p.x - sin(spin) * p.y, sin(spin) * p.x + cos(spin) * p.y);
    float blur = mix(0.028, 0.005, descent);
    float bodyR = 0.085;
    float body = 1.0 - smoothstep(bodyR - blur, bodyR + blur, pr);
    // Tail unit seen end-on: four fins in a cross, reaching well past the casing.
    float finW = 0.016 + blur;
    float finX = 1.0 - smoothstep(finW * 0.45, finW, abs(rp.x));
    float finY = 1.0 - smoothstep(finW * 0.45, finW, abs(rp.y));
    float finLen = 1.0 - smoothstep(0.14 - blur, 0.15 + blur, max(abs(rp.x), abs(rp.y)));
    float fins = max(finX, finY) * finLen;
    float shape = max(body, fins);
    // Matte gunmetal lit from the upper left: a broad gradient, one soft highlight, a dark fuze cap.
    vec2 toLight = normalize(-SHADOW_DIR);
    vec2 dirP = p / max(pr, 1e-4);
    float sphere = sqrt(max(0.0, 1.0 - (pr / bodyR) * (pr / bodyR)));
    float lit = clamp(0.35 + 0.55 * dot(dirP, toLight) * (1.0 - sphere) + 0.35 * sphere, 0.0, 1.0);
    // Same materials as the badger's rig: dark steel casing with a warm copper driving band.
    vec3 metal = mix(vec3(0.1, 0.1, 0.11), vec3(0.46, 0.45, 0.45), lit);
    float spec = exp(-dot(p - toLight * bodyR * 0.45, p - toLight * bodyR * 0.45) / (bodyR * bodyR * 0.05));
    metal += vec3(0.35) * spec * body;
    float copper = band(pr, bodyR * 0.58, 0.012 + blur * 0.4) * body;
    metal = mix(metal, vec3(0.62, 0.34, 0.16) * (0.55 + 0.6 * lit), copper * 0.85);
    // Fins: dark plates with a bright lit edge, so the tail cross reads at game size.
    float finEdge = clamp(finX * (1.0 - smoothstep(0.0, finW * 0.55, abs(rp.x + finW * 0.3)))
      + finY * (1.0 - smoothstep(0.0, finW * 0.55, abs(rp.y + finW * 0.3))), 0.0, 1.0);
    vec3 finC = mix(vec3(0.05, 0.05, 0.06), vec3(0.5, 0.49, 0.48), finEdge * 0.6);
    vec3 shellC = mix(finC, metal, body);
    // Soft air wake seen end-on around the falling shell.
    float wake = exp(-pr * pr / 0.035) * (1.0 - descent) * 0.3;
    float a = shape * appear;
    alpha = clamp(a + wake * appear * (1.0 - a), 0.0, 1.0);
    rgb = shellC * a + vec3(0.16, 0.15, 0.17) * wake * appear * (1.0 - a);
  } else {
    if (incoming || age < 0.12) discard;
    // Lit smoke leaving the crater, drifting with a per-strike breeze.
    float drift = (fract(seed * 0.381) - 0.5) * 1.2 + 0.6;
    vec2 wind = vec2(cos(drift), sin(drift));
    float life = smoothstep(0.12, 0.6, age) * (1.0 - smoothstep(3.0, 5.5, age));
    vec2 c = wind * 0.2 * age;
    float spread = 0.32 + 0.12 * age;
    float plume = exp(-dot(q - c, q - c) / (spread * spread));
    float tex = fbm((q - wind * age * 0.3) * 2.8 + seed);
    alpha = clamp(plume * (0.2 + 0.65 * tex) * life * 0.6, 0.0, 0.62);
    vec3 smoke = mix(vec3(0.22, 0.2, 0.19), vec3(0.42, 0.39, 0.36), tex);
    smoke = mix(smoke, mix(palette(0.0, allied), vec3(0.24), 0.65), 0.3 * (1.0 - smoothstep(0.0, 1.5, age)));
    rgb = smoke * alpha;
  }
  rgb *= edgeFade; alpha *= edgeFade;
  rgb *= uAlpha; alpha = clamp(alpha * uAlpha, 0.0, 1.0);
  gl_FragColor = vec4(rgb, alpha);
}`;
