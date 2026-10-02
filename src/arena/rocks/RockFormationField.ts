import { rockRimHeight, rockContactVisibility, type RockRimGeometry } from './RockRimGeometry';
import { CELL_SIZE } from '../../config';
import { ROCK_BASE_PHASE_CELLS, ROCK_BASE_PHASES, ROCK_BASE_FRAME_MARGIN } from '../RockBaseConfig';
import type { RockVisualState } from './RockVisualState';

export const FORMATION = {
  chunk: 512, step: 2, gutter: 1, atlasColumns: 8, atlasRows: 8,
  horizonReach: 160, envelopeReach: 96,
} as const;
export const FORMATION_SIDE = FORMATION.chunk / FORMATION.step + FORMATION.gutter * 2;
const PITCH = CELL_SIZE + ROCK_BASE_FRAME_MARGIN * 2;
const ATLAS_WIDTH = ROCK_BASE_PHASES * PITCH;

const clamp = (x: number, lo = 0, hi = 1): number => Math.max(lo, Math.min(hi, x));

export interface RockFormationSource {
  /** Unpremultiplied alpha of the displayed mineral skin, including weathered contours. */
  alpha: Uint8Array;
  /** Periodic authored fine relief, in world pixels. Not albedo luminance. */
  detail: Float32Array;
}
export type FormationRock = Pick<RockVisualState, 'id' | 'gridX' | 'gridY' | 'active' | 'material' | 'frame'>;
export interface FormationFieldResult { data: Uint8Array; occlusion: Uint8Array; heights: Float32Array }
interface FormationCache {
  heights: Float32Array; support: Uint8Array; result: FormationFieldResult;
  azimuth: number; solarHorizons: boolean;
}

/** Visual-only projection of the existing live rock store. Cells are indexed once;
 * destruction updates only dirty cells. No independent gameplay geometry or clock. */
export class RockFormationField {
  private readonly cells: Int32Array;
  private readonly detail: Float32Array;
  private readonly geometry = new Map<number, string>();
  private readonly sampledAlpha = new Map<number, Uint8Array>();
  readonly cols: number;
  readonly rows: number;
  revision = 0;
  private rim: RockRimGeometry | null = null;
  // Worker-owned, bounded independently of world size. Never transfer these buffers.
  private readonly cache = new Map<string, FormationCache>();
  lastBuild = { cacheHit: false, shadedTexels: 0, totalTexels: FORMATION_SIDE ** 2 };

  buildCached(cx: number, cy: number, azimuth = 135, solarHorizons = true): FormationFieldResult {
    return this.build(cx, cy, azimuth, solarHorizons, true);
  }

  setRimGeometry(rim: RockRimGeometry | null): void { this.rim = rim; }
  constructor(width: number, height: number, private readonly states: readonly (FormationRock | undefined)[],
    private readonly source: RockFormationSource) {
    this.cols = Math.ceil(width / CELL_SIZE); this.rows = Math.ceil(height / CELL_SIZE);
    this.cells = new Int32Array(this.cols * this.rows).fill(-1);
    this.detail = filterDetail(source.detail);
    this.invalidate(states.flatMap(s => s ? [s.id] : []));
  }

  /** Damage / owner / tint updates deliberately do not invalidate surface geometry. */
  invalidate(ids: readonly number[]): { x: number; y: number }[] {
    const changed: { x: number; y: number }[] = [];
    for (const id of ids) {
      const s = this.states[id]; if (!s) continue;
      const signature = `${s.gridX},${s.gridY},${Number(s.active && s.material !== 'walls')},${s.frame}`;
      if (this.geometry.get(id) === signature) continue;
      this.geometry.set(id, signature);
      if (s.gridX < 0 || s.gridY < 0 || s.gridX >= this.cols || s.gridY >= this.rows) continue;
      this.cells[s.gridY * this.cols + s.gridX] = s.active && s.material !== 'walls' ? id : -1;
      changed.push({ x: s.gridX * CELL_SIZE, y: s.gridY * CELL_SIZE });
    }
    if (changed.length) this.revision++;
    return changed;
  }

