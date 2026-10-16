/**
 * Self-lit part of a kraken view, drawn additively ABOVE the light map: the material pass keeps its own
 * emission, but everything at the boss's depth is multiplied by the dusk ambient, so the eyes and the brood
 * ember could never read as glowing there. One quad per view covers only the glowing region (eye trim,
 * brood discs, or the whole egg) in the view's logical canvas space and samples the view's own atlases.
 * Output alpha is 0: with Phaser's ADD (ONE, DST_ALPHA) the colour adds and destination alpha survives.
 * Quality is a uniform (halo taps), never a program variant.
 */
export const KRAKEN_EMISSION_PROGRAM = 'KrakenEmission';

export const KRAKEN_EMISSION_FRAGMENT = `
#pragma phaserTemplate(shaderName)
precision highp float;
varying vec2 outTexCoord;
uniform sampler2D uEmission, uElevation, uWater;
uniform vec4 uQuad;
uniform vec4 emissionUV, emissionTrim; uniform vec2 emissionSize;
uniform vec4 elevationUV, elevationTrim; uniform vec2 elevationSize;
uniform float elevationMin, elevationMax, waterLevel, uFadeEnd;
uniform vec2 uDisplay;
uniform float uEye, uEyeGain, uHaloPx, uHaloTaps, uHalo, uAlpha, uGlowWhole;
uniform vec3 uEyeColor, uEyeHot;
uniform vec4 uGlow;
uniform vec4 broodDisc0, broodDisc1, broodDisc2, broodDisc3, broodDisc4, broodDisc5;
float emissionAt(vec2 logical) {
  vec2 local=(logical*emissionSize-emissionTrim.xy)/emissionTrim.zw;
  if(any(lessThan(local,vec2(0)))||any(greaterThan(local,vec2(1)))) return 0.0;
  vec3 e=texture2D(uEmission,mix(emissionUV.xy,emissionUV.zw,local)).rgb;
  return max(e.r,max(e.g,e.b));
}
vec4 heightAt(vec2 logical) {
  vec2 local=(logical*elevationSize-elevationTrim.xy)/elevationTrim.zw;
  if(any(lessThan(local,vec2(0)))||any(greaterThan(local,vec2(1)))) return vec4(0);
  return texture2D(uElevation,mix(elevationUV.xy,elevationUV.zw,local));
}
float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p) {
  vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.0),f.x),f.y);
}
float brood(vec4 disc, vec2 logical, float z) {
  if(disc.z<=0.0) return 0.0;
  return (1.0-smoothstep(.55,1.0,length(logical-disc.xy)/disc.z))*smoothstep(disc.w-.04,disc.w+.02,z);
}
void main() {
  vec2 uv=vec2(outTexCoord.x,1.0-outTexCoord.y);
  vec2 logical=mix(uQuad.xy,uQuad.zw,uv);
  vec4 h=heightAt(logical);
  float coverage=h.a, rel=coverage>.001?clamp(h.r/coverage,0.0,1.0):0.0;
  float z=mix(elevationMin,elevationMax,rel);
  // Under water the light dims and reddens with depth, more slowly than the colour fades.
  float under=coverage>.001?texture2D(uWater,logical).r*smoothstep(0.0,uFadeEnd,waterLevel-z):0.0;
  vec3 rgb=vec3(0.0);
  float eye=emissionAt(logical)*uEyeGain*uEye;
  rgb+=mix(uEyeColor,uEyeHot,smoothstep(.55,1.5,eye))*eye;
  if(uHaloTaps>0.5) {
    float halo=0.0;
    vec2 tap=vec2(uHaloPx)/max(uDisplay,vec2(1.0));
    for(int i=0;i<12;i++) {
      if(float(i)>=uHaloTaps) break;
      float a=float(i)*6.2831853/uHaloTaps, r=mod(float(i),2.0)<.5?1.0:.55;
      halo+=emissionAt(logical+vec2(cos(a),sin(a))*tap*r);
    }
    rgb+=uEyeColor*halo/uHaloTaps*uHalo*uEyeGain*uEye;
  }
  if(uGlow.a>0.0) {
    float b=max(max(max(brood(broodDisc0,logical,z),brood(broodDisc1,logical,z)),max(brood(broodDisc2,logical,z),brood(broodDisc3,logical,z))),
      max(brood(broodDisc4,logical,z),brood(broodDisc5,logical,z)));
    // The brood's light shines through the shell: a core under the crown and, on a whole egg, a net of
    // veins leaking light across the leathery shell (egg-local, so the net turns with the egg).
    float crown=smoothstep(.4,1.0,rel);
    float veinField=noise(logical*7.0+3.1)*.65+noise(logical*16.0+8.7)*.35;
    float veins=(1.0-smoothstep(0.0,.055,abs(veinField-.5)))*smoothstep(.08,.75,rel)*uGlowWhole;
    float shell=mix(b,coverage,uGlowWhole)*(crown*crown*mix(.6,.38,uGlowWhole)+veins);
    rgb+=uGlow.rgb*uGlow.a*shell+uEyeHot*uGlow.a*veins*coverage*crown*.35;
  }
  rgb*=1.0-.8*under;
  rgb=mix(rgb,rgb*vec3(1.0,.32,.42),under);
  gl_FragColor=vec4(rgb*uAlpha,0.0);
}
`;
