import type { SyncedBurningGroundCell, SyncedBurningGroundSnapshot } from '../types';
import { decodeGroundFireVisualStyle, encodeGroundFireVisualStyle } from './groundFireVisualStyleCodec';

/**
 * Binary wire form of the burning-ground slice, carried as base64 strings in the JSON envelope.
 *
 * Identity is spatial: FireSystem keeps at most one cell per visual style and raster position, so
 * (style, gridX, gridY) names a cell on the wire and doubles as the client's cell id. Host ignition
 * ids never travel. A blob lists its cells row-major per style inside one bounding box as runs of
 * consecutive raster positions with equal expiry and intensity, so a permanent surface of
 * thousands of cells costs a few bytes per row, while scattered short-lived cells degrade to one
 * small run each. Expiries are whole milliseconds rounded up (identical for integer clocks);
 * everything else is exact. Decoding validates the whole blob and throws on malformed input.
 */

export type GroundWarning = NonNullable<SyncedBurningGroundSnapshot['warnings']>[number];

/** Wire view of one cell: the exact values a client reconstructs. */
export interface BurningGroundWireCell {
  readonly key: number;
  readonly style: number;
  readonly gridX: number;
  readonly gridY: number;
  readonly expiresAt: number;
  readonly intensity: number;
}

export interface DecodedBurningGroundCells {
  readonly upserts: SyncedBurningGroundCell[];
  /** Cell keys, see `burningGroundCellKey`. */
  readonly removals: number[];
}

/** Warnings of one style and raster cell, sorted by `activatesAt`; empty clears the cell. */
export interface GroundWarningEntry {
  readonly key: number;
  readonly warnings: readonly GroundWarning[];
}

const FORMAT = 1;
const PERMANENT = Number.MAX_SAFE_INTEGER;
const COORD_LIMIT = 2 ** 20;
const AXIS = 2 * COORD_LIMIT;
const STYLE_STRIDE = AXIS * AXIS;
const STYLE_LIMIT = 8;
const MAX_CELLS = 2 ** 21;
const MAX_INTENSITY = 2 ** 20;
const MAX_ENCODED_CHARS = 16 * 1024 * 1024;
const WARNING_VOID = encodeGroundFireVisualStyle('void');
const WARNING_NORMAL = encodeGroundFireVisualStyle('normal');

const inRange = (value: number) => Number.isSafeInteger(value) && value >= -COORD_LIMIT && value < COORD_LIMIT;

/** Stable numeric identity of a style and raster cell; ascending keys are style-major, then row-major. */
export function burningGroundCellKey(style: number, gridX: number, gridY: number): number {
  return style * STYLE_STRIDE + (gridY + COORD_LIMIT) * AXIS + gridX + COORD_LIMIT;
}

const keyStyle = (key: number) => Math.floor(key / STYLE_STRIDE);
const keyY = (key: number) => Math.floor((key % STYLE_STRIDE) / AXIS) - COORD_LIMIT;
const keyX = (key: number) => key % AXIS - COORD_LIMIT;

/** Normalizes a host cell to what the wire carries; null for a position outside the codec range. */
export function toBurningGroundWireCell(cell: SyncedBurningGroundCell): BurningGroundWireCell | null {
  const { gridX, gridY } = cell;
  if (!inRange(gridX) || !inRange(gridY)) return null;
  const style = encodeGroundFireVisualStyle(cell.visualStyle);
  const expiresAt = cell.expiresAt >= PERMANENT ? PERMANENT : Number.isFinite(cell.expiresAt) ? Math.max(0, Math.ceil(cell.expiresAt)) : 0;
  const intensity = Number.isFinite(cell.intensity) ? Math.min(MAX_INTENSITY, Math.max(1, Math.round(cell.intensity))) : 1;
  return { key: burningGroundCellKey(style, gridX, gridY), style, gridX, gridY, expiresAt, intensity };
}

export function sameBurningGroundWireCell(left: BurningGroundWireCell, right: BurningGroundWireCell): boolean {
  return left.key === right.key && left.expiresAt === right.expiresAt && left.intensity === right.intensity;
}

/** Wire identity of a warning (its style and raster cell), or null for an unusable entry. */
export function groundWarningKey(warning: GroundWarning): number | null {
  if (!inRange(warning.gridX) || !inRange(warning.gridY) || !Number.isFinite(warning.activatesAt)) return null;
  return burningGroundCellKey(warning.visualStyle === 'normal' ? WARNING_NORMAL : WARNING_VOID, warning.gridX, warning.gridY);
}