  coverage(x: number, y: number): number {
    const gx = Math.floor(x / CELL_SIZE), gy = Math.floor(y / CELL_SIZE);
    if (gx < 0 || gy < 0 || gx >= this.cols || gy >= this.rows) return 0;
    const s = this.states[this.cells[gy * this.cols + gx]]; if (!s) return 0;
    const phase = (gy % ROCK_BASE_PHASE_CELLS) * ROCK_BASE_PHASE_CELLS + gx % ROCK_BASE_PHASE_CELLS;
    return this.source.alpha[(s.frame * PITCH + ROCK_BASE_FRAME_MARGIN + Math.floor(y % CELL_SIZE)) * ATLAS_WIDTH
      + phase * PITCH + ROCK_BASE_FRAME_MARGIN + Math.floor(x % CELL_SIZE)] / 255;
  }

  /** Extended geometry support makes all shared chunk edges mathematically identical.
   * A distance-to-silhouette envelope has no fixed bevel width or flat centre plateau. */
  build(cx: number, cy: number, azimuth = 135, solarHorizons = true, incremental = false): FormationFieldResult {
    const key = `${cx},${cy}`, cached = incremental ? this.cache.get(key) : undefined;
    this.lastBuild = { cacheHit: !!cached, shadedTexels: 0, totalTexels: FORMATION_SIDE ** 2 };
    const period = Math.sqrt(this.detail.length);
    const step = FORMATION.step, pad = Math.ceil((FORMATION.horizonReach + FORMATION.envelopeReach) / step) + 3;
    const side = FORMATION_SIDE, span = side + pad * 2, count = span * span;
    const distance = new Float32Array(count), heights = new Float32Array(count), coverage = new Float32Array(count);
    const ox = cx * FORMATION.chunk - (pad + FORMATION.gutter) * step;
    const oy = cy * FORMATION.chunk - (pad + FORMATION.gutter) * step;
    if(!this.fillCoverage(coverage, span, ox, oy)) {
      this.cache.delete(key);
      const data=new Uint8Array(side*side*4),occlusion=new Uint8Array(data.length);
      for(let i=0;i<data.length;i+=4) {
        data[i]=128;data[i+1]=128;occlusion[i]=255;occlusion[i+3]=255;
      }
      return {data,occlusion,heights:new Float32Array(side*side)};
    }
    // Tiny enclosed skin holes must not collapse the formation all the way to
    // ground level. Keep displayed coverage intact; only its geometric support
    // is repaired. Open cracks and missing gameplay cells remain empty.
    const support = repairSmallHoles(coverage, span);
    for (let i = 0; i < count; i++) distance[i] = support[i] ? 1e6 : 0;
    // Bounded chamfer distance. Two passes; no ray search per point for formation height.
    chamferDistance(distance, span);
    // Smoothed occupied mass gives a rounded, asymmetric crown to isolated
    // stones. Distance alone creates a four-sided pyramid in every square cell.
    // Three separable box convolutions approximate a Gaussian, independent of
    // connected-component size and with bounded support across chunk borders.
    const mass=Float32Array.from(support),scratch=new Float32Array(count);
    blurMass(mass, scratch, span, 8);
    // Short finite support creates a smooth contact falloff around the actual
    // formation, never around internal tile edges. Reuse convolution scratch.
    const contact=Float32Array.from(support);
    blurMass(contact, scratch, span, 3);
    let maxHeight=0;
    for (let y = 0; y < span; y++) for (let x = 0; x < span; x++) {
      const i = y * span + x; if (!support[i]) continue;
      const wx = ox+x*step+step*.5, wy = oy+y*step+step*.5;
      const d = Math.min(FORMATION.envelopeReach, Math.max(0, distance[i] * step - step*.5));
      const broad = formationNoise(wx / 113, wy / 113), erosion = formationNoise(wx / 39 + 17, wy / 39 - 4);
      const envelope = 1 - Math.exp(-d / (1.4 + erosion * 3.5));
      const fine = this.detail[((Math.floor(wy)%period+period)%period)*period+(Math.floor(wx)%period+period)%period];
      heights[i] = Math.max(0, ((28 + broad * 19) * mass[i] + fine) * envelope);
      if (this.rim) {
        // Erosion varies the shoulder in height space only. The authored chipped
        // contour remains byte-identical, including gaps and destroyed cells.
        // Existing authored height steps inherit a weaker (<=15%) shoulder
        // response, without inventing terraces or deriving geometry from colour.
        const terrace=clamp((fine+8)/16);
        heights[i] += rockRimHeight(d/(.85+.3*erosion), this.rim)
          *(.85+.15*terrace*terrace*(3-2*terrace));
      }
      maxHeight=Math.max(maxHeight,heights[i]);
    }
    if (this.rim) {
      // Reuse the finished interior-distance buffer for an exterior distance.
      // The 10px foot requires no extra atlas, rays or scratch allocation.
      for (let i=0;i<count;i++) distance[i]=support[i]?0:1e6;
      chamferDistance(distance,span);
      for (let i=0;i<count;i++) if(!support[i])
        contact[i]=1-rockContactVisibility(Math.max(0,distance[i]*step-step*.5));
    }
    const data = new Uint8Array(side * side * 4), occlusion = new Uint8Array(side * side * 4);
    const surface = new Float32Array(side * side);
    const rays = Math.floor(FORMATION.horizonReach / (step*Math.SQRT2));
    // Three azimuth slices of one finite sun. Cached horizons make softness and
    // time uniform-only changes; the fragment shader never marches the world.
    const sunRays = [-.045, 0, .045].map(angle => Array.from({length:rays}, (_, r) => {
      const length=(r+1)*Math.SQRT2, a=(azimuth===135?-Math.PI*.75:-azimuth*Math.PI/180)+angle;
      const x=Math.round(Math.cos(a)*length), y=Math.round(Math.sin(a)*length);
      return {offset:y*span+x,distance:Math.hypot(x,y)*step};
    }));
    // Sub-six-pixel relief belongs to normals and ambient cavity shading, not
    // a binary solar blocker on its own face. Ground keeps the complete rays:
    // a close real silhouette must still cast onto a neighbouring empty cell.
    const surfaceSunRays = sunRays.map(ray=>ray.filter(sample=>sample.distance>=6));
    const skyRays = Array.from({length:8},(_,direction)=>{
      const angle=direction*Math.PI*.25;
      return [2,4,7,12,20,32].map(radius=>{
        const x=Math.round(Math.cos(angle)*radius/step),y=Math.round(Math.sin(angle)*radius/step);
        return {x:x*step,y:y*step,offset:y*span+x,distance:Math.hypot(x,y)*step};
      });
    });
    const horizons=new Uint8Array(3);
    // Exact dependency invalidation: compare the padded geometry, then reverse the
    // *same* discrete ray taps. A changed receiver also invalidates its normal/tangent.
    // No radius/cell-level approximation and no assumption about hole-repair locality.
    const dirty = cached ? new Uint8Array(count) : null;
    if (cached && dirty) {
      const offsets = new Set<number>([0, 1, -1, span, -span]);
      for (const ray of [...sunRays, ...skyRays]) for (const tap of ray) offsets.add(-tap.offset);
      const reverse = [...offsets];
      for (let y = 0; y < span; y++) {
        let first = span, last = -1;
        for (let x = 0; x < span; x++) if (heights[y*span+x] !== cached.heights[y*span+x]) {
          first = Math.min(first,x); last = x;
        }
        if (last < 0) continue;
        for (const offset of reverse) {
          const start = Math.max(0,y*span+first+offset), end = Math.min(count,y*span+last+offset+1);
          if (end > start) dirty.fill(1,start,end);
        }
      }
    }
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
      const i = (y+pad)*span+x+pad, z = heights[i];
      const p = (y*side+x)*4;
      if (cached && !dirty![i] && cached.support[i] === support[i]
        && cached.azimuth === azimuth && cached.solarHorizons === solarHorizons) {
        data[p]=cached.result.data[p]; data[p+1]=cached.result.data[p+1]; data[p+2]=cached.result.data[p+2];
        data[p+3] = Math.round(clamp(coverage[i])*255);
        occlusion[p]=cached.result.occlusion[p]; occlusion[p+1]=cached.result.occlusion[p+1]; occlusion[p+2]=cached.result.occlusion[p+2];
        occlusion[p+3] = Math.round(clamp(1-contact[i]*Math.exp(-z/8))*255);
        surface[y*side+x] = z;
        continue;
      }
      this.lastBuild.shadedTexels++;
      const dx = (heights[i+1]-heights[i-1])/(step*2), dy = (heights[i+span]-heights[i-span])/(step*2);
      const length = Math.hypot(dx,dy,1);
      const receiverRays=support[i]?surfaceSunRays:sunRays;
      for(let direction=0;direction<(solarHorizons?receiverRays.length:0);direction++) {
        let slope=0;
        for(const sample of receiverRays[direction]) {
          // Rays advance monotonically. Once even the tallest padded sample
          // cannot exceed the existing horizon, all remaining taps are hidden.
          if(maxHeight-z-.2<=slope*sample.distance)break;
          slope=Math.max(slope,(heights[i+sample.offset]-z-.2)/sample.distance);
        }
        horizons[direction]=Math.round(Math.atan(slope)/(Math.PI/2)*255);
      }
      let blocked=0;
      for(const ray of skyRays) {
        let slope=-1e6;
        for(const sample of ray) {
          slope=Math.max(slope,(heights[i+sample.offset]-z-.15)/sample.distance);
        }
        // Subtract the local tangent: a single inclined plane is not a cavity.
        const first=ray[0],tangent=support[i]?(dx*first.x+dy*first.y)/first.distance:0;
        const horizon=Math.max(0,Math.atan(slope)-Math.atan(tangent));
        blocked+=Math.sin(Math.min(Math.PI*.5,horizon))**2;
      }
      data[p] = Math.round((-.5*dx/length+.5)*255);
      data[p+1] = Math.round((-.5*dy/length+.5)*255);
      data[p+2] = horizons[1];
      data[p+3] = Math.round(clamp(coverage[i])*255);
      // Linear sky visibility, two neighbouring solar horizons, local contact
      // visibility. Height attenuation leaves raised faces free of contact AO.
      occlusion[p]=Math.round(clamp(1-blocked/8)*255);
      occlusion[p+1]=horizons[0];occlusion[p+2]=horizons[2];
      occlusion[p+3]=Math.round(clamp(1-contact[i]*Math.exp(-z/8))*255);
      surface[y*side+x] = z;
    }
    const result = {data,occlusion,heights:surface};
    if (incremental) {
      this.cache.delete(key);
      this.cache.set(key, { heights, support, result, azimuth, solarHorizons });
      while (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value!);
    }
    return result;
  }

  /** Chunk samples and cell origins share the two-pixel lattice. Cache each
   * authored frame/phase's conservative coverage once, then copy occupied cells
   * into the padded field without four world/grid lookups per sample. */
  private fillCoverage(target: Float32Array, span: number, ox: number, oy: number): boolean {
    const step=FORMATION.step, tileSide=CELL_SIZE/step;
    let occupied=false;
    const minX=Math.max(0,Math.floor(ox/CELL_SIZE)),minY=Math.max(0,Math.floor(oy/CELL_SIZE));
    const maxX=Math.min(this.cols-1,Math.floor((ox+(span-1)*step)/CELL_SIZE));
    const maxY=Math.min(this.rows-1,Math.floor((oy+(span-1)*step)/CELL_SIZE));
    for(let gy=minY;gy<=maxY;gy++)for(let gx=minX;gx<=maxX;gx++) {
      const state=this.states[this.cells[gy*this.cols+gx]];if(!state)continue;
      const phase=(gy%ROCK_BASE_PHASE_CELLS)*ROCK_BASE_PHASE_CELLS+gx%ROCK_BASE_PHASE_CELLS;
      const key=state.frame*ROCK_BASE_PHASES+phase;
      let samples=this.sampledAlpha.get(key);
      if(!samples) {
        samples=new Uint8Array(tileSide*tileSide);
        for(let y=0;y<tileSide;y++)for(let x=0;x<tileSide;x++) {
          const i=(state.frame*PITCH+ROCK_BASE_FRAME_MARGIN+y*step)*ATLAS_WIDTH+phase*PITCH+ROCK_BASE_FRAME_MARGIN+x*step;
          samples[y*tileSide+x]=Math.max(this.source.alpha[i],this.source.alpha[i+1],this.source.alpha[i+ATLAS_WIDTH],this.source.alpha[i+ATLAS_WIDTH+1]);
        }
        this.sampledAlpha.set(key,samples);
      }
      const x0=(gx*CELL_SIZE-ox)/step,y0=(gy*CELL_SIZE-oy)/step;
      for(let y=Math.max(0,-y0);y<Math.min(tileSide,span-y0);y++)
        for(let x=Math.max(0,-x0);x<Math.min(tileSide,span-x0);x++) {
          const alpha=samples[y*tileSide+x];
          target[(y0+y)*span+x0+x]=alpha/255;
          if(alpha)occupied=true;
        }
    }
    return occupied;
  }
}

