/**
 * CPU side of the persistent blood field: one fixed store of marks that the accumulation shader
 * (see `bloodFieldShaders.ts`) turns into density. Pure data, no Phaser: every animation (spread,
 * feeding, rivulet run, cloud growth, drying, shrinking) is evaluated on the GPU from the
 * timestamps written here, so the vertex data only changes when marks are added, fed or removed.
 */

/** Mark shapes; the accumulation shader branches on these ids. */
export const BloodMarkKind = { Pool: 0, Splat: 1, Drip: 2, Cloud: 3 } as const;
export type BloodMarkKind = typeof BloodMarkKind[keyof typeof BloodMarkKind];

/** Receivers: each writes its own accumulation channel (R ground, G rock, B water). */
export const BloodChannel = { Ground: 0, Rock: 1, Water: 2 } as const;
export type BloodChannel = typeof BloodChannel[keyof typeof BloodChannel];
export const BLOOD_CHANNEL_COUNT = 3;

export interface BloodMarkInput {
  readonly kind: BloodMarkKind;
  readonly channel: BloodChannel;
  readonly x: number;
  readonly y: number;
  /** Pool, cloud: unused. Splat: flight heading. Drip: run direction. */
  readonly angle: number;
  /** Pool, cloud: start radius. Splat, drip: half width. */
  readonly r0: number;
  /** Pool, cloud: final radius. Splat: length along the heading. Drip: run length. */
  readonly r1: number;
  /** Drip: run duration (ms). Splat: 1 for a detached satellite droplet. Otherwise 0. */
  readonly aux?: number;
  /** 0..1, varies the outline. */
  readonly seed: number;
  /** Scene time the mark appears; may lie in the future (blood still in flight). */
  readonly bornAtMs: number;
  /** Pool/cloud growth (ms) from r0 to r1. */
  readonly spreadMs: number;
  readonly endAtMs: number;
  /** Final part of the life in which the mark withdraws. */
  readonly shrinkMs: number;
  /** Peak density; 1 is a full mark. */
  readonly amount?: number;
  /** Blood colour 0xRRGGBB; absent for the default red. */
  readonly color?: number;
}

/** Floats per vertex; the shader's attribute layout (see `bloodFieldShaders.ts`). */
export const BLOOD_FIELD_WORDS = 20;
export const BLOOD_FIELD_VERTICES = 6;
const BLOCK = BLOOD_FIELD_WORDS * BLOOD_FIELD_VERTICES;
const CORNERS = [-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1];

/** Word offsets inside one vertex. */
const W = {
  x: 0, y: 1, angle: 2, kind: 3,
  r0: 4, r1: 5, aux: 6, seed: 7,
  born: 8, feed: 9, spread: 10, end: 11,
  channel: 12, amount: 13, shrink: 14, fresh: 15,
  cornerX: 16, cornerY: 17, colorRG: 18, colorB: 19,
} as const;

export interface BloodPoolFeed {
  readonly x: number;
  readonly y: number;
  /** Blood area in px²; a lone pool settles at radius sqrt(area). */
  readonly area: number;
  readonly channel: BloodChannel;
  readonly atMs: number;
  readonly spreadMs: number;
  readonly lifeMs: number;
  readonly maxLifeMs: number;
  readonly shrinkMs: number;
  readonly maxRadiusPx: number;
  /** Feeds within this share of a pool's radius grow it; further out a merging satellite buds. */
  readonly growCore: number;
  readonly mergeMarginPx: number;
  readonly seed: number;
  /** Blood colour 0xRRGGBB; absent for the default red. Only pools of the same colour merge. */
  readonly color?: number;
}

export interface BloodPoolFeedResult {
  readonly slot: number;
  /** True when an existing pool grew instead of a new one appearing. */
  readonly grew: boolean;
  readonly radius: number;
}

export interface BloodFieldBounds { minX: number; minY: number; maxX: number; maxY: number; count: number }

const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;


