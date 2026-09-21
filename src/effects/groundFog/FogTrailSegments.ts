import type { FogImpulse } from './FogImpulses';
import { FOG, type FogFrame } from './FogConfig';

const pack = (data: Uint8Array, offset: number, n: number): void => {
  n = Math.max(0, Math.min(65535, Math.round(n))); data[offset] = n >> 8; data[offset + 1] = n & 255;
};
/** Bounded observations only. The GPU computes the distance, age and attenuation. */
export class FogTrailSegments {
  readonly commands = new Uint8Array(FOG.trailCapacity * 3 * 4);
  readonly bins: Uint8Array;
  readonly columns: number;
  readonly binsHeight: number;
  private readonly slots: ({ input: FogImpulse; at: number } | undefined)[] = Array(FOG.trailCapacity);
  private cursor = 0;
  dropped = 0;
  size = 0;
  constructor(private readonly frame: FogFrame) {
    this.columns = Math.ceil(frame.width / FOG.trailTile);
    this.binsHeight = Math.ceil(this.columns * Math.ceil(frame.height / FOG.trailTile) * FOG.trailsPerTile / 1024);
    this.bins = new Uint8Array(1024 * this.binsHeight * 4);
  }
  add(input: FogImpulse, now: number): void {
    if (this.slots[this.cursor] && now - this.slots[this.cursor]!.at < FOG.trailMs) this.dropped++;
    this.slots[this.cursor] = { input, at: now }; this.cursor = (this.cursor + 1) % FOG.trailCapacity;
  }
  prepare(now: number): void {
    this.bins.fill(0); this.size = 0;
    const counts = new Uint8Array(this.columns * Math.ceil(this.frame.height / FOG.trailTile));
    // Newer observations win an overcrowded tile; no queue waits for another frame.
    for (let order = 0; order < FOG.trailCapacity; order++) {
      const index = (this.cursor - 1 - order + FOG.trailCapacity) % FOG.trailCapacity;
      const slot = this.slots[index]; if (!slot) continue;
      if (now - slot.at >= FOG.trailMs) { this.slots[index] = undefined; continue; }
      this.size++; const p = slot.input, f = this.frame, stride = FOG.trailCapacity * 4;
      pack(this.commands, index * 4, (p.x - f.offsetX) / f.width * 65535);
      pack(this.commands, index * 4 + 2, (p.y - f.offsetY) / f.height * 65535);
      pack(this.commands, stride + index * 4, (p.endX - f.offsetX) / f.width * 65535);
      pack(this.commands, stride + index * 4 + 2, (p.endY - f.offsetY) / f.height * 65535);
      pack(this.commands, stride * 2 + index * 4, slot.at % 60000);
      this.commands[stride * 2 + index * 4 + 2] = Math.round(p.strength * 255);
      const x0 = Math.max(0, Math.floor((Math.min(p.x, p.endX) - f.offsetX - 4) / FOG.trailTile));
      const y0 = Math.max(0, Math.floor((Math.min(p.y, p.endY) - f.offsetY - 4) / FOG.trailTile));
      const x1 = Math.min(this.columns - 1, Math.floor((Math.max(p.x, p.endX) - f.offsetX + 4) / FOG.trailTile));
      const y1 = Math.min(Math.ceil(f.height / FOG.trailTile) - 1, Math.floor((Math.max(p.y, p.endY) - f.offsetY + 4) / FOG.trailTile));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const tile = y * this.columns + x;
        if (counts[tile] >= FOG.trailsPerTile) continue;
        pack(this.bins, (tile * FOG.trailsPerTile + counts[tile]++) * 4, index + 1);
      }
    }
  }
  clear(): void { this.slots.fill(undefined); this.size = 0; this.bins.fill(0); }
}
