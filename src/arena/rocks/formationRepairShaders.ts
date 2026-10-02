import { CELL_SIZE } from '../../config';
import { ROCK_BASE_PHASE_CELLS, ROCK_BASE_PHASES, ROCK_BASE_FRAME_MARGIN } from '../RockBaseConfig';
import { FORMATION, FORMATION_SIDE } from './RockFormationField';

export const REPAIR_PAD = Math.ceil((FORMATION.horizonReach + FORMATION.envelopeReach) / FORMATION.step) + 3;
export const REPAIR_SPAN = FORMATION_SIDE + 2 * REPAIR_PAD;
export const REPAIR_DISTANCE_PASSES = [[1,0],[0,1],[1,1],[1,-1]].flatMap(direction =>
  [1,2,4,8,16,32].map(stride => ({direction,stride})));
const pitch = CELL_SIZE + ROCK_BASE_FRAME_MARGIN * 2;
const glsl = (n: number): string => Number.isInteger(n) ? `${n}.0` : `${n}`;
const header = `precision highp float;
precision highp sampler2D;
uniform sampler2D uA, uB, uC, uD;
uniform vec2 uOrigin, uSize, uDirection;
uniform vec4 uRim;
uniform float uStride, uInit, uOutput;
const float span = ${glsl(REPAIR_SPAN)};
vec2 uv(vec2 p) { return (p + 0.5) / span; }
bool inside(vec2 p) { return p.x >= 0.0 && p.y >= 0.0 && p.x < span && p.y < span; }
`;

/** All intermediates are linear data (nearest, non-PMA). Texture row zero is
 * world north, also when attached to an FBO; no Phaser/image Y flip is involved. */
