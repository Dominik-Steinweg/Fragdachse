import { FOG, type FogFrame, type FogRect } from './FogConfig';
export interface FogChunk { slot: number; cx: number; cy: number; active: boolean; fresh: boolean; lastUsed: number }
/** Slot identity is stable until eviction; no field copies or readbacks on camera motion. */
export class FogResidency {
  readonly chunks = new Map<string, FogChunk>();
  readonly slots: (FogChunk | null)[] = Array(FOG.atlasCols * FOG.atlasRows).fill(null);
  overflow = false;
  constructor(private readonly frame: FogFrame) {}
  update(view: FogRect, now: number): void {
    const size = FOG.chunkSize, f = this.frame;
    const minX = Math.max(0, Math.floor((view.x - f.offsetX - FOG.margin) / size));
    const minY = Math.max(0, Math.floor((view.y - f.offsetY - FOG.margin) / size));
    const maxX = Math.min(Math.ceil(f.width / size) - 1, Math.floor((view.x + view.width - f.offsetX + FOG.margin) / size));
    const maxY = Math.min(Math.ceil(f.height / size) - 1, Math.floor((view.y + view.height - f.offsetY + FOG.margin) / size));
    this.overflow = Math.max(0, maxX - minX + 1) * Math.max(0, maxY - minY + 1) > FOG.activeChunks;
    for (const chunk of this.chunks.values()) chunk.active = false;
    if (this.overflow) {
      const frozen = [...this.chunks.values()].sort((a, b) => a.lastUsed - b.lastUsed);
      while (frozen.length && (frozen.length > FOG.cachedChunks || now - frozen[0].lastUsed > FOG.cacheMs)) this.evict(frozen.shift()!);
      return;
    }
    for (let cy = minY; cy <= maxY; cy++) for (let cx = minX; cx <= maxX; cx++) {
      const existing = this.chunks.get(`${cx},${cy}`);
      if (existing) { existing.active = true; existing.lastUsed = now; }
    }
    const cached = [...this.chunks.values()].filter(c => !c.active).sort((a, b) => a.lastUsed - b.lastUsed);
    while (cached.length && (cached.length > FOG.cachedChunks || now - cached[0].lastUsed > FOG.cacheMs)) this.evict(cached.shift()!);
    for (let cy = minY; cy <= maxY; cy++) for (let cx = minX; cx <= maxX; cx++) {
      const key = `${cx},${cy}`;
      if (this.chunks.has(key)) continue;
      let slot = this.slots.indexOf(null);
      if (slot < 0 && cached.length) { this.evict(cached.shift()!); slot = this.slots.indexOf(null); }
      if (slot < 0) { this.overflow = true; return; }
      const chunk = { cx, cy, slot, active: true, fresh: true, lastUsed: now };
      this.slots[slot] = chunk; this.chunks.set(key, chunk);
    }
  }
  private evict(chunk: FogChunk): void { this.chunks.delete(`${chunk.cx},${chunk.cy}`); this.slots[chunk.slot] = null; }
  clear(): void { this.chunks.clear(); this.slots.fill(null); }
}
