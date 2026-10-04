import { afterEach, expect, it, vi } from 'vitest';
import * as bundled from '../src/voice/BundledVoices';
import { VoiceLibrary } from '../src/voice/VoiceLibrary';
import { canonicalJson, voiceHash, VOICE_EVENTS, type VoiceManifest } from '../src/voice/VoicePackage';

// Minimal identification page for the package boundary; audio decoding is tested separately.
async function fixture() {
  const bytes = new Uint8Array(58); const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('OggS')); bytes[5] = 4; view.setBigUint64(6, 24000n, true);
  bytes[26] = 1; bytes[27] = 30; bytes[28] = 1; bytes.set(new TextEncoder().encode('vorbis'), 29);
  bytes[39] = 1; view.setUint32(40, 24000, true);
  const manifest: VoiceManifest = { schema: 1, catalogVersion: 1, packageId: 'fixture', version: 1, voiceId: 'fixture', name: 'Fixture', language: 'de',
    missingEvents: VOICE_EVENTS.filter(e => e !== 'ready'), clips: [{ id: 'clip', sentenceId: 'ready_01', event: 'ready', file: 'clip.ogg', codec: 'vorbis', duration: 1, bytes: bytes.length, sha256: await voiceHash(bytes) }] };
  const pack = { manifest, checksum: await voiceHash(canonicalJson(manifest)), files: { 'clip.ogg': btoa(String.fromCharCode(...bytes)) } };
  return { pack, text: JSON.stringify({ format: 'fragdachse-voice', schema: 1, packages: [pack] }) };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('loads validated build content while isolating missing, corrupt and tampered voices', async () => {
  const { pack, text } = await fixture();
  const result = await bundled.loadBundledVoices({ good: async () => text, missing: async () => { throw new Error('missing chunk'); },
    corrupt: async () => '{', tampered: async () => text.replace('Fixture', 'Changed') });
  expect(result).toEqual([pack]);
});

it('offers built-in voices even when IndexedDB is unavailable and does not delete build-owned content', async () => {
  const { pack } = await fixture();
  const load = vi.spyOn(bundled, 'loadBundledVoices').mockResolvedValue([pack]);
  vi.stubGlobal('indexedDB', { open: () => { throw new Error('storage blocked'); } });
  const library = new VoiceLibrary(); await Promise.all([library.load(), library.load()]);
  expect(load).toHaveBeenCalledTimes(1);
  expect(library.packages.get(pack.checksum)).toEqual(pack);
  expect(library.isBundled(pack.checksum)).toBe(true);
  expect(library.revision).toBe(1);
  await expect(library.remove(pack.checksum)).rejects.toThrow('im Spiel enthalten');
  expect(library.packages.has(pack.checksum)).toBe(true);
});
