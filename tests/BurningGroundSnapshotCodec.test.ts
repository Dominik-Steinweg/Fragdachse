import { describe, expect, it } from 'vitest';
import {
  burningGroundCellKey,
  decodeBurningGroundCells,
  decodeGroundWarnings,
  encodeBurningGroundCells,
  encodeGroundWarnings,
  groupGroundWarnings,
  toBurningGroundWireCell,
  type BurningGroundWireCell,
  type GroundWarning,
} from '../src/network/burningGroundSnapshotCodec';
import { encodeGroundFireVisualStyle } from '../src/network/groundFireVisualStyleCodec';
import type { GroundFireVisualStyle, SyncedBurningGroundCell } from '../src/types';

const PERMANENT = Number.MAX_SAFE_INTEGER;
const epoch = 1_800_000_000_000;
let hostId = 0;
const cell = (gridX: number, gridY: number, expiresAt = PERMANENT, intensity = 1,
  visualStyle: GroundFireVisualStyle = 'void'): SyncedBurningGroundCell => ({ id: ++hostId, gridX, gridY, expiresAt, intensity, visualStyle });
const wire = (cells: SyncedBurningGroundCell[]) => cells.map(entry => toBurningGroundWireCell(entry)!);
/** What a client must reconstruct: host ids are replaced by the spatial wire key. */
const expected = (cells: SyncedBurningGroundCell[]) => wire(cells).map(entry => ({ id: entry.key, gridX: entry.gridX,
  gridY: entry.gridY, expiresAt: entry.expiresAt, intensity: entry.intensity,
  visualStyle: cells.find(source => source.gridX === entry.gridX && source.gridY === entry.gridY
    && encodeGroundFireVisualStyle(source.visualStyle) === entry.style)!.visualStyle }));
const byId = <T extends { id: number }>(cells: T[]) => [...cells].sort((left, right) => left.id - right.id);
const roundTrip = (cells: SyncedBurningGroundCell[], removals: number[] = []) => decodeBurningGroundCells(encodeBurningGroundCells(wire(cells), removals));

function bytesOf(encoded: string): Uint8Array { return Uint8Array.from(atob(encoded), char => char.charCodeAt(0)); }
function base64Of(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)); }

