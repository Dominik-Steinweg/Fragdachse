import { CLOUD_SHADOW_GLSL } from '../sunlight/cloudShadow';
import { ATMOSPHERE_DITHER_GLSL, FOG_BANK_GLSL } from '../sunlight/atmosphereNoise';
import { FOG } from './FogConfig';
import { SUN_VISIBILITY_GLSL, SUN_COMPOSITE_FACTOR_GLSL } from '../sunlight/sunVisibility';
import { FOG_VISIBILITY_BUDGET_GLSL } from '../sunlight/FogVisibilityBudget';
import { FOG_PATCH_GLSL } from '../sunlight/FogPatchField';
const cells = FOG.chunkSize / FOG.cellSize;
const f = (value: number): string => value.toFixed(6);
const cycle = (seconds: number): string => f(Math.PI * 2 / seconds);
const [W1, W2, W3, W4] = FOG.meanderPeriods.map(cycle);
const AMPLITUDE = f(FOG.meanderAmplitude);
export const FOG_GLSL = `
#pragma phaserTemplate(shaderName)
precision highp float;
varying vec2 outTexCoord;
uniform sampler2D uState, uVelocity, uTerrain, uMeta, uCommands, uBins, uImpulse;
uniform vec2 uWorldSize, uWind, uDensity;
uniform float uTime, uSeed, uReaction, uInitialize, uMeander;
const vec2 atlasSize = vec2(${FOG.atlasCols * cells}.0, ${FOG.atlasRows * cells}.0);
const float SIDE = ${cells}.0;
const float SLOTS = ${FOG.atlasCols * FOG.atlasRows}.0;
const float SPEED = ${FOG.maxSpeed}.0;
vec2 flip(vec2 uv) { return vec2(uv.x, 1.0-uv.y); }
float unpack16(vec2 v) { return dot(v,vec2(65280.0,255.0))/65535.0; }
vec2 pack16(float v) { float n=floor(clamp(v,0.0,1.0)*65535.0+.5); return vec2(floor(n/256.0),mod(n,256.0))/255.0; }
vec4 meta(float slot,float row) { return texture2D(uMeta,vec2((slot+.5)/SLOTS,(row+.5)/3.0)); }
vec2 cellUV(float slot,vec2 p) { return (vec2(mod(slot,${FOG.atlasCols}.0),floor(slot/${FOG.atlasCols}.0))*SIDE+p+.5)/atlasSize; }
vec2 origin(float slot) { vec4 m=meta(slot,1.0); return vec2(unpack16(m.rg),unpack16(m.ba))*65535.0*512.0; }
vec4 terrain(float slot,vec2 p) { return texture2D(uTerrain,cellUV(slot,p)); }
float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7))+uSeed)*43758.5453); }
float noise(vec2 p) {
  vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}
// Bounded, regionally phased sway: neighbouring banks drift in different directions and
// turn over minutes. The displacement never accumulates, so no shear builds up over time.
// The analytic phase field only times the motion and is never visible as a pattern.
vec4 meanderPhase(vec2 world,float t) {
  vec2 ph=vec2(sin(world.x/610.0+1.3*sin(world.y/830.0+uSeed))*2.4+world.y/1300.0,
    sin(world.y/570.0+1.1*sin(world.x/760.0-uSeed))*2.4-world.x/1500.0);
  return vec4(${W1}*t+ph.x,${W3}*t+ph.y*1.3,${W2}*t+ph.y,${W4}*t+ph.x*1.7);
}
vec2 meanderOffset(vec2 world,float t) {
  vec4 a=meanderPhase(world,t);
  return vec2(sin(a.x)+.5*sin(a.y),sin(a.z)+.5*sin(a.w))*${AMPLITUDE}*uMeander;
}
// Time derivative of fogSpace(): ambient flow carries density where the banks travel.
vec2 ambientWind(vec2 world) {
  vec4 a=meanderPhase(world,uTime);
  return uWind+vec2(${W1}*cos(a.x)+${W3}*.5*cos(a.y),${W2}*cos(a.z)+${W4}*.5*cos(a.w))*${AMPLITUDE}*uMeander;
}
// Target and material share this transport, so texture stays attached to its bank.
vec2 fogSpace(vec2 world,float t) { return world-uWind*t-meanderOffset(world,t); }
// Separate banks with clear gaps: elongated, gently warped two-octave patches above a wide,
// soft threshold. Isoline ribbons were avoided on purpose: value-noise isolines narrow into
// hard, river-like strands wherever the noise gradient is steep.
float targetDensity(float slot,vec2 p,float water) {
  vec2 q=fogSpace(origin(slot)+(p+.5)*8.0,uTime);
  vec2 drift=uTime*vec2(.0023,-.0017);
  vec2 warp=vec2(noise(q/560.0+vec2(9.2,3.7)+drift),noise(q/560.0+vec2(1.7,13.4)-drift))-.5;
  // Warp gradients stay well below one so the field never folds into creases with abrupt rims.
  float angle=uSeed*.0063;
  vec2 s=mat2(cos(angle),sin(angle),-sin(angle),cos(angle))*q/vec2(${f(FOG.bankLength)},${f(FOG.bankWidth)});
  float field=noise(s+warp*.45)*.68+noise(s*2.3+vec2(21.0,7.0)+warp*.8)*.32
    // Water favours banks a little instead of adding a hard, shore-shaped sheet.
    +water*${f(FOG.waterBankBias)};
  float cover=smoothstep(${f(FOG.bankLow)},${f(FOG.bankHigh)},field);
  // Thin residual haze keeps edge inflow alive; open water keeps slightly more of it.
  float haze=mix(${f(FOG.clearHaze)},${f(FOG.waterHaze)},water);
  return clamp(mix(uDensity.x,uDensity.y,water)*(haze+(1.0-haze)*cover),0.0,.95);
}
vec4 state(float slot,vec2 p) {
  if(slot<0.0) return vec4(0);
  vec4 mask=terrain(slot,p);
  if(mask.r<.5) return vec4(0);
  if(mask.a>.5) return vec4(0);
  if(meta(slot,2.0).g>.5) {
    float d=mask.b>.5?0.0:targetDensity(slot,p,mask.g);
    return vec4(pack16(d),mask.b>.5?0.0:1.0,0.0);
  }
  return texture2D(uState,flip(cellUV(slot,p)));
}
vec2 velocity(float slot,vec2 p) {
  if(slot<0.0 || terrain(slot,p).r<.5 || terrain(slot,p).a>.5) return vec2(0);
  if(meta(slot,2.0).g>.5) return ambientWind(origin(slot)+(p+.5)*8.0);
  vec4 v=texture2D(uVelocity,flip(cellUV(slot,p)));
  return (vec2(unpack16(v.rg),unpack16(v.ba))*2.0-1.0)*SPEED;
}
// Only face neighbours are allowed. No corner or long backtrace can cross a wall.
float neighbour(float slot,inout vec2 p,vec2 direction) {
  p+=direction;
  vec4 links=floor(meta(slot,0.0)*255.0+.5)-1.0;
  if(p.x<0.0) {slot=links.r;p.x+=SIDE;} else if(p.x>=SIDE) {slot=links.g;p.x-=SIDE;}
  else if(p.y<0.0) {slot=links.b;p.y+=SIDE;} else if(p.y>=SIDE) {slot=links.a;p.y-=SIDE;}
  return slot;
}
void address(out float slot,out vec2 p) {
  vec2 pixel=floor(flip(outTexCoord)*atlasSize);
  vec2 tile=floor(pixel/SIDE); slot=tile.y*${FOG.atlasCols}.0+tile.x; p=mod(pixel,SIDE);
}
`;

