import type { SunTuning } from './SunTuning';
import { cloudTimeSeconds, cloudTravel } from './SunFieldModel';
import { FOG } from '../groundFog/FogConfig';

/**
 * The one fog shape (look-dev "Variante 2", user 2026-10-20: Schlieren, einzelne dichte Flächen, weiche
 * organische Übergänge, keine harten Kanten). Day mist, night fog and the void haze over danger all
 * draw this field; they differ only in coverage, density and colour. Self-contained so the fog
 * material and the void creep layers include the same code.
 *
 * Inputs are world px in the drift frame (`q`: world minus the fog's wind travel) and seconds.
 * `cover` 0..1 is the time-of-day area budget (1 = the dense 08:00 morning), above 1 the void's
 * thicker haze; `water` 0..1 the shoreline ramp.
 */
/** Thickness range the shape pass stores (sqrt-encoded in eight bits). */
export const FOG_SHAPE_RANGE = 4;

export const FOG_SHAPE_GLSL = `
float fogShapeHash(vec2 p){p=fract(p*vec2(.1031,.11369));p+=dot(p,p.yx+19.19);return fract((p.x+p.y)*p.x);}
// Gradient noise: no axis-aligned plateaus or creases.
vec2 fogShapeDir(vec2 i){return vec2(fogShapeHash(i+vec2(7.3,2.1)),fogShapeHash(i+vec2(1.7,9.4)))*2.0-1.0;}
float fogShapeNoise(vec2 p) {
 vec2 i=floor(p),f=fract(p),u=f*f*f*(f*(f*6.0-15.0)+10.0);
 float a=dot(fogShapeDir(i),f),b=dot(fogShapeDir(i+vec2(1.0,0.0)),f-vec2(1.0,0.0));
 float c=dot(fogShapeDir(i+vec2(0.0,1.0)),f-vec2(0.0,1.0)),d=dot(fogShapeDir(i+vec2(1.0,1.0)),f-vec2(1.0,1.0));
 return clamp(.5+.8*mix(mix(a,b,u.x),mix(c,d,u.x),u.y),0.0,1.0);
}
// Three rotated octaves.
float fogShapeFbm(vec2 p) {
 float s=fogShapeNoise(p)*.57;p=mat2(.8,.6,-.6,.8)*p*2.03+vec2(11.7,5.3);
 s+=fogShapeNoise(p)*.29;p=mat2(.8,.6,-.6,.8)*p*2.03+vec2(3.1,17.9);
 return s+fogShapeNoise(p)*.14;
}
// Smoothstep that keeps its foot and stretches the rise: larger k is a gentler transition without
// a larger footprint, so clear air stays clear.
float fogShapeSS(float a,float b,float x,float k){return smoothstep(a,a+(b-a)*k,x);}
// Ridge with a rounded crest (no V-shaped crease); soft>1 rounds and widens it.
float fogShapeRidge(float n,float soft,float sharp) {
 float m=abs(n*2.0-1.0);
 return pow(1.0-pow(m,mix(1.0,2.2,clamp(soft-1.0,0.0,1.0))),sharp/soft);
}
// Void danger (the creep's haze, alerts included) as x the violet share of the fog's colour and y the
// lift of its coverage and density. Both run out over the danger's whole gradient, so the violet
// fades out through the fog's own streaks instead of tracing the danger field's contour.
vec2 fogShapeDanger(float danger){return vec2(smoothstep(.02,.45,danger),smoothstep(0.0,1.0,danger));}
// Streaks lie along the wind.
vec2 fogShapeFrame(vec2 q){const vec2 wd=vec2(.974391,.224110);return vec2(dot(q,wd),dot(q,vec2(-wd.y,wd.x)));}
// Optical thickness (about 0..2.4); core 0..1 marks the dense axis of streaks and patches.
// Every contour is domain-warped and eroded by finer octaves; a very large density envelope leaves
// some regions heavy and others thin.
float fogShape(vec2 q,float t,float cover,float water,out float core) {
 const float soft=1.35,blurPx=20.0;
 vec2 p=fogShapeFrame(q);
 float budget=clamp(cover,0.0,1.0);
 // The warps travel through their own noise, so banks bend, merge and re-form while they drift
 // instead of sliding as one sheet; the finer warp churns faster than the broad one.
 vec2 tv=vec2(t*.011,-t*.008);
 vec2 w=vec2(fogShapeFbm(p/720.0+vec2(2.0,5.0)+tv),fogShapeFbm(p/720.0+vec2(19.0,8.0)-tv))-.5;
 vec2 tv2=vec2(-t*.017,t*.021);
 vec2 w2=vec2(fogShapeFbm(p/230.0+vec2(7.0,1.0)+tv2),fogShapeFbm(p/230.0+vec2(3.0,13.0)-tv2))-.5;
 // Moderate warp amplitudes: stronger warps fold the field into swept, hard-edged contours.
 vec2 u=p+w*475.0+w2*102.0;
 float macro=fogShapeSS(.44,.64,fogShapeFbm(u/1150.0+vec2(41.0,23.0)),soft);
 float dens=mix(.20,1.6,macro);
 float F=fogShapeFbm(u/vec2(640.0,430.0)+vec2(31.0,9.0))+(fogShapeFbm(u/105.0+vec2(5.0,9.0))-.5)*.13/soft;
 float cut=mix(.70,.57,budget)-water*.04;
 float mask=fogShapeSS(cut-.18,cut+.24,F,soft);
 // Inner texture and islets ride slightly faster than the banks: the fog visibly moves within itself.
 vec2 lead=vec2(t*2.2,t*.4);
 float inner=fogShapeFbm((u-lead)/150.0+vec2(7.0,2.0));
 float field=mask*(.10+.85*fogShapeSS(.30,.78,inner,soft));
 vec2 rr=mat2(.8,.6,-.6,.8)*u;
 // Ridge crests are the crispest feature: three taps across the ribbon soften them.
 float body=0.0,axis=0.0;
 for(int k=0;k<3;k++) {
  float off=k==0?0.0:(k==1?blurPx:-blurPx);
  float wt=k==0?.5:.25;
  vec2 rq=rr+vec2(0.0,off);
  float r=fogShapeRidge(fogShapeNoise(rq/vec2(360.0,200.0)+vec2(8.0,4.0)),soft,1.25);
  float r2=fogShapeRidge(fogShapeNoise(rq/vec2(180.0,100.0)+vec2(2.0,9.0)),soft,1.7);
  body+=wt*fogShapeSS(.22,.96,r,soft)*(.55+.45*r2);
  axis+=wt*fogShapeSS(.55,.98,r*(.6+.5*r2),soft*1.5);
 }
 float zone=fogShapeSS(.40,.68,fogShapeFbm(u/vec2(900.0,520.0)+vec2(61.0,3.0))+(budget-.5)*.30-water*.04,soft);
 float ribbon=zone*(.04+.70*body+.95*axis)*(1.0+blurPx/55.0);
 float pn=fogShapeFbm((u-lead*1.6)/210.0+vec2(13.0,29.0))+(fogShapeFbm((u-lead*2.4)/70.0+vec2(3.0,41.0))-.5)*.13/soft;
 // Dense patches with a wide, soft rim: a narrow rim reads as a hard, swept edge.
 float islet=1.15*fogShapeSS(.55,.92,pn,soft)*fogShapeSS(.15,.65,macro+.25,soft);
 float thick=(ribbon+field*(1.0-.5*clamp(ribbon,0.0,1.0)))*dens+islet*(.55+.8*dens);
 core=clamp(max(max(zone*axis,mask*fogShapeSS(.55,.9,inner,soft)*.8),islet)*(.4+.6*dens),0.0,1.0);
 return thick*(1.0+.65*(soft-1.0));
}
// Over danger the fog's body breaks into a finer drifting spore cloud: dense flecks and clear pores
// a few dozen px across, which also fray the haze's rim, so a danger field never reads as a filled
// blob (user 2026-10-18: "feiner Dunst statt großer Kreise"). q, t and core as for fogShape.
float fogShapeSpores(vec2 q,float t,float lift,float core,float thick) {
 if(lift<=0.0)return thick;
 vec2 p=fogShapeFrame(q)-vec2(t*3.4,t*.9);
 float spores=fogShapeFbm(p/vec2(86.0,62.0)+vec2(5.7,12.9));
 float flecks=smoothstep(.38,.68,spores+(core-.5)*.24);
 return thick*mix(1.0,.38+1.1*flecks,lift)+lift*flecks*.5;
}
`;

/**
 * The shape's clock and coverage for one frame: x shape time (s), y wind travel (world px, the
 * shape is drawn at world minus (1, .23) times it), z time-of-day cover (a denser Activity fog adds
 * to it). The fog's shape pass and the void creep layers resolve the same values.
 */
export function resolveFogShapeClock(t: SunTuning, timeSec: number, bankCover: number, out: Float32Array): Float32Array {
  const time = cloudTimeSeconds(timeSec);
  out[0] = time;
  out[1] = cloudTravel(time, t.cloudSpeed, t.cloudGust) * FOG.shapedDrift;
  out[2] = Math.max(0, Math.min(1.4, t.fogAreaBudget / .48 + t.fogStyleCover)) + Math.max(0, Math.min(1, bankCover)) * .35;
  return out;
}
