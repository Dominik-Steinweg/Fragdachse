import { CLOUD_SHADOW_GLSL } from '../../effects/sunlight/cloudShadow';
import { HORIZON_BLEND_GLSL } from './FormationHorizonTransition';
import { FORMATION, FORMATION_SIDE } from './RockFormationField';
import type { RockLightingState } from './RockLightingState';

// Shared parameters keep CPU debris lighting and the surface/foliage shaders aligned.
// Slightly cooler relative fill keeps sheltered mineral faces from inheriting
// the morning lightmap's full olive cast. Unoccluded horizontal faces stay neutral.
const FILL = [.75, .94, 1.65] as const;
const SUN = [1, .92, .78] as const;
const FILL_POWER = .28, SUN_POWER = 1.35, CONTACT_FLOOR = .72;
const HIGHLIGHT_HEADROOM = .85, HIGHLIGHT_GAIN = 4.0;
const MINERAL_HIGHLIGHT_LIFT = .8, MINERAL_HIGHLIGHT_TRANSITION = .12;
type FormationOcclusion = readonly [number, number, number, number?];
const smooth = (value: number): number => { const t=Math.max(0,Math.min(1,value));return t*t*(3-2*t); };

/** Relative display-encoded RGB gain, not recovered physical albedo. A horizontal
 * unoccluded plane is neutral in every channel; sky colour cancels at night. */
export function formationSurfaceColour(nx: number, ny: number, horizon: number, state: RockLightingState,
  occlusion: FormationOcclusion = [1,horizon,horizon,1], ground = false): [number, number, number] {
  const fine=state.mineralResponse===true && !!state.clouds;
  const nz=Math.sqrt(Math.max(.001,1-nx*nx-ny*ny));
  if(fine&&!ground){nx*=1.12;ny*=1.12;}
  const length=Math.hypot(nx,ny,nz);
  nx/=length;ny/=length;const normalZ=nz/length;
  const selfShadow=state.selfShadow!==false&&state.clouds?.quality?.horizons!==false;
  const soft=state.softShadow!==false, width=soft?(fine?.043:.028):.006;
  const visible=(h:number):number=>smooth((Math.asin(Math.max(-1,Math.min(1,state.sun[2])))-h+width)/(2*width));
  const visibility=!selfShadow?1:soft?(visible(horizon)*2+visible(occlusion[1])+visible(occlusion[2]))*.25:visible(horizon);
  const mineral=state.mineralResponse===true;
  const sky=(!selfShadow?1:.55+.45*occlusion[0])*(ground?1:mineral?.5+.5*normalZ:.72+.28*normalZ);
  const direct=(state.enabled?(state.clouds?.strength??state.strength):0)*SUN_POWER;
  const facing=ground?Math.max(0,state.sun[2]):Math.max(0,nx*state.sun[0]+ny*state.sun[1]+normalZ*state.sun[2]);
  const contact=(!selfShadow?1:CONTACT_FLOOR+(1-CONTACT_FLOOR)*smooth(occlusion[3]??1))
    *(fine&&!ground&&selfShadow?1-.13*Math.pow(1-(occlusion[3]??1),3):1);
  return FILL.map((fill,i)=>{
    const diffuse=Math.pow((FILL_POWER*fill*sky+direct*SUN[i]*facing*visibility)
      /(FILL_POWER*fill+direct*SUN[i]*Math.max(0,state.sun[2])),1/2.2);
    // A smooth matte shoulder bounds highlights without a hard white rim.
    // Unit slope at neutral exposure avoids a white contour. Only already-lit
    // facets receive a gradual lift before the bounded matte shoulder.
    const excess=Math.max(0,diffuse-1);
    const highlight=mineral?excess+MINERAL_HIGHLIGHT_LIFT*excess*excess/(excess+MINERAL_HIGHLIGHT_TRANSITION):excess*HIGHLIGHT_GAIN;
    const headroom=fine?.34:HIGHLIGHT_HEADROOM;
    const factor=ground?diffuse:Math.min(diffuse,1)+headroom*(1-Math.exp(-highlight/headroom));
    return factor*contact;
  }) as [number,number,number];
}