export const FORMATION_REPAIR_SHADERS = {
  coverage: header + `
float alphaAt(vec2 p) { return texture2D(uB, (p + 0.5) / vec2(${glsl(ROCK_BASE_PHASES * pitch)}, uStride)).r; }
void main() {
  vec2 world = uOrigin + floor(gl_FragCoord.xy) * ${glsl(FORMATION.step)};
  vec2 cell = floor(world / ${glsl(CELL_SIZE)});
  float a = 0.0;
  if (cell.x >= 0.0 && cell.y >= 0.0 && cell.x < uSize.x && cell.y < uSize.y) {
    float frame = floor(texture2D(uA, (cell + 0.5) / uSize).r * 255.0 + 0.5) - 1.0;
    if (frame >= 0.0) {
      float phase = mod(cell.y, ${glsl(ROCK_BASE_PHASE_CELLS)}) * ${glsl(ROCK_BASE_PHASE_CELLS)} + mod(cell.x, ${glsl(ROCK_BASE_PHASE_CELLS)});
      vec2 p = vec2(phase, frame) * ${glsl(pitch)} + ${glsl(ROCK_BASE_FRAME_MARGIN)} + mod(world, ${glsl(CELL_SIZE)});
      a = max(max(alphaAt(p), alphaAt(p + vec2(1,0))), max(alphaAt(p + vec2(0,1)), alphaAt(p + vec2(1,1))));
    }
  }
  gl_FragColor = vec4(a, 0, 0, 1);
}`,
  support: header + `
// JS compares Float32 coverage with the double literal .4: byte 102 rounds up
// and is occupied. Comparing two GLSL floats with > .4 would lose that contour.
bool occupied(vec2 p) { return floor(texture2D(uA, uv(p)).r*255.0+0.5) >= 102.0; }
void main() {
  vec2 p = floor(gl_FragCoord.xy);
  float coverage = texture2D(uA, uv(p)).r;
  float support = occupied(p) ? 1.0 : 0.0;
  if (support == 0.0) {
    // A connected ten-sample empty cross proves this is not a tiny hole. This
    // exact early-out avoids a local flood fill over the large exposed ground.
    bool large = true;
    for (int k = -2; k <= 2; k++) {
      if (occupied(p+vec2(float(k),0)) || occupied(p+vec2(0,float(k)))) large=false;
    }
    if (large && !occupied(p+vec2(3,0))) { gl_FragColor=vec4(0,coverage,0,1); return; }
    // Exactly the reference's eight-connected, at-most-nine-texel hole rule.
    // Every fragment owns its bounded queue; no cross-fragment ordering.
    vec2 queue[10]; queue[0] = p;
    int tail = 1; bool open = false;
    for (int head = 0; head < 10; head++) {
      if (head >= tail || open) break;
      vec2 q = queue[head];
      if (q.x == 0.0 || q.y == 0.0 || q.x == span-1.0 || q.y == span-1.0) { open = true; break; }
      for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
        vec2 n = q + vec2(float(x),float(y));
        if (!open && !occupied(n)) {
          bool seen = false;
          for (int k = 0; k < 10; k++) { if (k < tail && all(equal(queue[k],n))) seen = true; }
          if (!seen) {
            // WebGL1 only guarantees constant-index expressions in fragments.
            for (int slot = 0; slot < 10; slot++) { if (slot == tail) queue[slot] = n; }
            tail++; if (tail > 9) open = true;
          }
        }
      }
    }
    if (!open) support = 1.0;
  }
  gl_FragColor = vec4(support, coverage, 0, 1);
}`,
  distance: header + `
vec2 distanceAt(vec2 p) { return inside(p) ? texture2D(uA,uv(p)).rg : vec2(49.0); }
void main() {
  vec2 p = floor(gl_FragCoord.xy);
  vec2 d;
  if (uInit > 0.5) {
    float s = texture2D(uA,uv(p)).r;
    d = vec2(s, 1.0-s) * 49.0;
  } else {
    vec2 delta = uDirection * uStride;
    d = min(distanceAt(p), min(distanceAt(p-delta),distanceAt(p+delta)) + length(delta));
  }
  gl_FragColor = vec4(d,0,1);
}`,
  blur: header + `
vec2 massAt(vec2 p) {
  if (!inside(p)) return vec2(0);
  vec4 s = texture2D(uA,uv(p));
  return uInit > 0.5 ? s.rr : s.rg;
}
void main() {
  vec2 p = floor(gl_FragCoord.xy), sum = vec2(0);
  for (int k = -8; k <= 8; k++) {
    vec2 v = massAt(p + uDirection * float(k));
    sum.x += v.x;
    if (k >= -3 && k <= 3) sum.y += v.y;
  }
  gl_FragColor = vec4(sum / vec2(17,7), 0, 1);
}`,
  height: header + `
uniform sampler2D uNoise;
uniform vec2 uNoiseSize;
float hashAt(vec2 p) { return texture2D(uNoise,(p+vec2(16.5))/uNoiseSize).r; }
float noiseAt(vec2 p) {
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hashAt(i),hashAt(i+vec2(1,0)),f.x),mix(hashAt(i+vec2(0,1)),hashAt(i+vec2(1,1)),f.x),f.y);
}
void main() {
  vec2 p=floor(gl_FragCoord.xy), world=uOrigin+p*2.0+1.0;
  vec2 support=texture2D(uA,uv(p)).rg, distance=texture2D(uB,uv(p)).rg, mass=texture2D(uC,uv(p)).rg;
  float z=0.0;
  if (support.r > 0.5) {
    float fine=texture2D(uD,(mod(floor(world),uSize)+0.5)/uSize).r;
    float broad=noiseAt(world/113.0), erosion=noiseAt(world/39.0+vec2(17,-4));
    float d=min(96.0,max(0.0,distance.r*2.0-1.0));
    z=max(0.0,((28.0+broad*19.0)*mass.r+fine)*(1.0-exp(-d/(1.4+erosion*3.5))));
    if (uRim.w > 0.5) {
      float width=max(1.0,uRim.y), lip=max(0.25,min(width*0.45,uRim.z));
      float r=clamp(d/(0.85+0.3*erosion),0.0,width);
      float rise=r<lip ? r*r/(2.0*lip) : (r>width-lip ? width-lip-(width-r)*(width-r)/(2.0*lip) : r-lip*0.5);
      float t=clamp((fine+8.0)/16.0,0.0,1.0);
      z+=max(0.0,uRim.x)*rise/(width-lip)*(0.85+0.15*t*t*(3.0-2.0*t));
    }
  } else if (uRim.w > 0.5) {
    float t=clamp((distance.g*2.0-1.0)/10.0,0.0,1.0);
    mass.g=1.0-t*t*(3.0-2.0*t);
  }
  gl_FragColor=vec4(z,support.r,support.g,clamp(1.0-mass.g*exp(-z/8.0),0.0,1.0));
}`,
} as const;

