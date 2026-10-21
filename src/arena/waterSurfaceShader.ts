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
// Surface disturbances (rings, swell, vortices, wakes) in frame-local space; see WaterDisturbanceField.
uniform sampler2D uDisturb;
uniform vec4 uDisturbRect;
uniform vec2 uDisturbTexel;
uniform float uDisturbOn;
// Void bloom: local centre xy, reached radius z, strength w; plus a luminance pulse.
uniform vec4 uVoid;
uniform float uVoidPulse;
// Dye in the water body (blood clouds): frame-local rect of the borrowed texture, density in B.
uniform sampler2D uDye;
uniform vec4 uDyeRect;
uniform float uDyeOn;
uniform float uDyeFlip;
// Optional hue of the dye: colour × presence in RGB, presence in A (same rect); off = the default red.
uniform sampler2D uDyeHue;
uniform float uDyeHueOn;

float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}
float field(vec2 p) { return noise(p)*.58 + noise(p*2.03+17.3)*.28 + noise(p*4.07+8.1)*.14; }
// Gradient noise on a triangular lattice avoids the square plateaus of value noise.
// Rotated octaves keep the surface material free of a shared grid direction.
float pondNoise(vec2 p) {
  vec2 cell=floor(p+(p.x+p.y)*.3660254);
  vec2 v0=p-cell+(cell.x+cell.y)*.2113249;
  vec2 corner=v0.x>v0.y ? vec2(1.0,0.0) : vec2(0.0,1.0);
  vec2 v1=v0-corner+.2113249;
  vec2 v2=v0-1.0+.4226497;
  vec3 angle=vec3(hash(cell),hash(cell+corner),hash(cell+1.0))*6.2831853;
  vec3 weight=max(.5-vec3(dot(v0,v0),dot(v1,v1),dot(v2,v2)),0.0);
  weight*=weight;
  weight*=weight;
  vec3 gradient=cos(angle)*vec3(v0.x,v1.x,v2.x)+sin(angle)*vec3(v0.y,v1.y,v2.y);
  return .5+35.0*dot(weight,gradient);
}
float pondField(vec2 p) {
  mat2 turn=mat2(.8,.6,-.6,.8);
  return pondNoise(p)*.58+pondNoise(turn*p*2.03+17.3)*.28
    +pondNoise(turn*turn*p*4.07+8.1)*.14;
}
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
  float broad=pondField(p*.004+uSeed);
  // World-space bank variation keeps neighboring chunks on the same shoreline.
  float bank=field(p*.038+vec2(uSeed,31.7));
  float grain=noise(p*.16+9.2);
  float shore=mask.r*${WATER_SHORE_DISTANCE.toFixed(1)};
  // The baked riverbank below carries the soft land transition (wet silt, darkening towards
  // the water), so the waterline itself stays fairly crisp instead of a blurred blob edge.
  float alpha=smoothstep(.40+bank*.08,.78,mask.b);
  // A short soft contact margin reveals water close to the collision edge.
  // Its opacity is independent of the much broader, calm shallow-water zone.
  alpha*=smoothstep(0.0,9.0,shore);
  // A shallow shelf: the baked bank stays visible through the water for a few decimetres and
  // only gradually disappears, so the shore reads as gently sloping rather than a drop-off.
  alpha*=mix(.42,1.0,smoothstep(2.0,44.0,shore));
  // Thin meniscus where the surface meets the bank and catches a little light.
  float meniscus=smoothstep(.40,.50,mask.b)*(1.0-smoothstep(.54,.70,mask.b));
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
  float phase=pondField(p*.005+23.4)*6.28318;
  vec2 eddyA=vec2(sin(deepTime*.17+phase),cos(deepTime*.13+phase*1.37));
  vec2 eddyB=vec2(cos(deepTime*.11-phase*.83),sin(deepTime*.19+phase*1.19));
  float a=pondField(q+eddyA*.24+eddyB*.10);
  float b=pondField(q*1.63+eddyB*.20-eddyA*.08+a*.25);
  // Small wind ripples disturb a sheltered surface instead of forming large swells.
  float pulseA=sin(deepTime*.31+phase)*.7+sin(deepTime*.14-phase*.7)*.3;
  float ripples=sin(p.x*.16+p.y*.057+a*2.4+pulseA)*mix(.35,1.0,b);
  // Stationary variations in bed depth soften the parallel band around the pond.
  // Fade this displacement at both ends to retain a calm bank and full deep material.
  float shelf=(pondNoise(p*.011+vec2(uSeed,53.2))-.5)*24.0+(bank-.5)*8.0;
  float depthDistance=shore*1.2;
  float basinDistance=depthDistance+shelf*smoothstep(12.0,28.0,depthDistance)*(1.0-smoothstep(46.0,64.0,depthDistance));
  float depth=smoothstep(6.0,60.0,basinDistance);
  float deepMotion=smoothstep(18.0,58.0,basinDistance);
  float deepReflections=smoothstep(32.0,62.0,basinDistance);
  // One continuous water material: the shallow region shares the slow surface field,
  // with much lower contrast. Ripples and their reflected light build up with depth.
  // A single monotonic distance ramp replaces the nearly uniform shallow shelf.
  // Every color channel darkens continuously. The ramp starts flat at the bank and eases into
  // deep water, so the shallows stay light instead of dropping off right at the shore.
  float shoreFraction=clamp(depthDistance/${WATER_SHORE_DISTANCE.toFixed(1)},0.0,1.0);
  float colorDepth=shoreFraction*shoreFraction*(3.0-2.0*shoreFraction);
  vec3 shallow=vec3(.095,.325,.32);
  vec3 deep=vec3(.022,.17,.195);
  vec3 color=mix(shallow,deep,colorDepth)*(.90+broad*.18);
  color*=1.0+(grain-.5)*(1.0-depth)*.025;
  // Dye: blood spreads inside the water body and curls with the pond's own eddies. It tints the
  // body before every reflection, ripple and glint, so those still play over it. Later body grades
  // (void bloom, void stain) give way where the dye covers the body.
  float dyeCover=0.0;
  if(uDyeOn>.5) {
    vec2 du=(p-uDyeRect.xy)/uDyeRect.zw;
    if(du.x>0.0&&du.y>0.0&&du.x<1.0&&du.y<1.0) {
      du.y=mix(du.y,1.0-du.y,uDyeFlip);
      if(texture2D(uDye,du).b>.003) {
        vec2 swirl=vec2(pondNoise(p*.019+eddyA*.7+vec2(t*.05,0.0)),pondNoise(p*.019+eddyB*.7+vec2(0.0,t*.045)+7.3))-.5;
        vec2 warped=du+swirl*vec2(16.0,mix(16.0,-16.0,uDyeFlip))/uDyeRect.zw;
        float dye=texture2D(uDye,warped).b;
        float wisps=pondField(p*.045+swirl*2.4+vec2(t*.03,-t*.024));
        float cloud=clamp(dye*(.62+.7*wisps),0.0,1.0);
        float body=smoothstep(0.0,.7,cloud);
        // Dense blood is a deep, almost opaque crimson; its thin rim scatters a warmer red.
        vec3 dense=vec3(.27,.012,.028)*mix(1.0,.72,colorDepth);
        vec3 thin=vec3(.50,.06,.05)*mix(1.0,.8,colorDepth);
        vec3 blood=mix(thin,dense,smoothstep(.25,.9,cloud));
        if(uDyeHueOn>.5) {
          // Keep the red's lightness, take the dye's own hue where it is present.
          vec4 tint=texture2D(uDyeHue,warped);
          float share=clamp(tint.a,0.0,1.0);
          vec3 hue=tint.rgb/max(tint.a,.001);
          // The authored colour stands for fresh thin blood (lightness .21); darker tones scale it.
          blood=mix(blood,min(hue*(dot(blood,vec3(.299,.587,.114))/.21),vec3(1.0)),share);
        }
        color=mix(color,blood+(color-mix(shallow,deep,colorDepth))*.25,body*.9);
        dyeCover=body*.9;
      }
    }
  }
  float surfaceMotion=smoothstep(0.0,12.0,shore)*mix(.50,1.0,depth);
  float depthReflection=mix(1.0,.25,colorDepth);
  color+=vec3(.025,.070,.075)*(a-.5)*surfaceMotion*mix(1.0,.65,colorDepth);
  // Soft procedural vegetation/sky reflections remain almost stationary and follow
  // the surface distortion. Reflected light belongs to the water, without drawn crests.
  float canopy=pondField(p*.006+vec2(uSeed,39.1)+eddyA*.06);
  float sky=smoothstep(.38,.72,pondField(p*.008+vec2(7.2,uSeed)+eddyB*.08));
  color-=vec3(.015,.030,.028)*smoothstep(.40,.72,canopy)*surfaceMotion;
  // A soft sheen shares the existing ripple field instead of drawing separate bright
  // strokes. Broad reflected light stays subdued in the basin to preserve its depth.
  float surfaceSheen=smoothstep(-.25,.90,ripples);
  float reflectedSky=sky*mix(1.0,.70+.30*surfaceSheen,deepReflections);
  color+=vec3(.035,.085,.105)*reflectedSky*surfaceMotion*depthReflection;
  color+=vec3(.003,.011,.013)*ripples*deepMotion;
  // Small shoreward wavelets share the outer water film's wetting cycle.
  // Roughly 39 px between crests leaves one or two across the shallow margin.
  // Base travel is 3.75 px/s; a faint trailing crest persists while its film spreads.
  float wave=max(pow(.5+.5*sin(shorePhase),10.0),.65*(1.0-smoothstep(.02,.10,localWaveAge)));
  float fringe=smoothstep(0.0,4.0,shore)*(1.0-smoothstep(24.0,42.0,shore));
  float broken=smoothstep(.28,.70,bank+.10*sin(shoreTime*.14+p.x*.022-p.y*.014));
  color+=vec3(.12,.26,.27)*wave*fringe*broken*.12;
  color+=vec3(.030,.060,.060)*meniscus*(.6+.4*bank);
  // Disturbances belong to this surface: their slopes catch the same sky light as the ripples, churned
  // water darkens, and foam is broken into lace by the pond's own noise rather than drawn as strokes.
  vec2 dSlope=vec2(0.0);
  if(uDisturbOn>.5) {
    vec2 du=(p-uDisturbRect.xy)/uDisturbRect.zw;
    if(du.x>0.0&&du.y>0.0&&du.x<1.0&&du.y<1.0) {
      vec2 tuv=vec2(du.x,1.0-du.y);
      vec4 f=texture2D(uDisturb,tuv);
      float dh=f.r*2.0-1.0;
      dSlope=vec2(texture2D(uDisturb,tuv+vec2(uDisturbTexel.x,0.0)).r*2.0-1.0-dh,
        dh-(texture2D(uDisturb,tuv+vec2(0.0,uDisturbTexel.y)).r*2.0-1.0))*5.0;
      float lit=clamp(dot(dSlope,vec2(-.6,-.8)),-1.0,1.0);
      color+=vec3(.060,.125,.130)*lit+vec3(.018,.045,.050)*dh;
      color*=1.0-.32*f.b;
      // Fine, translucent lace in the tone of the shore wavelets; it thins out instead of forming bands.
      float lace=smoothstep(.40,.88,pondField(p*.17+vec2(t*.35,-t*.27)+dSlope*.8))*.65
        +smoothstep(.50,.92,pondField(p*.055+vec2(-t*.12,t*.1)+11.0))*.35;
      float foam=clamp(f.g*lace,0.0,1.0);
      color=mix(color,vec3(.34,.52,.52),foam*.62);
      // Foam rides up onto the thin shore film as well.
      alpha=max(alpha,foam*.55*smoothstep(.35,.45,mask.b));
    }
  }
  // Void bloom: behind a soft luminous front the water turns to deep violet ink, darker with depth.
  // Faint swell lines, caustic pools and motes keep it reading as water. The light map lifts it at dusk.
  if(uVoid.w>0.0) {
    // Ink spreads unevenly: the front is pushed ahead and held back by the pond's own noise.
    float voidDistance=length(p-uVoid.xy)+(pondNoise(p*.0085+vec2(uSeed,17.3))-.5)*130.0+(pondNoise(p*.031+11.0)-.5)*34.0;
    float reached=1.0-smoothstep(uVoid.z-70.0,uVoid.z,voidDistance);
    // Blood in the pond stays visible: the void yields where the dye covers the body.
    float grade=uVoid.w*reached*(1.0-dyeCover*.9);
    // Deep, saturated void: almost black in the basin, a richer violet over the shelf.
    vec3 voidBody=mix(vec3(.17,.05,.29),vec3(.042,.008,.095),colorDepth)*(.9+broad*.2);
    color=mix(color,voidBody,grade*.94);
    // The surface keeps reading as water: its own ripple, sky and shore wavelet fields catch
    // faint violet light instead of the natural teal.
    color+=vec3(.11,.045,.19)*reflectedSky*surfaceMotion*depthReflection*grade;
    color+=vec3(.05,.02,.085)*(a-.5)*surfaceMotion*grade;
    color+=vec3(.18,.09,.30)*wave*fringe*broken*.10*grade;
    // Light from below: broad caustic pools drift slowly through the basin.
    float glowDepth=smoothstep(10.0,52.0,depthDistance);
    float caustic=smoothstep(.56,.96,pondField(p*.0058+vec2(t*.018,-t*.014)+eddyA*.12));
    float breathe=.75+.25*sin(t*.55+caustic*3.5);
    color+=vec3(.34,.12,.56)*caustic*glowDepth*grade*.28*breathe;
    // Waves: slow swell lines catch a soft violet light. Each line is a faint halo around a fine core,
    // broken along its length and gathered into drifting patches, so the surface never reads as a net.
    float swellOffset=abs(pondField(p*.0085+eddyA*.16+vec2(t*.021,-t*.016))-.5);
    float swellLine=(1.0-smoothstep(0.0,.018,swellOffset))*.65+(1.0-smoothstep(0.0,.075,swellOffset))*.35;
    float swellPatch=smoothstep(.34,.74,pondField(p*.0036+vec2(-t*.012,t*.009)+uSeed));
    float swellGlint=.45+.55*smoothstep(.30,.80,pondNoise(p*.021+vec2(t*.09,t*.06)));
    color+=vec3(.46,.26,.80)*swellLine*swellPatch*swellGlint*smoothstep(4.0,30.0,depthDistance)*grade*.16;
    // A finer set of ripples rides on top, much fainter.
    float rippleOffset=abs(pondField(p*.019+eddyB*.1+vec2(-t*.034,t*.028))-.5);
    color+=vec3(.40,.24,.70)*(1.0-smoothstep(0.0,.022,rippleOffset))*swellPatch*glowDepth*grade*.045;
    float motes=smoothstep(.90,.985,pondNoise(p*.085+vec2(t*.22,t*.15)));
    color+=vec3(.80,.62,1.0)*motes*glowDepth*.10*grade;
    color+=vec3(.50,.22,.80)*uVoidPulse*grade*(.25+.75*glowDepth)*.32;
    // The advancing front: a soft luminous edge with a short afterglow, only while the bloom spreads.
    float frontOffset=voidDistance-uVoid.z;
    float front=exp(-pow(frontOffset/22.0,2.0));
    float afterglow=exp(min(frontOffset,0.0)/60.0)*(1.0-smoothstep(-8.0,4.0,frontOffset));
    color+=vec3(.62,.38,.95)*front*uVoid.w*.45+vec3(.40,.18,.66)*afterglow*grade*.14;
  }
  gl_FragColor=vec4(color*alpha,alpha);
}
`;
