import { NET_TICK_RATE_HZ } from '../config';
import { GroundFireChangeJournal, resolveGroundFireChanges } from '../effects/GroundFireChanges';
import type { SyncedBurningGroundCell, SyncedBurningGroundSnapshot } from '../types';
import {
  decodeBurningGroundCells,
  decodeGroundWarnings,
  encodeBurningGroundCells,
  encodeGroundWarnings,
  groupGroundWarnings,
  sameBurningGroundWireCell,
  toBurningGroundWireCell,
  type BurningGroundWireCell,
  type GroundWarning,
  type GroundWarningEntry,
} from './burningGroundSnapshotCodec';

/**
 * Game-state slice `fg`. Cells travel as a full blob (`f`) or as a delta (`d`) keyed by style and
 * raster cell; warnings likewise as the complete band (`w`) or the changed cells (`wd`). Every
 * NET_TICK_RATE_HZ-th publication on the fast channel is complete and repairs lost deltas.
 */
export interface EncodedBurningGroundSlice {
  f?: string;
  d?: string;
  w?: string;
  wd?: string;
}

type GroundCells = readonly SyncedBurningGroundCell[];
/** Replicated snapshots expose mutable arrays; the receiver never mutates a published one. */
type MutableCells = SyncedBurningGroundCell[];
type GroundWarnings = readonly GroundWarning[];

/**
 * The host recomputes a warning's activation from two clocks every frame, so it jitters by a few
 * milliseconds. Within one 60 Hz frame of what a client already shows, it is not resent; the
 * periodic complete band carries exact values again.
 */
const WARNING_RESEND_TOLERANCE_MS = 16;
const NO_WARNINGS: GroundWarnings = [];

interface CellChanges {
  readonly upserts: Map<number, BurningGroundWireCell>;
  readonly removals: Set<number>;
}

/** Wire form of a published host cell; the host id tells a re-ignition from a refresh. */
interface PublishedCell extends BurningGroundWireCell {
  readonly hostId: number;
}

/** Host side: what clients hold after the last publication, and the next slice for them. */
export class BurningGroundPublisher {
  private ticks = 0;
  private lastCells: GroundCells | null = null;
  /** What clients hold, by wire key. */
  private readonly published = new Map<number, PublishedCell>();
  /** FireSystem keeps unchanged cell objects across snapshots; their wire form is reused. */
  private readonly wireCells = new WeakMap<SyncedBurningGroundCell, PublishedCell | null>();
  private revision = 0;
  private fullCells: { revision: number; encoded: string } | null = null;
  private lastWarnings: GroundWarnings | null = null;
  private readonly publishedWarnings = new Map<number, GroundWarnings>();

  constructor(private readonly now: () => number) {}

  reset(): void {
    this.ticks = 0;
    this.lastCells = null;
    this.published.clear();
    this.revision++;
    this.fullCells = null;
    this.lastWarnings = null;
    this.publishedWarnings.clear();
  }

  /** The slice of one fast-channel tick, or null when clients already hold this state. */
  publish(snapshot: SyncedBurningGroundSnapshot): EncodedBurningGroundSlice | null {
    this.ticks++;
    const changes = this.collectCellChanges(snapshot.cells);
    if (this.ticks === 1 || this.ticks % NET_TICK_RATE_HZ === 0) return this.complete(snapshot);
    const warnings = this.collectWarningChanges(snapshot.warnings ?? NO_WARNINGS);
    if (!changes && warnings === null) return null;
    return {
      ...(changes ? { d: encodeBurningGroundCells([...changes.upserts.values()], changes.removals) } : {}),
      ...(warnings !== null ? { wd: warnings } : {}),
    };
  }

  /** Complete slice for a bootstrap payload; it also counts as this tick's publication. */
  publishComplete(snapshot: SyncedBurningGroundSnapshot): EncodedBurningGroundSlice {
    this.ticks++;
    this.collectCellChanges(snapshot.cells);
    return this.complete(snapshot);
  }