/** Groups warnings by wire identity; several sources may warn the same cell, each entry is kept. */
export function groupGroundWarnings(warnings: readonly GroundWarning[]): Map<number, GroundWarning[]> {
  const groups = new Map<number, GroundWarning[]>();
  for (const warning of warnings) {
    const key = groundWarningKey(warning);
    if (key === null) continue;
    const group = groups.get(key);
    if (group) group.push(warning);
    else groups.set(key, [warning]);
  }
  for (const group of groups.values()) if (group.length > 1) group.sort((left, right) => left.activatesAt - right.activatesAt);
  return groups;
}

class ByteWriter {
  private bytes = new Uint8Array(1024);
  private length = 0;

  byte(value: number): void {
    if (this.length === this.bytes.length) {
      const grown = new Uint8Array(this.bytes.length * 2);
      grown.set(this.bytes);
      this.bytes = grown;
    }
    this.bytes[this.length++] = value;
  }

  uint(value: number): void {
    if (value < 0x80000000) {
      while (value > 127) { this.byte((value & 127) | 128); value >>>= 7; }
    } else {
      while (value > 127) { this.byte((value % 128) + 128); value = Math.floor(value / 128); }
    }
    this.byte(value);
  }

  int(value: number): void { this.uint(value < 0 ? -2 * value - 1 : 2 * value); }

  toBase64(): string { return bytesToBase64(this.bytes.subarray(0, this.length)); }
}

class ByteReader {
  private offset = 0;
  constructor(private readonly bytes: Uint8Array) {}

  uint(): number {
    let value = 0, scale = 1;
    for (let index = 0; index < 8; index++) {
      if (this.offset >= this.bytes.length) throw new Error('Truncated burning ground blob');
      const byte = this.bytes[this.offset++];
      value += (byte & 127) * scale;
      if (byte < 128) {
        if (!Number.isSafeInteger(value)) break;
        return value;
      }
      scale *= 128;
    }
    throw new Error('Invalid burning ground integer');
  }

  int(): number {
    const value = this.uint();
    return value % 2 === 0 ? value / 2 : -(value + 1) / 2;
  }

  bounded(limit: number): number {
    const value = this.uint();
    if (value > limit) throw new Error('Burning ground value out of range');
    return value;
  }

  end(): void {
    if (this.offset !== this.bytes.length) throw new Error('Trailing burning ground bytes');
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  const native = bytes as Uint8Array & { toBase64?: () => string };
  if (typeof native.toBase64 === 'function') return native.toBase64();
  // Chunked: spreading a large surface into one call would exceed the argument limit.
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x2000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + 0x2000) as unknown as number[]);
  }
  return btoa(binary);
}

