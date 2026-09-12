export const WATER_SHADER_NAME = 'FragdachseWaterSurface';
export const WATER_FRAGMENT = `
#pragma phaserTemplate(shaderName)
precision highp float;
varying vec2 outTexCoord;
uniform sampler2D uMask;
uniform vec2 uOrigin;
uniform float uSize;
uniform float uHalo;
uniform float uTime;
uniform float uSeed;

float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}
float field(vec2 p) { return noise(p)*.58 + noise(p*2.03+17.3)*.28 + noise(p*4.07+8.1)*.14; }
void main() {
  vec2 uv=outTexCoord;
  vec4 mask=texture2D(uMask,(uv*uSize+uHalo)/(uSize+2.0*uHalo));
  float alpha=smoothstep(.12,.88,mask.b);
  if(alpha<.002) discard;
  // Canvas samplers use bottom-up UVs; world Y grows downwards.
  vec2 p=uOrigin+vec2(uv.x,1.0-uv.y)*uSize;
  vec2 q=p*.013+vec2(uSeed);
  float t=uTime;
  float broad=field(p*.004+uSeed);
  float a=field(q+vec2(t*.042,-t*.023));
  float b=field(q*1.63+vec2(-t*.029,t*.036)+a*.6);
  float ripples=sin(p.x*.082+p.y*.046+a*7.0-t*.85)
    +.45*sin(p.x*-.055+p.y*.103+b*6.0+t*.66);
  float depth=smoothstep(.02,.85,mask.r);
  vec3 shallow=vec3(.22,.39,.34);
  vec3 deep=vec3(.065,.22,.255);
  vec3 color=mix(shallow,deep,depth)*(.87+broad*.25);
  color+=vec3(.11,.18,.16)*(a-.5)+vec3(.025,.043,.042)*ripples;
  float glint=pow(max(0.0,1.0-abs(ripples*.53+b*.30-.50)),15.0);
  glint*=smoothstep(.42,.74,a)*(.35+.65*depth);
  color+=vec3(.30,.40,.36)*glint*.34;
  // Narrow, broken wavelets roll toward a stable shoreline; no oscillating geometry.
  float shore=mask.r*48.0;
  float wave=pow(max(0.0,.5+.5*sin(shore*.70-t*.95+b*4.0)),12.0);
  float fringe=exp(-shore*.16)*smoothstep(0.0,3.5,shore);
  color+=vec3(.40,.45,.35)*wave*fringe*(.16+.18*a);
  color*=mix(.68,1.0,smoothstep(0.0,2.6,shore));
  gl_FragColor=vec4(color*alpha,alpha);
}
`;