export const FOG_IMPULSE_FRAGMENT = FOG_GLSL + `
void main() {
 float slot;vec2 p;address(slot,p);
 if(meta(slot,2.0).r<.5 || terrain(slot,p).r<.5) {gl_FragColor=vec4(vec2(128.0/255.0),0,0);return;}
 vec2 world=origin(slot)+(p+.5)*8.0;
 vec2 force=vec2(0);float clear=0.0;
 float count=floor(meta(slot,2.0).b*255.0+.5);
 for(int i=0;i<${FOG.impulsesPerChunk};i++) {
   if(float(i)>=count) break;
   vec4 bin=texture2D(uBins,vec2((float(i)+.5)/${FOG.impulsesPerChunk}.0,(slot+.5)/SLOTS));
   float index=unpack16(bin.rg)*65535.0;
   vec2 uv=vec2((index+.5)/256.0,.125);
   vec4 a=texture2D(uCommands,uv),b=texture2D(uCommands,uv+vec2(0,.25));
   vec4 spec=texture2D(uCommands,uv+vec2(0,.5));
   vec2 start=vec2(unpack16(a.rg),unpack16(a.ba))*uWorldSize;
   vec2 end=vec2(unpack16(b.rg),unpack16(b.ba))*uWorldSize;
   float radius=unpack16(spec.rg)*4096.0;
   vec2 line=end-start;float along=clamp(dot(world-start,line)/max(1.0,dot(line,line)),0.0,1.0);
   vec2 away=world-mix(start,end,along);float dist=length(away);
   float weight=1.0-smoothstep(radius*.12,radius,dist);
   float power=spec.b*uReaction;
   vec2 direction=away/max(dist,1.0);
   bool explosion=spec.a>.75;
   bool melee=spec.a>.25 && !explosion;
   if(melee) {
     vec4 sector=texture2D(uCommands,uv+vec2(0,.75));
     float angle=(unpack16(sector.ba)-.5)*6.2831853;
     vec2 facing=vec2(cos(angle),sin(angle));
     away=world-start;dist=length(away);direction=away/max(dist,1.0);
     float edge=unpack16(sector.rg)*2.0-1.0;
     float angularWeight=edge<-.9999?1.0:smoothstep(edge-.001,min(1.0,edge+.12),dot(direction,facing));
     weight=(1.0-smoothstep(radius*.6,radius,dist))*angularWeight;
     direction+=vec2(-direction.y,direction.x)*.45;
   }
   force+=(direction+(explosion || melee?vec2(0):line/max(length(line),1.0)*.2))*weight*power*(explosion?130.0:melee?65.0:36.0);
   clear+=weight*power*(explosion?2.8:melee?1.25:.48);
 }
 gl_FragColor=vec4(floor(clamp(force/SPEED*127.0+128.0,1.0,255.0)+.5)/255.0,1.0-exp(-clear),clamp(clear,0.0,1.0));
}
`;
export const FOG_VELOCITY_FRAGMENT = FOG_GLSL + `
float pressure(float slot,vec2 p) {
 return max(0.0,unpack16(state(slot,p).rg)-targetDensity(slot,p,terrain(slot,p).g)-.04);
}
void flowFace(float slot,vec2 p,vec2 direction,float ownPressure,vec2 ownVelocity,inout vec2 push,inout vec2 mixing) {
 vec2 q=p;float n=neighbour(slot,q,direction);
 if(n<0.0 || terrain(n,q).r<.5) return;
 // Compression spreads upstream and sideways through open faces only. Momentum
 // follows the same topology, carrying the deflected stream beyond a rock corner.
 push+=direction*(ownPressure-pressure(n,q));
 mixing+=velocity(n,q)-ownVelocity;
}
void main() {
 float slot;vec2 p;address(slot,p);vec2 uv=cellUV(slot,p);
 if(meta(slot,2.0).r<.5 || (uInitialize>.5 && meta(slot,2.0).g<.5)) {gl_FragColor=texture2D(uVelocity,flip(uv));return;}
 if(terrain(slot,p).r<.5) {gl_FragColor=vec4(pack16(.5),pack16(.5));return;}
 vec4 impulse=texture2D(uImpulse,flip(uv));
 vec2 old=velocity(slot,p),push=vec2(0),mixing=vec2(0);float compressed=pressure(slot,p);
 flowFace(slot,p,vec2(-1,0),compressed,old,push,mixing);flowFace(slot,p,vec2(1,0),compressed,old,push,mixing);
 flowFace(slot,p,vec2(0,-1),compressed,old,push,mixing);flowFace(slot,p,vec2(0,1),compressed,old,push,mixing);
 vec2 v=mix(old,ambientWind(origin(slot)+(p+.5)*8.0),${FOG.windRelaxation})+mixing*${FOG.momentumMix}*.25+push*${FOG.pressureGain}.0
   +(impulse.rg*255.0-128.0)/127.0*SPEED;
 // L1 CFL <= .6: even an extreme explosion never skips a cell.
 v*=min(1.0,144.0/max(144.0,abs(v.x)+abs(v.y)));
 // Solid faces are rejected in both flowFace() and exchange().
 gl_FragColor=vec4(pack16(v.x/SPEED*.5+.5),pack16(v.y/SPEED*.5+.5));
}
`;
export const FOG_DENSITY_FRAGMENT = FOG_GLSL + `
void exchange(float slot,vec2 p,vec2 direction,vec2 v,float d,inout float change,inout float incoming) {
 vec2 q=p;float n=neighbour(slot,q,direction);
 if(n<0.0 || terrain(n,q).r<.5) return;
 float other=unpack16(state(n,q).rg)*(1.0-texture2D(uImpulse,flip(cellUV(n,q))).b);
 // Four face fluxes plus diffusion remain below one cell's available mass,
 // including convergent velocities from independently saturated impulses.
 float speed=clamp(dot((v+velocity(n,q))*.5,direction)/240.0,-.18,.18);
 float flux=max(speed,0.0)*d+min(speed,0.0)*other;
 float diffuse=(other-d)*.014;
 change+=diffuse-flux; incoming+=max(0.0,diffuse-flux);
}
void main() {
 float slot;vec2 p;address(slot,p);vec2 uv=cellUV(slot,p);
 if(meta(slot,2.0).r<.5) {gl_FragColor=texture2D(uState,flip(uv));return;}
 if(uInitialize>.5) {gl_FragColor=state(slot,p);return;}
 vec4 mask=terrain(slot,p);
 if(mask.r<.5) {gl_FragColor=vec4(0);return;}
 vec4 impulse=texture2D(uImpulse,flip(uv));
 vec4 before=state(slot,p);float d=unpack16(before.rg)*(1.0-impulse.b),change=0.0,incoming=0.0;
 vec2 v=velocity(slot,p);
 exchange(slot,p,vec2(-1,0),v,d,change,incoming);exchange(slot,p,vec2(1,0),v,d,change,incoming);
 exchange(slot,p,vec2(0,-1),v,d,change,incoming);exchange(slot,p,vec2(0,1),v,d,change,incoming);
 float arrived=max(before.b,step(.0000076,incoming));
 float inhibition=max(before.a*.95,impulse.a);
 d=max(0.0,d+change);
 float target=targetDensity(slot,p,mask.g);
 if(arrived>.5) d=mix(d,target,(target<d?.004:.0025)*(1.0-inhibition));
 gl_FragColor=vec4(pack16(d),arrived,inhibition);
}
`;