  private complete(snapshot: SyncedBurningGroundSnapshot): EncodedBurningGroundSlice {
    if (this.fullCells?.revision !== this.revision) {
      this.fullCells = { revision: this.revision, encoded: encodeBurningGroundCells([...this.published.values()]) };
    }
    const warnings = snapshot.warnings ?? NO_WARNINGS;
    const groups = groupGroundWarnings(warnings);
    this.lastWarnings = warnings;
    this.publishedWarnings.clear();
    const entries: GroundWarningEntry[] = [];
    for (const [key, group] of groups) {
      this.publishedWarnings.set(key, group);
      entries.push({ key, warnings: group });
    }
    return { f: this.fullCells.encoded, w: encodeGroundWarnings(entries) };
  }

  private wireCell(cell: SyncedBurningGroundCell): PublishedCell | null {
    let wire = this.wireCells.get(cell);
    if (wire === undefined) {
      const normalized = toBurningGroundWireCell(cell);
      wire = normalized && { ...normalized, hostId: cell.id };
      this.wireCells.set(cell, wire);
    }
    return wire;
  }

  /** Applies the host's journaled changes, or compares whole arrays when the chain is unknown. */
  private collectCellChanges(cells: GroundCells): CellChanges | null {
    if (cells === this.lastCells) return null;
    const steps = resolveGroundFireChanges(cells, this.lastCells);
    this.lastCells = cells;
    const changes: CellChanges = { upserts: new Map(), removals: new Set() };
    if (steps) {
      for (const step of steps) {
        for (const cell of step.removed) this.removeCell(cell, changes);
        for (const cell of step.upserts) this.upsertCell(cell, changes);
      }
    } else {
      const present = new Set<number>();
      for (const cell of cells) {
        const key = this.upsertCell(cell, changes);
        if (key !== null) present.add(key);
      }
      for (const key of this.published.keys()) {
        if (present.has(key)) continue;
        this.published.delete(key);
        changes.upserts.delete(key);
        changes.removals.add(key);
      }
    }
    if (changes.upserts.size === 0 && changes.removals.size === 0) return null;
    this.revision++;
    return changes;
  }

  private removeCell(cell: SyncedBurningGroundCell, changes: CellChanges): void {
    const wire = this.wireCell(cell);
    // A stale removal must not take down a newer visual at the same key.
    if (!wire || this.published.get(wire.key)?.hostId !== wire.hostId) return;
    this.published.delete(wire.key);
    changes.upserts.delete(wire.key);
    changes.removals.add(wire.key);
  }

  private upsertCell(cell: SyncedBurningGroundCell, changes: CellChanges): number | null {
    const wire = this.wireCell(cell);
    if (!wire) return null;
    const previous = this.published.get(wire.key);
    if (previous === wire) return wire.key;
    this.published.set(wire.key, wire);
    if (previous && previous.hostId !== wire.hostId) {
      // A new visual replaced the old one at this key: clients replay removal and ignition.
      changes.removals.add(wire.key);
    } else if (previous && sameBurningGroundWireCell(previous, wire)) return wire.key;
    changes.upserts.set(wire.key, wire);
    return wire.key;
  }

  /**
   * Warning cells that appeared, were withdrawn or moved beyond the tolerance. Activated warnings
   * leave on the client by their own time, exactly as the complete band would drop them.
   */
  private collectWarningChanges(warnings: GroundWarnings): string | null {
    if (warnings === this.lastWarnings) return null;
    this.lastWarnings = warnings;
    const now = this.now();
    const current = groupGroundWarnings(warnings);
    const changed: GroundWarningEntry[] = [];
    for (const [key, group] of current) {
      if (sameLiveWarningTimes(this.publishedWarnings.get(key) ?? NO_WARNINGS, group, now)) continue;
      this.publishedWarnings.set(key, group);
      changed.push({ key, warnings: group });
    }
    for (const [key, previous] of this.publishedWarnings) {
      if (current.has(key)) continue;
      this.publishedWarnings.delete(key);
      if (previous.some(warning => warning.activatesAt > now)) changed.push({ key, warnings: NO_WARNINGS });
    }
    return changed.length > 0 ? encodeGroundWarnings(changed) : null;
  }
}

