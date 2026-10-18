import { SUN_VISIBILITY_GLSL } from '../effects/sunlight/sunVisibility';
import { CLOUD_SHADOW_GLSL, setCloudUniforms, type SunCloudState } from '../effects/sunlight/cloudShadow';
import { WATER_FRAGMENT } from './waterSurfaceShader';
import { SURFACE_LIGHT_GLSL, setSurfaceLightUniforms, type SurfaceLightFrame } from '../effects/SurfaceLocalLights';

/** A separate program leaves the production fragment source and sampler list untouched. */
export const WATER_SUN_FRAGMENT = WATER_FRAGMENT.replace('void main() {', `
uniform vec2 uWorldOffset;
uniform float uWaterGlint,uWaterGlintDensity,uWaterGlintSpeed;
uniform vec3 uWaterSun;
uniform float uWaterNight;
${CLOUD_SHADOW_GLSL}
${SUN_VISIBILITY_GLSL}
${SURFACE_LIGHT_GLSL}
void main() {`).replace('gl_FragColor=vec4(color*alpha,alpha);', `
  if(uCloudStrength>0.0) {
    vec2 world=p+uWorldOffset;
    float lit=sunVisibility(world);
    float direct=lit*uCloudStrength;
    // R7 thresholded the amplitude-damped ripple (usually only +/-0.6).
    // Read its unchanged phase instead: crest selection must not depend on height.
    float crest=sin(p.x*.16+p.y*.057+a*2.4+pulseA);
    float sparkleTime=t*uWaterGlintSpeed;
    float fleck=sunNoise(world*.23+vec2(sparkleTime*.57,-sparkleTime*.39));
    float flicker=.5+.5*sin(sparkleTime*3.7+sunNoise(world*.065)*6.2831853);
    float glint=smoothstep(.86,.995,crest)
      *smoothstep(mix(.93,.52,uWaterGlintDensity),.98,fleck)
      *smoothstep(.35,.92,flicker)*step(.0001,uWaterGlintDensity);
    // View is straight down. Wave slopes meeting the moving sun/view half-vector
    // shift the tiny specular patches across the unchanged ripple field.
    vec3 halfVector=normalize(uWaterSun+vec3(0.0,0.0,1.0));
    vec3 waveNormal=normalize(vec3(-.28*cos(p.x*.16+p.y*.057+a*2.4+pulseA)-dSlope.x*1.5,
      -.22*cos(p.y*.13-p.x*.043+b*2.1-pulseA)-dSlope.y*1.5,1.0));
    float specular=smoothstep(.77,.995,dot(waveNormal,halfVector));
    color+=vec3(1.0,.87,.60)*glint*specular*direct*uWaterGlint*3.0*surfaceMotion;
    color+=vec3(.025,.033,.035)*reflectedSky*direct*surfaceMotion;
    // The ground composite supplies shadow darkening; only increase reflected contrast here.
    color+=vec3(.012,.019,.023)*(sky-.5)*(1.0-lit)*uCloudStrength*surfaceMotion;
  }
  // Night (GDD Nachtsicht N-5): only added on top of the finished material. The outer film,
  // wavelets and meniscus stay as they are; alpha is never touched.
  if(uWaterNight>0.0) {
    vec2 world=p+uWorldOffset;
    // Night water reads blue against the warm, matte ground: its own cool body, keeping the
    // existing ripple and reflection detail on top. The outer film and wavelets stay untouched.
    float body=smoothstep(6.0,28.0,shore)*uWaterNight;
    vec3 dayBody=mix(shallow,deep,colorDepth)*(.90+broad*.18);
    vec3 nightBody=mix(vec3(.055,.13,.29),vec3(.022,.06,.175),colorDepth)*(.90+broad*.2);
    color=mix(color,nightBody+(color-dayBody)*vec3(.55,.8,1.15),body*.9);
    // Moonlit sky in the broad reflections; the light map shows it only inside moon islands.
    color+=vec3(.040,.058,.085)*reflectedSky*surfaceMotion*uWaterNight;
    // Lamp glints: crest flanks tilted towards a lamp catch it. A true specular highlight of a
    // low lamp is invisible from straight above, so the crest phase selects the patches.
    float crest=sin(p.x*.16+p.y*.057+a*2.4+pulseA);
    vec2 slope=vec2(-.28*cos(p.x*.16+p.y*.057+a*2.4+pulseA)-dSlope.x*1.5,
      -.22*cos(p.y*.13-p.x*.043+b*2.1-pulseA)-dSlope.y*1.5);
    float fleck=sunNoise(world*.23+vec2(t*.41,-t*.29))*sunNoise(world*.071-vec2(t*.13,t*.17));
    float lamp=0.0, sheen=0.0;
    for(int i=0;i<4;i++) {
      if(float(i)>=uSurfaceLightCount) break;
      vec4 lp=uSurfaceLightPos[i];
      float amount=surfaceLampAmount(lp,uSurfaceLightCone[i],uSurfaceLightProfile[i],world);
      if(amount<=0.0) continue;
      float dominance=amount/(amount+uSurfaceAmbient);
      float towards=dot(normalize(slope+vec2(1e-4)),normalize(lp.xy-world+vec2(1e-4)));
      lamp=max(lamp,dominance*smoothstep(.25,.85,towards));
      sheen=max(sheen,dominance*(.5+.5*towards));
    }
    float glint=smoothstep(.80,.99,crest)*smoothstep(.30,.80,fleck);
    color+=vec3(.95,.92,.84)*glint*lamp*surfaceMotion*1.2*uWaterNight;
    // A broad gloss where the surface leans towards the lamp, from the slow reflection field.
    color+=vec3(.035,.050,.058)*sheen*(.55+.45*reflectedSky)*surfaceMotion*uWaterNight;
  }
  gl_FragColor=vec4(color*alpha,alpha);`);

/** Night inputs of the water material: night weight and the lamps meeting a chunk. */
export interface WaterNightLight {
  readonly night: number;
  lights(x: number, y: number, width: number, height: number, out: SurfaceLightFrame): SurfaceLightFrame;
}
export function setWaterNightUniforms(set:(name:string,value:unknown)=>void, night:WaterNightLight|null|undefined,
  lights:SurfaceLightFrame|null):void {
  set('uWaterNight',night?Math.max(0,Math.min(1,night.night)):0);
  setSurfaceLightUniforms(set,lights,null);
}

export function setWaterSunUniforms(set:(name:string,value:unknown)=>void, state?:SunCloudState):void {
  set('uWaterSun',state?.sunPath?.sun??LEGACY_WATER_SUN);
  set('uWaterGlint',state?.tuning.waterGlint??0);
  set('uWaterGlintDensity',state?.tuning.waterGlintDensity??0);
  set('uWaterGlintSpeed',state?.tuning.waterGlintSpeed??0);
  setCloudUniforms(set,state);
}
const LEGACY_WATER_SUN = [-.5,-.5,Math.SQRT1_2];
