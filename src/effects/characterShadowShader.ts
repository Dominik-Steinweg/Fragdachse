import { CLOUD_SHADOW_GLSL } from './sunlight/cloudShadow';
import { CHARACTER_SHADOW_CONFIG } from './ShadowConfig';

export const CHARACTER_SHADOW_FRAGMENT = `
#pragma phaserTemplate(shaderName)
precision highp float;
varying vec2 outTexCoord;
uniform sampler2D uMask0,uMask1,uMask2,uMask3,uWeapon,uReceiver;
uniform vec4 uBounds0,uBounds1,uBounds2,uBounds3;
uniform vec4 uUv0,uUv1,uUv2,uUv3,uChannels,uWeights;
uniform vec4 uBounds,uBody,uTransform,uReceiverWorld;
uniform vec4 uWeaponAxis,uWeaponUv,uWeaponPose;
uniform vec4 uStrength;
uniform float uDebugSolid;
${CLOUD_SHADOW_GLSL}
float mask(sampler2D image,vec2 p,vec4 bounds,vec4 uv,float channel) {
  vec2 q=(p-bounds.xy)/bounds.zw;
  if(any(lessThan(q,vec2(0)))||any(greaterThan(q,vec2(1))))return 0.0;
  vec4 v=texture2D(image,uv.xy+q*uv.zw);
  if(channel<.5)return v.r;if(channel<1.5)return v.g;if(channel<2.5)return v.b;return v.a;
}
void main() {
  if(uDebugSolid>.5){gl_FragColor=vec4(1.0,0.0,1.0,1.0);return;}
  vec2 local=uBounds.xy+vec2(outTexCoord.x,1.0-outTexCoord.y)*uBounds.zw;
  vec2 scaled=local*uTransform.zw;
  vec2 world=uBody.xy+vec2(uTransform.x*scaled.x-uTransform.y*scaled.y,uTransform.y*scaled.x+uTransform.x*scaled.y);
  vec2 receiver=(world-uReceiverWorld.xy)/uReceiverWorld.zw;
  float response=0.0;
  if(all(greaterThanEqual(receiver,vec2(0)))&&all(lessThanEqual(receiver,vec2(1))))response=texture2D(uReceiver,receiver).r;
  float coverage=0.0;
  if(uStrength.x>0.0){
    coverage=dot(vec4(mask(uMask0,local,uBounds0,uUv0,uChannels.x),mask(uMask1,local,uBounds1,uUv1,uChannels.y),
      mask(uMask2,local,uBounds2,uUv2,uChannels.z),mask(uMask3,local,uBounds3,uUv3,uChannels.w)),uWeights);
    vec2 delta=world-uWeaponPose.xy;
    vec2 weapon=vec2(dot(delta,uWeaponAxis.xy),dot(delta,uWeaponAxis.zw))+uWeaponPose.zw;
    if(uStrength.w>0.0&&all(greaterThanEqual(weapon,vec2(0)))&&all(lessThanEqual(weapon,vec2(1))))
      coverage=max(coverage,texture2D(uWeapon,uWeaponUv.xy+weapon*uWeaponUv.zw).a*uStrength.w);
  }
  float direct=coverage*uStrength.x*cloudTransmission(world);
  vec2 foot=local/uBody.zw;
  float contact=(1.0-smoothstep(.25,1.0,length(foot)))*uStrength.y;
  float alpha=(1.0-(1.0-direct)*(1.0-contact))*uStrength.z*response;
  // MULTIPLY: alpha factors DST_ALPHA / ONE_MINUS_SRC_ALPHA preserve destination
  // alpha, including the transparent texels. Phaser ADD later depends on it.
  gl_FragColor=vec4(vec3(${CHARACTER_SHADOW_CONFIG.colour.join(',')})*alpha,alpha);
}`;
