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
    // Local projector thread only. Length is radius; no portal-distance connection exists.
    float wobble = sin(q.x*.7-uTime*15.0+vState.w) * .45;
    intensity = line(q.y-wobble,.15) * step(0.0,q.x) * (1.0-smoothstep(radius*.7,radius,q.x))
      * (.16+.12*sin(uTime*31.0+vState.w));
  } else {
    if (kind > .5 && kind < 1.5) q.x *= 2.9;
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
      // Exit: any recent transport makes the whole iris breathe briefly (direction lives in ExitFlash).
      // Entry: the iris swallows the shot, contracting inward.
      if (kind < .5) intensity *= 1.0 + flash * .45;
      else intensity += flash * (line(r - R * (1.0 - .35 * flash), .9) * 1.6 + exp(-r * r / 3.0) * .8);
      if (kind > .5) {
        float strength = mode < .5 ? .92 : mode < 1.5 ? .22+.07*sin(uTime*2.2) : .09;
        intensity *= strength;
      }
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