/** Matched brightness for the short-lived destruction snapshot. */
export function formationSurfaceFactor(nx: number, ny: number, horizon: number, state: RockLightingState,
  occlusion: FormationOcclusion = [1,horizon,horizon,1]): number {
  const [r,g,b]=formationSurfaceColour(nx,ny,horizon,state,occlusion);
  return r*.2126+g*.7152+b*.0722;
}

const glsl = (n: number): string => n.toFixed(8);
/** shelter contains sky visibility, two horizons in radians, and contact visibility.
 * Shared by the rock surface and its foliage receivers; ambient is applied once
 * afterwards by the existing world lightmap. */
export const FORMATION_RESPONSE_GLSL = `
uniform float uMineralResponse, uFineMineral;
float formationVisible(float horizon, float elevation, float width) {
  return smoothstep(horizon-width,horizon+width,elevation);
}
vec3 formationResponse(vec3 normal, float horizon, vec4 shelter, vec3 sun, vec4 options, float ground) {
  float elevation=asin(clamp(sun.z,-1.0,1.0));
  float width=mix(.006,mix(.028,.043,uFineMineral),options.w);
  if(ground<.5 && uFineMineral>.5) normal=normalize(vec3(normal.xy*1.12,normal.z));
  float centre=formationVisible(horizon,elevation,width);
  float spread=(centre*2.0+formationVisible(shelter.g,elevation,width)+formationVisible(shelter.b,elevation,width))*.25;
  float visibility=mix(1.0,mix(centre,spread,options.w),options.z);
  float sky=mix(1.0,.55+.45*shelter.r,options.z);
  float facing=max(0.0,sun.z);
  if(ground<.5) {
    sky*=uMineralResponse>.5 ? .5+.5*normal.z : .72+.28*normal.z;
    facing=max(0.0,dot(normal,sun));
  }
  vec3 fill=vec3(${FILL.map(glsl).join(',')})*${glsl(FILL_POWER)};
  vec3 direct=vec3(${SUN.map(glsl).join(',')})*(options.x*${glsl(SUN_POWER)});
  vec3 factor=pow((fill*sky+direct*facing*visibility)/(fill+direct*max(0.0,sun.z)),vec3(1.0/2.2));
  if(ground<.5) {
    vec3 excess=max(factor-1.0,vec3(0.0));
    // Preserve the baseline expression exactly; only the opt-in mineral profile
    // changes the positive highlight branch, never flat or sheltered faces.
    vec3 shoulder=excess*${glsl(HIGHLIGHT_GAIN/HIGHLIGHT_HEADROOM)};
    if(uMineralResponse>.5) shoulder=(excess+${glsl(MINERAL_HIGHLIGHT_LIFT)}*excess*excess/(excess+${glsl(MINERAL_HIGHLIGHT_TRANSITION)}))/${glsl(HIGHLIGHT_HEADROOM)};
    float headroom=mix(${glsl(HIGHLIGHT_HEADROOM)},.34,uFineMineral);
    factor=min(factor,vec3(1.0))+headroom*(1.0-exp(-shoulder*${glsl(HIGHLIGHT_HEADROOM)}/headroom));
  }
  float contact=mix(1.0,${glsl(CONTACT_FLOOR)}+${glsl(1-CONTACT_FLOOR)}*smoothstep(0.0,1.0,shelter.a),options.z);
  if(ground<.5 && uFineMineral>.5) contact*=1.0-.13*pow(1.0-shelter.a,3.0)*options.z;
  if(ground>.5 && uFineMineral>.5)contact=1.0; // The foot is independently tunable below.
  return factor*contact;
}
// Phaser MULTIPLY is DST_COLOR, ONE_MINUS_SRC_ALPHA. One alpha shared by
// all channels requires retaining the smallest channel in destination RGB.
vec4 formationMultiply(vec3 factor) {
  float retained=min(1.0,min(factor.r,min(factor.g,factor.b)));
  return vec4(factor-vec3(retained),1.0-retained);
}
`;

