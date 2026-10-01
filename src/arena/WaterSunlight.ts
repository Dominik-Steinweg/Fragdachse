import { SUN_VISIBILITY_GLSL } from '../effects/sunlight/sunVisibility';
import { CLOUD_SHADOW_GLSL, setCloudUniforms, type SunCloudState } from '../effects/sunlight/cloudShadow';
import { WATER_FRAGMENT } from './waterSurfaceShader';

/** A separate program leaves the production fragment source and sampler list untouched. */
export const WATER_SUN_FRAGMENT = WATER_FRAGMENT.replace('void main() {', `
uniform vec2 uWorldOffset;
uniform float uWaterGlint,uWaterGlintDensity,uWaterGlintSpeed;
uniform vec3 uWaterSun;
${CLOUD_SHADOW_GLSL}
${SUN_VISIBILITY_GLSL}
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
    vec3 waveNormal=normalize(vec3(-.28*cos(p.x*.16+p.y*.057+a*2.4+pulseA),
      -.22*cos(p.y*.13-p.x*.043+b*2.1-pulseA),1.0));
    float specular=smoothstep(.77,.995,dot(waveNormal,halfVector));
    color+=vec3(1.0,.87,.60)*glint*specular*direct*uWaterGlint*3.0*surfaceMotion;
    color+=vec3(.025,.033,.035)*reflectedSky*direct*surfaceMotion;
    // The ground composite supplies shadow darkening; only increase reflected contrast here.
    color+=vec3(.012,.019,.023)*(sky-.5)*(1.0-lit)*uCloudStrength*surfaceMotion;
  }
  gl_FragColor=vec4(color*alpha,alpha);`);

export function setWaterSunUniforms(set:(name:string,value:unknown)=>void, state?:SunCloudState):void {
  set('uWaterSun',state?.sunPath?.sun??LEGACY_WATER_SUN);
  set('uWaterGlint',state?.tuning.waterGlint??0);
  set('uWaterGlintDensity',state?.tuning.waterGlintDensity??0);
  set('uWaterGlintSpeed',state?.tuning.waterGlintSpeed??0);
  setCloudUniforms(set,state);
}
const LEGACY_WATER_SUN = [-.5,-.5,Math.SQRT1_2];
