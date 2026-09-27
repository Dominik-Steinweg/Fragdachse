/**
 * Persistent instance data of all enemy claw visuals. Pure data: no Phaser, no GL.
 *
 * One instance is one quad (six non-indexed vertices). Everything that changes over an
 * instance's lifetime – charge front, strike flash, rake sweep, fade – is evaluated by the
 * shader from the timing attributes, so the CPU only writes on spawn, on the rare position
 * correction of a still winding-up attacker and on removal.
 */

export const CLAW_VFX_FLOATS_PER_VERTEX = 16;
export const CLAW_VFX_VERTICES = 6;
export const CLAW_VFX_INSTANCE_FLOATS = CLAW_VFX_FLOATS_PER_VERTEX * CLAW_VFX_VERTICES;
export const CLAW_VFX_CAPACITY = 256;

/** Rake visibility after the authored hit time; shared with the shader. */
export const CLAW_VFX_SLASH_MS = 200;
/** Contact mark on the struck target. */
export const CLAW_VFX_CONTACT_MS = 280;
/** The ground telegraph dissolves this long after the hit; shared with the shader. */
export const CLAW_VFX_TELEGRAPH_FADE_MS = 110;

export const ClawVfxKind = { Attack: 0, Contact: 1 } as const;

/** Instance-relative times keep float32 attributes precise; rebased whenever the store is empty. */
const REBASE_AFTER_MS = 600_000;

export interface ClawVfxAttackSpec {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly range: number;
  readonly halfArc: number;
  /** Store-clock milliseconds. */
  readonly startedAt: number;
  readonly strikeAt: number;
  readonly hitAt: number;
  readonly color: number;
}

export class EnemyClawVfxStore {
  readonly data = new Float32Array(CLAW_VFX_CAPACITY * CLAW_VFX_INSTANCE_FLOATS);
  count = 0;
  /** Bumped on every write; a render layer re-uploads `data[0, count)` when it differs. */
  version = 0;
  private epoch = 0;
  private readonly expiresAt = new Float64Array(CLAW_VFX_CAPACITY);
  private readonly angles = new Float32Array(CLAW_VFX_CAPACITY);
  private readonly keys: (string | null)[] = new Array(CLAW_VFX_CAPACITY).fill(null);
  private readonly slots = new Map<string, number>();

  /** Clock value for the shader; the epoch only moves while nothing is alive. */
  time(clockMs: number): number {
    if (this.count === 0 && clockMs - this.epoch > REBASE_AFTER_MS) this.epoch = clockMs;
    return clockMs - this.epoch;
  }

  has(key: string): boolean { return this.slots.has(key); }

  addAttack(key: string, spec: ClawVfxAttackSpec, clockMs: number): boolean {
    const slot = this.allocate(key, clockMs);
    if (slot < 0) return false;
    const { range: r, halfArc } = spec;
    const pad = 4 + r * 0.08;
    const cos = Math.cos(Math.min(halfArc, Math.PI));
    const lateral = halfArc >= Math.PI / 2 ? r : r * Math.sin(halfArc);
    const e = this.epoch;
    this.writeQuad(slot, spec.x, spec.y, spec.angle,
      Math.min(0, r * cos) - pad, r + pad, -lateral - pad, lateral + pad,
      spec.startedAt - e, spec.strikeAt - e, spec.hitAt - e, spec.hitAt + CLAW_VFX_SLASH_MS - e,
      r, halfArc, ClawVfxKind.Attack, spec.color);
    this.expiresAt[slot] = spec.hitAt + CLAW_VFX_SLASH_MS;
    return true;
  }

  addContact(key: string, x: number, y: number, angle: number, size: number, color: number, clockMs: number): boolean {
    const slot = this.allocate(key, clockMs);
    if (slot < 0) return false;
    const start = clockMs - this.epoch;
    this.writeQuad(slot, x, y, angle, -size, size, -size, size,
      start, start, start, start + CLAW_VFX_CONTACT_MS, size, 0, ClawVfxKind.Contact, color);
    this.expiresAt[slot] = clockMs + CLAW_VFX_CONTACT_MS;
    return true;
  }