/** Pools are found through a coarse grid; a pool never moves, so its cell is fixed. */
const POOL_CELL_PX = 32;
const cellKey = (x: number, y: number): number =>
  ((Math.floor(x / POOL_CELL_PX) & 0xffff) << 16) | (Math.floor(y / POOL_CELL_PX) & 0xffff);
/** A pool fed this recently keeps its place under budget pressure: it is visibly alive. */
const FED_GRACE_MS = 2_000;

export class BloodFieldModel {
  /** Six vertices per mark, written for the accumulation batch. Freed slots hold an expired mark. */
  readonly data: Float32Array;
  private readonly area: Float32Array;
  private readonly lastSeepMs: Float64Array;
  private readonly forcedFade: Uint8Array;
  private readonly alive: Uint8Array;
  private readonly generation: Uint32Array;
  /** Free slots (LIFO); slots below `highWater` that hold no mark. */
  private readonly free: Int32Array;
  private freeTop = 0;
  private highWater = 0;
  /** Insertion order (slot, generation) for budget pressure; stale entries are skipped. */
  private readonly order: Int32Array;
  private readonly orderGen: Uint32Array;
  private orderHead = 0;
  private orderTail = 0;
  /** Slots whose vertex data changed since the batch last uploaded. */
  private readonly dirtyFlag: Uint8Array;
  private readonly dirtyList: Int32Array;
  private dirtyCount = 0;
  private dirtyAll = true;
  private readonly pools = new Map<number, number[]>();
  private live = 0;
  private tinted = 0;
  private revision = 0;
  private epoch: number;
  private readonly channelBounds: BloodFieldBounds[] = Array.from({ length: 3 },
    () => ({ minX: 0, minY: 0, maxX: 0, maxY: 0, count: 0 }));

  constructor(readonly capacity: number, epochMs = 0) {
    this.data = new Float32Array(capacity * BLOCK);
    this.area = new Float32Array(capacity);
    this.lastSeepMs = new Float64Array(capacity);
    this.forcedFade = new Uint8Array(capacity);
    this.alive = new Uint8Array(capacity);
    this.generation = new Uint32Array(capacity);
    this.free = new Int32Array(capacity);
    this.order = new Int32Array(Math.max(1, capacity * 2));
    this.orderGen = new Uint32Array(Math.max(1, capacity * 2));
    this.dirtyFlag = new Uint8Array(capacity);
    this.dirtyList = new Int32Array(capacity);
    this.epoch = epochMs;
  }

  get count(): number { return this.live; }
  /** Slots the batch draws: every live mark lies below it, freed slots in between draw nothing. */
  get drawCount(): number { return this.highWater; }
  /** Marks with their own blood colour; zero keeps the colour pass off. */
  get tintedCount(): number { return this.tinted; }
  /** Changes whenever the vertex data changes. */
  get version(): number { return this.revision; }
  get epochMs(): number { return this.epoch; }
  /** Shader clock: seconds since the epoch. */
  seconds(ms: number): number { return (ms - this.epoch) / 1000; }

  /**
   * Hands the changed slots to the uploader and forgets them. `all` asks for the whole draw range
   * (after a clear or when most slots changed); otherwise `slots[0..count)` lists the changed ones.
   */
  takeDirty(): { readonly all: boolean; readonly slots: Int32Array; readonly count: number } {
    const all = this.dirtyAll || this.dirtyCount > this.highWater / 4;
    const result = { all, slots: this.dirtyList, count: all ? 0 : this.dirtyCount };
    for (let index = 0; index < this.dirtyCount; index++) this.dirtyFlag[this.dirtyList[index]] = 0;
    this.dirtyCount = 0;
    this.dirtyAll = false;
    return result;
  }

