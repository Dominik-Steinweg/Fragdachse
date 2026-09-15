import { describe, expect, it, vi } from 'vitest';
import { PeerPacketAssembler, compressPeerPayload, decodePeerPayload, encodePeerBytes,
  makePeerPacket, PEER_MESSAGE_LIMIT_BYTES } from '../src/network/peer/PeerPacketCodec';

function packets(text: string, id = 1) {
  const payload = encodePeerBytes(text);
  const parts: Uint8Array[] = [];
  for (let offset = 0; offset < payload.bytes.length;) {
    const part = makePeerPacket(payload, id, offset, 1024);
    parts.push(part); offset += part.length - 24;
  }
  return parts;
}

describe('bounded peer packet codec', () => {
  it('expires incomplete fast messages while preserving reliable transfers through slow drains', async () => {
    const text = 'data'.repeat(1000), parts = packets(text);
    const fast = new PeerPacketAssembler(false), reliable = new PeerPacketAssembler(true);
    expect(fast.accept(parts[0], 0)).toBeNull(); expect(reliable.accept(parts[0], 0)).toBeNull();
    let result = null;
    for (const part of parts.slice(1)) {
      expect(fast.accept(part, 3000)).toBeNull();
      result = reliable.accept(part, 3000);
    }
    expect(await decodePeerPayload(result!)).toBe(text);
    reliable.clear();
    for (const part of parts) result = reliable.accept(part, 4000);
    expect(await decodePeerPayload(result!)).toBe(text);
  });

  it('rejects inconsistent headers, overlaps and sizes before publishing a message', () => {
    const parts = packets('x'.repeat(2500));
    const invalid = parts[0].slice();
    const header = new DataView(invalid.buffer);
    header.setUint32(8, PEER_MESSAGE_LIMIT_BYTES + 1);
    const assembler = new PeerPacketAssembler(false);
    expect(assembler.accept(invalid)).toBeNull();
    expect(assembler.accept(parts[0])).toBeNull();
    const overlapping = parts[1].slice();
    new DataView(overlapping.buffer).setUint32(12, 500);
    expect(assembler.accept(overlapping)).toBeNull();
    expect(assembler.accept(parts[2])).toBeNull();
    const next = packets('complete', 2);
    expect(assembler.accept(next[0])).not.toBeNull();
    for (const part of parts) expect(assembler.accept(part)).toBeNull();
  });

  it('bounds decompression and rejects forged decoded sizes', async () => {
    const payload = await compressPeerPayload(encodePeerBytes('z'.repeat(100_000)));
    expect(payload.compressed).toBe(true);
    await expect(decodePeerPayload({ ...payload, rawBytes: 1024 })).rejects.toThrow();
    await expect(decodePeerPayload({ ...payload, rawBytes: 100_001 })).rejects.toThrow();
    expect(await decodePeerPayload(payload)).toBe('z'.repeat(100_000));
  });

  it('uses exact raw framing when native compression is unavailable or fails', async () => {
    const payload = encodePeerBytes('💥'.repeat(1000));
    try {
      vi.stubGlobal('CompressionStream', undefined);
      expect(await compressPeerPayload(payload)).toBe(payload);
      vi.stubGlobal('CompressionStream', class { constructor() { throw new Error('Unavailable'); } });
      expect(await compressPeerPayload(payload)).toBe(payload);
    } finally { vi.unstubAllGlobals(); }
  });
});
