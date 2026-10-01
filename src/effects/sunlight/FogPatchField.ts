import type { SunCloudState } from './cloudShadow';
import { cloudTimeSeconds, cloudTravel, fogBankAt, fogDetailNoise, fogDetailHash } from './SunFieldModel';
import { FOG } from '../groundFog/FogConfig';
import { fogDayWeight } from '../groundFog/FogBankField';

/** Two independently occupied, staggered lattices share the area budget.
 * Cell radii and jitter reserve the complete optical halo, not just the mask.
 * Their union can merge; correlated vacancies and broad size variation leave
 * clusters and gaps. Above sparse budgets a continuous field joins seeds across
 * cells. The budget controls visible coverage statistically, not each camera. */
export const FOG_PATCH_GLSL=`
vec2 fogPatchLayer(vec2 p,float scale,float area,float bank,float salt) {
 p=p/(scale*vec2(1.4,.8))+vec2(salt,salt*.713);
 float row=floor(p.y);
 p.x+=(fogBankHash(vec2(row,salt+91.7))-.5)*.9;
 vec2 cell=floor(p);
 float chance=.58+.28*fogBankHash(floor(cell/3.0)+salt+41.3);
 if(fogBankHash(cell+salt+73.9)>=chance)return vec2(0.0,-1000.0);
 vec2 seed=vec2(fogBankHash(cell+salt+3.1),fogBankHash(cell+salt+17.7));
 float sizeSeed=fogBankHash(cell+salt+29.4);
 float variation=.20+2.4*sizeSeed*sizeSeed;
 float radius=sqrt(area*variation*(.60+.40*bank)/(chance*3.14159265));
 // Reserve the FULL 22px halo in the short-axis distance metric, plus a
 // zero-alpha gutter. This also protects row shifts and empty-cell transitions.
 float halo=22.0/(scale*.8/1.1);
 radius=min(radius,max(.001,.475/1.1-halo));
 vec2 extent=(radius+halo)*vec2(1.1,1.0/1.1);
 vec2 center=.5+(seed*2.0-1.0)*max(vec2(0.0),.475-extent)*.92;
 vec2 local=(fract(p)-center)/(radius*vec2(1.1,1.0/1.1));
 float r=length(local);
 float distance=(1.0-r)*radius*scale*.8/1.1;
 return vec2(smoothstep(0.0,1.0,1.0-r*r)*smoothstep(0.0,.025,area),distance);
}
float fogPatchMaskDistance(vec2 q,float time,float bank,float water,out float distance) {
 distance=-1000.0;
 float area=mix(uFogAreaBudget,min(uFogAreaBudget,uFogWaterAreaBudget),clamp(water,0.0,1.0));
 if(area<=0.0)return 0.0;
 vec2 wind=normalize(vec2(1.0,.23));
 vec2 p=vec2(dot(q,wind),dot(q,vec2(-wind.y,wind.x)));
 // Each shear has determinant one. Their composition bends and stretches the
 // contour without enlarging its area or introducing a fold/discontinuity.
 p.x+=(fogBankNoise(vec2(p.y/74.0+time*.0023,17.3))-.5)*120.0;
 p.y+=(fogBankNoise(vec2(p.x/33.0-time*.0017,9.2))-.5)*55.0;
 vec2 a=fogPatchLayer(p,uFogPatchScale*1.45,area*.60,bank,11.7);
 vec2 rotated=vec2(.8*p.x+.6*p.y,-.6*p.x+.8*p.y);
 vec2 b=fogPatchLayer(rotated,uFogPatchScale*.89,area*.40,bank,83.1);
 distance=max(a.y,b.y);
 float mask=1.0-(1.0-a.x)*(1.0-b.x);
 // High area budgets must grow beyond the cell-local radius cap. A continuous
 // field joins the sparse seeds instead of enlarging them across cell seams.
 // The low-budget afternoon/night path remains exactly the original field.
 if(area>.20) {
  float body=fogBankNoise(p/(uFogPatchScale*1.1)+vec2(37.1,61.7));
  float detail=fogBankNoise(p/(uFogPatchScale*.65)+vec2(81.3,19.4));
  float field=.7*body+.3*detail+.04*(bank-.5);
  // Compress the top end: the two seed layers also continue growing there.
  float expandedArea=area-.70*max(0.0,area-.48);
  float joined=-22.0+max(0.0,450.0*(field-(.95-.90*expandedArea))+22.0)*smoothstep(.20,.30,area);
  distance=max(distance,joined);
  mask=1.0-(1.0-mask)*(1.0-smoothstep(0.0,60.0,joined));
 }
 return mask;
}
float fogPatchMask(vec2 q,float time,float bank,float water) {
 float distance;return fogPatchMaskDistance(q,time,bank,water,distance);
}
// Applied AFTER Beer-Lambert saturation. Limit the high-frequency alpha response;
// retain the full billow contrast in premultiplied RGB. At the old boundary the
// exterior halo is <= .073; at -22 patch-space world px it reaches exactly zero.
float fogPatchEdgeAlpha(float alpha,float distance,float activity) {
 float cover=smoothstep(-22.0,52.0,distance);
 return .62*cover*(.55+.45*clamp(alpha/.62,0.0,1.0))*activity;
}
float fogPatchStructure(vec2 q,float time,float quality) {
 // Offset the billows from the contour field: choosing a patch must not also
 // choose only bright crests, which would saturate its entire interior.
 float body=fogBankNoise(q/74.0+vec2(17.3+time*.011,9.2));
 float fine=quality>1.5?fogBankNoise(q/33.0+vec2(body-.5,.5-body)*.85+vec2(23.1,7.4-time*.009)):.5;
 return smoothstep(.22,.82,body*.62+fine*.38);
}
`;
const smooth=(a:number,b:number,n:number)=>{const t=Math.max(0,Math.min(1,(n-a)/(b-a)));return t*t*(3-2*t);};
const fract=(n:number)=>n-Math.floor(n);
export function fogPatchMaskAt(x:number,y:number,state:SunCloudState,water=0,rollX=0,rollY=0):number {
  return fogPatchFieldAt(x,y,state,water,rollX,rollY,false);
}
function patchLayer(px:number,py:number,scale:number,area:number,bank:number,salt:number,distance:boolean):number {
 px=px/(scale*1.4)+salt;py=py/(scale*.8)+salt*.713;
 px+=(fogDetailHash(Math.floor(py),salt+91.7)-.5)*.9;
 const cx=Math.floor(px),cy=Math.floor(py);
 const chance=.58+.28*fogDetailHash(Math.floor(cx/3)+salt+41.3,Math.floor(cy/3)+salt+41.3);
 if(fogDetailHash(cx+salt+73.9,cy+salt+73.9)>=chance)return distance?-1000:0;
 const sx=fogDetailHash(cx+salt+3.1,cy+salt+3.1),sy=fogDetailHash(cx+salt+17.7,cy+salt+17.7);
 const sizeSeed=fogDetailHash(cx+salt+29.4,cy+salt+29.4),variation=.20+2.4*sizeSeed*sizeSeed;
 const halo=22/(scale*.8/1.1);
 const radius=Math.min(Math.sqrt(area*variation*(.60+.40*bank)/(chance*Math.PI)),Math.max(.001,.475/1.1-halo));
 const centerX=.5+(sx*2-1)*Math.max(0,.475-(radius+halo)*1.1)*.92;
 const centerY=.5+(sy*2-1)*Math.max(0,.475-(radius+halo)/1.1)*.92;
 const lx=(px-cx-centerX)/(radius*1.1),ly=(py-cy-centerY)/(radius/1.1),r=Math.hypot(lx,ly);
 return distance?(1-r)*radius*scale*.8/1.1:smooth(0,1,1-r*r)*smooth(0,.025,area);
}
function fogPatchFieldAt(x:number,y:number,state:SunCloudState,water:number,rollX:number,rollY:number,distance:boolean):number {
  if(!Number.isFinite(x+y))return distance?-1000:0;
  const t=state.tuning,wet=Number.isFinite(water)?Math.max(0,Math.min(1,water)):0;
  const area=t.fogAreaBudget+(Math.min(t.fogAreaBudget,t.fogWaterAreaBudget)-t.fogAreaBudget)*wet;
  if(!(area>0))return distance?-1000:0;
  const time=cloudTimeSeconds(state.timeSec),travel=cloudTravel(time,t.cloudSpeed,t.cloudGust)*.18;
  const qx=x-travel+rollX,qy=y-travel*.23+rollY,wind=1/Math.hypot(1,.23);
  let px=(qx+qy*.23)*wind,py=(-qx*.23+qy)*wind;
  px+=(fogDetailNoise(py/74+time*.0023,17.3)-.5)*120;
  py+=(fogDetailNoise(px/33-time*.0017,9.2)-.5)*55;
  const bank=fogBankAt(x,y,state);
  const a=patchLayer(px,py,t.fogPatchScale*1.45,area*.60,bank,11.7,distance);
  const b=patchLayer(.8*px+.6*py,-.6*px+.8*py,t.fogPatchScale*.89,area*.40,bank,83.1,distance);
  let result=distance?Math.max(a,b):1-(1-a)*(1-b);
  if(area>.20) {
   const body=fogDetailNoise(px/(t.fogPatchScale*1.1)+37.1,py/(t.fogPatchScale*1.1)+61.7);
   const detail=fogDetailNoise(px/(t.fogPatchScale*.65)+81.3,py/(t.fogPatchScale*.65)+19.4);
   const field=.7*body+.3*detail+.04*(bank-.5);
   const expandedArea=area-.70*Math.max(0,area-.48);
   const joined=-22+Math.max(0,450*(field-(.95-.90*expandedArea))+22)*smooth(.20,.30,area);
   result=distance?Math.max(result,joined):1-(1-result)*(1-smooth(0,60,joined));
  }
  return result;
}
/** Material billows in drift-local world pixels; same two reads as the shader. */
export function fogPatchStructureAt(qx:number,qy:number,timeSec:number,quality=2):number {
  if(!Number.isFinite(qx+qy))return 0;
  const time=cloudTimeSeconds(timeSec),body=fogDetailNoise(qx/74+17.3+time*.011,qy/74+9.2);
  const fine=quality>1.5?fogDetailNoise(qx/33+(body-.5)*.85+23.1,qy/33+(.5-body)*.85+7.4-time*.009):.5;
  return smooth(.22,.82,body*.62+fine*.38);
}
/** Short-axis distance in warped patch coordinates, scaled to world pixels.
 * This is not an exact Euclidean SDF: tests measure FINAL alpha in world space. */
