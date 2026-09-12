import type { CoopDefenseMapGroundHazardEventConfig } from '../config/coopDefenseMaps';

/** Smooth seeded arrival times, prepared once. No runtime flood fill or random walk. */
export function groundHazardIgnitionDelay(
  event: CoopDefenseMapGroundHazardEventConfig, gridX: number, gridY: number, worldSeed: number,
): number {
  const spread = event.spread;
  const area = event.area;
  if (!spread || area.type !== 'rectangle') return 0;
  let seed = worldSeed | 0;
  for (const char of event.id) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  const noise = (index: number) => {
    let value = Math.imul(seed ^ index, 0x45d9f3b);
    value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
    return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff * 2 - 1;
  };
  const row = (gridY - area.gridY) / 5;
  const fraction = row - Math.floor(row);
  const smooth = fraction * fraction * (3 - 2 * fraction);
  const offset = noise(Math.floor(row)) * (1 - smooth) + noise(Math.floor(row) + 1) * smooth;
  const width = Math.max(0.5, area.widthCells - 0.5);
  const progress = Math.max(0, Math.min(1, (gridX - area.gridX) / width));
  // The bounded sine envelope keeps both edges fixed. The validator bounds roughness so
  // the derivative stays positive: each row remains connected and never retreats.
  const amplitude = Math.min(spread.roughnessCells / width, 0.3);
  return Math.round(spread.durationMs * (progress + amplitude * Math.sin(Math.PI * progress) * offset));
}
