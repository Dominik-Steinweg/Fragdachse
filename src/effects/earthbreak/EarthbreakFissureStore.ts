/**
 * Persistent instance data of every visible Earthbreak fissure. Pure data: no Phaser, no GL.
 *
 * One instance is one quad (six non-indexed vertices): either one path segment of a trace or
 * the emergence crater. Growth, ignition, collapse, embers and the residual fade are evaluated
 * by the shader from the timing attributes, so the CPU only writes when a point appears, when
 * the trace detonates, when it is cancelled and on removal.
 */

export const FISSURE_FLOATS_PER_VERTEX = 24;
export const FISSURE_VERTICES = 6;
export const FISSURE_INSTANCE_FLOATS = FISSURE_FLOATS_PER_VERTEX * FISSURE_VERTICES;
export const FISSURE_CAPACITY = 512;

export const FissureKind = { Segment: 0, Crater: 1 } as const;
export type FissureKind = (typeof FissureKind)[keyof typeof FissureKind];

/** Shared with the shader: every duration the CPU uses for expiry is authored here once. */
export const FISSURE_TIMING = {
  /** A segment's crack front crosses it in this time; close to the underground point cadence. */
  growMs: 50,
  /** The ignition front leaves the exit with the collapse and runs this much faster. */
  ignitionLead: 0.3,
  /** Collapsed ground stays readable before it sinks back into the terrain. */
  holdMs: 1300,
  fadeMs: 1200,
  /** A cancelled dig closes its cracks quickly instead of detonating. */
  cancelMs: 450,
} as const;

/** Quad half-extent across a segment: trench, lip and lateral shock band. */
export const FISSURE_HALF_WIDTH = 48;
/** Arc length a successor segment grows before its predecessor's crack front is fully open. */
export const FISSURE_SPACING_HINT = 24;

/** Instance-relative times keep float32 attributes precise; rebased whenever the store is empty. */
const REBASE_AFTER_MS = 600_000;
/** Far below any store time; the shader treats values under -1e6 as "not yet known". */
export const FISSURE_NONE = -1e7;
const NONE = FISSURE_NONE;

export interface FissureSegmentSpec {
  readonly ax: number; readonly ay: number;
  readonly bx: number; readonly by: number;
  /** Arc length of `a` along its trace; the start taper and along-path noise use it. */
  readonly arcStart: number;
  /** Bisector plane normals at both joints in world space, oriented along travel; null = open end. */
  readonly joinA: readonly [number, number] | null;
  readonly joinB: readonly [number, number] | null;
  readonly bornAt: number;
  readonly seed: number;
  readonly color: number;
}

export interface FissureCraterSpec {
  readonly x: number; readonly y: number;
  readonly radius: number;
  readonly seed: number;
  readonly color: number;
}

// Vertex word offsets.
const W_SHAPE = 4;   // length, arcStart, axis cos, axis sin
const W_JOIN = 8;    // joint normal a (xy), joint normal b (xy), segment-local
const W_TIME = 12;   // bornAt, nextBornAt, collapseA, collapseB
const W_MISC = 16;   // fadeAt, detonatedAt, seed, kind

export class EarthbreakFissureStore {
  readonly data = new Float32Array(FISSURE_CAPACITY * FISSURE_INSTANCE_FLOATS);
  count = 0;
  /** Bumped by `commit()` when any slot changed since the previous commit. */
  version = 0;
  /** Slot range changed by the latest committed version. Older consumers upload everything. */
  dirtyStart = 0;
  dirtyEnd = 0;
  private pendingStart = Infinity;
  private pendingEnd = 0;
  private epoch = 0;
  private readonly expiresAt = new Float64Array(FISSURE_CAPACITY);
  private readonly keys: (string | null)[] = new Array(FISSURE_CAPACITY).fill(null);
  private readonly slots = new Map<string, number>();