function fogPatchDistanceAt(x:number,y:number,state:SunCloudState,water=0,rollX=0,rollY=0):number {
 return fogPatchFieldAt(x,y,state,water,rollX,rollY,true);
}
export function fogPatchEdgeAlpha(alpha:number,distance:number,activity:number):number {
 const cover=smooth(-22,52,distance);
 return .62*cover*(.55+.45*Math.max(0,Math.min(1,alpha/.62)))*activity;
}
/** Texture-derived inputs to woodlandThickness; callers reuse this record. */
interface FogPatchOptics {
 water:number; flow:number; edge:number; surface:number; wake:number;
 quality:number; opacity:number; baseThickness:number; baseOpacity:number;
 quantize:boolean; roll?:number; tangentX?:number; tangentY?:number;
}
/** Full alpha chain with explicit sampled terrain/transport inputs. Lighting,
 * composite and grade alter RGB only. RT bilinear interpolation is convex;
 * wake multiplication is the final alpha operation (and may intentionally cut fog). */
export function fogPatchFinalAlphaAt(x:number,y:number,state:SunCloudState,o:FogPatchOptics,softEdges=true):number {
 const t=state.tuning,day=fogDayWeight(state.strength);
 const time=cloudTimeSeconds(state.timeSec),travel=cloudTravel(time,t.cloudSpeed,t.cloudGust)*.18;
 const roll=o.roll??0,rx=(o.tangentX??0)*roll*6,ry=(o.tangentY??0)*roll*6;
 const structure=Math.max(0,Math.min(1,fogPatchStructureAt(x-travel+rx,y-travel*.23+ry,time,o.quality)+.08*roll));
 const patch=fogPatchMaskAt(x,y,state,o.water,rx,ry);
 const shape=t.fogClearHaze+t.fogPatchDensity*patch*(.07+2.25*structure*structure);
 const pile=smooth(-5,t.fogPileSoftness,o.edge)*(1+.28*Math.exp(-Math.pow((o.edge-t.fogPileSoftness*.65)/t.fogPileSoftness,2)));
 const density=t.fogDensity*shape*(1+t.fogWaterBoost*o.water*smooth(.65,.95,structure))
   *Math.max(0,Math.min(1.8,o.flow))*pile*(.22+.78*smooth(-2,9,o.edge));
 const thickness=Math.max(0,density*(1-o.surface)-.004);
 const opacity=o.baseOpacity+(o.opacity-o.baseOpacity)*day;
 let alpha=fogPatchMaterialAlpha(o.baseThickness,thickness,o.baseOpacity,o.opacity,state);
 const activity=Math.max(0,Math.min(1,opacity*t.fogOpacity*t.fogDensity*t.fogPatchDensity
   *Math.max(0,Math.min(1.8,o.flow))*pile*(.22+.78*smooth(-2,9,o.edge))*(1-o.surface)));
 const edged=fogPatchEdgeAlpha(alpha,fogPatchDistanceAt(x,y,state,o.water,rx,ry),activity);
 if(softEdges)alpha+=(edged-alpha)*day;
 const dither=fract(52.9829189*fract(Math.floor(x)*.06711056+Math.floor(y)*.00583715))-.5;
 alpha=Math.max(0,alpha+dither/255*day*Math.min(1,alpha*255));
 if(o.quantize)alpha=Math.round(Math.min(1,alpha)*255)/255;
 return alpha*(1-o.wake);
}
/** Optical saturation; opacity changes thickness, never premultiplied alpha twice. */
export function fogPatchAlpha(mask:number,structure:number,opacity:number,density:number):number {
  const thickness=Math.max(0,mask*density*(.07+2.25*structure*structure)-.004);
  return FOG.materialMaxAlpha*(1-Math.exp(-FOG.materialGain*Math.max(0,opacity)*thickness));
}
/** Counterpart of the material pass and FogGpuField's borrowed opacity fade. */
export function fogPatchMaterialAlpha(baseThickness:number,patchThickness:number,baseOpacity:number,
  woodlandOpacity:number,state:SunCloudState):number {
  const day=fogDayWeight(state.strength);
  const thickness=baseThickness+(patchThickness-baseThickness)*day;
  const opacity=(baseOpacity+(woodlandOpacity-baseOpacity)*day)*(1+(state.tuning.fogOpacity-1)*day);
  return FOG.materialMaxAlpha*(1-Math.exp(-FOG.materialGain*Math.max(0,opacity*thickness)));
}