/** Shared by mineral and colonies resting on it; colour never defines relief. */
export const MINERAL_CAVITY_GLSL = `
uniform sampler2D uMineralHeight;
float mineralHeight(vec2 local) {
  vec2 uv=fract((local+.5)/512.0);
  vec2 rg=texture2D(uMineralHeight,vec2(uv.x,1.0-uv.y)).rg;
  return -32.0+dot(rg,vec2(65280.0,255.0))*(64.0/65535.0);
}
float mineralCavity(vec2 local) {
  float bowl=(mineralHeight(local+vec2(2,0))+mineralHeight(local-vec2(2,0))
    +mineralHeight(local+vec2(0,2))+mineralHeight(local-vec2(0,2)))*.25-mineralHeight(local);
  return 1.0-.14*smoothstep(.35,2.4,bowl);
}
`;

export const ROCK_FORMATION_FRAGMENT = `
#pragma phaserTemplate(shaderName)
precision highp float;
varying vec2 outTexCoord;
uniform sampler2D uField, uLookup, uOcclusion;
uniform vec4 uView, uFrame;
uniform vec3 uSun;
uniform vec4 uOptions;
uniform float uGround, uCastShadow, uRockContactAO;
const float CHUNK = ${FORMATION.chunk}.0;
const float SIDE = ${FORMATION_SIDE}.0;
const vec2 ATLAS = vec2(${FORMATION.atlasColumns}.0, ${FORMATION.atlasRows}.0);
${FORMATION_RESPONSE_GLSL}
${HORIZON_BLEND_GLSL}
${CLOUD_SHADOW_GLSL}
// Geometric cavity at a two-world-pixel radius, independent of colour. This
// only enhances small V7 depressions; macro contour and broad gaps stay intact.
${MINERAL_CAVITY_GLSL}
void main() {
  vec2 world = uView.xy + vec2(outTexCoord.x, 1.0-outTexCoord.y) * uView.zw;
  vec2 local = world-uFrame.xy, cell = floor(local/CHUNK);
  vec2 lookupSize = ceil(uFrame.zw/CHUNK);
  if (min(local.x,local.y)<0.0 || local.x>=uFrame.z || local.y>=uFrame.w) discard;
  float slot = floor(texture2D(uLookup,(cell+.5)/lookupSize).r*255.0+.5)-1.0;
  if (slot<0.0) discard;
  vec2 uv = (vec2(mod(slot,ATLAS.x),floor(slot/ATLAS.x))*SIDE
    + mod(local,CHUNK)/${FORMATION.step}.0 + ${FORMATION.gutter}.0) / (ATLAS*SIDE);
  vec4 data = texture2D(uField,uv), shelter = texture2D(uOcclusion,uv);
  vec4 horizons=blendHorizons(vec4(data.b,shelter.gba),uv,slot);
  data.b=horizons.r;shelter.gb=horizons.gb;shelter.a=horizons.a;
  vec2 xy = data.rg*2.0-1.0;
  vec3 normal = normalize(vec3(xy,sqrt(max(.001,1.0-dot(xy,xy)))));
  vec4 formOptions=uOptions;formOptions.x*=cloudFormStrength(world);
  vec3 factor=formationResponse(normal,data.b*1.570796327,
    vec4(shelter.r,shelter.gb*1.570796327,shelter.a),uSun,formOptions,uGround);
  if(uFineMineral>.5 && uGround<.5 && uOptions.z>.5) {
    factor*=mineralCavity(local);
  }
  if(uGround>.5&&uCastShadow<.5)factor=vec3(1.0);
  // Ambient foot beneath the mineral contour, before fog. Preserve contact
  // under partial mineral coverage so antialiased edges cannot expose a bright
  // strip of ground. Opaque mineral covers this pass at its own depth.
  // It remains independent of direct light, clouds and the cast-shadow switch.
  if(uGround>.5 && uFineMineral>.5)
    factor*=1.0-uRockContactAO*(1.0-shelter.a)*uOptions.z;
  // Apply before mineral coverage: exposed ground receives this only from its
  // own pass, while the surface pass remains neutral outside the rock alpha.
  if (uGround<.5) {
    // Subpixel rock coverage must not light the grass just outside its contour.
    factor = 1.0 + min(factor-1.0,vec3(0.0))*smoothstep(0.0,.35,data.a) + max(factor-1.0,vec3(0.0))*smoothstep(.7,1.0,data.a);
    if (uOptions.y>.5) { gl_FragColor=vec4((normal*.5+.5)*data.a,data.a); return; }
  }
  gl_FragColor = formationMultiply(factor);
}
`;
