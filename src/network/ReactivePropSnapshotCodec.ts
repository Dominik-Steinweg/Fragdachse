/**
 * Drahtformat der reaktiven Map-Objekte (Slice `rp`).
 *
 * `[full, index, code, progress, index, code, progress, …]`: `full` ist 1 für einen
 * vollständigen Stand (nicht genannte Objekte sind idle mit vollem Fortschritt) und 0 für ein
 * Delta. `index` ist die Position im Layout, `code` die Phase (0 idle, 1 primed, 2 triggered,
 * 3 recharging, 4 destroyed), `progress` ein Byte 0..255.
 */
export interface ReactivePropNetSnapshot {
  readonly full: boolean;
  /** Flache Tripel `[index, code, progress]`. */
  readonly entries: readonly number[];
}

export const REACTIVE_PROP_MAX_INDEX = 4095;
const MAX_CODE = 4;
const DEFAULT_CODE = 0;
const DEFAULT_PROGRESS = 255;

export function encodeReactivePropSnapshot(snapshot: ReactivePropNetSnapshot): number[] {
  return [snapshot.full ? 1 : 0, ...snapshot.entries];
}

export function decodeReactivePropSnapshot(raw: unknown): ReactivePropNetSnapshot | null {
  if (!Array.isArray(raw) || raw.length === 0 || (raw.length - 1) % 3 !== 0) return null;
  const flag = raw[0];
  if (flag !== 0 && flag !== 1) return null;
  const entries: number[] = [];
  for (let i = 1; i < raw.length; i += 3) {
    const index = raw[i], code = raw[i + 1], progress = raw[i + 2];
    if (!Number.isInteger(index) || index < 0 || index > REACTIVE_PROP_MAX_INDEX) return null;
    if (!Number.isInteger(code) || code < 0 || code > MAX_CODE) return null;
    if (!Number.isInteger(progress) || progress < 0 || progress > DEFAULT_PROGRESS) return null;
    entries.push(index, code, progress);
  }
  return { full: flag === 1, entries };
}

/** Führt ein Delta bzw. einen Vollstand mit dem bisherigen Stand zusammen (nur Nicht-Defaults). */
export function mergeReactivePropSnapshot(snapshot: ReactivePropNetSnapshot | null, previous: readonly number[]): readonly number[] {
  if (!snapshot) return previous;
  const next = new Map<number, readonly [number, number]>();
  if (!snapshot.full) {
    for (let i = 0; i + 2 < previous.length; i += 3) next.set(previous[i], [previous[i + 1], previous[i + 2]]);
  }
  for (let i = 0; i + 2 < snapshot.entries.length; i += 3) {
    const index = snapshot.entries[i];
    const code = snapshot.entries[i + 1];
    const progress = snapshot.entries[i + 2];
    if (code === DEFAULT_CODE && progress === DEFAULT_PROGRESS) next.delete(index);
    else next.set(index, [code, progress]);
  }
  const merged: number[] = [];
  for (const index of [...next.keys()].sort((a, b) => a - b)) merged.push(index, ...next.get(index)!);
  return merged;
}