function base64ToBytes(encoded: unknown): Uint8Array {
  if (typeof encoded !== 'string' || encoded.length > MAX_ENCODED_CHARS) throw new Error('Invalid burning ground encoding');
  const native = Uint8Array as unknown as { fromBase64?: (text: string) => Uint8Array };
  if (typeof native.fromBase64 === 'function') return native.fromBase64(encoded);
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

interface Bounds { minX: number; minY: number; width: number; height: number }

function boundsOf(keys: Iterable<number>): Bounds | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const key of keys) {
    const x = keyX(key), y = keyY(key);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return minX === Infinity ? null : { minX, minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function writeBounds(writer: ByteWriter, bounds: Bounds): void {
  writer.int(bounds.minX); writer.int(bounds.minY); writer.uint(bounds.width - 1); writer.uint(bounds.height - 1);
}

function readBounds(reader: ByteReader): Bounds {
  const minX = reader.int(), minY = reader.int();
  const width = reader.bounded(AXIS - 1) + 1, height = reader.bounded(AXIS - 1) + 1;
  if (!inRange(minX) || !inRange(minY) || !inRange(minX + width - 1) || !inRange(minY + height - 1)) {
    throw new Error('Burning ground bounds out of range');
  }
  return { minX, minY, width, height };
}

const linearIndex = (key: number, bounds: Bounds) => (keyY(key) - bounds.minY) * bounds.width + keyX(key) - bounds.minX;
const cellIndex = (cell: BurningGroundWireCell, bounds: Bounds) => (cell.gridY - bounds.minY) * bounds.width + cell.gridX - bounds.minX;

/** Counts entries per style of ascending keys: [style, count] pairs. */
function styleSections(keys: readonly number[]): [number, number][] {
  const sections: [number, number][] = [];
  for (const key of keys) {
    const style = keyStyle(key);
    const last = sections[sections.length - 1];
    if (last?.[0] === style) last[1]++;
    else sections.push([style, 1]);
  }
  return sections;
}

function readStyle(reader: ByteReader, previous: number, valid: (style: number) => boolean): number {
  const style = reader.bounded(STYLE_LIMIT - 1);
  if (style <= previous || !valid(style)) throw new Error('Invalid burning ground style section');
  return style;
}

const isCellStyle = (style: number) => encodeGroundFireVisualStyle(decodeGroundFireVisualStyle(style)) === style;

/**
 * Encodes cells (a full snapshot, or the upserts of a delta) and removed cell keys into one blob.
 * Inputs need no particular order; of duplicate keys only one entry is kept.
 */
export function encodeBurningGroundCells(upserts: readonly BurningGroundWireCell[], removals: Iterable<number> = []): string {
  const cells = [...upserts].sort((left, right) => left.key - right.key)
    .filter((cell, index, sorted) => index === 0 || sorted[index - 1].key !== cell.key);
  const removedKeys = Array.from(Float64Array.from(removals).sort())
    .filter((key, index, sorted) => index === 0 || sorted[index - 1] !== key);
  const writer = new ByteWriter();
  writer.byte(FORMAT);
  const upsertKeys = cells.map(cell => cell.key);
  const upsertSections = styleSections(upsertKeys), removalSections = styleSections(removedKeys);
  writer.uint(upsertSections.length); writer.uint(removalSections.length);
  const bounds = boundsOf([...upsertKeys, ...removedKeys]);
  if (!bounds) return writer.toBase64();
  writeBounds(writer, bounds);

  let next = 0, prevFinite = 0;
  for (const [style, count] of upsertSections) {
    writer.uint(style); writer.uint(count);
    let end = 0, intensity = 1, expiresAt = PERMANENT;
    for (const stop = next + count; next < stop;) {
      const first = cells[next], start = cellIndex(first, bounds);
      let length = 1;
      while (next + length < stop) {
        const candidate = cells[next + length];
        if (candidate.expiresAt !== first.expiresAt || candidate.intensity !== first.intensity
          || cellIndex(candidate, bounds) !== start + length) break;
        length++;
      }
      const flags = (first.intensity !== intensity ? 1 : 0) | (first.expiresAt !== expiresAt ? 2 : 0);
      writer.uint(start - end); writer.uint((length - 1) * 4 + flags);
      if (flags & 1) writer.uint(intensity = first.intensity);
      if (flags & 2) {
        expiresAt = first.expiresAt;
        if (expiresAt === PERMANENT) writer.uint(0);
        else {
          const delta = expiresAt - prevFinite;
          writer.uint((delta < 0 ? -2 * delta - 1 : 2 * delta) + 1);
          prevFinite = expiresAt;
        }
      }
      end = start + length;
      next += length;
    }
  }

  next = 0;
  for (const [style, count] of removalSections) {
    writer.uint(style); writer.uint(count);
    let end = 0;
    for (const stop = next + count; next < stop;) {
      const start = linearIndex(removedKeys[next], bounds);
      let length = 1;
      while (next + length < stop && linearIndex(removedKeys[next + length], bounds) === start + length) length++;
      writer.uint(start - end); writer.uint(length - 1);
      end = start + length;
      next += length;
    }
  }
  return writer.toBase64();
}

/** Decodes and validates a cell blob. Upsert ids are their cell keys; throws on malformed input. */
export function decodeBurningGroundCells(encoded: unknown): DecodedBurningGroundCells {
  const reader = new ByteReader(base64ToBytes(encoded));
  if (reader.bounded(255) !== FORMAT) throw new Error('Unknown burning ground format');
  const upsertSections = reader.bounded(STYLE_LIMIT), removalSections = reader.bounded(STYLE_LIMIT);
  const upserts: SyncedBurningGroundCell[] = [], removals: number[] = [];
  if (upsertSections + removalSections === 0) { reader.end(); return { upserts, removals }; }
  const { minX, minY, width, height } = readBounds(reader);
  const area = width * height;
  let total = 0, prevFinite = 0;

  for (let list = 0; list < 2; list++) {
    const removing = list === 1;
    let previousStyle = -1;
    for (let section = 0, sections = removing ? removalSections : upsertSections; section < sections; section++) {
      const style = previousStyle = readStyle(reader, previousStyle, isCellStyle);
      const visualStyle = decodeGroundFireVisualStyle(style);
      const count = reader.bounded(MAX_CELLS - total);
      total += count;
      let end = 0, intensity = 1, expiresAt = PERMANENT;
      for (let done = 0; done < count;) {
        const start = end + reader.uint();
        const head = reader.uint();
        const length = (removing ? head : Math.floor(head / 4)) + 1;
        if (length > count - done || start + length > area) throw new Error('Burning ground run outside its section');
        if (!removing && head & 1) {
          intensity = reader.uint();
          if (intensity < 1 || intensity > MAX_INTENSITY) throw new Error('Invalid burning ground intensity');
        }
        if (!removing && head & 2) {
          const code = reader.uint();
          if (code === 0) expiresAt = PERMANENT;
          else {
            const zigzag = code - 1;
            expiresAt = prevFinite + (zigzag % 2 === 0 ? zigzag / 2 : -(zigzag + 1) / 2);
            if (!Number.isSafeInteger(expiresAt) || expiresAt < 0 || expiresAt >= PERMANENT) throw new Error('Invalid burning ground expiry');
            prevFinite = expiresAt;
          }
        }
        for (let index = start; index < start + length; index++) {
          const gridX = minX + index % width, gridY = minY + Math.floor(index / width);
          const id = burningGroundCellKey(style, gridX, gridY);
          if (removing) removals.push(id);
          else upserts.push({ id, gridX, gridY, expiresAt, intensity, visualStyle });
        }
        end = start + length;
        done += length;
      }
    }
  }
  reader.end();
  return { upserts, removals };
}

/**
 * Encodes warning entries. Ascending activation times within a cell; an empty list tells a delta
 * receiver to drop that cell's warnings. Activation times are whole milliseconds rounded up.
 */
export function encodeGroundWarnings(entries: readonly GroundWarningEntry[]): string {
  const sorted = [...entries].sort((left, right) => left.key - right.key)
    .filter((entry, index, list) => index === 0 || list[index - 1].key !== entry.key);
  const keys = sorted.map(entry => entry.key);
  const sections = styleSections(keys);
  const writer = new ByteWriter();
  writer.byte(FORMAT);
  writer.uint(sections.length);
  const bounds = boundsOf(keys);
  if (!bounds) return writer.toBase64();
  writeBounds(writer, bounds);
  let next = 0, previousAt = 0;
  for (const [style, count] of sections) {
    writer.uint(style); writer.uint(count);
    let end = 0;
    for (const stop = next + count; next < stop; next++) {
      const { key, warnings } = sorted[next];
      const index = linearIndex(key, bounds);
      writer.uint((index - end) * 2 + (warnings.length === 1 ? 0 : 1));
      if (warnings.length !== 1) writer.uint(warnings.length);
      for (const warning of warnings) {
        const activatesAt = Math.ceil(warning.activatesAt);
        writer.int(activatesAt - previousAt);
        previousAt = activatesAt;
      }
      end = index + 1;
    }
  }
  return writer.toBase64();
}

const isWarningStyle = (style: number) => style === WARNING_VOID || style === WARNING_NORMAL;

/** Decodes and validates a warning blob; throws on malformed input. */
export function decodeGroundWarnings(encoded: unknown): GroundWarningEntry[] {
  const reader = new ByteReader(base64ToBytes(encoded));
  if (reader.bounded(255) !== FORMAT) throw new Error('Unknown burning ground format');
  const sections = reader.bounded(STYLE_LIMIT);
  const entries: GroundWarningEntry[] = [];
  if (sections === 0) { reader.end(); return entries; }
  const bounds = readBounds(reader);
  const area = bounds.width * bounds.height;
  let total = 0, previousAt = 0, previousStyle = -1;
  for (let section = 0; section < sections; section++) {
    const style = previousStyle = readStyle(reader, previousStyle, isWarningStyle);
    const count = reader.bounded(MAX_CELLS - entries.length);
    let end = 0;
    for (let done = 0; done < count; done++) {
      const head = reader.uint();
      const index = end + Math.floor(head / 2);
      if (index >= area) throw new Error('Burning ground warning outside its bounds');
      const length = head % 2 === 0 ? 1 : reader.bounded(MAX_CELLS - total);
      total += length;
      const gridX = bounds.minX + index % bounds.width, gridY = bounds.minY + Math.floor(index / bounds.width);
      const warnings: GroundWarning[] = [];
      for (let item = 0; item < length; item++) {
        const activatesAt = previousAt + reader.int();
        if (!Number.isSafeInteger(activatesAt)) throw new Error('Invalid burning ground warning time');
        previousAt = activatesAt;
        warnings.push(style === WARNING_NORMAL ? { gridX, gridY, activatesAt, visualStyle: 'normal' } : { gridX, gridY, activatesAt });
      }
      entries.push({ key: burningGroundCellKey(style, gridX, gridY), warnings });
      end = index + 1;
    }
  }
  reader.end();
  return entries;
}
