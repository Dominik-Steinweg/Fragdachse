import type { VoidMarchers, VoidMarcherSample } from './VoidDangerField';
import { liftArrivalSec, type VoidLiftWave } from './VoidLiftWave';

/**
 * Void taint (GDD Void-Gefahrenzonen V1, E12-E14): hostile bodies carry the void into the fog they
 * walk through. Where one passed, the fog takes the haze of an active spawn zone: it flares up
 * first, settles, holds and returns to ordinary fog after about fifteen seconds. A defeated
 * spawn's wave dissolves exactly the trails its enemies laid. The situation map's phantom marchers
 * lay the same trails along the planned routes.
 *
 * Presentation only, never networked. The CPU keeps world-anchored capsule stamps with their birth
 * and retire times; the GPU evaluates the envelope (VoidTaintShaders), so a frame only appends.
 */
export const VOID_TAINT = {
  /**
   * A trail starts to rise this long after the body passed and is full after riseMs more (ms): the
   * haze gathers behind the body, so enemies never walk inside their own densest, freshest haze.
   */
  riseDelayMs: 350,
  riseMs: 700,
  /** Fresh contamination flares up; the flare decays with this time constant (ms). */
  flareMs: 1600,
  /** A trail holds this long after the body passed (ms), then fades back to fog. */
  holdMs: 11000,
  fadeMs: 4000,
  /** A lifted or dropped trail fades this fast (ms); a lifted one flares once more just before. */
  quickFadeMs: 900,
  liftFlareMs: 450,
  /** Trail radius: at least this, else this share of the body size (world px). */
  minRadius: 60,
  sizeRadius: 1.5,
  /** The capsule's Gaussian reaches this many radii; its rim is frayed by up to this share. */
  extent: 2,
  fray: .45,
  /** Around the body still laying a trail the haze stays open over this share of the trail radius. */
  bodyClear: .8,
  /** An open capsule grows until it is this long (px) or old (ms), then a connected one starts. */
  maxSegmentPx: 180,
  maxSegmentMs: 1500,
  /** It grows only while the path bends less than this (sine of the angle). */
  bendSin: .14,
  /** A standing body keeps its point stamp alive this often (ms). */
  refreshMs: 500,
  /**
   * The GPU decodes times modulo the clock as signed ages within half of it. A stamp's births are
   * never older than this at the end of its fade: a body standing long keeps a point whose birth
   * moves along, its flare long settled.
   */
  birthWindowMs: 25000,
  /** A move further than this many radii plus this speed breaks the trail (teleports, corrections). */
  jumpRadii: 4,
  jumpSpeedPxPerSec: 2000,
  /** At most this many new stamps per frame; further ones wait for the next. */
  maxInsertsPerFrame: 256,
  /** Share of a zone's coverage a trail raises outside fog: the light veil of its own (E12). */
  coverShare: .45,
} as const;

/** Times travel modulo this clock in 16 bits. */
export const VOID_TAINT_CLOCK_MS = 60000;
/** Stamps per command row; each stamp takes five rows of texels (FogTrailSegments layout). */
export const VOID_TAINT_TEXTURE_WIDTH = 256;
export const VOID_TAINT_CAPACITY = 4096;
export const VOID_TAINT_TEXEL_ROWS = VOID_TAINT_CAPACITY / VOID_TAINT_TEXTURE_WIDTH * 5;
/** Flags of a stamp: lifted by its zone's wave (flare, then a quick fade), or dropped quickly. */
export const VOID_TAINT_LIFTED = 1;
export const VOID_TAINT_QUICK = 2;
/** The stamp's end is where a body still stands or walks: the haze stays open around it. */
export const VOID_TAINT_OCCUPIED = 4;
const RETIRING = VOID_TAINT_LIFTED | VOID_TAINT_QUICK;
/** Floats per vertex (position, slot, unused) and vertices per stamp. */
const VERTEX_FLOATS = 4, STAMP_VERTICES = 6;
const CORNERS = [0, 1, 2, 2, 1, 3] as const;

