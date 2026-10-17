import { groundHazardSweepExtent, type CoopDefenseMapGroundHazardEventConfig } from '../config/coopDefenseMaps';

type SweepExtent = NonNullable<ReturnType<typeof groundHazardSweepExtent>>;
/** Sweep extents per resolved event: a cell-list extent is O(cells) and every sub-cell asks for it. */
const sweepExtents = new WeakMap<CoopDefenseMapGroundHazardEventConfig, SweepExtent | null>();

/** Smooth seeded arrival times, prepared once. No runtime flood fill or random walk. */
export function groundHazardIgnitionDelay(
  event: CoopDefenseMapGroundHazardEventConfig, gridX: number, gridY: number, worldSeed: number,
  expansionProgress?: number,
): number {
  const spread = event.spread;
  const area = event.area;
  if (!spread) return 0;
  if (spread.direction === 'radial') {
    if ((area.type !== 'expanded-patches' && area.type !== 'random-patches')
      || expansionProgress === undefined || !Number.isFinite(expansionProgress)) {
      throw new Error(`Missing radial geometry for ground hazard ${event.id}`);
    }
    return Math.round(spread.warningLeadMs + Math.max(0, Math.min(1, expansionProgress))
      * (spread.durationMs - spread.warningLeadMs));
  }
  let seed = worldSeed | 0;
  for (const char of event.id) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  const noise = (index: number) => {
    let value = Math.imul(seed ^ index, 0x45d9f3b);
    value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
    return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff * 2 - 1;
  };
  // A smooth offset per band of five cells across the front keeps it wavy instead of a wall.
  const front = (progress: number, across: number, extent: number) => {
    const row = across / 5;
    const fraction = row - Math.floor(row);
    const smooth = fraction * fraction * (3 - 2 * fraction);
    const offset = noise(Math.floor(row)) * (1 - smooth) + noise(Math.floor(row) + 1) * smooth;
    // The bounded sine envelope keeps both edges fixed. The validator bounds roughness so
    // the derivative stays positive: each line remains connected and never retreats.
    const amplitude = Math.min(spread.roughnessCells / extent, 0.3);
    return Math.round(spread.durationMs * (progress + amplitude * Math.sin(Math.PI * progress) * offset));
  };
  if (spread.direction === 'sweep') {
    if (!sweepExtents.has(event)) sweepExtents.set(event, groundHazardSweepExtent(area, spread.headingDeg));
    const extent = sweepExtents.get(event);
    if (!extent) return 0;
    const angle = spread.headingDeg * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
    const length = Math.max(0.5, extent.alongMax - extent.alongMin - 0.5);
    const progress = Math.max(0, Math.min(1, (gridX * cos + gridY * sin - extent.alongMin) / length));
    return front(progress, -gridX * sin + gridY * cos - extent.acrossMin, length);
  }
  if (area.type !== 'rectangle') return 0;
  const width = Math.max(0.5, area.widthCells - 0.5);
  const progress = Math.max(0, Math.min(1, (gridX - area.gridX) / width));
  return front(progress, gridY - area.gridY, width);
}
