import { WATER_SHORE_DISTANCE } from './WaterSurfaceModel';

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
  // Canvas samplers use bottom-up UVs; world Y grows downwards.
  vec2 p=uOrigin+vec2(uv.x,1.0-uv.y)*uSize;
  // Small stationary bank irregularities keep the shoreline tied to the authored cells.
  vec2 bankWarp=(vec2(noise(p*.036+uSeed),noise(p*.041+vec2(19.2,uSeed)))-.5)*8.0;
  vec2 maskUv=(uv*uSize+uHalo+vec2(bankWarp.x,-bankWarp.y))/(uSize+2.0*uHalo);
  vec4 mask=texture2D(uMask,maskUv);
  if(mask.b<.35) discard;
  vec2 q=p*.013+vec2(uSeed);
  float t=uTime;
  float deepTime=t*.35;
  float shoreTime=t*1.5;
  float broad=field(p*.004+uSeed);
  // World-space bank variation keeps neighboring chunks on the same shoreline.
  float bank=field(p*.038+vec2(uSeed,31.7));
  float grain=noise(p*.16+9.2);
  float shore=mask.r*${WATER_SHORE_DISTANCE.toFixed(1)};
  float alpha=smoothstep(.32+bank*.10,.99,mask.b);
  // A short soft contact margin reveals water close to the collision edge.
  // Its opacity is independent of the much broader, calm shallow-water zone.
  alpha*=smoothstep(0.0,16.0,shore);
  // Freshly wetted ground retains a thin translucent film, strongest at the outer rim.
  alpha*=mix(.68,1.0,smoothstep(0.0,24.0,shore));
  // The same phase drives the incoming crest and its wetting/recession cycle.
  // Age zero is a crest at the bank. Water then recedes outside-in and returns
  // smoothly with the next crest, without moving the authored collision boundary.
  // Broad local phase offsets stagger arrivals along the coast. Bounded temporal
  // modulation varies their pace without accumulating spatial shear over time.
  // Long spatial wavelengths keep a water film coherent across its narrow width,
  // while different sections of the pond remain several seconds out of phase.
  float coastPhase=noise(p*.002+vec2(uSeed,47.1))*8.0
    +.5*sin(p.x*.003-p.y*.002);
  float bankPhase=shoreTime*.40+coastPhase
    +.35*sin(shoreTime*.09+coastPhase*.5)+.15*sin(shoreTime*.15-coastPhase*.5);
  float shorePhase=shore*.16+bankPhase;
  float waveAge=fract((bankPhase-1.5707963)/6.2831853);
  float localWaveAge=fract((shorePhase-1.5707963)/6.2831853);
  float recession=smoothstep(.10,.70,waveAge)*(1.0-smoothstep(.82,1.0,waveAge));
  float dryFront=recession*(14.0+bank*6.0);
  // The incoming crest pushes the wet front towards shore. Everything behind it
  // stays wet, so the film advances with the crest rather than as a detached band.
  float incomingFront=(1.0-waveAge)*6.2831853/.16;
  dryFront=min(dryFront,incomingFront);
  float dryMargin=1.0-smoothstep(dryFront-4.0,dryFront+4.0,shore);
  alpha*=1.0-.94*recession*dryMargin;

  // Bounded local eddies stretch and relax independently. Integrating position via
  // bounded oscillations avoids the increasing shear of position * time flow fields.
  float phase=field(p*.005+23.4)*6.28318;
  vec2 eddyA=vec2(sin(deepTime*.17+phase),cos(deepTime*.13+phase*1.37));
  vec2 eddyB=vec2(cos(deepTime*.11-phase*.83),sin(deepTime*.19+phase*1.19));
  float a=field(q+eddyA*.62+eddyB*.23);
  float b=field(q*1.63+eddyB*.54-eddyA*.19+a*.6);
  float pulseA=sin(deepTime*.31+phase)*1.9+sin(deepTime*.14-phase*.7)*.8;
  float pulseB=sin(deepTime*.23-phase*1.23)*1.7+cos(deepTime*.37+phase)*.6;
  float ripples=sin(p.x*.082+p.y*.046+a*7.0+pulseA)
    +.45*sin(p.x*-.055+p.y*.103+b*6.0+pulseB);
  // Stationary variations in bed depth soften the parallel band around the pond.
  // Fade this displacement at both ends to retain a calm bank and full deep material.
  float shelf=(noise(p*.011+vec2(uSeed,53.2))-.5)*24.0+(bank-.5)*8.0;
  float depthDistance=shore*1.2;
  float basinDistance=depthDistance+shelf*smoothstep(12.0,28.0,depthDistance)*(1.0-smoothstep(46.0,64.0,depthDistance));
  float depth=smoothstep(6.0,60.0,basinDistance);
  float deepMotion=smoothstep(18.0,58.0,basinDistance);
  float deepReflections=smoothstep(32.0,62.0,basinDistance);
  // One continuous water material: the shallow region shares the slow surface field,
  // with much lower contrast. Only the large ripples and sharp reflections need depth.
  // A single monotonic distance ramp replaces the nearly uniform shallow shelf.
  // Every color channel darkens continuously; only the slope eases into deep water.
  float shoreFraction=clamp(depthDistance/${WATER_SHORE_DISTANCE.toFixed(1)},0.0,1.0);
  float colorDepth=1.0-pow(1.0-shoreFraction,1.5);
  vec3 shallow=vec3(.155,.30,.325);
  vec3 deep=vec3(.05,.185,.235);
  vec3 color=mix(shallow,deep,colorDepth)*(.90+broad*.18);
  color*=1.0+(grain-.5)*(1.0-depth)*.025;
  float surfaceMotion=smoothstep(0.0,12.0,shore)*mix(.50,1.0,depth);
  color+=vec3(.11,.18,.16)*(a-.5)*surfaceMotion;
  color+=vec3(.025,.043,.042)*ripples*deepMotion;
  float glint=pow(max(0.0,1.0-abs(ripples*.53+b*.30-.50)),15.0);
  glint*=smoothstep(.42,.74,a)*deepReflections;
  color+=vec3(.30,.40,.36)*glint*.34;
  // Small shoreward wavelets share the outer water film's wetting cycle.
  // Roughly 39 px between crests leaves one or two across the shallow margin.
  // Base travel is 3.75 px/s; a faint trailing crest persists while its film spreads.
  float wave=max(pow(.5+.5*sin(shorePhase),10.0),.65*(1.0-smoothstep(.02,.10,localWaveAge)));
  float fringe=smoothstep(0.0,4.0,shore)*(1.0-smoothstep(24.0,42.0,shore));
  float broken=smoothstep(.28,.70,bank+.10*sin(shoreTime*.14+p.x*.022-p.y*.014));
  color+=vec3(.18,.24,.20)*wave*fringe*broken*.12;
  gl_FragColor=vec4(color*alpha,alpha);
}
`;