/** CPU-generated integer taps avoid a GPU/JS sin/cos rounding disagreement at
 * axes and diagonals. Same order, surface exclusion and biases as the worker. */
export function formationRepairLightTaps(azimuth: number): Float32Array {
  const data = new Float32Array(56*4*4);
  for (let direction=0; direction<3; direction++) for(let r=0;r<56;r++) {
    const a=(azimuth===135 ? -Math.PI*.75 : -azimuth*Math.PI/180)+[-.045,0,.045][direction];
    const x=Math.round(Math.cos(a)*(r+1)*Math.SQRT2), y=Math.round(Math.sin(a)*(r+1)*Math.SQRT2);
    data.set([x,y,Math.hypot(x,y)*2,0],(direction*56+r)*4);
  }
  for(let direction=0;direction<8;direction++) for(let r=0;r<6;r++) {
    const radius=[2,4,7,12,20,32][r];
    const x=Math.round(Math.cos(direction*Math.PI*.25)*radius/2),y=Math.round(Math.sin(direction*Math.PI*.25)*radius/2);
    data.set([x,y,Math.hypot(x,y)*2,0],(3*56+direction*6+r)*4);
  }
  return data;
}
export const FORMATION_REPAIR_LIGHT = header+`
float heightAt(vec2 p) { return texture2D(uA,uv(p)).r; }
void main() {
  vec2 p=floor(gl_FragCoord.xy)+${glsl(REPAIR_PAD)};
  vec4 h=texture2D(uA,uv(p));
  vec2 gradient=vec2(heightAt(p+vec2(1,0))-heightAt(p-vec2(1,0)),heightAt(p+vec2(0,1))-heightAt(p-vec2(0,1)))/4.0;
  vec3 horizons=vec3(0);
  if (uInit > 0.5) for(int direction=0;direction<3;direction++) {
    float slope=0.0;
    for(int r=0;r<56;r++) {
      vec3 tap=texture2D(uB,vec2((float(r)+0.5)/56.0,(float(direction)+0.5)/4.0)).rgb;
      if (h.g < 0.5 || tap.z >= 6.0) slope=max(slope,(heightAt(p+tap.xy)-h.r-0.2)/tap.z);
    }
    horizons[direction]=atan(slope)/1.5707963267948966;
  }
  float blocked=0.0;
  for(int direction=0;direction<8;direction++) {
    float slope=-1000000.0, tangent=0.0;
    for(int r=0;r<6;r++) {
      vec3 tap=texture2D(uB,vec2((float(direction*6+r)+0.5)/56.0,3.5/4.0)).rgb;
      slope=max(slope,(heightAt(p+tap.xy)-h.r-0.15)/tap.z);
      if(r==0 && h.g>0.5) tangent=dot(gradient,tap.xy*2.0)/tap.z;
    }
    float angle=clamp(atan(slope)-atan(tangent),0.0,1.5707963267948966);
    blocked+=sin(angle)*sin(angle);
  }
  vec4 result=uOutput<0.5 ? vec4(-0.5*gradient/length(vec3(gradient,1))+0.5,horizons.y,h.b)
    : vec4(clamp(1.0-blocked/8.0,0.0,1.0),horizons.x,horizons.z,h.a);
  gl_FragColor=floor(result*255.0+0.5)/255.0;
}`;