describe('burning ground snapshot codec', () => {
  it('round-trips an empty slice', () => {
    expect(roundTrip([])).toEqual({ upserts: [], removals: [] });
    expect(decodeGroundWarnings(encodeGroundWarnings([]))).toEqual([]);
  });

  it('reconstructs mixed styles, intensities, per-cell expiries and removals exactly', () => {
    const cells = [
      ...Array.from({ length: 30 }, (_, i) => cell(-12 + (i % 10), -3 + Math.floor(i / 10))),
      cell(5, 5, epoch + 1_234), cell(6, 5, epoch + 1_235), cell(7, 5, epoch + 1_235, 3), cell(9, 5, epoch + 900),
      cell(5, 5, epoch + 4_000, 2, 'normal'), cell(5, 5, PERMANENT, 1, 'allied'), cell(400, 290, epoch + 77, 1, 'normal'),
    ];
    const removals = [burningGroundCellKey(1, 3, 3), burningGroundCellKey(1, 4, 3), burningGroundCellKey(0, -20, 300)];
    const decoded = roundTrip(cells, removals);
    expect(byId(decoded.upserts)).toEqual(byId(expected(cells)));
    expect([...decoded.removals].sort((a, b) => a - b)).toEqual([...removals].sort((a, b) => a - b));
    // Different styles at one raster position stay distinct cells.
    expect(new Set(decoded.upserts.map(entry => entry.id)).size).toBe(cells.length);
  });

  it('normalizes host values to whole milliseconds without changing integer-clock expiry', () => {
    const [fractional, overlong, weak] = wire([cell(0, 0, epoch + 10.2), cell(1, 0, Infinity), cell(2, 0, epoch, 0.4)]);
    expect(fractional.expiresAt).toBe(epoch + 11);
    expect(overlong.expiresAt).toBe(PERMANENT);
    expect(weak.intensity).toBe(1);
    expect(toBurningGroundWireCell(cell(2 ** 21, 0))).toBeNull();
  });

  it('costs a few bytes per row for a permanent surface and degrades gracefully when scattered', () => {
    const surface = Array.from({ length: 60 * 92 }, (_, i) => cell(400 + (i % 92), 80 + Math.floor(i / 92)));
    const encoded = encodeBurningGroundCells(wire(surface));
    expect(encoded.length).toBeLessThan(surface.length / 10);
    expect(byId(decodeBurningGroundCells(encoded).upserts)).toEqual(byId(expected(surface)));

    let seed = 7;
    const random = () => (seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31;
    const scattered = Array.from({ length: 400 }, (_, i) => cell(Math.floor(i * 1.31) % 528, (i * 37) % 300,
      epoch + Math.floor(random() * 3_000), 1 + (i % 3), 'normal'));
    const unique = [...new Map(scattered.map(entry => [`${entry.gridX}:${entry.gridY}`, entry])).values()];
    const scatteredEncoded = encodeBurningGroundCells(wire(unique));
    expect(scatteredEncoded.length).toBeLessThan(unique.length * 12);
    expect(byId(decodeBurningGroundCells(scatteredEncoded).upserts)).toEqual(byId(expected(unique)));
  });

  it('keeps every warning of a cell, its style and activation time', () => {
    const warnings: GroundWarning[] = [
      { gridX: 3, gridY: 4, activatesAt: epoch + 2_500 }, { gridX: 3, gridY: 4, activatesAt: epoch + 900 },
      { gridX: 3, gridY: 4, activatesAt: epoch + 1_000, visualStyle: 'normal' },
      { gridX: -7, gridY: 40, activatesAt: epoch + 2_999.2 }, { gridX: 300, gridY: -2, activatesAt: epoch - 5 },
    ];
    const groups = groupGroundWarnings(warnings);
    const cleared = burningGroundCellKey(1, 9, 9);
    const entries = [...groups].map(([key, list]) => ({ key, warnings: list }));
    const decoded = decodeGroundWarnings(encodeGroundWarnings([...entries, { key: cleared, warnings: [] }]));
    const decodedByKey = new Map(decoded.map(entry => [entry.key, entry.warnings]));
    expect(decodedByKey.get(cleared)).toEqual([]);
    for (const [key, list] of groups) {
      expect(decodedByKey.get(key)).toEqual(list.map(warning => ({ ...warning, activatesAt: Math.ceil(warning.activatesAt) })));
    }
    expect(groups.get(burningGroundCellKey(1, 3, 4))!.map(warning => warning.activatesAt)).toEqual([epoch + 900, epoch + 2_500]);
  });

  it('rejects malformed blobs instead of decoding partial state', () => {
    const encoded = encodeBurningGroundCells(wire([cell(1, 1), cell(2, 1, epoch + 50, 2), cell(4, 3, epoch + 60, 1, 'normal')]),
      [burningGroundCellKey(1, 0, 0)]);
    const bytes = bytesOf(encoded);
    for (const malformed of [undefined, 42, [], 'not base64!', '']) expect(() => decodeBurningGroundCells(malformed)).toThrow();
    for (let length = 1; length < bytes.length; length++) {
      expect(() => decodeBurningGroundCells(base64Of(bytes.subarray(0, length)))).toThrow();
    }
    expect(() => decodeBurningGroundCells(base64Of(Uint8Array.of(...bytes, 0)))).toThrow();
    expect(() => decodeBurningGroundCells(base64Of(Uint8Array.of(2, ...bytes.subarray(1))))).toThrow();
    // Shrinking the bounding box pushes runs outside it.
    const narrow = bytes.slice();
    narrow[5] = 0;
    expect(() => decodeBurningGroundCells(base64Of(narrow))).toThrow();
    // Any single corrupted byte either still describes valid cells or is rejected, never a hang or crash.
    for (let index = 0; index < bytes.length; index++) {
      for (const value of [0, 1, 0x7f, 0x80, 0xff]) {
        const corrupted = bytes.slice();
        corrupted[index] = value;
        try {
          const { upserts } = decodeBurningGroundCells(base64Of(corrupted));
          for (const entry of upserts) {
            expect(Number.isSafeInteger(entry.gridX) && Number.isSafeInteger(entry.gridY) && entry.intensity >= 1).toBe(true);
          }
        } catch (error) { expect(error).toBeInstanceOf(Error); }
      }
    }
    const warningBytes = bytesOf(encodeGroundWarnings([...groupGroundWarnings([{ gridX: 1, gridY: 1, activatesAt: epoch }])]
      .map(([key, warnings]) => ({ key, warnings }))));
    for (let length = 1; length < warningBytes.length; length++) {
      expect(() => decodeGroundWarnings(base64Of(warningBytes.subarray(0, length)))).toThrow();
    }
    // Allied is a cell style, never a warning style.
    expect(() => decodeGroundWarnings(encodeGroundWarnings([{ key: burningGroundCellKey(2, 1, 1),
      warnings: [{ gridX: 1, gridY: 1, activatesAt: epoch }] }]))).toThrow();
  });

  it('identifies a cell by style and raster position only', () => {
    const [first, refreshed] = wire([cell(8, 9, epoch + 10), cell(8, 9, epoch + 900, 4)]);
    expect(first.key).toBe(refreshed.key);
    expect(new Set<BurningGroundWireCell['key']>(wire([cell(8, 9), cell(8, 9, PERMANENT, 1, 'normal'), cell(9, 8)])
      .map(entry => entry.key)).size).toBe(3);
  });
});
