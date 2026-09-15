/** Lossless framing below the room protocol. A logical message is published only when all
 * bytes are present; splitting a snapshot into independently applied batches is invalid. */
export const PEER_PACKET_BYTES = 16 * 1024;
export const PEER_PACKET_HEADER_BYTES = 24;
export const PEER_MESSAGE_LIMIT_BYTES = 16 * 1024 * 1024;
export const PEER_COMPRESSION_THRESHOLD_BYTES = 2 * 1024;
const MAGIC = 0x46444731;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export interface EncodedPeerPayload {
  readonly bytes: Uint8Array;
  readonly rawBytes: number;
  readonly compressed: boolean;
}

/** Bounded streaming read also prevents a compressed payload from expanding without limit. */
async function readStream(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new Error('Peer payload exceeds decoded size limit');
      parts.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

function byteStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
}

export function supportsPeerCompression(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
}

export function encodePeerBytes(payload: string): EncodedPeerPayload {
  const bytes = encoder.encode(payload);
  if (bytes.length > PEER_MESSAGE_LIMIT_BYTES) throw new Error('Peer message exceeds local size limit');
  return { bytes, rawBytes: bytes.length, compressed: false };
}

export async function compressPeerPayload(payload: EncodedPeerPayload): Promise<EncodedPeerPayload> {
  if (payload.rawBytes < PEER_COMPRESSION_THRESHOLD_BYTES || !supportsPeerCompression()) return payload;
  try {
    const bytes = await readStream(byteStream(payload.bytes).pipeThrough(new CompressionStream('deflate')),
      PEER_MESSAGE_LIMIT_BYTES);
    return bytes.length < payload.bytes.length ? { ...payload, bytes, compressed: true } : payload;
  } catch {
    // Compression is optional. Raw fragments still deliver a correct full message.
    return payload;
  }
}

export function makePeerPacket(payload: EncodedPeerPayload, id: number, offset: number, limit: number): Uint8Array {
  const length = Math.min(payload.bytes.length - offset, Math.floor(limit) - PEER_PACKET_HEADER_BYTES);
  if (length <= 0) throw new Error('Negotiated SCTP message limit is too small for framing');
  const packet = new Uint8Array(PEER_PACKET_HEADER_BYTES + length);
  const header = new DataView(packet.buffer);
  header.setUint32(0, MAGIC);
  header.setUint32(4, id);
  header.setUint32(8, payload.bytes.length);
  header.setUint32(12, offset);
  header.setUint32(16, payload.rawBytes);
  header.setUint32(20, payload.compressed ? 1 : 0);
  packet.set(payload.bytes.subarray(offset, offset + length), PEER_PACKET_HEADER_BYTES);
  return packet;
}

interface Assembly {
  total: number;
  rawBytes: number;
  compressed: boolean;
  received: number;
  touched: number;
  parts: Map<number, Uint8Array>;
}

/** One instance per channel and link. Fast assemblies expire; reliable assemblies survive
 * slow draining. Memory, number of assemblies, fragments and expansion are all bounded. */
export class PeerPacketAssembler {
  private readonly pending = new Map<number, Assembly>();
  private completedId = 0;
  private reservedBytes = 0;
  constructor(private readonly ordered: boolean) {}

  accept(raw: unknown, now = performance.now()): EncodedPeerPayload | null {
    if (!this.ordered) this.prune(now);
    if (!(raw instanceof ArrayBuffer) && !ArrayBuffer.isView(raw)) return null;
    const bytes = raw instanceof ArrayBuffer ? new Uint8Array(raw)
      : new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    if (bytes.length <= PEER_PACKET_HEADER_BYTES) return null;
    const h = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (h.getUint32(0) !== MAGIC) return null;
    const id = h.getUint32(4), total = h.getUint32(8), offset = h.getUint32(12);
    const rawBytes = h.getUint32(16), flags = h.getUint32(20), length = bytes.length - PEER_PACKET_HEADER_BYTES;
    if (id <= this.completedId || !total || total > PEER_MESSAGE_LIMIT_BYTES
      || !rawBytes || rawBytes > PEER_MESSAGE_LIMIT_BYTES || flags > 1
      || (!flags && total !== rawBytes) || offset + length > total) return null;
    let entry = this.pending.get(id);
    if (!entry) {
      // Reliable messages are sent serially; an overlapping reliable assembly is invalid.
      if (this.ordered && this.pending.size) return null;
      while (this.pending.size >= 8 || this.reservedBytes + total > PEER_MESSAGE_LIMIT_BYTES * 2) {
        this.remove(this.pending.keys().next().value!);
      }
      entry = { total, rawBytes, compressed: flags === 1, received: 0, touched: now, parts: new Map() };
      this.pending.set(id, entry);
      this.reservedBytes += total;
    }
    if (entry.total !== total || entry.rawBytes !== rawBytes || entry.compressed !== (flags === 1)) return null;
    if (entry.parts.has(offset)) return null;
    if (entry.parts.size >= 65536) { this.remove(id); return null; }
    entry.parts.set(offset, bytes.slice(PEER_PACKET_HEADER_BYTES));
    entry.received += length;
    entry.touched = now;
    if (entry.received < total) return null;
    const result = new Uint8Array(total);
    let cursor = 0;
    for (const [start, part] of [...entry.parts].sort((a, b) => a[0] - b[0])) {
      if (start !== cursor) { this.remove(id); return null; }
      result.set(part, cursor); cursor += part.length;
    }
    this.remove(id);
    if (cursor !== total) return null;
    this.completedId = id;
    for (const key of this.pending.keys()) if (key < id) this.remove(key);
    return { bytes: result, rawBytes, compressed: entry.compressed };
  }

  clear(): void { this.pending.clear(); this.reservedBytes = 0; this.completedId = 0; }
  prune(now: number): void {
    for (const [id, entry] of this.pending) if (now - entry.touched > 2000) this.remove(id);
  }
  private remove(id: number): void {
    const entry = this.pending.get(id);
    if (entry) this.reservedBytes -= entry.total;
    this.pending.delete(id);
  }
}

export async function decodePeerPayload(payload: EncodedPeerPayload): Promise<string> {
  const bytes = payload.compressed
    ? await readStream(byteStream(payload.bytes).pipeThrough(new DecompressionStream('deflate')), payload.rawBytes)
    : payload.bytes;
  if (bytes.length !== payload.rawBytes) throw new Error('Invalid decoded peer payload length');
  return decoder.decode(bytes);
}