/** Prefilter once at worker initialization, before the two-pixel field sampling.
 * Periodic binomial taps reject isolated sub-sample relief without flattening
 * medium crevices or changing an inclined plane. */
export function filterDetail(source: Float32Array): Float32Array {
  const side=Math.sqrt(source.length), scratch=new Float32Array(source.length), result=new Float32Array(source.length);
  const weights=[1,4,6,4,1];
  for(let y=0;y<side;y++)for(let x=0;x<side;x++) {
    let sum=0;
    for(let k=-2;k<=2;k++)sum+=source[y*side+(x+k+side)%side]*weights[k+2];
    scratch[y*side+x]=sum/16;
  }
  for(let y=0;y<side;y++)for(let x=0;x<side;x++) {
    let sum=0;
    for(let k=-2;k<=2;k++)sum+=scratch[((y+k+side)%side)*side+x]*weights[k+2];
    result[y*side+x]=sum/16;
  }
  return result;
}

function blurMass(mass: Float32Array, scratch: Float32Array, span: number, radius: number): void {
  const diameter=radius*2+1;
  for(let pass=0;pass<3;pass++) {
    for(let y=0;y<span;y++) {
      let sum=0;for(let x=0;x<=radius;x++)sum+=mass[y*span+x];
      for(let x=0;x<span;x++) {
        scratch[y*span+x]=sum/diameter;
        if(x-radius>=0)sum-=mass[y*span+x-radius];
        if(x+radius+1<span)sum+=mass[y*span+x+radius+1];
      }
    }
    for(let x=0;x<span;x++) {
      let sum=0;for(let y=0;y<=radius;y++)sum+=scratch[y*span+x];
      for(let y=0;y<span;y++) {
        mass[y*span+x]=sum/diameter;
        if(y-radius>=0)sum-=scratch[(y-radius)*span+x];
        if(y+radius+1<span)sum+=scratch[(y+radius+1)*span+x];
      }
    }
  }
}