  /** Drops every mark; the epoch restarts so shader times stay small. */
  clear(epochMs = this.epoch): void {
    this.alive.fill(0);
    this.live = 0;
    this.tinted = 0;
    this.highWater = 0;
    this.freeTop = 0;
    this.orderHead = this.orderTail = 0;
    this.pools.clear();
    for (let index = 0; index < this.dirtyCount; index++) this.dirtyFlag[this.dirtyList[index]] = 0;
    this.dirtyCount = 0;
    this.dirtyAll = true;
    this.epoch = epochMs;
    for (const bounds of this.channelBounds) bounds.count = 0;
    this.revision++;
  }

  /** Adds a mark; at full capacity the oldest mark gives way. Returns its slot. */
  add(mark: BloodMarkInput): number {
    if (this.capacity <= 0) return -1;
    if (this.live >= this.capacity) {
      const victim = this.oldest(Infinity, false);
      this.remove(victim >= 0 ? victim : this.earliestEnd());
    }
    const slot = this.freeTop > 0 ? this.free[--this.freeTop] : this.highWater++;
    this.alive[slot] = 1;
    this.generation[slot]++;
    this.live++;
    this.write(slot, mark);
    if (mark.color !== undefined) this.tinted++;
    this.area[slot] = mark.kind === BloodMarkKind.Pool ? mark.r1 * mark.r1 : 0;
    this.lastSeepMs[slot] = -Infinity;
    this.forcedFade[slot] = 0;
    if (mark.kind === BloodMarkKind.Pool) {
      const key = cellKey(mark.x, mark.y);
      const cell = this.pools.get(key);
      if (cell) cell.push(slot); else this.pools.set(key, [slot]);
    }
    this.enqueue(slot);
    this.touch(slot);
    return slot;
  }

  /**
   * Pours blood onto a receiver. Near an existing pool of the same receiver the pool grows and
   * stays fresh; otherwise a new pool spreads from a small blob. Satellites close to a pool merge
   * with it in the accumulation, so the visible result is always one growing pool.
   */
  feedPool(feed: BloodPoolFeed): BloodPoolFeedResult {
    let grow = -1, growDistance = Infinity;
    const reach = Math.max(1, Math.ceil(feed.maxRadiusPx * feed.growCore / POOL_CELL_PX));
    const cx = Math.floor(feed.x / POOL_CELL_PX), cy = Math.floor(feed.y / POOL_CELL_PX);
    for (let gy = cy - reach; gy <= cy + reach; gy++) for (let gx = cx - reach; gx <= cx + reach; gx++) {
      const cell = this.pools.get(((gx & 0xffff) << 16) | (gy & 0xffff));
      if (!cell) continue;
      for (const slot of cell) {
        if (this.word(slot, W.channel) !== feed.channel || this.forcedFade[slot]) continue;
        if (!this.sameColor(slot, feed.color)) continue;
        const endMs = this.ms(this.word(slot, W.end)), shrinkMs = this.word(slot, W.shrink) * 1000;
        if (feed.atMs >= endMs - shrinkMs) continue;
        const radius = this.radiusAt(slot, feed.atMs);
        const distance = Math.hypot(this.word(slot, W.x) - feed.x, this.word(slot, W.y) - feed.y);
        if (distance <= radius * feed.growCore && distance < growDistance) { grow = slot; growDistance = distance; }
      }
    }
    if (grow >= 0) {
      const area = this.area[grow] + feed.area;
      this.area[grow] = area;
      const radius = Math.min(feed.maxRadiusPx, Math.sqrt(area));
      const start = this.radiusAt(grow, feed.atMs);
      const feedSec = this.seconds(feed.atMs);
      const endMs = Math.min(feed.atMs + feed.maxLifeMs, Math.max(this.ms(this.word(grow, W.end)), feed.atMs + feed.lifeMs));
      this.set(grow, W.r0, start);
      this.set(grow, W.r1, Math.max(start, radius));
      this.set(grow, W.feed, feedSec);
      this.set(grow, W.spread, Math.max(0.001, feed.spreadMs / 1000));
      this.set(grow, W.end, this.seconds(endMs));
      this.set(grow, W.fresh, feedSec);
      this.touch(grow);
      return { slot: grow, grew: true, radius: Math.max(start, radius) };
    }
    const radius = Math.min(feed.maxRadiusPx, Math.sqrt(feed.area));
    const slot = this.add({
      kind: BloodMarkKind.Pool, channel: feed.channel, x: feed.x, y: feed.y, angle: 0,
      r0: radius * 0.35, r1: radius, seed: feed.seed, bornAtMs: feed.atMs, spreadMs: feed.spreadMs,
      endAtMs: feed.atMs + feed.lifeMs, shrinkMs: feed.shrinkMs, color: feed.color,
    });
    if (slot >= 0) this.area[slot] = feed.area;
    return { slot, grew: false, radius };
  }