/** Both sorted lists name the same pending activations within the resend tolerance. */
function sameLiveWarningTimes(published: GroundWarnings, current: GroundWarnings, now: number): boolean {
  let left = 0, right = 0;
  for (;;) {
    while (left < published.length && published[left].activatesAt <= now) left++;
    while (right < current.length && current[right].activatesAt <= now) right++;
    if (left === published.length || right === current.length) return left === published.length && right === current.length;
    if (Math.abs(published[left].activatesAt - current[right].activatesAt) > WARNING_RESEND_TOLERANCE_MS) return false;
    left++;
    right++;
  }
}

/** Id-keyed view of the last merged cells; any other array (full snapshot, reset) is re-read once. */
interface ClientGroundCells {
  source: MutableCells;
  readonly cells: Map<number, SyncedBurningGroundCell>;
  earliestExpiry: number;
}

interface ClientGroundWarnings {
  source: GroundWarning[] | undefined;
  readonly byKey: Map<number, GroundWarnings>;
  earliest: number;
}

function readSlice(raw: unknown): EncodedBurningGroundSlice {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const value = raw as Record<string, unknown>;
  const text = (field: unknown) => typeof field === 'string' ? field : undefined;
  return { f: text(value.f), d: text(value.d), w: text(value.w), wd: text(value.wd) };
}

function decodeOrNull<T>(decode: (encoded: unknown) => T, encoded: string | undefined): T | null {
  if (encoded === undefined) return null;
  try { return decode(encoded); } catch { return null; }
}

/**
 * Client side: merges `fg` slices into the replicated snapshot. Unchanged geometry keeps its array
 * and an unchanged state its snapshot object, so per-change consumers stay idle. Malformed blobs
 * are ignored; the next complete slice repairs the state.
 */
export class BurningGroundReceiver {
  private readonly journal = new GroundFireChangeJournal();
  private view: ClientGroundCells | null = null;
  private lastFull: { encoded: string; cells: MutableCells; earliestExpiry: number } | null = null;
  private warnings: ClientGroundWarnings | null = null;

  reset(): void {
    this.view = null;
    this.lastFull = null;
    this.warnings = null;
  }

  merge(raw: unknown, previous: SyncedBurningGroundSnapshot, now: number): SyncedBurningGroundSnapshot {
    const slice = readSlice(raw);
    const cells = slice.f !== undefined
      ? this.applyFull(slice.f, previous.cells, now)
      : this.applyDelta(slice.d, previous.cells, now);
    const warnings = this.mergeWarnings(slice, previous.warnings, now);
    return cells === previous.cells && warnings === previous.warnings ? previous : { cells, warnings };
  }

  private applyFull(encoded: string, previous: MutableCells, now: number): MutableCells {
    const last = this.lastFull;
    if (last && last.encoded === encoded && last.cells === previous && now < last.earliestExpiry) return previous;
    const decoded = decodeOrNull(decodeBurningGroundCells, encoded);
    if (!decoded) return previous;
    const live = decoded.upserts.filter(cell => cell.expiresAt > now);
    const cells = this.holdsExactly(previous, live, now) ? previous : live;
    let earliestExpiry = Number.POSITIVE_INFINITY;
    for (const cell of cells) earliestExpiry = Math.min(earliestExpiry, cell.expiresAt);
    this.lastFull = { encoded, cells, earliestExpiry };
    return cells;
  }

  /** True when `previous` consists of exactly the live decoded cells. */
  private holdsExactly(previous: MutableCells, live: readonly SyncedBurningGroundCell[], now: number): boolean {
    if (previous.length !== live.length) return false;
    const view = this.viewOf(previous);
    if (view.cells.size !== previous.length || now >= view.earliestExpiry) return false;
    for (const cell of live) {
      const held = view.cells.get(cell.id);
      if (!held || held.expiresAt !== cell.expiresAt || held.intensity !== cell.intensity
        || held.gridX !== cell.gridX || held.gridY !== cell.gridY || held.visualStyle !== cell.visualStyle) return false;
    }
    return true;
  }