/** Eight-connected emptiness preserves even diagonal open crevices. Each sample
 * is visited once; bounded components touching the padded border stay empty. */
function repairSmallHoles(coverage: Float32Array, span: number): Uint8Array {
  const support=Uint8Array.from(coverage,a=>Number(a>.4));
  // A component larger than the repair limit can be rejected immediately. Mark
  // that frontier as open so subsequent pieces cannot be mistaken for holes.
  const visited=new Uint8Array(coverage.length),queue=new Uint32Array(10);
  for(let start=0;start<support.length;start++) {
    if(support[start] || visited[start])continue;
    let head=0,tail=1,open=false;
    queue[0]=start;visited[start]=1;
    search: while(head<tail) {
      const i=queue[head++],x=i%span,y=Math.floor(i/span);
      if(x===0 || y===0 || x===span-1 || y===span-1) {open=true;break;}
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++) {
        if(x+dx<0 || x+dx>=span || y+dy<0 || y+dy>=span)continue;
        const next=i+dy*span+dx;
        if(visited[next]===2) {open=true;break search;}
        if(support[next] || visited[next])continue;
        visited[next]=1;queue[tail++]=next;
        if(tail>9) {open=true;break search;}
      }
    }
    for(let k=0;k<tail;k++) {
      if(open)visited[queue[k]]=2;
      else support[queue[k]]=1;
    }
  }
  return support;
}

