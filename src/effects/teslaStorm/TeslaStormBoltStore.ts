/**
 * Persistent instance data of all Tesla storm discharges. Pure data: no Phaser, no GL.
 *
 * One instance is one quad (six non-indexed vertices) aligned with the flight direction. The
 * shader animates filaments, branches, halo and sparks from time and seed, so the CPU only
 * moves the quad of each living discharge once per frame.
 */

export const TESLA_STORM_FLOATS_PER_VERTEX = 12;
export const TESLA_STORM_VERTICES = 6;
export const TESLA_STORM_INSTANCE_FLOATS = TESLA_STORM_FLOATS_PER_VERTEX * TESLA_STORM_VERTICES;
export const TESLA_STORM_CAPACITY = 512;
/** Half quad extent in discharge sizes; covers branches and the outer halo. */
export const TESLA_STORM_QUAD_EXTENT = 0.74;

const CORNERS = [-1, -1, 1, -1, -1, 1, 1, -1, 1, 1, -1, 1] as const;

export class TeslaStormBoltStore {
  readonly data = new Float32Array(TESLA_STORM_CAPACITY * TESLA_STORM_INSTANCE_FLOATS);
  count = 0;
  /** Bumped on every write; a render layer re-uploads `data[0, count)` when it differs. */
  version = 0;
  private readonly ids = new Float64Array(TESLA_STORM_CAPACITY);
  private readonly slots = new Map<number, number>();

  has(id: number): boolean { return this.slots.has(id); }

  activeIds(): number[] { return [...this.slots.keys()]; }

  /** Adds or moves one discharge. Returns false only when the bounded pool is exhausted. */
  write(id: number, x: number, y: number, angle: number, size: number, color: number, seed: number): boolean {
    let slot = this.slots.get(id);
    if (slot === undefined) {
      if (this.count >= TESLA_STORM_CAPACITY) return false;
      slot = this.count++;
      this.slots.set(id, slot);
      this.ids[slot] = id;
    }
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const half = size * TESLA_STORM_QUAD_EXTENT;
    const r = ((color >> 16) & 0xff) / 255;
    const g = ((color >> 8) & 0xff) / 255;
    const b = (color & 0xff) / 255;
    const data = this.data;
    let offset = slot * TESLA_STORM_INSTANCE_FLOATS;
    for (let vertex = 0; vertex < TESLA_STORM_VERTICES; vertex++) {
      const u = CORNERS[vertex * 2];
      const v = CORNERS[vertex * 2 + 1];
      data[offset] = x + (cos * u - sin * v) * half;
      data[offset + 1] = y + (sin * u + cos * v) * half;
      // Local coordinates in discharge sizes: x along the flight direction, y across it.
      data[offset + 2] = u * TESLA_STORM_QUAD_EXTENT;
      data[offset + 3] = v * TESLA_STORM_QUAD_EXTENT;
      data[offset + 4] = size;
      data[offset + 5] = seed;
      data[offset + 6] = 1;
      data[offset + 7] = 0;
      data[offset + 8] = r;
      data[offset + 9] = g;
      data[offset + 10] = b;
      data[offset + 11] = 1;
      offset += TESLA_STORM_FLOATS_PER_VERTEX;
    }
    this.version++;
    return true;
  }

  /** Swap-remove keeps the live range dense, so one draw covers exactly `count` instances. */
  remove(id: number): void {
    const slot = this.slots.get(id);
    if (slot === undefined) return;
    this.slots.delete(id);
    const last = --this.count;
    if (slot !== last) {
      const movedId = this.ids[last];
      this.data.copyWithin(slot * TESLA_STORM_INSTANCE_FLOATS, last * TESLA_STORM_INSTANCE_FLOATS,
        (last + 1) * TESLA_STORM_INSTANCE_FLOATS);
      this.ids[slot] = movedId;
      this.slots.set(movedId, slot);
    }
    this.version++;
  }

  clear(): void {
    this.slots.clear();
    this.count = 0;
    this.version++;
  }
}
