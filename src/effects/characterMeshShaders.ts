import { CLOUD_SHADOW_GLSL } from './sunlight/cloudShadow';
import { CHARACTER_SHADOW_CONFIG } from './ShadowConfig';

export const CHARACTER_MESH_VERTEX = `
precision highp float;
attribute vec3 inPosition;
uniform mat4 uModel;
uniform vec3 uSun;
uniform vec4 uBounds;
void main() {
  vec3 p=(uModel*vec4(inPosition,1.0)).xyz;
  vec2 q=p.xy-uSun.xy*max(0.0,p.z)/max(0.05,uSun.z);
  vec2 uv=(q-uBounds.xy)/uBounds.zw;
  // Texture v=0 is the bottom of a framebuffer; store north at v=1, like Phaser RTTs.
  gl_Position=vec4(uv.x*2.0-1.0,1.0-uv.y*2.0,0.0,1.0);
}`;
// Opaque writes with blending OFF implement a union independent of winding/overlap count.
export const CHARACTER_MESH_MASK = `precision highp float; void main(){gl_FragColor=vec4(1.0);}`;
export const CHARACTER_MESH_BLUR = `
precision highp float;
varying vec2 outTexCoord;
uniform sampler2D uMask;
uniform vec2 uStep;
void main(){
  float v=texture2D(uMask,outTexCoord).r*0.2270270270;
  v+=(texture2D(uMask,outTexCoord+uStep*1.3846153846).r+texture2D(uMask,outTexCoord-uStep*1.3846153846).r)*0.3162162162;
  v+=(texture2D(uMask,outTexCoord+uStep*3.2307692308).r+texture2D(uMask,outTexCoord-uStep*3.2307692308).r)*0.0702702703;
  gl_FragColor=vec4(v,v,v,1.0);
}`;
export const CHARACTER_MESH_COMPOSITE = `
precision highp float;
varying vec2 outTexCoord;
uniform sampler2D uMask,uReceiver;
uniform vec4 uBounds,uBody,uReceiverWorld;
uniform vec4 uStrength;
uniform vec4 uBodyInverse;
uniform float uDebugSolid;
${CLOUD_SHADOW_GLSL}
void main(){
  vec2 world=uBounds.xy+vec2(outTexCoord.x,1.0-outTexCoord.y)*uBounds.zw;
  vec2 r=(world-uReceiverWorld.xy)/uReceiverWorld.zw;
  float response=0.0;
  if(all(greaterThanEqual(r,vec2(0)))&&all(lessThanEqual(r,vec2(1))))response=texture2D(uReceiver,r).r;
  float mask=texture2D(uMask,outTexCoord).r;
  if(uDebugSolid>.5){float a=mask*response*uStrength.z;gl_FragColor=vec4(a,0.0,a,a);return;}
  vec2 d=world-uBody.xy;
  vec2 local=vec2(dot(d,uBodyInverse.xy),dot(d,uBodyInverse.zw));
  float contact=(1.0-smoothstep(.25,1.0,length(local/uBody.zw)))*uStrength.y;
  float direct=mask*uStrength.x*cloudTransmission(world);
  float alpha=(1.0-(1.0-direct)*(1.0-contact))*response*uStrength.z;
  // PMA MULTIPLY preserves destination alpha (required by Phaser's ONE/DST_ALPHA ADD).
  gl_FragColor=vec4(vec3(${CHARACTER_SHADOW_CONFIG.colour.join(',')})*alpha,alpha);
}`;
