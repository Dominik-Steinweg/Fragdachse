import type { HoloOffensiveUltimateConfig } from '../../loadout/LoadoutTypes';

export interface HoloCopyPosition { readonly x: number; readonly y: number }
type LayoutConfig = Pick<HoloOffensiveUltimateConfig,
  'spawnRingRadiiPx' | 'spawnRingSlots' | 'clearanceRadiusPx' | 'minCopySpacingPx'>;

/** Deployment-local preferred slot. Fallback rings do not change the preferred ring. */
export class HoloSpawnLayout {
  private cursor = 0;

  find(owner: HoloCopyPosition, config: LayoutConfig, copies: Iterable<HoloCopyPosition>,
    isPointFree: (x: number, y: number, radius: number) => boolean): HoloCopyPosition | null {
    const occupied = [...copies];
    const start = this.cursor;
    this.cursor = (start + 1) % config.spawnRingSlots;
    for (const radius of config.spawnRingRadiiPx) {
      for (let offset = 0; offset < config.spawnRingSlots; offset++) {
        const slot = (start + offset) % config.spawnRingSlots;
        const angle = slot * Math.PI * 2 / config.spawnRingSlots;
        const x = owner.x + Math.cos(angle) * radius;
        const y = owner.y + Math.sin(angle) * radius;
        if (isPointFree(x, y, config.clearanceRadiusPx)
          && occupied.every(copy => Math.hypot(copy.x - x, copy.y - y) >= config.minCopySpacingPx)) {
          this.cursor = (slot + 1) % config.spawnRingSlots;
          return { x, y };
        }
      }
    }
    return null;
  }
}