  /** Displayed pool/cloud radius at a time, following the shader's spread curve. */
  radiusAt(slot: number, atMs: number): number {
    const r0 = this.word(slot, W.r0), r1 = this.word(slot, W.r1);
    const spread = Math.max(0.001, this.word(slot, W.spread));
    const t = Math.max(0, Math.min(1, (this.seconds(atMs) - this.word(slot, W.feed)) / spread));
    return r0 + (r1 - r0) * easeOutCubic(t);
  }

  /** Rate limit for seeping into nearby water, per pool. */
  claimSeep(slot: number, atMs: number, intervalMs: number): boolean {
    if (slot < 0 || slot >= this.highWater || !this.alive[slot] || atMs - this.lastSeepMs[slot] < intervalMs) return false;
    this.lastSeepMs[slot] = atMs;
    return true;
  }

  /**
   * Removes finished marks and, above `pressure` × budget, lets the oldest marks dry out early
   * (never pops). Refreshes the per-channel bounds used to size the receiver passes.
   */
  update(nowMs: number, budget: number, pressure: number, fastFadeMs: number): void {
    const nowSec = this.seconds(nowMs);
    for (let slot = 0; slot < this.highWater; slot++) {
      if (this.alive[slot] && this.word(slot, W.end) <= nowSec) this.remove(slot);
    }
    const limit = Math.max(1, Math.floor(Math.min(budget, this.capacity) * pressure));
    let excess = this.live - limit;
    if (excess > 0) for (let slot = 0; slot < this.highWater && excess > 0; slot++) {
      if (this.alive[slot] && this.forcedFade[slot]) excess--;
    }
    const fade = Math.max(0.05, fastFadeMs / 1000);
    while (excess-- > 0) {
      const slot = this.oldest(nowMs, true);
      if (slot < 0) break;
      this.forcedFade[slot] = 1;
      const end = Math.min(this.word(slot, W.end), nowSec + fade);
      this.set(slot, W.end, end);
      this.set(slot, W.shrink, Math.min(fade, Math.max(0.05, end - nowSec)));
      this.touch(slot);
    }
    this.refreshBounds(nowSec);
  }

  /** World bounds of a receiver's marks after the last update; count 0 when it has none. */
  bounds(channel: BloodChannel): Readonly<BloodFieldBounds> { return this.channelBounds[channel]; }

  /** Marks of one kind and receiver, for diagnostics and the review lab. */
  countOf(kind?: BloodMarkKind, channel?: BloodChannel): number {
    let total = 0;
    for (let slot = 0; slot < this.highWater; slot++) {
      if (!this.alive[slot]) continue;
      if (kind !== undefined && this.word(slot, W.kind) !== kind) continue;
      if (channel !== undefined && this.word(slot, W.channel) !== channel) continue;
      total++;
    }
    return total;
  }

  /** Read access for tests and diagnostics; null for a free slot. */
  mark(slot: number): { kind: number; channel: number; x: number; y: number; r0: number; r1: number;
    bornAtMs: number; endAtMs: number; area: number } | null {
    if (slot < 0 || slot >= this.highWater || !this.alive[slot]) return null;
    return { kind: this.word(slot, W.kind), channel: this.word(slot, W.channel), x: this.word(slot, W.x),
      y: this.word(slot, W.y), r0: this.word(slot, W.r0), r1: this.word(slot, W.r1),
      bornAtMs: this.ms(this.word(slot, W.born)), endAtMs: this.ms(this.word(slot, W.end)), area: this.area[slot] };
  }

