import glowIndex from '../../config/krakenGlowPoints.json';
import type { PipelineBossAsset } from '../../config/pipelineAssetContracts';

/**
 * Visible sucker cups per exported pose, derived once from the hash-pinned Blender scene of the selected
 * revision (scripts/asset-pipeline/kraken_glow_points.py). They are CPU data only: the glow layer draws
 * instanced dots at these points above the light map, so the atlases and the GPU budget stay untouched.
 *
 * Binary record, little endian, 10 bytes per point:
 *   u16 x, u16 y   full-canvas logical position (0..65535 = 0..1, y down, like the per-frame sockets)
 *   u16 z          model height, 0..65535 over the asset's elevation min..max (Blender units)
 *   u8  t          position along the arm, 0 = root (body / tentacle water entry) .. 255 = tip
 *   u8  vis        visible share of the cup from above, 0..255
 *   u8  r          cup radius in full-canvas source pixels * 4
 *   u8  arm        arm index (body 0..7, strike tentacle 0), 255 = unknown
 */
export const KRAKEN_GLOW_POINT_BYTES = 10;

export interface KrakenGlowPoint {
  readonly x: number; readonly y: number; readonly z: number;
  readonly t: number; readonly vis: number; readonly radiusPx: number; readonly arm: number;
}
export interface KrakenGlowPointEntry {
  readonly revision: string; readonly variant: string;
  /** Served path, like the atlas pages (`./assets/sprites/pipeline-v2/<id>/glow/points.bin`). */
  readonly file: string; readonly sha256: string; readonly bytes: number;
  /** Indexed by master pose (the values of `clip.frames`, like `socketFrames`): [first record, count]. */
  readonly frames: readonly (readonly [number, number])[];
}
interface KrakenGlowIndex { readonly version: 1; readonly assets: Readonly<Record<string, KrakenGlowPointEntry>> }

/** The entry for exactly this selected asset; another revision or variant (a draft) has no glow points. */
export function krakenGlowPointEntry(asset: PipelineBossAsset, index: KrakenGlowIndex = glowIndex as KrakenGlowIndex): KrakenGlowPointEntry | null {
  const entry = index.assets[asset.id];
  return entry && entry.revision === asset.revision && entry.variant === asset.variant ? entry : null;
}

export class KrakenGlowPointSet {
  private readonly cache = new Map<number, readonly KrakenGlowPoint[]>();
  constructor(private readonly entry: KrakenGlowPointEntry, private readonly data: DataView,
    private readonly elevation: { readonly min: number; readonly max: number }) {
    if (data.byteLength !== entry.bytes || data.byteLength % KRAKEN_GLOW_POINT_BYTES) throw Error('Kraken glow points: size mismatch');
    const records = data.byteLength / KRAKEN_GLOW_POINT_BYTES;
    for (const [first, count] of entry.frames) if (first < 0 || count < 0 || first + count > records) throw Error('Kraken glow points: frame table outside data');
  }
  /** Points of one master pose; empty for poses without visible cups. */
  points(sourceFrame: number): readonly KrakenGlowPoint[] {
    const cached = this.cache.get(sourceFrame);
    if (cached) return cached;
    const [first, count] = this.entry.frames[sourceFrame] ?? [0, 0];
    const { min, max } = this.elevation, out: KrakenGlowPoint[] = [];
    for (let i = 0; i < count; i++) {
      const o = (first + i) * KRAKEN_GLOW_POINT_BYTES, d = this.data;
      out.push({ x: d.getUint16(o, true) / 65535, y: d.getUint16(o + 2, true) / 65535,
        z: min + d.getUint16(o + 4, true) / 65535 * (max - min), t: d.getUint8(o + 6) / 255, vis: d.getUint8(o + 7) / 255,
        radiusPx: d.getUint8(o + 8) / 4, arm: d.getUint8(o + 9) });
    }
    this.cache.set(sourceFrame, out);
    return out;
  }
}

export function decodeKrakenGlowPoints(entry: KrakenGlowPointEntry, bytes: ArrayBuffer, asset: PipelineBossAsset): KrakenGlowPointSet {
  return new KrakenGlowPointSet(entry, new DataView(bytes), asset.elevation);
}

/** Hash-checked fetch, like the atlas pages and shadow meshes. */
export async function loadKrakenGlowPoints(asset: PipelineBossAsset, signal: AbortSignal): Promise<KrakenGlowPointSet | null> {
  const entry = krakenGlowPointEntry(asset);
  if (!entry) return null;
  const response = await fetch(`${entry.file}?v=${entry.sha256}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) });
  if (!response.ok) throw Error(`Kraken glow points HTTP ${response.status}: ${entry.file}`);
  const bytes = await response.arrayBuffer();
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
  if (hash !== entry.sha256) throw Error(`Kraken glow points hash mismatch: ${entry.file}`);
  return decodeKrakenGlowPoints(entry, bytes, asset);
}
