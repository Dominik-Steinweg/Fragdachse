export const MARKER_GPU_VERTEX = /* glsl */ `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform mat4 uProjectionMatrix;
uniform mat3 uViewMatrix;
uniform vec2 uPixelScale;
uniform float uRadiusScale;
attribute vec4 inCenterCorner;
attribute vec4 inGeometry;
attribute vec4 inColor;
attribute vec4 inState;
attribute vec4 inExtra;
attribute vec4 inUv;
attribute vec4 inFeedback;
varying vec2 vLocal;
varying vec4 vGeometry;
varying vec4 vColor;
varying vec4 vState;
varying vec4 vExtra;
varying vec4 vUv;
varying vec4 vFeedback;
varying float vAa;
void main() {
  float radius = inGeometry.x * uRadiusScale;
  float extent = radius + max(12.0, radius * .25 + 3.0);
  vLocal = inCenterCorner.zw * extent;
  vGeometry = vec4(radius, inGeometry.yzw);
  vColor = inColor; vState = inState; vExtra = inExtra; vUv = inUv; vFeedback = inFeedback;
  // Analytic antialiasing width: one framebuffer pixel in local design units. fwidth needs
  // OES_standard_derivatives, which ESSL 1.00 shaders on a WebGL2 context do not expose.
  vAa = 1.2 / max(inGeometry.y * uPixelScale.x, .001);
  vec3 center = uViewMatrix * vec3(inCenterCorner.xy, 1.0);
  vec2 position = center.xy + vLocal * inGeometry.y * uPixelScale;
  gl_Position = uProjectionMatrix * vec4(position, 0.0, 1.0);
}`;

