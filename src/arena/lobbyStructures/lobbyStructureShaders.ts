import { CLOUD_SHADOW_GLSL } from '../../effects/sunlight/cloudShadow';
import { SURFACE_LIGHT_GLSL } from '../../effects/SurfaceLocalLights';
import { FORMATION_RESPONSE_GLSL } from '../rocks/rockFormationShader';

/**
 * Elevation pass of a structure (`linear-unorm8-z-oct-normal-v1`): R height between the
 * manifest's min/max, GB octahedral normal in world orientation, A coverage. Phaser uploads
 * it premultiplied, so every read divides by coverage. Texture Y=0 is the image bottom (GL).
 */
const ELEVATION_GLSL = `
uniform sampler2D uElevation;
uniform vec4 uCanvas;   // canvas top-left in world px, canvas size in px, unused
uniform vec2 uHeight;   // height range in px
vec3 structureOct(vec2 e){vec2 f=e*2.0-1.0;vec3 n=vec3(f,1.0-abs(f.x)-abs(f.y));
float t=max(0.0,-n.z);n.xy+=mix(vec2(t),vec2(-t),step(vec2(0),n.xy));return normalize(n);}
float structureHeight(vec2 uv){
  if(any(lessThan(uv,vec2(0)))||any(greaterThan(uv,vec2(1))))return 0.0;
  vec4 d=texture2D(uElevation,uv);
  return d.a>.02?mix(uHeight.x,uHeight.y,clamp(d.r/d.a,0.0,1.0)):0.0;
}
// World px offset to texture uv offset (world Y grows downwards, texture Y upwards).
vec2 structureUvStep(vec2 world){return vec2(world.x,-world.y)/uCanvas.z;}
`;

/**
 * Relief of a structure's albedo under the shared sun, clouds, moon and lamps: the same
 * relative response as the rock formations (a flat roof stays neutral, the world light map
 * keeps all irradiance). Self-shadow comes from the steepest occluder toward the sun.
 */
export const LOBBY_STRUCTURE_RELIEF_FRAGMENT = `
#pragma phaserTemplate(shaderName)
precision highp float;
varying vec2 outTexCoord;
uniform vec3 uSun;
uniform vec4 uOptions;
${ELEVATION_GLSL}
${FORMATION_RESPONSE_GLSL}
${CLOUD_SHADOW_GLSL}
${SURFACE_LIGHT_GLSL}
void main(){
  vec2 uv=outTexCoord;
  vec4 d=texture2D(uElevation,uv);
  if(d.a<.004)discard;
  vec3 normal=structureOct(clamp(d.gb/d.a,0.0,1.0));
  float h0=mix(uHeight.x,uHeight.y,clamp(d.r/d.a,0.0,1.0));
  vec2 world=uCanvas.xy+vec2(uv.x,1.0-uv.y)*uCanvas.z;
  float horizon=-1.5;
  float planar=length(uSun.xy);
  if(planar>.001){
    vec2 stepUv=structureUvStep(uSun.xy/planar);
    for(int k=1;k<=28;k++){
      float t=float(k)*3.0;
      float h=structureHeight(uv+stepUv*t);
      horizon=max(horizon,atan(h-h0-1.5,t));
    }
  }
  vec4 options=uOptions;options.x*=cloudFormStrength(world);
  vec3 factor=formationResponse(normal,horizon,vec4(1.0,horizon,horizon,1.0),uSun,options,0.0);
  factor*=surfaceNightResponse(normal,world);
  // Subpixel coverage never lights the ground beside the contour.
  factor=1.0+min(factor-1.0,vec3(0.0))*smoothstep(0.0,.35,d.a)+max(factor-1.0,vec3(0.0))*smoothstep(.7,1.0,d.a);
  gl_FragColor=formationMultiply(factor);
}
`;

/**
 * Sun (or moon) shadow of a structure on the ground around it: a ground point is shaded when
 * the structure toward the light rises high enough to reach it (length per px of height from
 * the shared shadow profile). Drawn in the long-caster band, below the structure itself.
 */
export const LOBBY_STRUCTURE_SHADOW_FRAGMENT = `
#pragma phaserTemplate(shaderName)
precision highp float;
varying vec2 outTexCoord;
uniform vec4 uQuad;     // quad top-left in world px, quad size in px
uniform vec4 uCast;     // cast direction xy, length per px of height, max reach in px
uniform vec2 uShade;    // opacity, softness in px
${ELEVATION_GLSL}
vec4 shadowMultiply(float factor){float retained=min(1.0,factor);return vec4(vec3(factor-retained),1.0-retained);}
void main(){
  vec2 world=uQuad.xy+vec2(outTexCoord.x,1.0-outTexCoord.y)*uQuad.zw;
  vec2 local=(world-uCanvas.xy)/uCanvas.z;
  vec2 uv=vec2(local.x,1.0-local.y);
  vec2 back=structureUvStep(-uCast.xy);
  float shade=0.0;
  for(int k=0;k<=40;k++){
    float t=uCast.w*float(k)/40.0;
    float h=structureHeight(uv+back*t);
    shade=max(shade,clamp((h*uCast.z-t)/max(1.0,uShade.y)+.5,0.0,1.0)*step(.5,h));
  }
  if(shade<=.001)discard;
  gl_FragColor=shadowMultiply(1.0-uShade.x*shade);
}
`;
