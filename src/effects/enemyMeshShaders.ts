import { CLOUD_SHADOW_GLSL } from './sunlight/cloudShadow';
import { CHARACTER_SHADOW_CONFIG } from './ShadowConfig';

export const ENEMY_MESH_VERTEX = `
precision highp float;
attribute vec3 inPosition;
attribute vec4 inMatrix;
attribute vec3 inTranslation;
attribute vec4 inBounds;
attribute vec2 inTile;
uniform vec3 uSun;
uniform vec2 uGrid;
void main(){
 vec2 p=vec2(dot(inMatrix.xz,inPosition.xy),dot(inMatrix.yw,inPosition.xy))+inTranslation.xy;
 vec2 q=p-uSun.xy*max(0.0,inPosition.z*inTranslation.z)/max(.05,uSun.z);
 vec2 uv=((q-inBounds.xy)/inBounds.zw+inTile)/uGrid;
 gl_Position=vec4(uv.x*2.0-1.0,1.0-uv.y*2.0,0,1);
}`;
export const ENEMY_MESH_BLUR = `
precision highp float;
varying vec2 outTexCoord;
varying vec2 stepUv;
uniform sampler2D uMask;
uniform vec2 uGrid,uTexel;
float sampleTile(vec2 uv,vec2 lo,vec2 hi){return texture2D(uMask,clamp(uv,lo,hi)).r;}
void main(){
 vec2 cell=floor(outTexCoord*uGrid);
 vec2 lo=cell/uGrid+uTexel*.5,hi=(cell+1.0)/uGrid-uTexel*.5;
 float v=sampleTile(outTexCoord,lo,hi)*.2270270270;
 v+=(sampleTile(outTexCoord+stepUv*1.3846153846,lo,hi)+sampleTile(outTexCoord-stepUv*1.3846153846,lo,hi))*.3162162162;
 v+=(sampleTile(outTexCoord+stepUv*3.2307692308,lo,hi)+sampleTile(outTexCoord-stepUv*3.2307692308,lo,hi))*.0702702703;
 gl_FragColor=vec4(v,v,v,1);
}`;
export const ENEMY_MESH_BLUR_VERTEX = `
precision highp float;
attribute vec2 inPosition;
attribute vec4 inBounds,inTileAlpha;
uniform vec2 uGrid,uAxis;
varying vec2 outTexCoord,stepUv;
void main(){
 vec2 uv=(inTileAlpha.xy+inPosition)/uGrid;
 gl_Position=vec4(uv.x*2.0-1.0,1.0-uv.y*2.0,0,1);
 outTexCoord=vec2(uv.x,1.0-uv.y);
 stepUv=uAxis*inTileAlpha.w/inBounds.zw/uGrid;
}`;
export const ENEMY_MESH_DISPLAY_VERTEX = `
precision highp float;
attribute vec2 inPosition;
attribute vec4 inBounds;
attribute vec4 inTileAlpha;
attribute vec4 inFoot0,inFoot1,inFoot2,inFoot3;
uniform mat4 uProjectionMatrix;
uniform mat3 uViewMatrix;
uniform vec2 uGrid;
varying vec2 world,uv;
varying float opacity;
varying vec4 foot0,foot1,foot2,foot3;
void main(){
 world=inBounds.xy+inPosition*inBounds.zw;
 vec3 view=uViewMatrix*vec3(world,1);
 gl_Position=uProjectionMatrix*vec4(view.xy,0,1);
 uv=vec2((inTileAlpha.x+inPosition.x)/uGrid.x,1.0-(inTileAlpha.y+inPosition.y)/uGrid.y);
 opacity=inTileAlpha.z;
 foot0=inFoot0;foot1=inFoot1;foot2=inFoot2;foot3=inFoot3;
}`;
export const ENEMY_MESH_DISPLAY_FRAGMENT = `
precision highp float;
uniform sampler2D uMask,uReceiver;
uniform vec4 uReceiverWorld;
uniform float uStrength,uDebugSolid;
varying vec2 world,uv;
varying float opacity;
varying vec4 foot0,foot1,foot2,foot3;
${CLOUD_SHADOW_GLSL}
float contact(vec4 foot){return (1.0-smoothstep(.25,1.0,length(world-foot.xy)/max(.01,foot.z)))*foot.w;}
void main(){
 vec2 r=(world-uReceiverWorld.xy)/uReceiverWorld.zw;
 float response=0.0;
 if(all(greaterThanEqual(r,vec2(0)))&&all(lessThanEqual(r,vec2(1))))response=texture2D(uReceiver,r).r;
 float mask=texture2D(uMask,uv).r;
 if(uDebugSolid>.5){float a=mask*response*opacity;gl_FragColor=vec4(a,0,a,a);return;}
 float direct=mask*uStrength*cloudTransmission(world);
 float foot=max(max(contact(foot0),contact(foot1)),max(contact(foot2),contact(foot3)))*${CHARACTER_SHADOW_CONFIG.contactOpacity};
 float a=(1.0-(1.0-direct)*(1.0-foot))*response*opacity;
 gl_FragColor=vec4(vec3(${CHARACTER_SHADOW_CONFIG.colour.join(',')})*a,a);
}`;