export interface VoidTaintFrame { readonly offsetX: number; readonly offsetY: number; readonly width: number; readonly height: number }

interface Stamp {
  ax: number; ay: number; bx: number; by: number; radius: number;
  birthA: number; birthB: number; retireA: number; retireB: number;
  strength: number; flags: number; zone: string | null; group: number;
}
interface Track { id: string; slot: number; revision: number; x: number; y: number; at: number; refreshedAt: number; seen: number;
  zone: string | null; group: number; strength: number }

const pack = (data: Uint8Array, offset: number, n: number): void => {
  n = Math.max(0, Math.min(65535, Math.round(n))); data[offset] = n >> 8; data[offset + 1] = n & 255;
};
/** Never round a time into the future: modulo age would turn it into almost a minute. */
const clock = (ms: number): number => Math.floor(((ms % VOID_TAINT_CLOCK_MS) + VOID_TAINT_CLOCK_MS) % VOID_TAINT_CLOCK_MS);
/** The signed age the GPU decodes from two clock readings: `now - at`, within half the clock. */
export function voidTaintAge(nowClock: number, atClock: number): number {
  return ((nowClock - atClock + VOID_TAINT_CLOCK_MS * 1.5) % VOID_TAINT_CLOCK_MS) - VOID_TAINT_CLOCK_MS / 2;
}
const fadeMsOf = (flags: number): number => flags & RETIRING ? VOID_TAINT.quickFadeMs : VOID_TAINT.fadeMs;

/**
 * Stamps of the void trails of one World presentation. Owned by the void creep presentation; it
 * outlives creep rebuilds and is freed with it. `commands` and `vertices` mirror the slots for the
 * GPU; the dirty ranges tell the layer what to upload.
 */
export class VoidTaintTrails {
  /** Five texel rows per stamp: start, end, births, retires, radius/strength/flags. */
  readonly commands = new Uint8Array(VOID_TAINT_CAPACITY * 5 * 4);
  /** Six vertices per stamp slot, frame relative; free slots are degenerate. */
  readonly vertices = new Float32Array(VOID_TAINT_CAPACITY * STAMP_VERTICES * VERTEX_FLOATS);
  private readonly slots: (Stamp | undefined)[];
  private readonly free: number[] = [];
  private readonly tracks = new Map<string, Track>();
  private cursor = 0;
  private frame = 0;
  private lastNow = NaN;
  private retiredRevision = -1;
  private inserts = 0;
  /** Live stamps; 0 skips the raster. */
  size = 0;
  /** Highest slot ever used plus one: the raster draws this many stamps. */
  used = 0;
  /** Slot range changed since the layer last uploaded; min > max when clean. */
  dirtyMin = Infinity;
  dirtyMax = -1;
  /** Stamps replaced while still visible (capacity exhausted). */
  dropped = 0;

  constructor(private readonly world: VoidTaintFrame, private readonly capacity = VOID_TAINT_CAPACITY) {
    if (capacity > VOID_TAINT_CAPACITY || capacity < 1) throw new Error('[VoidTaint] capacity out of range');
    this.slots = Array(capacity);
    for (let i = capacity - 1; i >= 0; i--) this.free.push(i);
  }

  /** The clock the GPU compares stamp times with. */
  static clock(nowMs: number): number { return clock(nowMs); }

  /** Lays this frame's trails. Bodies not visited are closed; a backward clock jump starts over. */
  feed(nowMs: number, marchers: VoidMarchers | null): void {
    if (Number.isFinite(this.lastNow) && nowMs < this.lastNow - 1000) this.clear();
    this.lastNow = nowMs;
    this.frame++; this.inserts = 0;
    this.sweep(nowMs);
    const retired = marchers?.retired;
    if (retired && retired.revision !== this.retiredRevision) {
      this.retiredRevision = retired.revision;
      this.retireGroups(retired.groups, nowMs);
    }
    marchers?.forEach(sample => this.visit(sample, nowMs));
    for (const [id, track] of this.tracks) if (track.seen !== this.frame) { this.release(track); this.tracks.delete(id); }
  }

