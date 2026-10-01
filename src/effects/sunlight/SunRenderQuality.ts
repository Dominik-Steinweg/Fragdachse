/** Sunlight resource policy, selected by the shared graphics quality profile. */
export interface SunRenderQuality {
  readonly vegetationForm: boolean;
  readonly vegetationShadows: boolean;
  readonly compositeScale: number;
  readonly raysScale: number;
  readonly raysSamples: number;
  readonly cloudSize: number;
  readonly horizonStep: number;
  readonly horizons: boolean;
  readonly dapple: boolean;
  readonly ecologyDensity: number;
}
export const SUN_RENDER_QUALITY = {
  high: { vegetationForm: true, vegetationShadows: true, compositeScale: .5, raysScale: .5, raysSamples: 6, cloudSize: 256, horizonStep: 6, horizons: true, dapple: true, ecologyDensity: 1 },
  medium: { vegetationForm: true, vegetationShadows: false, compositeScale: .5, raysScale: .25, raysSamples: 5, cloudSize: 192, horizonStep: 12, horizons: true, dapple: true, ecologyDensity: .8 },
  low: { vegetationForm: false, vegetationShadows: false, compositeScale: .25, raysScale: 0, raysSamples: 0, cloudSize: 128, horizonStep: 24, horizons: false, dapple: false, ecologyDensity: .5 },
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