  private applyDelta(encoded: string | undefined, previous: MutableCells, now: number): MutableCells {
    const decoded = decodeOrNull(decodeBurningGroundCells, encoded);
    const view = this.viewOf(previous);
    if (!decoded?.removals.length && !decoded?.upserts.length && now < view.earliestExpiry) return previous;
    // Mutate the live cells in place and publish what changed, so the ground renderer applies a
    // few cells per tick instead of re-resolving a permanent surface of thousands.
    const cells = view.cells;
    const removed: SyncedBurningGroundCell[] = [];
    const upserts: SyncedBurningGroundCell[] = [];
    if (now >= view.earliestExpiry) {
      view.earliestExpiry = Number.POSITIVE_INFINITY;
      for (const [id, cell] of cells) {
        if (cell.expiresAt > now) view.earliestExpiry = Math.min(view.earliestExpiry, cell.expiresAt);
        else { cells.delete(id); removed.push(cell); }
      }
    }
    // Removals first: a removal and an upsert of the same key replay a re-ignition.
    for (const key of decoded?.removals ?? []) {
      const cell = cells.get(key);
      if (cell && cells.delete(key)) removed.push(cell);
    }
    for (const cell of decoded?.upserts ?? []) {
      if (cell.expiresAt <= now) continue;
      view.earliestExpiry = Math.min(view.earliestExpiry, cell.expiresAt);
      cells.set(cell.id, cell);
      upserts.push(cell);
    }
    if (removed.length === 0 && upserts.length === 0) return previous;
    const next = [...cells.values()];
    view.source = next;
    this.journal.record(next, { base: previous, removed, upserts });
    return next;
  }

  private viewOf(source: MutableCells): ClientGroundCells {
    if (this.view?.source === source) return this.view;
    const view: ClientGroundCells = { source, cells: new Map(), earliestExpiry: Number.POSITIVE_INFINITY };
    for (const cell of source) {
      view.earliestExpiry = Math.min(view.earliestExpiry, cell.expiresAt);
      view.cells.set(cell.id, cell);
    }
    return this.view = view;
  }

  private mergeWarnings(slice: EncodedBurningGroundSlice, previous: GroundWarning[] | undefined, now: number): GroundWarning[] {
    let state = this.warnings;
    if (!state || state.source !== previous) {
      state = this.warnings = { source: previous, byKey: groupGroundWarnings(previous ?? NO_WARNINGS),
        earliest: Number.NEGATIVE_INFINITY };
    }
    let changed = false;
    const complete = decodeOrNull(decodeGroundWarnings, slice.w);
    if (complete) {
      state.byKey.clear();
      for (const entry of complete) if (entry.warnings.length > 0) state.byKey.set(entry.key, entry.warnings);
      changed = true;
    }
    for (const entry of decodeOrNull(decodeGroundWarnings, slice.wd) ?? []) {
      if (entry.warnings.length > 0) state.byKey.set(entry.key, entry.warnings);
      else state.byKey.delete(entry.key);
      changed = true;
    }
    if (!changed && previous && now < state.earliest) return previous;
    const next: GroundWarning[] = [];
    let earliest = Number.POSITIVE_INFINITY;
    for (const [key, group] of state.byKey) {
      let live = group;
      if (group.some(warning => warning.activatesAt <= now)) {
        live = group.filter(warning => warning.activatesAt > now);
        if (live.length > 0) state.byKey.set(key, live);
        else state.byKey.delete(key);
      }
      for (const warning of live) {
        next.push(warning);
        earliest = Math.min(earliest, warning.activatesAt);
      }
    }
    state.source = next;
    state.earliest = earliest;
    return next;
  }
}