  /** Farthest reach of a zone's trails from a point, radius included; 0 without trails. */
  reachOf(zone: string, x: number, y: number): number {
    let reach = 0;
    for (const stamp of this.slots) {
      if (!stamp || stamp.zone !== zone) continue;
      reach = Math.max(reach, Math.hypot(stamp.ax - x, stamp.ay - y) + stamp.radius, Math.hypot(stamp.bx - x, stamp.by - y) + stamp.radius);
    }
    return reach;
  }

  /**
   * The zone's wave dissolves its trails: every stamp of the zone retires when the front reaches
   * it, unless it fades sooner anyway. Trails its enemies lay afterwards start fresh.
   */
  lift(zone: string, nowMs: number, wave: VoidLiftWave): void {
    for (const track of this.tracks.values()) if (track.zone === zone) this.release(track);
    for (let i = 0; i < this.capacity; i++) {
      const stamp = this.slots[i];
      if (!stamp || stamp.zone !== zone || stamp.flags & RETIRING) continue;
      const arriveA = nowMs + liftArrivalSec(wave, Math.hypot(stamp.ax - wave.x, stamp.ay - wave.y)) * 1000;
      const arriveB = nowMs + liftArrivalSec(wave, Math.hypot(stamp.bx - wave.x, stamp.by - wave.y)) * 1000;
      if (arriveA >= stamp.retireA && arriveB >= stamp.retireB) continue;
      stamp.retireA = Math.min(stamp.retireA, arriveA); stamp.retireB = Math.min(stamp.retireB, arriveB);
      stamp.flags = stamp.flags & ~RETIRING | VOID_TAINT_LIFTED;
      this.encode(i);
    }
  }

  /** Trails of these groups fade quickly from now (the situation map's dropped routes). */
  retireGroups(groups: readonly number[], nowMs: number): void {
    if (!groups.length) return;
    const set = new Set(groups);
    for (const track of this.tracks.values()) if (set.has(track.group)) this.release(track);
    for (let i = 0; i < this.capacity; i++) {
      const stamp = this.slots[i];
      if (!stamp || !set.has(stamp.group) || stamp.flags & RETIRING || Math.max(stamp.retireA, stamp.retireB) <= nowMs) continue;
      stamp.retireA = Math.min(stamp.retireA, nowMs); stamp.retireB = Math.min(stamp.retireB, nowMs);
      stamp.flags = stamp.flags & ~RETIRING | VOID_TAINT_QUICK;
      this.encode(i);
    }
  }

  /** Frees stamps that have faded out. */
  sweep(nowMs: number): void {
    for (let i = 0; i < this.capacity; i++) {
      const stamp = this.slots[i];
      if (stamp && nowMs - Math.max(stamp.retireA, stamp.retireB) >= fadeMsOf(stamp.flags)) this.remove(i);
    }
  }

  clear(): void {
    for (let i = 0; i < this.capacity; i++) if (this.slots[i]) this.remove(i);
    this.tracks.clear();
    this.lastNow = NaN;
  }

  /** The layer uploaded everything up to now. */
  markClean(): void { this.dirtyMin = Infinity; this.dirtyMax = -1; }

  /** A copy of the stamp in a slot, for tests and lab readouts. */
  stampAt(slot: number): Readonly<Stamp> | undefined {
    const stamp = this.slots[slot];
    return stamp && { ...stamp };
  }

