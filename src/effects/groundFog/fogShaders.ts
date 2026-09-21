import { FOG } from './FogConfig';
const cells = FOG.chunkSize / FOG.cellSize;
export const FOG_GLSL = `
#pragma phaserTemplate(shaderName)
precision highp float;
varying vec2 outTexCoord;
uniform sampler2D uState, uVelocity, uTerrain, uMeta, uCommands, uBins, uImpulse;
uniform vec2 uWorldSize, uWind, uDensity;
uniform float uTime, uSeed, uReaction, uInitialize;
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
float targetDensity(float slot,vec2 p,float water) {
  vec2 world=origin(slot)+(p+.5)*8.0;
  float broad=noise(world/270.0);
  float wisps=noise(world/113.0+vec2(21.0,7.0));
  return clamp(mix(uDensity.x,uDensity.y,water)*(.10+.90*smoothstep(.28,.78,broad*.72+wisps*.28)),0.0,.95);
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
  if(meta(slot,2.0).g>.5) return uWind;
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
 vec2 v=mix(old,uWind,${FOG.windRelaxation})+mixing*${FOG.momentumMix}*.25+push*${FOG.pressureGain}.0
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

export const FOG_MATERIAL_FRAGMENT = FOG_GLSL + `
uniform sampler2D uLookup;
uniform vec2 uLookupSize,uViewOrigin,uViewSize;
uniform float uOpacity,uDetail,uDebug,uInterpolation,uHasSurface,uQuality,uHasTrails;
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
void main() {
 vec2 world=uViewOrigin+flip(outTexCoord)*uViewSize;
 vec4 center=worldSample(world);
 vec2 grid=world/8.0-.5,base=(floor(grid)+.5)*8.0,weight=fract(grid);
 float d=mix(mix(worldSample(base).r,worldSample(base+vec2(8,0)).r,weight.x),
   mix(worldSample(base+vec2(0,8)).r,worldSample(base+vec2(8,8)).r,weight.x),weight.y);
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
 vec2 drift=world-uWind*uTime;
 float broad=noise(drift/160.0),fold=noise(drift/55.0+vec2(broad*2.0,uTime*.013));
 float fine=uQuality>1.5?noise(drift/23.0+fold):.5;
 float veil=mix(.55,1.0,smoothstep(.2,.8,broad*.4+fold*.6));
 veil*=mix(1.0,.7+fine*.6,uDetail);
 float trace=uHasTrails>.5?texture2D(uImpulse,outTexCoord).r:0.0;
 float alpha=min(.30,d*veil*uOpacity)*(1.0-trace);
 gl_FragColor=vec4(vec3(.79,.85,.84)*alpha,alpha);
}
`;

export const FOG_TRAIL_FRAGMENT = `
#pragma phaserTemplate(shaderName)
precision highp float;
varying vec2 outTexCoord;
uniform sampler2D uCommands,uBins;
uniform vec2 uWorldSize,uViewOrigin,uViewSize;
uniform float uTrailTime,uTrailCols,uTrailBinsHeight,uReaction;
float decode(vec2 v) {return dot(v,vec2(65280.,255.));}
void main() {
 vec2 world=uViewOrigin+vec2(outTexCoord.x,1.-outTexCoord.y)*uViewSize;
 if(any(lessThan(world,vec2(0))) || any(greaterThanEqual(world,uWorldSize))) {gl_FragColor=vec4(0);return;}
 vec2 tile=floor(world/${FOG.trailTile}.);
 float base=(tile.y*uTrailCols+tile.x)*${FOG.trailsPerTile}.;
 float amount=0.;
 for(int i=0;i<${FOG.trailsPerTile};i++) {
   float address=base+float(i);
   float index=decode(texture2D(uBins,vec2((mod(address,1024.)+.5)/1024.,(floor(address/1024.)+.5)/uTrailBinsHeight)).rg)-1.;
   if(index<0.) break;
   float x=(index+.5)/${FOG.trailCapacity}.;
   vec4 a=texture2D(uCommands,vec2(x,.125)),b=texture2D(uCommands,vec2(x,.375)),c=texture2D(uCommands,vec2(x,.625));
   float strength=texture2D(uCommands,vec2(x,.875)).r;
   vec2 start=vec2(decode(a.rg),decode(a.ba))/65535.*uWorldSize,end=vec2(decode(b.rg),decode(b.ba))/65535.*uWorldSize;
   vec2 line=end-start;
   float t=clamp(dot(world-start,line)/max(.001,dot(line,line)),0.,1.);
   float distance=length(world-mix(start,end,t));
   float duration=mod(decode(c.ba)-decode(c.rg)+60000.,60000.);
   float age=mod(uTrailTime-decode(c.rg)-t*duration+60000.,60000.);
   // max joins overlapping capsules without dark circular knots at frame boundaries.
   amount=max(amount,(1.-smoothstep(1.,${FOG.trailRadius}.,distance))*exp(-age/${FOG.trailDecayMs}.)
     *(1.-smoothstep(${FOG.trailMs * .7}.,${FOG.trailMs}.,age))*strength*4.5*uReaction);
 }
 gl_FragColor=vec4(min(.90,1.-exp(-amount)),0,0,1);
}
`;
