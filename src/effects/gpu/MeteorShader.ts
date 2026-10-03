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
varying vec2 p;
varying vec4 state;
varying float age;
void main() {
  p = inCorner; state = inState; age = inAge;
  vec2 local = inCorner * 1.12;
  if(uPass > 1.5) local = vec2(inCorner.x*0.85-0.25,inCorner.y*1.15-0.6);
  vec2 offset = vec2(0.0);
  if (uPass > 1.5) offset = vec2(-0.65, -1.45) * inState.x * pow(1.0-inState.y, 1.5);
  vec2 world = inCenter + offset + local * inState.x;
  if(uPass > 0.5 && inAge >= 0.0) world = inCenter;
  gl_Position = uProjectionMatrix * vec4((uViewMatrix * vec3(world, 1.0)).xy, 0.0, 1.0);
}`;

export const METEOR_FRAGMENT = `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform float uPass;
uniform float uDetail;
uniform float uZoom;
uniform float uAlpha;
varying vec2 p;
varying vec4 state;
varying float age;
float hash(vec2 v) { return fract(sin(dot(v,vec2(127.1,311.7))) * 43758.5453); }
float noise(vec2 v) {
  vec2 i=floor(v), f=fract(v); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.0),f.x),f.y);
}
float grain(vec2 v) {
  float n=noise(v)*0.65;
  if(uDetail > 0.5) n+=noise(v*2.13)*0.25+noise(v*4.27)*0.1;
  else n+=0.175;
  return n;
}
void main() {
  float progress=state.y, seed=state.z;
  vec3 hot=mix(vec3(1.0,0.38,0.065),vec3(0.61,0.20,1.0),state.w);
  vec3 pale=mix(vec3(1.0,0.86,0.53),vec3(0.89,0.72,1.0),state.w);
  vec3 color=vec3(0); float alpha=0.0;
  float px=1.0/max(8.0,state.x*uZoom);
  if(uPass < 0.5) {
    vec2 q=p*1.12; float r=length(q);
    if(age < 0.0) {
      // Circular overhead shadow, growing at the actual landing position.
      float shadow=1.0-smoothstep(0.06+progress*0.14,0.16+progress*0.23,r);
      alpha=shadow*(0.12+progress*0.27); color=vec3(0.035,0.023,0.019);
    } else {
      float n=grain(q*8.0+seed);
      float edge=r+(n-0.5)*0.18;
      float soot=1.0-smoothstep(0.47,0.87,edge);
      float bowl=1.0-smoothstep(0.32,0.49,edge);
      float rim=exp(-pow((edge-0.49)*21.0,2.0));
      color=mix(vec3(0.14,0.095,0.063),vec3(0.035,0.024,0.019),bowl);
      color+=rim*(0.05+0.09*n);
      alpha=soot*(0.22+0.48*bowl+0.14*n)*(1.0-smoothstep(3.0,7.0,age));
    }
  } else if(uPass < 1.5) {
    if(age >= 0.0) discard;
    vec2 q=p*1.12; float r=length(q);
    float angle=fract(atan(q.y,q.x)/6.2831853+0.25+1.0);
    float ring=1.0-smoothstep(px*0.7,px*1.5,abs(r-1.0));
    float backing=1.0-smoothstep(px*1.6,px*2.7,abs(r-1.0));
    float countdown=1.0-smoothstep(progress,progress+0.006,angle);
    float moving=exp(-pow((r-(1.08-progress*0.08))/max(px,0.004),2.0))*0.2;
    // Thin fixed danger boundary, clockwise timer; never a filled warning disk.
    alpha=backing*0.22+ring*(0.08+countdown*0.36)+moving*0.45;
    color=mix(vec3(0.09,0.055,0.035),mix(hot,pale,0.48),ring);
    float ticks=(1.0-smoothstep(px,px*2.0,min(abs(q.x),abs(q.y))))
      *smoothstep(0.86,0.9,r)*(1.0-smoothstep(1.045,1.065,r));
    alpha=max(alpha,ticks*0.63); color=mix(color,pale,ticks);
  } else {
    if(age >= 0.0 || progress < 0.12) discard;
    vec2 q=vec2(p.x*0.85-0.25,p.y*1.15-0.6);
    // Oblique velocity projected onto an orthographic overhead view, no perspective ellipse.
    vec2 axis=normalize(vec2(-0.65,-1.45));
    float along=dot(q,axis), across=dot(q,vec2(-axis.y,axis.x));
    float size=0.10+progress*0.20;
    float n=grain(q*12.0+vec2(seed,progress*7.0));
    float r=length(q);
    float body=1.0-smoothstep(size*0.84,size*1.04,r+(n-0.5)*size*0.42);
    float core=1.0-smoothstep(size*0.1,size*0.86,r);
    float tailLength=0.45+progress*1.05;
    float tail=exp(-pow(across/max(0.025,size*(0.7-along*0.35)),2.0)*2.0)
      *smoothstep(-0.04,0.13,along)*(1.0-smoothstep(0.18,tailLength,along));
    tail*=0.45+0.55*grain(vec2(across*22.0,along*9.0-progress*18.0)+seed);
    float halo=exp(-r*r/(size*size*3.0))*0.14;
    alpha=(body*0.98+tail*0.7+halo)*smoothstep(0.12,0.3,progress);
    float fissure=smoothstep(0.43,0.52,n)*(1.0-smoothstep(0.55,0.62,n));
    color=mix(hot*0.32,pale,clamp(core*(0.32+n)+fissure*body*0.55+tail*0.3,0.0,1.0));
  }
  alpha=clamp(alpha*uAlpha,0.0,1.0);
  gl_FragColor=vec4(color*alpha,alpha);
}`;
