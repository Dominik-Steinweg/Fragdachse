import { PROJECTILE_PATH_HISTORY_MS, PROJECTILE_PATH_MAX_POINTS,
  type ProjectileFlightPath, type ProjectilePathPoint } from '../projectile/ProjectileFlightPath';

// Binary is carried as one base64 string in the existing JSON envelope. Prediction affects
// only storage: XOR residuals reconstruct the original IEEE-754 bits without quantization.
// Uniform spatial travel stays cheap even when wall-clock timestamps jitter or repeat.
const MAX_BYTES = 12 + PROJECTILE_PATH_MAX_POINTS * 80;
const BREAK = 1, VELOCITY = 2, BOUNCE = 4, TRAVEL = 8;

function predict(a: number | undefined, b: number | undefined, fallback = 0, ratio = 1): number {
  if (a === undefined) return fallback;
  const value = b === undefined ? a : a + (a - b) * ratio;
  return Number.isFinite(value) ? value : 0;
}

function travelTime(p: ProjectilePathPoint, previous: ProjectilePathPoint | undefined): number {
  if (!previous) return 0;
  const value = Math.abs(previous.vx) >= Math.abs(previous.vy) && previous.vx !== 0
    ? (p.x - previous.x) / previous.vx : previous.vy !== 0 ? (p.y - previous.y) / previous.vy : 0;
  return Number.isFinite(value) ? value : 0;
}

class PathBytes {
  offset = 0;
  private readonly value = new DataView(new ArrayBuffer(8));
  private readonly prediction = new DataView(new ArrayBuffer(8));
  constructor(readonly bytes: Uint8Array) {}

  write(value: number): void { this.bytes[this.offset++] = value; }
  read(): number {
    if (this.offset >= this.bytes.length) throw new Error('Truncated projectile path');
    return this.bytes[this.offset++];
  }
  writeInt(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid projectile path integer');
    while (value >= 128) { this.write((value % 128) + 128); value = Math.floor(value / 128); }
    this.write(value);
  }
  readInt(): number {
    let value = 0, scale = 1;
    for (let i = 0; i < 8; i++) {
      const byte = this.read(); value += (byte & 127) * scale;
      if (!Number.isSafeInteger(value)) break;
      if (!(byte & 128)) return value;
      scale *= 128;
    }
    throw new Error('Invalid projectile path integer');
  }
  writeFloat(value: number, prediction: number): void {
    if (!Number.isFinite(value)) throw new Error('Invalid projectile path number');
    // Exact predictions have no residual bytes. Preserve the sign of zero just as the
    // IEEE-754 XOR path does, without writing/scanning two DataViews for the common case.
    if (Object.is(value, prediction)) { this.write(0); return; }
    this.value.setFloat64(0, value); this.prediction.setFloat64(0, prediction);
    let first = 0, last = 7;
    while (first < 8 && this.value.getUint8(first) === this.prediction.getUint8(first)) first++;
    if (first === 8) { this.write(0); return; }
    while (this.value.getUint8(last) === this.prediction.getUint8(last)) last--;
    this.write(1 + first * 8 + last - first);
    for (let i = first; i <= last; i++) this.write(this.value.getUint8(i) ^ this.prediction.getUint8(i));
  }
  readFloat(prediction: number): number {
    this.value.setFloat64(0, prediction);
    const header = this.read();
    if (header) {
      const first = Math.floor((header - 1) / 8), last = first + (header - 1) % 8;
      if (last > 7) throw new Error('Invalid projectile path float');
      for (let i = first; i <= last; i++) this.value.setUint8(i, this.value.getUint8(i) ^ this.read());
    }
    const value = this.value.getFloat64(0);
    if (!Number.isFinite(value)) throw new Error('Invalid projectile path number');
    return value;
  }
}

