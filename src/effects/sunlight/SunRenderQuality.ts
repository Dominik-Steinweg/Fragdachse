/** Sunlight resource policy, selected by the shared graphics quality profile. */
export interface SunRenderQuality {
  readonly vegetationForm: boolean;
  readonly vegetationShadows: boolean;
  readonly compositeScale: number;
  /** Target world pixels per texel, subject to the per-world pixel/axis caps. */
  readonly cloudTexel: number;
  readonly cloudMaxPixels: number;
  readonly cloudMaxAxis: number;
  readonly horizonStep: number;
  readonly horizons: boolean;
  readonly ecologyDensity: number;
}
export const SUN_RENDER_QUALITY = {
  high: { vegetationForm: true, vegetationShadows: true, compositeScale: .5, cloudTexel: 10, cloudMaxPixels: 262144, cloudMaxAxis: 2048, horizonStep: 6, horizons: true, ecologyDensity: 1 },
  medium: { vegetationForm: true, vegetationShadows: false, compositeScale: .5, cloudTexel: 20, cloudMaxPixels: 65536, cloudMaxAxis: 1024, horizonStep: 12, horizons: true, ecologyDensity: .8 },
  low: { vegetationForm: false, vegetationShadows: false, compositeScale: .25, cloudTexel: 40, cloudMaxPixels: 16384, cloudMaxAxis: 512, horizonStep: 24, horizons: false, ecologyDensity: .5 },
} as const satisfies Record<string, SunRenderQuality>;

/** Same world rectangle for material and display, independent of backing scale.
 * Writes caller-owned storage; camera viewport offsets must not be applied twice. */
export function sunRenderWorld(out: number[], x: number, y: number, width: number, height: number,
  zoomX: number, zoomY: number): number {
  const pad = 64 / Math.max(.001, Math.min(zoomX, zoomY));
  out[0] = x-pad; out[1] = y-pad; out[2] = width+2*pad; out[3] = height+2*pad;
  return pad;
}
export function sunRenderSize(worldLength: number, zoom: number, scale: number): number {
  return Math.max(2, Math.ceil(worldLength * zoom * scale / 2 - 1e-8) * 2);
}

/** Rectangular, bounded world field. Writes reusable storage; never camera-sized.
 * Finite oversized worlds gracefully exceed the target footprint, not the cap. */
export function cloudFieldSize(out:number[],width:number,height:number,q:SunRenderQuality):void {
  const w=Number.isFinite(width)?Math.max(1,width):1,h=Number.isFinite(height)?Math.max(1,height):1;
  let x=Math.min(q.cloudMaxAxis,Math.max(2,2**Math.ceil(Math.log2(w/q.cloudTexel))));
  let y=Math.min(q.cloudMaxAxis,Math.max(2,2**Math.ceil(Math.log2(h/q.cloudTexel))));
  while(x*y>q.cloudMaxPixels) {
    if(x>2&&(y<=2||w/x<=h/y))x/=2;else y/=2;
  }
  out[0]=x;out[1]=y;
}
