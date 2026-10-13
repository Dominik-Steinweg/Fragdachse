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
  // The exit has no facing; only its flash uses the transport angle.
  if (kind < .5 || (kind > 1.5 && kind < 3.5)) q = p;
  float intensity = 0.0, core = 0.0;
  if (kind > 3.5) {
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
      float directed = pow(max(0.0,cos(a-(kind<.5?angle:0.0))),20.0);
      intensity += flash * line(r-R,1.0) * (kind < .5 ? directed*2.5 : 1.5);
      // Short outward needles in the shot direction, only at the exit.
      if (kind < .5) {
        float along = c*p.x+s*p.y, side = -s*p.x+c*p.y;
        float head = R + (1.0-flash)*radius*.70;
        core += flash * line(side,.4) * exp(-pow((along-head)/4.0,2.0));
        intensity += flash * line(side,1.2) * exp(-pow((along-head)/7.0,2.0))*.5;
      }
      if (kind > .5) {
        float strength = mode < .5 ? .92 : mode < 1.5 ? .22+.07*sin(uTime*2.2) : .09;
        intensity *= strength;
      }
    } else if (kind < 2.5) {
      float pulse = .5+.5*sin(uTime*TAU/1.2);
      intensity = line(r-R,.28) * (.16+.25*pulse);
    } else {
      intensity = line(r-R,.35)*.60 + line(r-R*.58,.20)*.22;
      core = exp(-r*r/2.0)*.7;
    }
    intensity += exp(-pow((r-R)/2.1,2.0))*.11;
  }
  vec3 rgb = vec3(.239,1.0,.816)*intensity + vec3(.91,1.0,.976)*core;
  gl_FragColor = vec4(rgb, clamp(max(rgb.r,max(rgb.g,rgb.b)),0.0,1.0)) * uAlpha * opening;
}`;
