import { CHARACTER_MATERIAL_CONFIG } from '../CharacterMaterialModel';
import { CLOUD_SHADOW_GLSL } from '../sunlight/cloudShadow';
/** AO/cavities are authored into albedo. Emission is a sparse linear RGB sidecar. */
export const KRAKEN_MATERIAL_HEADER = `
uniform float materialEnabled,materialLow,materialStrength,emissionRange;
uniform vec3 materialSun; uniform vec4 materialWorld; uniform vec2 materialOrigin;
uniform vec3 materialNormalScale,materialTint; uniform float materialSaturation; uniform vec2 materialHighlightTone;
uniform vec4 emissionUV,emissionTrim; uniform vec2 emissionSize;
uniform vec4 materialGlow; uniform vec2 materialGlowShape; uniform vec4 broodTint;
uniform vec4 broodDisc0,broodDisc1,broodDisc2,broodDisc3,broodDisc4,broodDisc5;
uniform sampler2D uEmission;
${CLOUD_SHADOW_GLSL}
vec3 krakenOct(vec2 e){vec2 f=e*2.0-1.0;vec3 n=vec3(f,1.0-abs(f.x)-abs(f.y));
float t=max(0.0,-n.z);n.xy+=mix(vec2(t),vec2(-t),step(vec2(0),n.xy));return normalize(n);}
vec4 krakenNormalTexel(vec2 p){
vec2 local=(clamp(p,elevationTrim.xy+.5,elevationTrim.xy+elevationTrim.zw-.5)-elevationTrim.xy)/elevationTrim.zw;
vec4 d=texture2D(uElevation,mix(elevationUV.xy,elevationUV.zw,local));
return vec4(krakenOct(clamp(d.gb/max(.001,d.a),0.0,1.0))*d.a,d.a);}
vec3 krakenNormal(vec2 logical){
// Decode each octahedral texel BEFORE interpolation (including the lower-hemisphere seam).
vec2 p=logical*elevationSize-.5,base=floor(p)+.5,f=fract(p);
vec4 n=mix(mix(krakenNormalTexel(base),krakenNormalTexel(base+vec2(1,0)),f.x),
mix(krakenNormalTexel(base+vec2(0,1)),krakenNormalTexel(base+vec2(1,1)),f.x),f.y);
return n.a>.001?normalize(n.xyz):vec3(0,0,1);}
vec3 krakenLinear(vec3 c){return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(vec3(.04045),c));}
vec3 krakenSRGB(vec3 c){return mix(c*12.92,1.055*pow(max(c,vec3(0)),vec3(1.0/2.4))-.055,step(vec3(.0031308),c));}
// A brood egg baked into a body frame: its shell is the only surface at/above the egg socket's height
// inside the socket disc; the carrying arm tip stays below it. Disc: logical centre, radius, socket z.
float krakenBrood(vec4 disc,vec2 logical,float z){
if(disc.z<=0.0)return 0.0;
return (1.0-smoothstep(.8,1.0,length(logical-disc.xy)/disc.z))*smoothstep(disc.w-.04,disc.w+.02,z);}
vec4 krakenLight(vec4 source,vec2 logical,vec4 data){
if(materialEnabled<.5||source.a<=.001||data.a<=.001)return source;
vec3 n;
if(materialLow>.5){vec2 xy=(logical-.5)*1.1;n=normalize(vec3(xy,sqrt(max(.1,1.0-dot(xy,xy)))));}
else n=krakenNormal(logical);
n=normalize(n*materialNormalScale);
vec2 p=(logical-materialOrigin)*displaySize;
vec2 world=materialWorld.xy+vec2(p.x*materialWorld.z-p.y*materialWorld.w,p.x*materialWorld.w+p.y*materialWorld.z);
float direct=materialStrength*cloudTransmission(world);
float factor=(${CHARACTER_MATERIAL_CONFIG.ambient}+direct*max(0.0,dot(n,materialSun)))/(${CHARACTER_MATERIAL_CONFIG.ambient}+direct*max(0.0,materialSun.z));
vec3 albedo=krakenLinear(source.rgb/source.a);
// Preserve dark dermis/AO; roll off only bright albedo (not light or emission).
// A positive slope retains the relief within pale suction-cup rims.
float albedoL=dot(albedo,vec3(.2126,.7152,.0722));
if(albedoL>materialHighlightTone.x)albedo*=(materialHighlightTone.x+(albedoL-materialHighlightTone.x)*materialHighlightTone.y)/albedoL;
vec3 color=albedo*factor*materialTint;
color=mix(vec3(dot(color,vec3(.2126,.7152,.0722))),color,materialSaturation);
float brood=0.0;
if(broodTint.a>0.0){
float z=mix(elevationMin,elevationMax,clamp(data.r/data.a,0.0,1.0));
brood=max(max(max(krakenBrood(broodDisc0,logical,z),krakenBrood(broodDisc1,logical,z)),
max(krakenBrood(broodDisc2,logical,z),krakenBrood(broodDisc3,logical,z))),
max(krakenBrood(broodDisc4,logical,z),krakenBrood(broodDisc5,logical,z)));
vec3 egg=albedo*factor*broodTint.rgb;
color=mix(color,mix(vec3(dot(egg,vec3(.2126,.7152,.0722))),egg,broodTint.a),brood);}
// Inner ember of the brood: strongest where the shell faces up, i.e. its centre seen from above.
color+=materialGlow.rgb*materialGlow.a*pow(clamp(n.z,0.0,1.0),materialGlowShape.x)*mix(brood,1.0,materialGlowShape.y);
color=max(color,vec3(0));
vec2 local=(logical*emissionSize-emissionTrim.xy)/emissionTrim.zw;
if(all(greaterThanEqual(local,vec2(0)))&&all(lessThanEqual(local,vec2(1)))){
vec4 e=texture2D(uEmission,mix(emissionUV.xy,emissionUV.zw,local));
color+=e.rgb*emissionRange/max(source.a,.001);}
return vec4(krakenSRGB(color)*source.a,source.a);
}`;