export function formationNoise(x: number, y: number): number {
  const ix=Math.floor(x), iy=Math.floor(y), fx=x-ix, fy=y-iy;
  const u=fx*fx*(3-2*fx), v=fy*fy*(3-2*fy);
  const hash=(a: number,b: number): number => {
    let n = Math.imul(a,374761393) ^ Math.imul(b,668265263) ^ 91831;
    n = Math.imul(n^(n>>>13),1274126177); return ((n^(n>>>16))>>>0)/4294967295;
  };
  return (hash(ix,iy)*(1-u)+hash(ix+1,iy)*u)*(1-v)+(hash(ix,iy+1)*(1-u)+hash(ix+1,iy+1)*u)*v;
}

function chamferDistance(distance: Float32Array, span: number): void {
    const diagonal = Math.SQRT2;
    for (let y = 1; y < span; y++) for (let x = 1; x < span - 1; x++) {
      const i = y * span + x;
      distance[i] = Math.min(distance[i], distance[i-1]+1, distance[i-span]+1,
        distance[i-span-1]+diagonal, distance[i-span+1]+diagonal);
    }
    for (let y = span-2; y >= 0; y--) for (let x = span-2; x > 0; x--) {
      const i = y * span + x;
      distance[i] = Math.min(distance[i], distance[i+1]+1, distance[i+span]+1,
        distance[i+span-1]+diagonal, distance[i+span+1]+diagonal);
    }
}