  /** Clock value for the shader; the epoch only moves while nothing is alive. */
  time(clockMs: number): number {
    if (this.count === 0 && clockMs - this.epoch > REBASE_AFTER_MS) this.epoch = clockMs;
    return clockMs - this.epoch;
  }

  has(key: string): boolean { return this.slots.has(key); }
  get size(): number { return this.count; }

  addSegment(key: string, spec: FissureSegmentSpec, clockMs: number): boolean {
    const dx = spec.bx - spec.ax, dy = spec.by - spec.ay;
    const length = Math.hypot(dx, dy);
    if (!(length > 0.01) || !Number.isFinite(length + spec.arcStart + spec.bornAt)) return false;
    const slot = this.allocate(key, clockMs);
    if (slot < 0) return false;
    const cos = dx / length, sin = dy / length;
    // World bisector normals expressed in the segment frame (x = travel, y = left).
    const local = (n: readonly [number, number] | null): [number, number] => n
      ? [n[0] * cos + n[1] * sin, -n[0] * sin + n[1] * cos] : [0, 0];
    const [nax, nay] = local(spec.joinA);
    const [nbx, nby] = local(spec.joinB);
    const pad = FISSURE_HALF_WIDTH;
    this.writeQuad(slot, spec.ax, spec.ay, cos, sin, -pad, length + pad, -pad, pad,
      [length, spec.arcStart, cos, sin], [nax, nay, nbx, nby],
      [spec.bornAt - this.epoch, NONE, NONE, NONE], [NONE, NONE, spec.seed, FissureKind.Segment], spec.color);
    this.expiresAt[slot] = Infinity;
    return true;
  }

  addCrater(key: string, spec: FissureCraterSpec, detonatedAt: number, clockMs: number): boolean {
    if (!Number.isFinite(spec.x + spec.y + spec.radius + detonatedAt) || spec.radius <= 0) return false;
    const slot = this.allocate(key, clockMs);
    if (slot < 0) return false;
    const r = spec.radius + 10;
    const det = detonatedAt - this.epoch;
    this.writeQuad(slot, spec.x, spec.y, 1, 0, -r, r, -r, r,
      [spec.radius, 0, 1, 0], [0, 0, 0, 0],
      [det, NONE, det, det], [NONE, det, spec.seed, FissureKind.Crater], spec.color);
    this.expiresAt[slot] = detonatedAt + FISSURE_TIMING.holdMs + FISSURE_TIMING.fadeMs;
    return true;
  }

  /** Replaces one joint plane once the neighbouring segment is known (world normal, null = open). */
  setJoin(key: string, end: 'a' | 'b', normal: readonly [number, number] | null): void {
    const slot = this.slots.get(key);
    if (slot === undefined) return;
    const base = slot * FISSURE_INSTANCE_FLOATS;
    const cos = this.data[base + W_SHAPE + 2], sin = this.data[base + W_SHAPE + 3];
    const word = W_JOIN + (end === 'a' ? 0 : 2);
    this.writeWord(slot, word, normal ? normal[0] * cos + normal[1] * sin : 0);
    this.writeWord(slot, word + 1, normal ? -normal[0] * sin + normal[1] * cos : 0);
  }

  /** The successor segment starts growing: this segment's crack front opens into it. */
  setNextBorn(key: string, nextBornAt: number): void {
    const slot = this.slots.get(key);
    if (slot !== undefined) this.writeWord(slot, W_TIME + 1, nextBornAt - this.epoch);
  }

  /** Collapse times at both ends of a segment (store clock). */
  setCollapse(key: string, detonatedAt: number, collapseA: number, collapseB: number): void {
    const slot = this.slots.get(key);
    if (slot === undefined) return;
    this.writeWord(slot, W_TIME + 2, collapseA - this.epoch);
    this.writeWord(slot, W_TIME + 3, collapseB - this.epoch);
    this.writeWord(slot, W_MISC + 1, detonatedAt - this.epoch);
    this.expiresAt[slot] = Math.max(collapseA, collapseB) + FISSURE_TIMING.holdMs + FISSURE_TIMING.fadeMs;
  }