  private refreshBounds(nowSec: number): void {
    for (const bounds of this.channelBounds) {
      bounds.count = 0; bounds.minX = bounds.minY = Infinity; bounds.maxX = bounds.maxY = -Infinity;
    }
    for (let slot = 0; slot < this.highWater; slot++) {
      // Marks still in flight already count: the pass must exist when they land.
      if (!this.alive[slot] || this.word(slot, W.born) > nowSec + 2) continue;
      const bounds = this.channelBounds[this.word(slot, W.channel)];
      const x = this.word(slot, W.x), y = this.word(slot, W.y), reach = this.reach(slot);
      bounds.minX = Math.min(bounds.minX, x - reach); bounds.maxX = Math.max(bounds.maxX, x + reach);
      bounds.minY = Math.min(bounds.minY, y - reach); bounds.maxY = Math.max(bounds.maxY, y + reach);
      bounds.count++;
    }
  }

  /** Conservative world radius a mark can cover, matching the shader's quad extents. */
  private reach(slot: number): number {
    const kind = this.word(slot, W.kind), r0 = this.word(slot, W.r0), r1 = Math.max(r0, this.word(slot, W.r1));
    if (kind === BloodMarkKind.Splat || kind === BloodMarkKind.Drip) return r1 * 1.3 + r0 * 3 + 2;
    return r1 * 2.4 + 2;
  }

  private earliestEnd(): number {
    let best = -1, end = Infinity;
    for (let slot = 0; slot < this.highWater; slot++) {
      if (!this.alive[slot]) continue;
      const value = this.word(slot, W.end);
      if (value < end) { end = value; best = slot; }
    }
    return best;
  }

  private enqueue(slot: number): void {
    const size = this.order.length;
    if ((this.orderTail + 1) % size === this.orderHead) this.compactOrder();
    this.order[this.orderTail] = slot;
    this.orderGen[this.orderTail] = this.generation[slot];
    this.orderTail = (this.orderTail + 1) % size;
  }

  /** Drops stale entries; the queue then holds at most the live marks. */
  private compactOrder(): void {
    const size = this.order.length;
    let write = this.orderHead;
    for (let read = this.orderHead; read !== this.orderTail; read = (read + 1) % size) {
      const slot = this.order[read];
      if (!this.alive[slot] || this.orderGen[read] !== this.generation[slot]) continue;
      this.order[write] = slot; this.orderGen[write] = this.orderGen[read];
      write = (write + 1) % size;
    }
    this.orderTail = write;
  }

  /**
   * Oldest live mark by insertion, skipping marks already drying early and, for pressure, pools
   * fed within the grace period (they move to the back). -1 when none qualifies.
   */
  private oldest(nowMs: number, spareFed: boolean): number {
    const size = this.order.length;
    let guard = this.live + 1;
    while (this.orderHead !== this.orderTail && guard-- > 0) {
      const slot = this.order[this.orderHead], gen = this.orderGen[this.orderHead];
      this.orderHead = (this.orderHead + 1) % size;
      if (!this.alive[slot] || gen !== this.generation[slot] || this.forcedFade[slot]) continue;
      // A pool that kept being fed is visibly in use: it goes to the back of the queue instead.
      const fedAgain = this.word(slot, W.kind) === BloodMarkKind.Pool && this.word(slot, W.feed) > this.word(slot, W.born) + 0.001;
      if (spareFed && fedAgain && nowMs - this.ms(this.word(slot, W.feed)) < FED_GRACE_MS) {
        this.order[this.orderTail] = slot; this.orderGen[this.orderTail] = gen;
        this.orderTail = (this.orderTail + 1) % size;
        continue;
      }
      return slot;
    }
    return -1;
  }