const FOG_LIGHT_GLSL = `
uniform vec3 uFogSun;
uniform float uSunComposite;
uniform vec3 uCompositeShade,uCompositeDaylight,uCompositeSun;
uniform vec3 uSunFogShade,uSunFogLit;
uniform float uSunFogOpacity,uSunFogShadeOpacity;
uniform float uFogBankMetadata;
${FOG_VISIBILITY_BUDGET_GLSL}
uniform float uSceneSun;
${SUN_VISIBILITY_GLSL}
${SUN_COMPOSITE_FACTOR_GLSL}

vec4 lightFog(vec4 fog,vec2 world) {
 if(fog.a<=0.0)return fog;
 // Material optics only: preserve premultiplied colour and alpha, wakes and density.
 float v=0.0;vec2 cloudLight=vec2(0.0);
 float day=uSunComposite*smoothstep(0.0,.15,uSceneSun);
 float waterWeight=0.0;
 vec3 fogComposite=vec3(1.0);
 if(day>0.0 && uFogBankMetadata>.5) {
   waterWeight=clamp(fog.b/max(.0001,fog.a),0.0,1.0);
   float structure=clamp((fog.g/max(.0001,fog.a)-.79)/.09,0.0,1.0);
   fog.b=mix(.81,.88,structure)*fog.a;
 }
 if(day>0.0) {
   cloudLight=sunLightSample(world);v=cloudLight.r;
   // Solar visibility changes radiance below, never optical coverage.
   if(uFogBankMetadata<.5)fog*=mix(1.0,uSunFogOpacity,day);
 }
 // Scattering colour shares the ground/foliage transmission and moving offset.
 // Premultiplied alpha and the independent high-resolution wake remain intact.
 if(uSceneSun>0.0 && uFogSun.z>0.0) {
   if(uSunComposite>.5) {
     // Ground fog precedes the composite. Compensate its factor so scattering
     // remains readable instead of receiving two layers of canopy darkness.
     float amount=clamp(uSceneSun,0.0,1.0);
     vec3 scattering=mix(uSunFogShade,uSunFogLit,v);
     // Neutral sky fill keeps rosy dusk mist from boosting flower/decal chroma.
     float luma=dot(scattering,vec3(.2126,.7152,.0722));
     scattering=mix(vec3(luma),scattering,.50);
     // Retain the material's dimmer underside instead of painting every bank flat.
     float underside=clamp(dot(fog.rgb,vec3(.2126,.7152,.0722))/max(.0001,fog.a),.65,.9)/.9;
     float forward=uFogScatter*pow(1.0-clamp(uFogSun.z,0.0,1.0),1.5)*v;
     scattering*=underside*(1.0+forward)*mix(1.0,mix(uSunFogShadeOpacity,1.0,v),amount);
     if(uFogBankMetadata>.5) {
       // Preserve the material relief; cloud openings colour its radiance, never alpha.
       vec3 material=fog.rgb/max(.0001,fog.a);
       scattering=material*mix(vec3(1.0),mix(uSunFogShade,uSunFogLit,v),.80)
         *(1.0+forward*.35);
     }
     // Cancel the exact shared ground factor. Fog scatters the same smooth
     // opening once; no leaf texture or separate volumetric pass contributes.
     float ground=cloudLight.r;
     float spot=cloudLight.g;
     float spotWarmth=clamp((uCompositeSun.r-uCompositeSun.b)*2.0,0.0,1.0);
     scattering*=vec3(1.0)+vec3(.25+.15*spotWarmth,.25,.25-.15*spotWarmth)*(spot*uCloudSpotAmount*amount);
     vec3 factor=sunCompositeFactor(uCompositeShade,uCompositeDaylight,uCompositeSun,ground,amount,atmosphereDither(world),spot,uCloudSpotAmount*uCloudCached);
     fogComposite=max(vec3(.05),factor);
     fog.rgb=mix(fog.rgb,scattering*fog.a,amount)/max(vec3(.05),factor);
   }
 }
 // Preserve premultiplied colour while bounding the denser woodland mist. The
 // ordinary wake still clears around actors; never turn banks into opaque walls.
 if(day>0.0) {
   if(uFogBankMetadata<.5)fog*=fogBudgetAlpha(fog.a,waterWeight,uSceneSun)/max(.0001,fog.a);
   float grain=atmosphereDither(world)/255.0*day*min(1.0,fog.a*32.0);
   // Limit radiance AFTER the following composite, not the compensated source.
   // Scattering changes hue within the fog budget, never its coverage. Reserve
   // headroom for the unchanged grade; peak-normalize to retain the warm hue.
   vec3 radiance=fog.rgb*fogComposite;
   float peak=max(radiance.r,max(radiance.g,radiance.b));
   // Patch mode budgets occupied area. A uniform grade compensation preserves
   // internal contrast; the old per-pixel knee would flatten these dense cores.
   if(uFogBankMetadata>.5)radiance*=mix(1.0,uFogRadianceLimit/.80,day);
   float ceiling=fog.a*mix(1.0,uFogBankMetadata>.5?1.0:uFogRadianceLimit,day);
   radiance*=min(1.0,ceiling/max(.0001,peak));
   fog.rgb=clamp(radiance+grain,vec3(0),vec3(ceiling))/fogComposite;
 }
 return fog;
}
`;