  /** A trace vanished without detonating: close its cracks instead of collapsing them. */
  cancel(key: string, clockMs: number): void {
    const slot = this.slots.get(key);
    if (slot === undefined || this.expiresAt[slot] !== Infinity) return;
    this.writeWord(slot, W_MISC, clockMs - this.epoch);
    this.expiresAt[slot] = clockMs + FISSURE_TIMING.cancelMs;
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
    if (this.count === 0 && this.slots.size === 0) return;
    this.count = 0;
    this.slots.clear();
    this.keys.fill(null);
    this.pendingStart = Infinity; this.pendingEnd = 0;
    this.dirtyStart = this.dirtyEnd = 0;
    this.version++;
  }

  /** Publishes all writes since the last commit as one upload version. */
  commit(): void {
    if (this.pendingStart === Infinity) return;
    this.dirtyStart = this.pendingStart;
    this.dirtyEnd = Math.min(this.pendingEnd, this.count);
    this.pendingStart = Infinity; this.pendingEnd = 0;
    this.version++;
  }

  private allocate(key: string, clockMs: number): number {
    this.remove(key);
    if (this.count >= FISSURE_CAPACITY) this.retire(clockMs);
    if (this.count >= FISSURE_CAPACITY) return -1;
    this.time(clockMs);
    const slot = this.count++;
    this.keys[slot] = key;
    this.slots.set(key, slot);
    return slot;
  }

  private touch(slot: number): void {
    this.pendingStart = Math.min(this.pendingStart, slot);
    this.pendingEnd = Math.max(this.pendingEnd, slot + 1);
  }

  /** Swap-remove keeps the live range dense; overlapping instances are order-independent. */
  private removeSlot(slot: number): void {
    const last = this.count - 1;
    const key = this.keys[slot];
    if (key !== null) this.slots.delete(key);
    if (slot !== last) {
      this.data.copyWithin(slot * FISSURE_INSTANCE_FLOATS, last * FISSURE_INSTANCE_FLOATS, (last + 1) * FISSURE_INSTANCE_FLOATS);
      this.expiresAt[slot] = this.expiresAt[last];
      const moved = this.keys[last];
      this.keys[slot] = moved;
      if (moved !== null) this.slots.set(moved, slot);
      this.touch(slot);
    }
    this.keys[last] = null;
    this.count = last;
  }

  private writeWord(slot: number, word: number, value: number): void {
    const base = slot * FISSURE_INSTANCE_FLOATS + word;
    for (let v = 0; v < FISSURE_VERTICES; v++) this.data[base + v * FISSURE_FLOATS_PER_VERTEX] = value;
    this.touch(slot);
  }

  private writeQuad(slot: number, x: number, y: number, cos: number, sin: number,
    left: number, right: number, top: number, bottom: number,
    shape: readonly number[], join: readonly number[], time: readonly number[], misc: readonly number[],
    color: number): void {
    const r = ((color >> 16) & 0xff) / 255, g = ((color >> 8) & 0xff) / 255, b = (color & 0xff) / 255;
    const corners = [left, top, right, top, right, bottom, left, top, right, bottom, left, bottom];
    let o = slot * FISSURE_INSTANCE_FLOATS;
    const d = this.data;
    for (let v = 0; v < FISSURE_VERTICES; v++) {
      const lx = corners[v * 2], ly = corners[v * 2 + 1];
      d[o++] = x + lx * cos - ly * sin; d[o++] = y + lx * sin + ly * cos;
      d[o++] = lx; d[o++] = ly;
      for (let i = 0; i < 4; i++) d[o++] = shape[i];
      for (let i = 0; i < 4; i++) d[o++] = join[i];
      for (let i = 0; i < 4; i++) d[o++] = time[i];
      for (let i = 0; i < 4; i++) d[o++] = misc[i];
      d[o++] = r; d[o++] = g; d[o++] = b; d[o++] = 1;
    }
    this.touch(slot);
  }
}