export const MARKER_GPU_FRAGMENT = /* glsl */ `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform sampler2D uGlyphs;
uniform float uTime;
uniform float uGroundStrength;
varying vec2 vLocal;
varying vec4 vGeometry;
varying vec4 vColor;
varying vec4 vState;
varying vec4 vExtra;
varying vec4 vUv;
varying vec4 vFeedback;
varying float vAa;
const float PI = 3.14159265359;
float cover(float d) { float w = max(vAa, .45); return 1.0 - smoothstep(-w*.5, w*.5, d); }
float line(vec2 p, vec2 a, vec2 b) {
  vec2 v = b-a; return length(p-a-v*clamp(dot(p-a,v)/dot(v,v),0.0,1.0));
}
float triangle(vec2 p, vec2 a, vec2 b, vec2 c) {
  vec2 e0=b-a,e1=c-b,e2=a-c,v0=p-a,v1=p-b,v2=p-c;
  vec2 q0=v0-e0*clamp(dot(v0,e0)/dot(e0,e0),0.0,1.0);
  vec2 q1=v1-e1*clamp(dot(v1,e1)/dot(e1,e1),0.0,1.0);
  vec2 q2=v2-e2*clamp(dot(v2,e2)/dot(e2,e2),0.0,1.0);
  float s=sign(e0.x*e2.y-e0.y*e2.x);
  vec2 d=min(min(vec2(dot(q0,q0),s*(v0.x*e0.y-v0.y*e0.x)),
                 vec2(dot(q1,q1),s*(v1.x*e1.y-v1.y*e1.x))),
                 vec2(dot(q2,q2),s*(v2.x*e2.y-v2.y*e2.x)));
  return -sqrt(d.x)*sign(d.y);
}
void over(inout vec4 dst, vec3 color, float alpha) {
  alpha=clamp(alpha,0.0,1.0); dst=vec4(color*alpha,alpha)+dst*(1.0-alpha);
}
void main() {
  vec2 p=vLocal;
  float r=vGeometry.x;
  vec3 tone=vColor.rgb;
  vec4 result=vec4(0.0);
  float radial=length(p);
  if(vGeometry.z>1.5) {
    float ring=cover(abs(radial-r)-.9);
    float inner=cover(abs(radial-(r-3.0))-.35)*.18;
    over(result,vec3(.02,.015,.01),cover(abs(radial-r)-1.9)*.4);
    over(result,tone,(ring*.58+inner)*uGroundStrength);
    gl_FragColor=result*vGeometry.w; return;
  }
  float d=vGeometry.z>.5 ? triangle(p,vec2(0.0,-r),vec2(r*.95,r*.85),vec2(-r*.95,r*.85)) : radial-r;
  // Slow expanding impulse; quality disables both this and vulnerability animation.
  if(vState.w>0.0) {
    float phase=mod(uTime,vState.w)/vState.w;
    float impulse=cover(abs(radial-r*(1.0+.25*phase))-.7);
    over(result,tone,impulse*.5*(1.0-phase));
  }
  vec2 direction=vec2(cos(vExtra.x),sin(vExtra.x));
  vec2 q=vec2(dot(p,direction),dot(p,vec2(-direction.y,direction.x)));
  float anchor=vGeometry.z>.5 && vExtra.y<7.0 ? r*.85 : r;
  float pointer=triangle(q,vec2(anchor-2.0,-3.5*vExtra.y/6.0),vec2(anchor+vExtra.y,0.0),vec2(anchor-2.0,3.5*vExtra.y/6.0));
  float silhouette=min(d,pointer);
  over(result,vec3(0.0),cover(silhouette-1.0)*.4);
  vec3 brass=mix(vec3(.44,.28,.12),vec3(.88,.69,.36),clamp(.55-p.y/(r*2.2)-p.x/(r*6.0),0.0,1.0));
  over(result,brass,cover(pointer));
  over(result,brass,cover(d));
  // A narrow warm bevel, no noise or sparkling highlights.
  over(result,vec3(.94,.78,.46),cover(abs(d+1.0)-.28)*.42);
  // Brass and tone rim scale with the badge (30 px: 2.6 + 3), so the clamped 22 px
  // badge still keeps a readable walnut disc and glyph.
  float brassW=clamp(r*.17,1.6,4.2), rimW=clamp(r*.2,1.8,4.7), innerD=brassW+rimW;
  // Detail size follows the badge (authored at a 30 px badge), so dots and marks grow with it.
  float k=max(r/15.0,.8);
  vec3 walnut=mix(vec3(.075,.044,.025),vec3(.145,.095,.055),clamp(.5-p.y/(2.0*r),0.0,1.0));
  over(result,walnut,cover(d+brassW));
  vec3 innerTone=tone;
  if(vFeedback.w>=0.0) innerTone=tone*(.65+.35*vFeedback.w);
  if(vState.z>.5) {
    float pulse=vExtra.w>.5 ? .82+.18*sin(uTime*2.0*PI/1600.0) : 1.0;
    innerTone=vec3(pulse);
  }
  over(result,innerTone,cover(d+brassW)*(1.0-cover(d+innerD)));
  // Contained danger glow bleeds into the walnut only; no ground or screen flash.
  if(vFeedback.w>=0.0) over(result,tone,cover(d+innerD)*exp(-abs(d+innerD)/2.0)*vFeedback.w*.45);
  // Thin dark seam keeps the light glyph and the tone rim apart on the walnut disc.
  over(result,vec3(0.0),cover(abs(d+innerD+.3)-.35)*.35);
  if(vColor.w>=0.0) {
    float angle=mod(atan(p.x,-p.y)+2.0*PI,2.0*PI);
    float arc=1.0-smoothstep(vColor.w*2.0*PI-.035,vColor.w*2.0*PI+.035,angle);
    if(vColor.w==0.0) arc=0.0;
    if(vColor.w>=1.0) arc=1.0;
    if(vFeedback.w>=0.0) over(result,vec3(.025,.018,.012),cover(abs(d-2.0)-1.6)*.9);
    over(result,vFeedback.rgb,cover(abs(d-2.0)-(vFeedback.w>=0.0?1.35:.85))*arc);
  }
  vec2 glyphP=p-vec2(0.0,vGeometry.z>.5?2.0:0.0);
  // Keep the whole silhouette inside the 22 px lower zoom clamp. At the authored
  // badge diameters this is 16 px; a triangle has less usable interior than a disc.
  float glyphSize=min(vExtra.z,max(7.0,vGeometry.z>.5?r*.9-3.0:2.0*(r-innerD)-1.0));
  vec2 glyphUv=glyphP/glyphSize+.5;
  float inside=step(0.0,glyphUv.x)*step(glyphUv.x,1.0)*step(0.0,glyphUv.y)*step(glyphUv.y,1.0);
  float glyph=texture2D(uGlyphs,mix(vUv.xy,vUv.zw,clamp(glyphUv,0.0,1.0))).a*inside;
  over(result,vec3(.96,.92,.80),glyph*cover(d+innerD+.4));
  if(vState.x>0.0) {
    vec3 tierColor=vState.x<1.5?vec3(.73,.35,.19):vState.x<2.5?vec3(.59,.62,.29):vec3(.36,.79,.81);
    for(int i=0;i<3;i++) {
      if(float(i)>=vState.x) break;
      vec2 dotP=p-vec2((float(i)-(vState.x-1.0)*.5)*6.0*k,r+9.0*k);
      over(result,vec3(0.0),cover(length(dotP)-2.8*k)*.4);
      over(result,tierColor,cover(length(dotP)-2.0*k));
    }
  }
  if(vState.y>.5) {
    vec2 mark=(p-vec2(r*.72,r*.68))/k;
    over(result,walnut,cover((length(mark)-5.7)*k));
    over(result,tone,cover((abs(length(mark)-5.0)-.7)*k));
    float symbol=vState.y<1.5
      ? min(line(mark,vec2(-2.7,0.0),vec2(-.7,2.0)),line(mark,vec2(-.7,2.0),vec2(3.0,-2.5)))
      : min(line(mark,vec2(-2.2),vec2(2.2)),line(mark,vec2(-2.2,2.2),vec2(2.2,-2.2)));
    over(result,vec3(.96,.92,.80),cover((symbol-.9)*k));
  }
  gl_FragColor=result*vGeometry.w;
}`;