export const FOG_K_MATERIAL_FRAGMENT = FOG_GLSL + `
uniform sampler2D uLookup;
uniform float uFogBanksK,uFogDay,uBoundaryBlend,uWorldOffsetX,uWorldOffsetY,uFogPrelit;
${CLOUD_SHADOW_GLSL}
${FOG_BANK_GLSL}
${FOG_PATCH_GLSL}
${ATMOSPHERE_DITHER_GLSL}
${FOG_LIGHT_GLSL}
uniform vec2 uLookupSize,uViewOrigin,uViewSize;
uniform float uOpacity,uDetail,uDebug,uInterpolation,uHasSurface,uQuality,uWoodlandBanks;
// uVelocity is the previous DENSITY buffer in this presentation pass.
vec4 worldSample(vec2 world) {
 if(any(lessThan(world,vec2(0))) || any(greaterThanEqual(world,uWorldSize))) return vec4(0);
 vec2 chunk=floor(world/512.0);
 float slot=texture2D(uLookup,(chunk+.5)/uLookupSize).r*255.0-1.0;
 if(slot<-.5) return vec4(0);
 vec2 p=floor(mod(world,512.0)/8.0);vec2 uv=cellUV(floor(slot+.5),p);
 vec4 mask=terrain(floor(slot+.5),p);
 vec4 s=texture2D(uState,flip(uv));
 vec4 old=texture2D(uVelocity,flip(uv));
 float d=mix(unpack16(old.rg),unpack16(s.rg),meta(floor(slot+.5),2.0).g>.5?1.0:uInterpolation);
 if(mask.r<.5 || (mask.b>.5 && s.b<.5)) d=0.0;
 return vec4(d,mask.r,mask.g,s.b);
}
vec4 smoothWorld(vec2 world) {
 vec2 grid=world/8.0-.5,base=(floor(grid)+.5)*8.0,w=fract(grid);
 return mix(mix(worldSample(base),worldSample(base+vec2(8,0)),w.x),
   mix(worldSample(base+vec2(0,8)),worldSample(base+vec2(8,8)),w.x),w.y);
}
float waterCell(vec2 world) {
 if(any(lessThan(world,vec2(0)))||any(greaterThanEqual(world,uWorldSize)))return 0.0;
 float slot=texture2D(uLookup,(floor(world/512.0)+.5)/uLookupSize).r*255.0-1.0;
 return slot<-.5?0.0:terrain(floor(slot+.5),floor(mod(world,512.0)/8.0)).g;
}
float smoothWater(vec2 world) {
 vec2 grid=world/8.0-.5,base=(floor(grid)+.5)*8.0,w=fract(grid);
 return mix(mix(waterCell(base),waterCell(base+vec2(8,0)),w.x),
  mix(waterCell(base+vec2(0,8)),waterCell(base+vec2(8,8)),w.x),w.y);
}
float boundaryCell(vec2 world) {
 if(any(lessThan(world,vec2(0))) || any(greaterThanEqual(world,uWorldSize)))return -64.0;
 float slot=texture2D(uLookup,(floor(world/512.0)+.5)/uLookupSize).r*255.0-1.0;
 if(slot<-.5)return -64.0;
 // Unit six is the boundary atlas in woodland material mode, the impulse map in debug mode.
 vec4 encodedBoundary=texture2D(uImpulse,cellUV(floor(slot+.5),floor(mod(world,512.0)/8.0)));
 float blend=uBoundaryBlend*uBoundaryBlend*(3.0-2.0*uBoundaryBlend);
 return mix(unpack16(encodedBoundary.ba),unpack16(encodedBoundary.rg),blend)*128.0-64.0;
}
// Decode first, interpolate second: packed high/low bytes must never use LINEAR filtering.
vec3 boundaryField(vec2 world) {
 vec2 grid=world/8.0-.5,p=(floor(grid)+.5)*8.0,w=fract(grid);
 float a=boundaryCell(p),b=boundaryCell(p+vec2(8,0)),c=boundaryCell(p+vec2(0,8)),d=boundaryCell(p+vec2(8,8));
 return vec3(mix(mix(a,b,w.x),mix(c,d,w.x),w.y),mix(b-a,d-c,w.y)/8.0,mix(c-a,d-b,w.x)/8.0);
}
float woodlandThickness(vec2 world,float surface,out float layered,out float waterWeight,out float patchDistance,out float patchActivity) {
 patchDistance=-1000.0;patchActivity=0.0;
 waterWeight=0.0;
 vec2 global=world+vec2(uWorldOffsetX,uWorldOffsetY);
 vec2 drift=vec2(1.0,.23)*cloudTravel(uCloudTime,uCloudSpeed)*.18;
 vec3 boundary=boundaryField(world);
 vec2 normal=boundary.yz/max(.001,length(boundary.yz)),tangent=vec2(-normal.y,normal.x);
 float nearEdge=1.0-smoothstep(0.0,uFogPileSoftness*2.0,abs(boundary.x));
 float roll=sin(dot(global,tangent)/31.0-uCloudTime*.17)*nearEdge;
 vec2 q=global-drift+tangent*roll*6.0;
 // Static small erosion follows rounded corners without moving the collision contour.
 float edge=boundary.x+(fogBankNoise(global/19.0)-.5)*4.0;
 vec2 source=world+normal*max(0.0,12.0-boundary.x);
 vec4 transported=smoothWorld(source);
 float slot=texture2D(uLookup,(floor(source/512.0)+.5)/uLookupSize).r*255.0-1.0;
 if(slot<-.5){layered=0.0;return 0.0;}
 float original=targetDensity(floor(slot+.5),mod(source,512.0)/8.0-.5,transported.b);
 float flow=clamp(transported.r/max(.0001,original),0.0,1.8);
 // Invert the existing cubic water-distance encoding, then use a much gentler density ratio.
 float water=boundary.x>=12.0?transported.b:smoothWater(world);
 float distance=(.5-sin(asin(clamp(1.0-2.0*water,-1.0,1.0))/3.0))*224.0-160.0;
 float shoreWarp=(fogBankNoise(q/85.0)-.5)*24.0;
 float waterRamp=smoothstep(-uFogShoreRamp*.65,uFogShoreRamp*.35,distance+shoreWarp);
 waterWeight=waterRamp;
 float bank=fogBank(global,uCloudTime,uCloudSpeed);
 layered=clamp(fogPatchStructure(q,uCloudTime,uQuality)+.08*roll,0.0,1.0);
 float patch=fogPatchMaskDistance(q,uCloudTime,bank,waterRamp,patchDistance);
 // Squared billows have real inner valleys; banks merely favour their locations.
 float shape=uFogClearHaze+uFogPatchDensity*patch*(.07+2.25*layered*layered);
 float pile=smoothstep(-5.0,uFogPileSoftness,edge)
   *(1.0+.28*exp(-pow((edge-uFogPileSoftness*.65)/uFogPileSoftness,2.0)));
 // Extra moisture appears only in narrow drifting fibres, not the entire pond.
 float vapour=smoothstep(.65,.95,layered);
 float density=uFogDensity*shape*(1.0+uFogWaterBoost*waterRamp*vapour)*flow*pile;
 // Thin wind-borne shoulder wisps, not a fog sheet over rock tops.
 density*=mix(.22,1.0,smoothstep(-2.0,9.0,edge));
 patchActivity=clamp(uOpacity*uFogOpticalOpacity*uFogDensity*uFogPatchDensity
   *flow*pile*mix(.22,1.0,smoothstep(-2.0,9.0,edge))*(1.0-surface),0.0,1.0);
 return max(0.0,density*(1.0-surface)-.004);
}
void main() {
 vec2 world=uViewOrigin+flip(outTexCoord)*uViewSize;
 float day=uFogBanksK*smoothstep(0.0,.15,uFogDay);
 vec4 center=vec4(0.0);float d=0.0;
 if(day<1.0||uDebug>.5){
  center=worldSample(world);
  vec2 grid=world/8.0-.5,base=(floor(grid)+.5)*8.0,weight=fract(grid);
  d=mix(mix(worldSample(base).r,worldSample(base+vec2(8,0)).r,weight.x),
    mix(worldSample(base+vec2(0,8)).r,worldSample(base+vec2(8,8)).r,weight.x),weight.y);
 }
 float surface=uHasSurface>.5?texture2D(uBins,outTexCoord).a:0.0;
 d*=1.0-surface;
 if(uDebug>.5) {
   vec3 color=vec3(d);
   if(uDebug<1.5) color=mix(vec3(.75,.18,.14),vec3(.12,.55,.28),center.g);
   else if(uDebug<2.5) color=vec3(.08,center.b*.6,center.b);
   else if(uDebug>3.5 && uDebug<4.5) color=center.a<.5 && center.g>.5?vec3(.9,.35,.05):vec3(d);
   else if(uDebug>4.5) {
     float slot=texture2D(uLookup,(floor(world/512.0)+.5)/uLookupSize).r*255.0-1.0;
     vec2 uv=cellUV(max(0.0,floor(slot+.5)),floor(mod(world,512.0)/8.0));
     vec4 imp=texture2D(uImpulse,flip(uv));
     vec4 v=texture2D(uCommands,flip(uv));
     color=uDebug<5.5?vec3(unpack16(v.rg),unpack16(v.ba),.3):uDebug<6.5?vec3(imp.ba,0):vec3(surface);
   }
   gl_FragColor=vec4(color, .92);return;
 }
 float structure=0.0,thickness=0.0;
 if(day<1.0) {
 // Displayed density lies between the previous and current step; texture time follows it.
 float t=uTime-(1.0-uInterpolation)*${f(FOG.stepMs / 1000)};
 vec2 q=fogSpace(world,t);
 // A time-evolving domain warp lets billows churn in place instead of sliding as one sheet.
 vec2 warp=vec2(noise(q/170.0+vec2(t*.019,5.1)),noise(q/170.0+vec2(-3.7,t*.015)))-.5;
 float body=noise(q/74.0+warp*2.2)*.62+noise(q/33.0+warp*3.0+vec2(t*.011,0.0))*.38;
 float strand=1.0-abs(noise(q/47.0+warp*3.4-vec2(0.0,t*.009))*2.0-1.0);
 float fine=uQuality>1.5?noise(q/17.0+warp*4.0+vec2(0.0,t*.02)):.5;
 structure=smoothstep(.22,.82,body*.76+strand*strand*.12+fine*.12);
 // Structure scales optical thickness; a small edge offset erodes thin fog into wisps and
 // leaves the gaps clear, while saturation keeps dense cores soft instead of clipped flat.
 thickness=max(0.0,d*mix(1.0,.12+1.8*structure,uDetail)-${f(FOG.materialEdge)});
 // Optional forest presentation: clear the thin veil between smaller billows,
 // retain dense soft cores. This never writes the transported density field.
 if(uWoodlandBanks>.5) {
   // A second narrow threshold made islands with conspicuous dark cut-outs.
   // Squaring the existing soft structure concentrates cores without that rim.
   float bank=structure*structure;
   thickness=max(0.0,d*(.07+2.25*bank)-.025);
 }
 }
 float waterWeight=0.0,patchDistance=-1000.0,patchActivity=0.0;
 if(day>0.0) {
   // Feather the base-image cutout before applying the smooth obstacle shoulder.
   float softSurface=surface;
   if(uHasSurface>.5) {
     vec2 px=vec2(5.0)/uViewSize;
     softSurface=(surface*2.0+texture2D(uBins,outTexCoord+vec2(px.x,0)).a+texture2D(uBins,outTexCoord-vec2(px.x,0)).a
       +texture2D(uBins,outTexCoord+vec2(0,px.y)).a+texture2D(uBins,outTexCoord-vec2(0,px.y)).a)/6.0;
   }
   float layered;
   float banks=woodlandThickness(world,softSurface,layered,waterWeight,patchDistance,patchActivity);
   thickness=mix(thickness,banks,day);
   structure=mix(structure,layered,day);
 }
 // Weapon wakes are cut in FOG_DISPLAY_FRAGMENT at mask resolution, never at material texels.
 float alpha=${f(FOG.materialMaxAlpha)}*(1.0-exp(-${f(FOG.materialGain)}*uOpacity*mix(1.0,uFogOpticalOpacity,day)*thickness));
 if(day>0.0)alpha=mix(alpha,fogPatchEdgeAlpha(alpha,patchDistance,patchActivity),day);
 if(day>0.0)alpha=max(0.0,alpha+atmosphereDither(world+vec2(uWorldOffsetX,uWorldOffsetY))/255.0*day*min(1.0,alpha*255.0));
 gl_FragColor=vec4(mix(vec3(.72,.79,.81),vec3(.84,.88,.88),structure)*alpha,alpha);
 // Woodland intermediate material: B carries premultiplied shoreline weight.
 // Display reconstructs blue from green/alpha before lighting. No extra sampler
 // or surface pass; linear filtering and wake attenuation preserve the ratio.
 if(day>0.0)gl_FragColor.b=waterWeight*alpha;
 if(uFogPrelit>.5)gl_FragColor=lightFog(gl_FragColor,world+vec2(uWorldOffsetX,uWorldOffsetY));
}
`;