  /** Frees a slot: its quad collapses (ended in the past) and it returns to the free list. */
  private remove(slot: number): void {
    if (slot < 0 || !this.alive[slot]) return;
    if (this.word(slot, W.colorB) !== 0) this.tinted--;
    if (this.word(slot, W.kind) === BloodMarkKind.Pool) {
      const key = cellKey(this.word(slot, W.x), this.word(slot, W.y));
      const cell = this.pools.get(key);
      const index = cell ? cell.indexOf(slot) : -1;
      if (cell && index >= 0) { cell.splice(index, 1); if (!cell.length) this.pools.delete(key); }
    }
    this.alive[slot] = 0;
    this.live--;
    this.set(slot, W.born, -1e6);
    this.set(slot, W.end, -1e6);
    this.touch(slot);
    if (slot === this.highWater - 1) {
      // Trim trailing free slots so the draw range stays tight.
      this.highWater--;
      while (this.highWater > 0 && !this.alive[this.highWater - 1]) this.highWater--;
      let keep = 0;
      for (let index = 0; index < this.freeTop; index++) if (this.free[index] < this.highWater) this.free[keep++] = this.free[index];
      this.freeTop = keep;
    } else {
      this.free[this.freeTop++] = slot;
    }
  }

  private touch(slot: number): void {
    this.revision++;
    if (this.dirtyAll || this.dirtyFlag[slot]) return;
    this.dirtyFlag[slot] = 1;
    this.dirtyList[this.dirtyCount++] = slot;
  }

  private write(slot: number, mark: BloodMarkInput): void {
    const born = this.seconds(mark.bornAtMs);
    let offset = slot * BLOCK;
    for (let vertex = 0; vertex < BLOOD_FIELD_VERTICES; vertex++) {
      const d = this.data;
      d[offset + W.x] = mark.x; d[offset + W.y] = mark.y; d[offset + W.angle] = mark.angle; d[offset + W.kind] = mark.kind;
      d[offset + W.r0] = mark.r0; d[offset + W.r1] = mark.r1; d[offset + W.aux] = mark.aux ?? 0; d[offset + W.seed] = mark.seed;
      d[offset + W.born] = born; d[offset + W.feed] = born; d[offset + W.spread] = Math.max(0.001, mark.spreadMs / 1000);
      d[offset + W.end] = this.seconds(mark.endAtMs);
      d[offset + W.channel] = mark.channel; d[offset + W.amount] = mark.amount ?? 1;
      d[offset + W.shrink] = Math.max(0.05, mark.shrinkMs / 1000); d[offset + W.fresh] = born;
      d[offset + W.cornerX] = CORNERS[vertex * 2]; d[offset + W.cornerY] = CORNERS[vertex * 2 + 1];
      // Two exact float words: R * 256 + G, and B + 1 (0 = the default red).
      d[offset + W.colorRG] = mark.color === undefined ? 0 : ((mark.color >> 16) & 255) * 256 + ((mark.color >> 8) & 255);
      d[offset + W.colorB] = mark.color === undefined ? 0 : (mark.color & 255) + 1;
      offset += BLOOD_FIELD_WORDS;
    }
  }

  private word(slot: number, word: number): number { return this.data[slot * BLOCK + word]; }
  private sameColor(slot: number, color: number | undefined): boolean {
    if (color === undefined) return this.word(slot, W.colorB) === 0;
    return this.word(slot, W.colorB) === (color & 255) + 1
      && this.word(slot, W.colorRG) === ((color >> 16) & 255) * 256 + ((color >> 8) & 255);
  }
  private set(slot: number, word: number, value: number): void {
    let offset = slot * BLOCK + word;
    for (let vertex = 0; vertex < BLOOD_FIELD_VERTICES; vertex++, offset += BLOOD_FIELD_WORDS) this.data[offset] = value;
  }
  private ms(seconds: number): number { return this.epoch + seconds * 1000; }
}