export function encodeProjectileFlightPath(path: ProjectileFlightPath): string {
  if (!path.points.length || path.points.length > PROJECTILE_PATH_MAX_POINTS) throw new Error('Invalid projectile path count');
  const writer = new PathBytes(new Uint8Array(12 + path.points.length * 80));
  writer.writeFloat(path.timeMs, 0);
  writer.write(path.ended ? 1 : 0); writer.write(path.points.length);
  let previous: ProjectilePathPoint | undefined, before: ProjectilePathPoint | undefined;
  for (const p of path.points) {
    // The recorder can remove uniform intermediate samples. Their sequence distance remains
    // available, so a run with alternating one/two-step knots is still predictable.
    const ratio = before && previous ? (p.sequence - previous.sequence) / (previous.sequence - before.sequence) : 1;
    const velocity = !previous || !Object.is(p.vx, previous.vx) || !Object.is(p.vy, previous.vy);
    let px = predict(previous?.x, before?.x, 0, ratio), py = predict(previous?.y, before?.y, 0, ratio);
    // Variable physics intervals make a sequence-based spatial predictor ineffective.
    // A travel scalar plus exact x/y residuals compresses straight variable-step motion.
    // It is a wire predictor only, never a replacement clock or reconstructed geometry.
    const travel = previous && !velocity && !p.breakBefore && (previous.vx !== 0 || previous.vy !== 0)
      && (Math.abs(p.x - px) > 1e-8 || Math.abs(p.y - py) > 1e-8) ? travelTime(p, previous) : undefined;
    writer.write((p.breakBefore ? BREAK : 0) | (velocity ? VELOCITY : 0)
      | (p.bounceSequence === undefined ? 0 : BOUNCE) | (travel === undefined ? 0 : TRAVEL));
    writer.writeInt(p.sequence - (previous?.sequence ?? 0));
    writer.writeFloat(p.timeMs, predict(previous?.timeMs, before?.timeMs, path.timeMs, ratio));
    if (travel !== undefined) {
      writer.writeFloat(travel, travelTime(previous!, before));
      px = previous!.x + previous!.vx * travel; py = previous!.y + previous!.vy * travel;
      if (!Number.isFinite(px)) px = 0;
      if (!Number.isFinite(py)) py = 0;
    }
    writer.writeFloat(p.x, px); writer.writeFloat(p.y, py);
    if (velocity) { writer.writeFloat(p.vx, previous?.vx ?? 0); writer.writeFloat(p.vy, previous?.vy ?? 0); }
    if (p.bounceSequence !== undefined) writer.writeInt(p.bounceSequence);
    before = previous; previous = p;
  }
  return btoa(String.fromCharCode(...writer.bytes.subarray(0, writer.offset)));
}

export function decodeProjectileFlightPath(encoded: unknown): ProjectileFlightPath {
  if (typeof encoded !== 'string' || encoded.length > Math.ceil(MAX_BYTES / 3) * 4) throw new Error('Invalid projectile path encoding');
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const reader = new PathBytes(bytes);
  const timeMs = reader.readFloat(0), ended = reader.read(), count = reader.read();
  if (ended > 1 || count < 1 || count > PROJECTILE_PATH_MAX_POINTS) throw new Error('Invalid projectile path header');
  const points: ProjectilePathPoint[] = [];
  for (let i = 0; i < count; i++) {
    const previous = points[i - 1], before = points[i - 2], flags = reader.read();
    if (flags > 15 || (!previous && (!(flags & VELOCITY) || (flags & TRAVEL)))) throw new Error('Invalid projectile path flags');
    const sequence = (previous?.sequence ?? 0) + reader.readInt();
    const ratio = before && previous ? (sequence - previous.sequence) / (previous.sequence - before.sequence) : 1;
    const time = reader.readFloat(predict(previous?.timeMs, before?.timeMs, timeMs, ratio));
    let px = predict(previous?.x, before?.x, 0, ratio), py = predict(previous?.y, before?.y, 0, ratio);
    if (flags & TRAVEL) {
      const travel = reader.readFloat(travelTime(previous, before));
      px = previous.x + previous.vx * travel; py = previous.y + previous.vy * travel;
      if (!Number.isFinite(px)) px = 0;
      if (!Number.isFinite(py)) py = 0;
    }
    const x = reader.readFloat(px), y = reader.readFloat(py);
    const vx = flags & VELOCITY ? reader.readFloat(previous?.vx ?? 0) : previous.vx;
    const vy = flags & VELOCITY ? reader.readFloat(previous?.vy ?? 0) : previous.vy;
    const bounceSequence = flags & BOUNCE ? reader.readInt() : undefined;
    if (!Number.isSafeInteger(sequence) || sequence <= (previous?.sequence ?? 0)
      || time > timeMs || time < timeMs - PROJECTILE_PATH_HISTORY_MS - 0.001
      || (previous && time < previous.timeMs)) throw new Error('Invalid projectile path point');
    points.push({ sequence, timeMs: time, x, y, vx, vy,
      ...(flags & BREAK ? { breakBefore: true } : {}), ...(bounceSequence === undefined ? {} : { bounceSequence }) });
  }
  if (reader.offset !== reader.bytes.length) throw new Error('Trailing projectile path bytes');
  return { timeMs, points, ...(ended ? { ended: true } : {}) };
}