  colorOf(key: string): number | null {
    const slot = this.slots.get(key);
    if (slot === undefined) return null;
    const o = slot * CLAW_VFX_INSTANCE_FLOATS + 12;
    const channel = (i: number): number => Math.round(this.data[o + i] * 255);
    return (channel(0) << 16) | (channel(1) << 8) | channel(2);
  }

  /** Re-anchors a live instance; skipped below a quarter pixel to avoid needless uploads. */
  move(key: string, x: number, y: number): void {
    const slot = this.slots.get(key);
    if (slot === undefined) return;
    const base = slot * CLAW_VFX_INSTANCE_FLOATS;
    const d = this.data;
    const cos = Math.cos(this.angles[slot]), sin = Math.sin(this.angles[slot]);
    const cx = d[base] - (d[base + 2] * cos - d[base + 3] * sin);
    const cy = d[base + 1] - (d[base + 2] * sin + d[base + 3] * cos);
    if (Math.abs(cx - x) < 0.25 && Math.abs(cy - y) < 0.25) return;
    for (let v = 0; v < CLAW_VFX_VERTICES; v++) {
      const o = base + v * CLAW_VFX_FLOATS_PER_VERTEX;
      d[o] = x + d[o + 2] * cos - d[o + 3] * sin;
      d[o + 1] = y + d[o + 2] * sin + d[o + 3] * cos;
    }
    this.version++;
  }

  remove(key: string): void {
    const slot = this.slots.get(key);
    if (slot !== undefined) this.removeSlot(slot);
  }

  /** Drops every instance whose last visible frame lies before `clockMs`. */
  retire(clockMs: number): void {
    for (let slot = this.count - 1; slot >= 0; slot--) {
      if (this.expiresAt[slot] <= clockMs) this.removeSlot(slot);
    }
  }

  clear(): void {
    this.count = 0;
    this.slots.clear();
    this.keys.fill(null);
    this.version++;
  }

  private allocate(key: string, clockMs: number): number {
    this.remove(key);
    if (this.count >= CLAW_VFX_CAPACITY) this.retire(clockMs);
    if (this.count >= CLAW_VFX_CAPACITY) return -1;
    this.time(clockMs);
    const slot = this.count++;
    this.keys[slot] = key;
    this.slots.set(key, slot);
    return slot;
  }

  /** Swap-remove keeps the live range dense; draw order inside the batch carries no meaning. */
  private removeSlot(slot: number): void {
    const last = this.count - 1;
    const key = this.keys[slot];
    if (key !== null) this.slots.delete(key);
    if (slot !== last) {
      this.data.copyWithin(slot * CLAW_VFX_INSTANCE_FLOATS, last * CLAW_VFX_INSTANCE_FLOATS, (last + 1) * CLAW_VFX_INSTANCE_FLOATS);
      this.expiresAt[slot] = this.expiresAt[last];
      this.angles[slot] = this.angles[last];
      const moved = this.keys[last];
      this.keys[slot] = moved;
      if (moved !== null) this.slots.set(moved, slot);
    }
    this.keys[last] = null;
    this.count = last;
    this.version++;
  }

  private writeQuad(slot: number, x: number, y: number, angle: number,
    left: number, right: number, top: number, bottom: number,
    t0: number, t1: number, t2: number, t3: number,
    size: number, halfArc: number, kind: number, color: number): void {
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const r = ((color >> 16) & 0xff) / 255, g = ((color >> 8) & 0xff) / 255, b = (color & 0xff) / 255;
    const seed = (slot * 0.618034) % 1;
    const corners = [left, top, right, top, right, bottom, left, top, right, bottom, left, bottom];
    let o = slot * CLAW_VFX_INSTANCE_FLOATS;
    const d = this.data;
    for (let v = 0; v < CLAW_VFX_VERTICES; v++) {
      const lx = corners[v * 2], ly = corners[v * 2 + 1];
      d[o++] = x + lx * cos - ly * sin; d[o++] = y + lx * sin + ly * cos;
      d[o++] = lx; d[o++] = ly;
      d[o++] = t0; d[o++] = t1; d[o++] = t2; d[o++] = t3;
      d[o++] = size; d[o++] = halfArc; d[o++] = kind; d[o++] = seed;
      d[o++] = r; d[o++] = g; d[o++] = b; d[o++] = 1;
    }
    this.angles[slot] = angle;
    this.version++;
  }
}
