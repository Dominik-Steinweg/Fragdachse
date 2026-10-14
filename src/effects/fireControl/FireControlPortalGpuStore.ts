export const FIRE_CONTROL_CAPACITY = 512;
export const FIRE_CONTROL_WORDS = 12;
export const FIRE_CONTROL_VERTICES = 6;
export const enum FireControlGpuKind { Exit, Entry, TransferRing, Projector, Filament, ExitFlash, HoloPlate, HoloGenesis }
export interface FireControlGpuInstance {
  x: number; y: number; radius: number; angle: number; kind: FireControlGpuKind;
  open: number; remaining: number; flash: number; mode?: number; length?: number; seed?: number;
}
const CORNERS = [-1,-1, 1,-1, 1,1, -1,-1, 1,1, -1,1];
/** Room for the arrival burst of a genesis streak beyond its end point. */
const GENESIS_BURST_EXTENT = 22;
/** Rebuilt from the read model. Bounded storage, no entity or gameplay ownership. */
export class FireControlPortalGpuStore {
  readonly data = new Float32Array(FIRE_CONTROL_CAPACITY * FIRE_CONTROL_VERTICES * FIRE_CONTROL_WORDS);
  count = 0;
  version = 0;
  time = 0;
  begin(now: number): void { this.count = 0; this.time = now / 1000 % 1000; this.version++; }
  add(i: FireControlGpuInstance): boolean {
    if (this.count === FIRE_CONTROL_CAPACITY) return false;
    let p = this.count++ * FIRE_CONTROL_VERTICES * FIRE_CONTROL_WORDS;
    const extent = i.kind === FireControlGpuKind.Filament ? (i.length ?? 1)
      : i.kind === FireControlGpuKind.HoloGenesis ? (i.length ?? 1) + GENESIS_BURST_EXTENT
      : i.radius * (i.kind === FireControlGpuKind.ExitFlash ? 2.3 : 1.85);
    for (let v = 0; v < FIRE_CONTROL_VERTICES; v++) {
      const x = CORNERS[v*2] * extent, y = CORNERS[v*2+1] * extent;
      this.data.set([i.x+x, i.y+y, x, y, i.radius, i.angle, i.kind, i.open,
        i.remaining, i.flash, i.mode ?? 0, i.seed ?? 0], p);
      p += FIRE_CONTROL_WORDS;
    }
    return true;
  }
  clear(): void { this.count = 0; this.version++; }
}
