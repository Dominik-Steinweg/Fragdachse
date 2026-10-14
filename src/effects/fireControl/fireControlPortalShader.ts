export const FIRE_CONTROL_VERTEX = `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform mat4 uProjectionMatrix;
uniform mat3 uViewMatrix;
attribute vec4 inGeom, inShape, inState;
varying vec2 vLocal;
varying vec4 vShape, vState;
void main() {
  vec3 p = uViewMatrix * vec3(inGeom.xy, 1.0);
  gl_Position = uProjectionMatrix * vec4(p.xy, 0.0, 1.0);
  vLocal = inGeom.zw; vShape = inShape; vState = inState;
}`;
export const FIRE_CONTROL_FRAGMENT = `
#pragma phaserTemplate(shaderName)
precision mediump float;
uniform float uTime, uPixel, uAlpha;
varying vec2 vLocal;
varying vec4 vShape, vState;
const float TAU = 6.2831853;
float line(float d, float w) { return 1.0 - smoothstep(w, w + uPixel * .8, abs(d)); }
void main() {
  float radius = vShape.x, angle = vShape.y, kind = vShape.z, opening = vShape.w;
  float remaining = vState.x, flash = vState.y, mode = vState.z;
  vec2 p = vLocal;
  float c = cos(angle), s = sin(angle);
  vec2 q = vec2(c*p.x+s*p.y, -s*p.x+c*p.y);
  // The exit has no facing; per-shot flashes are separate ExitFlash instances.
  if (kind < .5 || (kind > 1.5 && kind < 3.5)) q = p;
  float intensity = 0.0, core = 0.0;
  if (kind > 4.5) {
    // One directed burst per transported shot. q is aligned with the shot: +x points outward.
    // The ring segment flares, then a short streak leaves the iris; nothing points back
    // toward the source turret.
    float r = length(q), a = atan(q.y, q.x);
    float R = radius;
    float wedge = pow(max(0.0, cos(a)), 14.0);
    intensity = line(r - R, 1.3) * wedge * 2.6 * flash;
    intensity += exp(-pow((r - R) / 3.5, 2.0)) * pow(max(0.0, cos(a)), 6.0) * .9 * flash;
    float head = R + (1.0 - flash) * R * .9;
    float streak = exp(-pow(q.y / 1.1, 2.0)) * step(R * .9, q.x) * exp(-pow((q.x - head) / (5.0 + 6.0 * (1.0 - flash)), 2.0));
    intensity += streak * 1.4 * flash;
    core += streak * flash * 1.2 + line(r - R, .5) * wedge * flash;
  } else if (kind > 3.5) {
    // Projection beam: projector lens (x = 0) to its copy (x = radius). Strictly local; the
    // renderer never emits one across portal or map distances. A narrow cone widens toward the
    // hologram, data motes flow outward, and the whole beam flares when the copy fires (flash).
    float L = radius;
    float inside = step(0.0, q.x) * (1.0 - smoothstep(L - 13.0, L - 8.0, q.x));
    float t = clamp(q.x / max(L, 1.0), 0.0, 1.0);
    float across = abs(q.y) / mix(.7, 5.0, t);
    float cone = (1.0 - smoothstep(.45, 1.0, across)) * inside;
    float axis = line(q.y, .22) * inside;
    float motes = 0.0;
    for (int i = 0; i < 3; i++) {
      float phase = fract(uTime * 1.5 + float(i) / 3.0 + vState.w * .137);
      float mx = phase * (L - 9.0);
      motes += exp(-pow((q.x - mx) / 1.5, 2.0) - pow(q.y / .8, 2.0)) * sin(phase * 3.14159);
    }
    float shimmer = .85 + .15 * sin(uTime * 9.0 + q.x * .6 + vState.w);
    intensity = (cone * .20 + axis * .17) * shimmer + motes * inside * .85;
    intensity *= 1.0 + flash * 2.4;
    core = motes * inside * .30 + axis * flash * .5;
  } else if (kind > .5 && kind < 1.5) {
    // Muzzle portal: its own readable iris, an ellipse across the firing line (q.x = barrel axis).
    // Bold segmented rim, a swirling throat and a clear halo carry it at game size; modes dim it.
    float closed = mode > 1.5 ? .6 : 1.0;
    vec2 e = vec2(q.x * 1.6, q.y);
    float r = length(e), a = atan(e.y, e.x);
    float R = radius * max(.02, opening) * closed;
    float segments = .55 + .45 * smoothstep(.18, .32, fract((a + uTime * 1.4) / TAU * 4.0));
    float rim = line(r - R, .9) * segments;
    float outer = line(r - R * 1.18, .35) * .45;
    float swirl = .5 + .5 * sin(a * 3.0 - uTime * 6.0 + r * .55);
    float throat = (1.0 - smoothstep(0.0, R * .95, r)) * (.22 + .28 * swirl);
    float halo = exp(-pow((r - R) / 3.2, 2.0)) * .45;
    intensity = rim * 1.25 + outer + throat + halo;
    // Swallow: the rim flares and contracts while the throat flashes.
    intensity += flash * (line(r - R * (1.0 - .3 * flash), 1.1) * 1.2 + exp(-r * r / 9.0) * .6);
    core = rim * .35 + flash * exp(-r * r / 6.0) * .45;
    float strength = mode < .5 ? 1.0 : mode < 1.5 ? .42 + .12 * sin(uTime * 2.4) : .16;
    intensity *= strength; core *= strength;
  } else {
    float r = length(q), a = atan(q.y,q.x);
    float R = radius * max(.02, opening);
    if (kind < 1.5) {
      float segment = smoothstep(.10,.20, fract((a-uTime*.18)/TAU*8.0));
      float ring = line(r-R,.48) * segment;
      float inner = line(r-R*.84,.14)*.27;
      float ticks = line(sin(a*24.0)*r,.12) * step(R*1.07,r) * (1.0-step(R*1.18,r)) * .40;
      float cross = max(line(q.x,.13)* (1.0-smoothstep(2.0,4.0,abs(q.y))),
                        line(q.y,.13)* (1.0-smoothstep(2.0,4.0,abs(q.x)))) * .26;
      float lens = (1.0-smoothstep(0.0,R,r)) * .024;
      float rest = line(r-R*1.25,.16)*step(fract((a+1.5708)/TAU), remaining)*.20;
      intensity = ring+inner+ticks+cross+lens+rest;
      // Any recent transport makes the whole exit iris breathe briefly (direction lives in ExitFlash).
      intensity *= 1.0 + flash * .45;
    } else if (kind < 2.5) {
      float pulse = .5+.5*sin(uTime*TAU/1.2);
      intensity = line(r-R,.28) * (.16+.25*pulse);
    } else {
        // Halo outside the physical tripod; the sprite owns the central optical core.
        intensity = line(r-R,.35)*.42;
    }
    intensity += exp(-pow((r-R)/2.1,2.0))*.11;
  }
  vec3 rgb = vec3(.239,1.0,.816)*intensity + vec3(.91,1.0,.976)*core;
  gl_FragColor = vec4(rgb, clamp(max(rgb.r,max(rgb.g,rgb.b)),0.0,1.0)) * uAlpha * opening;
}`;
