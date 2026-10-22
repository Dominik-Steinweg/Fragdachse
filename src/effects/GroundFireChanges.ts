import type { SyncedBurningGroundCell } from '../types';

type GroundCells = readonly SyncedBurningGroundCell[];

/**
 * Host-local difference between two published ground-fire cell arrays. It never travels on the
 * wire: consumers that saw `base` can apply it instead of rescanning a surface of thousands of
 * cells, and anything else falls back to comparing whole arrays.
 */
export interface GroundFireCellChanges {
  readonly base: GroundCells;
  /** Published cell objects that left the snapshot. */
  readonly removed: readonly SyncedBurningGroundCell[];
  /** New or replaced cell objects; unchanged cells keep their identity and are not listed. */
  readonly upserts: readonly SyncedBurningGroundCell[];
}

/** A few steps cover publishes a consumer missed between two of its own reads. */
const MAX_CHAIN = 8;
const changesByCells = new WeakMap<GroundCells, GroundFireCellChanges>();

/** Records the changes that produced each published array; only the latest steps are kept. */
export class GroundFireChangeJournal {
  private readonly recent: GroundCells[] = [];

  record(cells: GroundCells, changes: GroundFireCellChanges): void {
    changesByCells.set(cells, changes);
    this.recent.push(cells);
    if (this.recent.length > MAX_CHAIN) changesByCells.delete(this.recent.shift()!);
  }

  /** A full republish starts a new chain; older arrays can no longer be reached incrementally. */
  reset(): void {
    for (const cells of this.recent) changesByCells.delete(cells);
    this.recent.length = 0;
  }
}

/**
 * Changes from `known` to `current` in publish order, or null when the consumer must compare the
 * arrays itself (unknown origin, missed full republish or a gap longer than the journal).
 */
export function resolveGroundFireChanges(current: GroundCells, known: GroundCells | null): GroundFireCellChanges[] | null {
  if (!known) return null;
  const chain: GroundFireCellChanges[] = [];
  for (let cells = current; cells !== known;) {
    const changes = changesByCells.get(cells);
    if (!changes || chain.length >= MAX_CHAIN) return null;
    chain.push(changes);
    cells = changes.base;
  }
  return chain.reverse();
}