// Unlit material retains its sampler budget and unlit material contract.
export const FOG_MATERIAL_FRAGMENT=FOG_K_MATERIAL_FRAGMENT.replace(FOG_LIGHT_GLSL,'')
 .replace(' if(uFogPrelit>.5)gl_FragColor=lightFog(gl_FragColor,world+vec2(uWorldOffsetX,uWorldOffsetY));','');

/** Screen composite: soft half-resolution material, wake cut at the finer trail-mask resolution.
 * Cutting inside the material would sample thin wakes per material texel and bead diagonals. */
export const FOG_DISPLAY_FRAGMENT = `
#pragma phaserTemplate(shaderName)
precision highp float;
varying vec2 outTexCoord;
uniform sampler2D uMaterial,uTrails;
uniform float uHasTrails,uFogPrelit;
uniform vec4 uFogView;
${CLOUD_SHADOW_GLSL}
${FOG_BANK_GLSL}
${ATMOSPHERE_DITHER_GLSL}
${FOG_LIGHT_GLSL}
void main() {
 float trace=uHasTrails>.5?texture2D(uTrails,outTexCoord).r:0.0;
 vec4 fog=texture2D(uMaterial,outTexCoord)*(1.0-trace);
 // Woodland radiance is already resolved at material resolution; preserve fine wakes.
 if(uFogPrelit>.5||fog.a<=0.0){gl_FragColor=fog;return;}
 vec2 world=uFogView.xy+vec2(outTexCoord.x,1.0-outTexCoord.y)*uFogView.zw;
 gl_FragColor=lightFog(fog,world);
}
`;

