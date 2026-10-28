import { CLOUD_SHADOW_GLSL } from '../../effects/sunlight/cloudShadow';
import { SURFACE_LIGHT_GLSL } from '../../effects/SurfaceLocalLights';
import { FORMATION_RESPONSE_GLSL } from '../rocks/rockFormationShader';

/** Canvas placement shared by every structure pass. Texture Y=0 is the image bottom (GL). */
const CANVAS_GLSL = `
uniform vec4 uCanvas;   // canvas top-left in world px, canvas size in px, unused
uniform vec2 uHeight;   // height range in px
// World px offset to texture uv offset (world Y grows downwards, texture Y upwards).
vec2 structureUvStep(vec2 world){return vec2(world.x,-world.y)/uCanvas.z;}
`;

/**
 * Elevation pass of a structure (`linear-unorm8-z-oct-normal-v1`): R height between the
 * manifest's min/max, GB octahedral normal in world orientation, A coverage. Phaser uploads
 * it premultiplied, so every read divides by coverage.
 */
const ELEVATION_GLSL = `${CANVAS_GLSL}
uniform sampler2D uElevation;
vec3 structureOct(vec2 e){vec2 f=e*2.0-1.0;vec3 n=vec3(f,1.0-abs(f.x)-abs(f.y));
float t=max(0.0,-n.z);n.xy+=mix(vec2(t),vec2(-t),step(vec2(0),n.xy));return normalize(n);}
float structureHeight(vec2 uv){
  if(any(lessThan(uv,vec2(0)))||any(greaterThan(uv,vec2(1))))return 0.0;
  vec4 d=texture2D(uElevation,uv);
  return d.a>.02?mix(uHeight.x,uHeight.y,clamp(d.r/d.a,0.0,1.0)):0.0;
}
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
// 1 by default; a fort fading out of a planning view (Bauhof) lowers it.
uniform float uFade;
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
    // Every px close by, then every third: a palisade is only a few px thick where two round stakes
    // touch, and fixed coarse steps skip it at the same distances, combing the shadow on the deck.
    for(int k=1;k<=40;k++){
      float t=k<=12?float(k):12.0+float(k-12)*3.0;
      float h=structureHeight(uv+stepUv*t);
      horizon=max(horizon,atan(h-h0-1.5,t));
    }
  }
  vec4 options=uOptions;options.x*=cloudFormStrength(world);
  vec3 factor=formationResponse(normal,horizon,vec4(1.0,horizon,horizon,1.0),uSun,options,0.0);
  factor*=surfaceNightResponse(normal,world);
  // Subpixel coverage never lights the ground beside the contour.
  factor=1.0+min(factor-1.0,vec3(0.0))*smoothstep(0.0,.35,d.a)+max(factor-1.0,vec3(0.0))*smoothstep(.7,1.0,d.a);
  gl_FragColor=formationMultiply(mix(vec3(1.0),factor,uFade));
}
`;

/** Upper bound of shadow march steps: caster texels a ray can cross within the reach. */
export const LOBBY_STRUCTURE_SHADOW_MAX_STEPS = 160;

/**
 * Sun (or moon) shadow of a structure on the ground around it: a ground point is shaded when
 * the structure toward the light rises high enough to reach it (length per px of height from
 * the shared shadow profile). Drawn in the long-caster band, below the structure itself.
 *
 * The ray walks the caster-height grid (solid geometry only, max-pooled, two px per texel) texel
 * by texel and reads each crossed texel once, filtered at the middle of its stretch of ray. Fixed
 * march steps beat against the texel grid and the filter ramps: thin posts and stake tips then
 * cast combs of teeth at the beat period. Only the stretch inside the canvas is walked.
 *
 * Structures that carry turrets (the base fort) add a second height grid on the same texels: the
 * mounted turrets' heights above their deck. Both rise into one shadow; the lobby passes none.
 */
export const LOBBY_STRUCTURE_SHADOW_FRAGMENT = `
#pragma phaserTemplate(shaderName)
precision highp float;
varying vec2 outTexCoord;
uniform vec4 uQuad;     // quad top-left in world px, quad size in px
uniform vec4 uCast;     // cast direction xy, length per px of height, max reach in px
uniform vec2 uShade;    // opacity, softness in px
uniform float uTexels;  // caster texels across the canvas
uniform sampler2D uCaster;
uniform sampler2D uMountedCaster;
uniform vec3 uMounted;  // deck height in px, mounted height range in px (0: none), 1 when its rows run top down
${CANVAS_GLSL}
vec4 shadowMultiply(float factor){float retained=min(1.0,factor);return vec4(vec3(factor-retained),1.0-retained);}
void main(){
  vec2 world=uQuad.xy+vec2(outTexCoord.x,1.0-outTexCoord.y)*uQuad.zw;
  vec2 local=(world-uCanvas.xy)/uCanvas.z;
  vec2 uv=vec2(local.x,1.0-local.y);
  vec2 back=structureUvStep(-uCast.xy);
  // Clip the ray toward the light to the canvas square: outside it nothing casts.
  vec2 safe=vec2(abs(back.x)<1e-6?1e-6:back.x,abs(back.y)<1e-6?1e-6:back.y);
  vec2 t0=-uv/safe,t1=(1.0-uv)/safe;
  float enter=max(0.0,max(min(t0.x,t1.x),min(t0.y,t1.y)));
  float leave=min(uCast.w,min(max(t0.x,t1.x),max(t0.y,t1.y)));
  if(enter>leave)discard;
  // Grid walk in texel units; t stays in world px along the ray.
  vec2 dir=back*uTexels;
  vec2 pos=(uv+back*enter)*uTexels+dir*1e-3;
  vec2 cell=floor(pos);
  vec2 stepCell=vec2(dir.x<0.0?-1.0:1.0,dir.y<0.0?-1.0:1.0);
  vec2 delta=vec2(abs(dir.x)<1e-6?1e9:abs(1.0/dir.x),abs(dir.y)<1e-6?1e9:abs(1.0/dir.y));
  vec2 next=enter+vec2(stepCell.x>0.0?cell.x+1.0-pos.x:pos.x-cell.x,stepCell.y>0.0?cell.y+1.0-pos.y:pos.y-cell.y)*delta;
  float t=enter,shade=0.0,soft=max(1.0,uShade.y);
  for(int k=0;k<${LOBBY_STRUCTURE_SHADOW_MAX_STEPS};k++){
    if(t>leave)break;
    float exit=min(next.x,next.y);
    if(cell.x>=0.0&&cell.y>=0.0&&cell.x<uTexels&&cell.y<uTexels){
      // Filtered read where the ray runs through this texel: continuous across neighbouring rays.
      float mid=.5*(t+min(exit,leave));
      vec2 at=uv+back*mid;
      float r=texture2D(uCaster,at).r,h=r>.002?mix(uHeight.x,uHeight.y,r):0.0;
      if(uMounted.y>0.0){
        float m=texture2D(uMountedCaster,vec2(at.x,uMounted.z>.5?1.0-at.y:at.y)).r;
        if(m>.004)h=max(h,uMounted.x+m*uMounted.y);
      }
      if(h>0.0)shade=max(shade,clamp((h*uCast.z-mid)/soft+.5,0.0,1.0));
      if(shade>=1.0)break;
    }
    if(next.x<next.y){t=next.x;next.x+=delta.x;cell.x+=stepCell.x;}
    else{t=next.y;next.y+=delta.y;cell.y+=stepCell.y;}
  }
  if(shade<=.001)discard;
  gl_FragColor=shadowMultiply(1.0-uShade.x*shade);
}
`;