  private visit(sample: Readonly<VoidMarcherSample>, nowMs: number): void {
    let track = this.tracks.get(sample.id);
    if (!track) {
      track = { id: sample.id, slot: -1, revision: sample.revision, x: sample.x, y: sample.y, at: nowMs, refreshedAt: nowMs,
        seen: this.frame, zone: sample.zone, group: sample.group, strength: sample.strength };
      this.tracks.set(sample.id, track);
    }
    track.seen = this.frame;
    const radius = Math.max(VOID_TAINT.minRadius, VOID_TAINT.sizeRadius * sample.size);
    const strength = Math.max(0, Math.min(1, sample.strength));
    if (!sample.active || !Number.isFinite(sample.x + sample.y + radius) || strength <= 0) {
      this.release(track); track.x = sample.x; track.y = sample.y; track.at = nowMs; return;
    }
    const step = Math.hypot(sample.x - track.x, sample.y - track.y), dt = Math.max(0, nowMs - track.at) / 1000;
    const broken = track.revision !== sample.revision || track.zone !== sample.zone || track.group !== sample.group
      || Math.abs(track.strength - strength) > .02
      || step > radius * VOID_TAINT.jumpRadii + VOID_TAINT.jumpSpeedPxPerSec * dt;
    track.revision = sample.revision; track.zone = sample.zone; track.group = sample.group; track.strength = strength;
    track.x = sample.x; track.y = sample.y; track.at = nowMs;
    if (broken) this.release(track);
    const open = track.slot < 0 ? undefined : this.slots[track.slot];
    if (!open) { track.slot = this.insertPoint(sample, radius, strength, nowMs); track.refreshedAt = nowMs; return; }
    const ex = open.bx - open.ax, ey = open.by - open.ay, length = Math.hypot(ex, ey);
    const mx = sample.x - open.bx, my = sample.y - open.by, move = Math.hypot(mx, my);
    if (move < .5) {
      // Standing: the body's end stays alive (encode keeps its births inside the clock's window).
      if (nowMs - track.refreshedAt < VOID_TAINT.refreshMs) return;
      track.refreshedAt = nowMs;
      open.retireB = nowMs + VOID_TAINT.holdMs;
      if (length < .5) open.retireA = open.retireB;
      this.encode(track.slot);
      return;
    }
    const straight = length < .5 || (ex * mx + ey * my > 0 && Math.abs(ex * my - ey * mx) <= length * move * VOID_TAINT.bendSin);
    if (straight && length + move <= VOID_TAINT.maxSegmentPx && nowMs - open.birthA <= VOID_TAINT.maxSegmentMs) {
      if (length < .5) { open.birthA = Math.max(open.birthA, open.birthB); }
      open.bx = sample.x; open.by = sample.y; open.birthB = nowMs; open.retireB = nowMs + VOID_TAINT.holdMs;
      if (length < .5) open.retireA = Math.max(open.retireA, open.birthA + VOID_TAINT.holdMs);
      this.encode(track.slot);
      return;
    }
    // A connected piece starts where the last one ended, with that end's times.
    const last = { birthB: open.birthB, retireB: open.retireB, bx: open.bx, by: open.by };
    this.release(track);
    track.slot = this.insert({ ax: last.bx, ay: last.by, bx: sample.x, by: sample.y, radius, birthA: last.birthB, birthB: nowMs,
      retireA: last.retireB, retireB: nowMs + VOID_TAINT.holdMs, strength, flags: VOID_TAINT_OCCUPIED, zone: sample.zone, group: sample.group }, nowMs);
  }

  private insertPoint(sample: Readonly<VoidMarcherSample>, radius: number, strength: number, nowMs: number): number {
    return this.insert({ ax: sample.x, ay: sample.y, bx: sample.x, by: sample.y, radius, birthA: nowMs, birthB: nowMs,
      retireA: nowMs + VOID_TAINT.holdMs, retireB: nowMs + VOID_TAINT.holdMs, strength, flags: VOID_TAINT_OCCUPIED, zone: sample.zone, group: sample.group }, nowMs);
  }

  /** The body no longer stands at its stamp's end: that end takes the haze like the rest. */
  private release(track: Track): void {
    const stamp = track.slot >= 0 ? this.slots[track.slot] : undefined;
    if (stamp && stamp.flags & VOID_TAINT_OCCUPIED) { stamp.flags &= ~VOID_TAINT_OCCUPIED; this.encode(track.slot); }
    track.slot = -1;
  }