export const FOG_TRAIL_VERTEX = `
precision highp float;
attribute vec2 inPosition,inTexCoord;
uniform vec2 uViewOrigin,uViewSize;
varying vec2 outWorld;
varying float outIndex,outShape;
void main() {
 outWorld=inPosition;outIndex=inTexCoord.x;outShape=inTexCoord.y;
 gl_Position=vec4((inPosition-uViewOrigin)/uViewSize*vec2(2.,-2.)+vec2(-1.,1.),0.,1.);
}
`;
export const FOG_TRAIL_FRAGMENT = `
precision highp float;
varying vec2 outWorld;
varying float outIndex,outShape;
uniform sampler2D uCommands;
uniform vec2 uWorldSize;
uniform float uTrailTime,uReaction,uTrailBlur;
float decode(vec2 v) {return dot(v,vec2(65280.,255.));}
void main() {
 float index=floor(outIndex+.5);
 vec2 uv=vec2((mod(index,${FOG.trailTextureWidth}.)+.5)/${FOG.trailTextureWidth}.,(floor(index/${FOG.trailTextureWidth}.)*5.+.5)/${FOG.trailCapacity / FOG.trailTextureWidth * 5}.);
 vec2 row=vec2(0.,1./${FOG.trailCapacity / FOG.trailTextureWidth * 5}.);
 vec4 a=texture2D(uCommands,uv),b=texture2D(uCommands,uv+row),c=texture2D(uCommands,uv+row*2.);
 vec4 profile=texture2D(uCommands,uv+row*3.),radii=texture2D(uCommands,uv+row*4.);
 vec2 start=vec2(decode(a.rg),decode(a.ba))/65535.*uWorldSize,end=vec2(decode(b.rg),decode(b.ba))/65535.*uWorldSize;
 vec2 line=end-start;
 float lineLength=max(.001,length(line));
 float along=dot(outWorld-start,line)/lineLength;
 float t=clamp(along/lineLength,0.,1.);
 float authored=mix(decode(radii.rg),decode(radii.ba),t)/16.;
 // Prefilter by the mask's texel footprint (variances add), so a sub-texel wake
 // reads as a continuous lane instead of beads. Only half of the widening is paid in peak
 // strength: thin wakes stay clearly cut without their cross-section swelling unbounded.
 float radius=sqrt(authored*authored+uTrailBlur*uTrailBlur),coverage=sqrt(authored/max(.01,radius));
 float distance=length(outWorld-mix(start,end,t));
 float arc=mod(outShape,512.),caps=floor(outShape/512.);
 float sector=1.,ends=1.;
 if(arc>0.) {
   vec2 delta=outWorld-start;
   distance=length(delta);t=0.;
   float facing=dot(delta,line)/max(.001,distance*length(line));
   float halfAngle=radians(arc*.5);
   float feather=min(halfAngle*.65,${FOG.trailSectorFeather});
   sector=arc>=359.9?1.:smoothstep(cos(halfAngle),cos(max(0.,halfAngle-feather)),facing);
 } else {
   float feather=min(lineLength*.45,max(${FOG.trailEndFeatherMin.toFixed(1)},radius*${FOG.trailEndFeather.toFixed(1)}));
   float outside=max(.01,radius*${FOG.trailEdgeExtent});
   if(mod(caps,2.)>.5) ends*=smoothstep(-outside,feather,along);
   if(caps>1.5) ends*=smoothstep(-outside,feather,lineLength-along);
 }
 float duration=mod(decode(c.ba)-decode(c.rg)+60000.,60000.);
 float age=mod(uTrailTime-decode(c.rg)-t*duration+60000.,60000.);
 float life=decode(profile.gb),decay=max(1.,profile.a*life);
 float amount=exp(-age/decay)
   *(1.-smoothstep(life*.7,life,age))*profile.r*4.5*uReaction;
 // Shape after saturation: strong shots retain a soft edge instead of flattening the falloff.
 float q=distance/max(.01,radius);
 float edge=exp(-${FOG.trailEdgeFalloff}*q*q)*(1.-smoothstep(${FOG.trailEdgeExtent * .72},${FOG.trailEdgeExtent},q));
 gl_FragColor=vec4(min(.90,1.-exp(-amount))*edge*coverage*sector*ends,0,0,1);
}
`;
