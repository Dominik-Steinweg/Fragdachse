import { ZONE_HAZE } from '../../arena/VoidDangerField';
import { VOID_TAINT, VOID_TAINT_CAPACITY, VOID_TAINT_CLOCK_MS, VOID_TAINT_TEXEL_ROWS, VOID_TAINT_TEXTURE_WIDTH } from '../../arena/VoidTaint';

/** Fixed program key: one linked program per renderer, warmed while loading. */
export const VOID_TAINT_SHADER_NAME = 'VoidTaint';

const f = (value: number): string => Number.isInteger(value) ? `${value}.0` : `${value}`;

/** World-anchored stamp quads (VoidTaintTrails.vertices) into the target's world rect. */
export const VOID_TAINT_VERTEX = `
precision highp float;
attribute vec2 inPosition,inTexCoord;
uniform vec2 uViewOrigin,uViewSize;
varying vec2 outWorld;
varying float outIndex;
void main() {
 outWorld=inPosition;outIndex=inTexCoord.x;
 gl_Position=vec4((inPosition-uViewOrigin)/uViewSize*vec2(2.,-2.)+vec2(-1.,1.),0.,1.);
}
`;

/**
 * One void trail stamp (GDD Void-Gefahrenzonen V1, E12): a Gaussian capsule whose strength follows
 * its own clock. It rises as the body passes, flares and settles, holds the haze of an active spawn
 * zone and fades back to fog; a lifted stamp flares once more as the wave reaches it, then fades
 * quickly. MAX blending unites crossing trails like one. R haze, G flare.
 */
export const VOID_TAINT_FRAGMENT = `
precision highp float;
varying vec2 outWorld;
varying float outIndex;
uniform sampler2D uCommands;
uniform vec2 uWorldSize;
// The trails' clock (ms modulo ${VOID_TAINT_CLOCK_MS}).
uniform float uNow;
float decode(vec2 v) {return dot(v,vec2(65280.,255.));}
// Signed age of a clock reading, within half the clock either way.
float since(float at) {return mod(uNow-at+${f(VOID_TAINT_CLOCK_MS * 1.5)},${f(VOID_TAINT_CLOCK_MS)})-${f(VOID_TAINT_CLOCK_MS / 2)};}
void main() {
 float index=floor(outIndex+.5);
 vec2 uv=vec2((mod(index,${f(VOID_TAINT_TEXTURE_WIDTH)})+.5)/${f(VOID_TAINT_TEXTURE_WIDTH)},(floor(index/${f(VOID_TAINT_TEXTURE_WIDTH)})*5.+.5)/${f(VOID_TAINT_TEXEL_ROWS)});
 vec2 row=vec2(0.,1./${f(VOID_TAINT_TEXEL_ROWS)});
 vec4 a=texture2D(uCommands,uv),b=texture2D(uCommands,uv+row),births=texture2D(uCommands,uv+row*2.);
 vec4 retires=texture2D(uCommands,uv+row*3.),profile=texture2D(uCommands,uv+row*4.);
 vec2 start=vec2(decode(a.rg),decode(a.ba))/65535.*uWorldSize,end=vec2(decode(b.rg),decode(b.ba))/65535.*uWorldSize;
 vec2 line=end-start;
 float t=clamp(dot(outWorld-start,line)/max(dot(line,line),.000001),0.,1.);
 float radius=max(1.,decode(profile.rg)/16.);
 float q=length(outWorld-start-line*t)/radius;
 if(q>=${f(VOID_TAINT.extent)})discard;
 // Ages are taken per end, then interpolated: clock readings themselves may wrap between the ends.
 float born=mix(since(decode(births.rg)),since(decode(births.ba)),t);
 float retired=mix(since(decode(retires.rg)),since(decode(retires.ba)),t);
 float flags=floor(profile.a*255.+.5);
 float rise=smoothstep(0.,${f(VOID_TAINT.riseMs)},born);
 float flare=rise*exp(-max(0.,born)/${f(VOID_TAINT.flareMs)});
 float fade;
 if(flags>.5) {
   fade=1.-smoothstep(0.,${f(VOID_TAINT.quickFadeMs)},retired);
   // The wave's front: the trail glows up once more just before it dissolves.
   if(flags<1.5)flare=max(flare,smoothstep(-${f(VOID_TAINT.liftFlareMs)},0.,retired)*fade);
 } else fade=1.-smoothstep(0.,${f(VOID_TAINT.fadeMs)},retired);
 float edge=exp(-1.6*q*q)*(1.-smoothstep(${f(VOID_TAINT.extent * .75)},${f(VOID_TAINT.extent)},q));
 float amount=edge*profile.b*fade;
 gl_FragColor=vec4(${f(ZONE_HAZE)}*amount*rise,flare*amount,0.,1.);
}
`;

/** Stamp slots the vertex buffer holds; the command texture is VOID_TAINT_TEXTURE_WIDTH by VOID_TAINT_TEXEL_ROWS. */
export const VOID_TAINT_VERTEX_CAPACITY = VOID_TAINT_CAPACITY * 6;