  private insert(stamp: Stamp, nowMs: number): number {
    if (this.inserts >= VOID_TAINT.maxInsertsPerFrame) return -1;
    this.inserts++;
    let index = this.free.pop();
    if (index === undefined) {
      // Full: replace the stamp that retires first among the next few, so recent trails survive.
      let best = this.cursor, bestRetire = Infinity;
      for (let i = 0; i < Math.min(64, this.capacity); i++) {
        const candidate = (this.cursor + i) % this.capacity, old = this.slots[candidate]!;
        const retire = Math.max(old.retireA, old.retireB);
        if (retire < bestRetire) { best = candidate; bestRetire = retire; }
      }
      index = best;
      this.cursor = (best + 1) % this.capacity;
      if (bestRetire > nowMs) this.dropped++;
      this.remove(index);
      this.free.pop();
    }
    this.slots[index] = stamp; this.size++;
    this.used = Math.max(this.used, index + 1);
    this.encode(index);
    return index;
  }

  private remove(index: number): void {
    if (!this.slots[index]) return;
    this.slots[index] = undefined; this.size--; this.free.push(index);
    for (const track of this.tracks.values()) if (track.slot === index) track.slot = -1;
    this.vertices.fill(0, index * STAMP_VERTICES * VERTEX_FLOATS, (index + 1) * STAMP_VERTICES * VERTEX_FLOATS);
    this.touch(index);
  }

  private touch(index: number): void {
    this.dirtyMin = Math.min(this.dirtyMin, index); this.dirtyMax = Math.max(this.dirtyMax, index);
  }

  private encode(index: number): void {
    const stamp = this.slots[index]!, f = this.world, stride = VOID_TAINT_TEXTURE_WIDTH * 4;
    const earliest = Math.max(stamp.retireA, stamp.retireB) + fadeMsOf(stamp.flags) - VOID_TAINT.birthWindowMs;
    stamp.birthA = Math.max(stamp.birthA, earliest); stamp.birthB = Math.max(stamp.birthB, earliest);
    const base = Math.floor(index / VOID_TAINT_TEXTURE_WIDTH) * stride * 5 + index % VOID_TAINT_TEXTURE_WIDTH * 4, data = this.commands;
    pack(data, base, (stamp.ax - f.offsetX) / f.width * 65535); pack(data, base + 2, (stamp.ay - f.offsetY) / f.height * 65535);
    pack(data, base + stride, (stamp.bx - f.offsetX) / f.width * 65535); pack(data, base + stride + 2, (stamp.by - f.offsetY) / f.height * 65535);
    pack(data, base + stride * 2, clock(stamp.birthA)); pack(data, base + stride * 2 + 2, clock(stamp.birthB));
    pack(data, base + stride * 3, clock(stamp.retireA)); pack(data, base + stride * 3 + 2, clock(stamp.retireB));
    pack(data, base + stride * 4, stamp.radius * 16);
    data[base + stride * 4 + 2] = Math.round(stamp.strength * 255); data[base + stride * 4 + 3] = stamp.flags;
    // The quad covers the capsule's Gaussian, aligned to its direction.
    const reach = stamp.radius * VOID_TAINT.extent * (1 + VOID_TAINT.fray) + 1, dx0 = stamp.bx - stamp.ax, dy0 = stamp.by - stamp.ay;
    const length = Math.hypot(dx0, dy0), dx = length > .001 ? dx0 / length : 1, dy = length > .001 ? dy0 / length : 0;
    let offset = index * STAMP_VERTICES * VERTEX_FLOATS;
    for (const corner of CORNERS) {
      const end = corner >= 2, side = corner % 2 ? 1 : -1, along = end ? reach : -reach;
      this.vertices[offset++] = (end ? stamp.bx : stamp.ax) + dx * along - dy * reach * side - f.offsetX;
      this.vertices[offset++] = (end ? stamp.by : stamp.ay) + dy * along + dx * reach * side - f.offsetY;
      this.vertices[offset++] = index;
      this.vertices[offset++] = 0;
    }
    this.touch(index);
  }
}
