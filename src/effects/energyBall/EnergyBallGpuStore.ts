/**
 * Persistent instance data of all energy balls and their impacts. Pure data: no Phaser, no GL.
 *
 * One instance is one square quad (six non-indexed vertices). The shader derives glow, plasma
 * core, rotating shell, swarming sparks and impact bursts from time, seed and these values, so
 * the CPU only moves the quad of each living ball once per frame and writes an impact once.
 */

export const ENERGY_BALL_FLOATS_PER_VERTEX = 23;
export const ENERGY_BALL_VERTICES = 6;
export const ENERGY_BALL_INSTANCE_FLOATS = ENERGY_BALL_FLOATS_PER_VERTEX * ENERGY_BALL_VERTICES;
export const ENERGY_BALL_CAPACITY = 1024;

export const ENERGY_BALL_KIND_BALL = 0;
export const ENERGY_BALL_KIND_IMPACT = 1;

export interface EnergyBallInstance {
  x: number;
  y: number;
  /** Half extent of the quad in px. */
  extent: number;
  glowRadius: number;
  shellScale: number;
  seed: number;
  kind: number;
  /** 0 = default, 1 = plasma. */
  variant: number;
  /** Shader clock (s) at creation; balls emit no particles before it, impacts age from it. */
  bornS: number;
  /** Impact scale; unused by balls. */
  motion: number;
  /** Emission zone radii (px) of the core and shell particle streams. */
  coreZone: number;
  shellZone: number;
  /** Start radius (px) of one core / shell (impact: spark) particle. */
  coreParticleRadius: number;
  shellParticleRadius: number;
  glowColor: number;
  shellColor: number;
  coreColor: number;
}

const CORNERS = [-1, -1, 1, -1, -1, 1, 1, -1, 1, 1, -1, 1] as const;

export class EnergyBallGpuStore {
  readonly data = new Float32Array(ENERGY_BALL_CAPACITY * ENERGY_BALL_INSTANCE_FLOATS);
  count = 0;
  /** Bumped on every change; a render layer re-uploads `data[0, count)` when it differs. */
  version = 0;
  private readonly ids = new Float64Array(ENERGY_BALL_CAPACITY);
  /** Absolute expiry per slot; Infinity for balls, which only their owner removes. */
  private readonly expiresAt = new Float64Array(ENERGY_BALL_CAPACITY);
  private readonly slots = new Map<number, number>();

  has(id: number): boolean { return this.slots.has(id); }

  /**
   * Adds or moves one instance. Without `expiresAtMs` it lives until removed. When the bounded
   * pool is full, a persistent instance displaces an expiring one (a ball outranks an impact
   * burst); returns false only when nothing could be displaced.
   */
  write(id: number, instance: Readonly<EnergyBallInstance>, expiresAtMs = Infinity): boolean {
    let slot = this.slots.get(id);
    if (slot === undefined) {
      if (this.count >= ENERGY_BALL_CAPACITY && !(expiresAtMs === Infinity && this.evictExpiring())) return false;
      slot = this.count++;
      this.slots.set(id, slot);
      this.ids[slot] = id;
    }
    this.expiresAt[slot] = expiresAtMs;
    this.pack(slot, instance);
    this.version++;
    return true;
  }

  /** Swap-remove keeps the live range dense, so one draw covers exactly `count` instances. */
  remove(id: number): void {
    const slot = this.slots.get(id);
    if (slot === undefined) return;
    this.removeSlot(slot);
    this.version++;
  }

  /** Drops every instance whose expiry has passed. */
  expire(nowMs: number): void {
    let removed = false;
    for (let slot = this.count - 1; slot >= 0; slot--) {
      if (this.expiresAt[slot] > nowMs) continue;
      this.removeSlot(slot);
      removed = true;
    }
    if (removed) this.version++;
  }

  clear(): void {
    this.slots.clear();
    this.count = 0;
    this.version++;
  }

  private evictExpiring(): boolean {
    let victim = -1;
    for (let slot = 0; slot < this.count; slot++) {
      if (this.expiresAt[slot] === Infinity) continue;
      if (victim < 0 || this.expiresAt[slot] < this.expiresAt[victim]) victim = slot;
    }
    if (victim < 0) return false;
    this.removeSlot(victim);
    return true;
  }

  private removeSlot(slot: number): void {
    this.slots.delete(this.ids[slot]);
    const last = --this.count;
    if (slot === last) return;
    const movedId = this.ids[last];
    this.data.copyWithin(slot * ENERGY_BALL_INSTANCE_FLOATS, last * ENERGY_BALL_INSTANCE_FLOATS,
      (last + 1) * ENERGY_BALL_INSTANCE_FLOATS);
    this.ids[slot] = movedId;
    this.expiresAt[slot] = this.expiresAt[last];
    this.slots.set(movedId, slot);
  }

  private pack(slot: number, i: Readonly<EnergyBallInstance>): void {
    const state = i.kind * 2 + i.variant;
    const data = this.data;
    let offset = slot * ENERGY_BALL_INSTANCE_FLOATS;
    for (let vertex = 0; vertex < ENERGY_BALL_VERTICES; vertex++) {
      const lx = CORNERS[vertex * 2] * i.extent;
      const ly = CORNERS[vertex * 2 + 1] * i.extent;
      data[offset] = i.x + lx;
      data[offset + 1] = i.y + ly;
      data[offset + 2] = lx;
      data[offset + 3] = ly;
      data[offset + 4] = i.glowRadius;
      data[offset + 5] = i.shellScale;
      data[offset + 6] = i.seed;
      data[offset + 7] = state;
      data[offset + 8] = i.bornS;
      data[offset + 9] = i.motion;
      data[offset + 10] = i.coreZone;
      data[offset + 11] = i.shellZone;
      writeColor(data, offset + 12, i.glowColor);
      data[offset + 15] = i.coreParticleRadius;
      writeColor(data, offset + 16, i.shellColor);
      data[offset + 19] = i.shellParticleRadius;
      writeColor(data, offset + 20, i.coreColor);
      offset += ENERGY_BALL_FLOATS_PER_VERTEX;
    }
  }
}

function writeColor(data: Float32Array, offset: number, color: number): void {
  data[offset] = ((color >> 16) & 0xff) / 255;
  data[offset + 1] = ((color >> 8) & 0xff) / 255;
  data[offset + 2] = (color & 0xff) / 255;
}
