import { afterEach, expect, it, vi } from 'vitest';
import * as bundled from '../src/voice/BundledVoices';
import { VoiceLibrary, readVoicePreferences, saveVoicePreferences } from '../src/voice/VoiceLibrary';
import * as deletions from '../src/voice/VoiceDeletions';
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

function browserStorage(initial: unknown[]) {
  const items = new Map(initial.map(value => [(value as { checksum: string }).checksum, value]));
  const local = new Map<string, string>();
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('localStorage', { getItem: (key: string) => local.get(key) ?? null, setItem: (key: string, value: string) => local.set(key, value) });
  vi.stubGlobal('indexedDB', { open: () => {
    const request: any = {};
    request.result = { close() {}, transaction: () => {
      const tx: any = { objectStore: () => ({ getAll: () => ({ result: [...items.values()] }), delete: (sum: string) => items.delete(sum) }) };
      queueMicrotask(() => tx.oncomplete()); return tx;
    } };
    queueMicrotask(() => request.onsuccess()); return request;
  } });
  return { items, local };
}

it('purges every imported version of a deleted voice, hides cached build copies, clears selection and refuses reimport', async () => {
  const { pack, text } = await fixture(); const previous = structuredClone(pack); previous.checksum = 'a'.repeat(64);
  const keep = structuredClone(pack); keep.manifest.voiceId = 'other'; keep.manifest.packageId = 'other';
  keep.checksum = await voiceHash(canonicalJson(keep.manifest));
  const { items } = browserStorage([pack, previous, keep]);
  saveVoicePreferences({ checksum: previous.checksum, enabled: true, volume: 0.6 });
  vi.spyOn(deletions, 'loadVoiceDeletions').mockResolvedValue({ voiceIds: ['fixture'], checksums: [pack.checksum] });
  vi.spyOn(bundled, 'loadBundledVoices').mockResolvedValue([pack]);
  const library = new VoiceLibrary(); await library.load();
  expect([...items.keys()]).toEqual([keep.checksum]); expect([...library.packages.keys()]).toEqual([keep.checksum]);
  expect(readVoicePreferences()).toEqual({ checksum: null, enabled: true, volume: 0.6 });
  const decodeAudioData = vi.fn();
  await expect(library.import({ size: text.length, text: async () => text } as File, { decodeAudioData } as unknown as BaseAudioContext)).rejects.toThrow('endgültig gelöscht');
  expect(decodeAudioData).not.toHaveBeenCalled();
});

it('remembers downloaded deletions when the static game registry is temporarily unavailable', async () => {
  const { pack } = await fixture(); browserStorage([]);
  const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ voiceIds: ['fixture'], checksums: [pack.checksum] }) });
  vi.stubGlobal('fetch', request);
  expect(await deletions.loadVoiceDeletions()).toEqual({ voiceIds: ['fixture'], checksums: [pack.checksum] });
  request.mockRejectedValue(new Error('offline'));
  expect(await deletions.loadVoiceDeletions()).toEqual({ voiceIds: ['fixture'], checksums: [pack.checksum] });
  expect(request).toHaveBeenCalledWith(expect.stringContaining('voice-deletions.json'), expect.objectContaining({ cache: 'no-store' }));
});

it('keeps deleted voices unavailable and reports blocked browser cleanup', async () => {
  const { pack } = await fixture(); browserStorage([]);
  saveVoicePreferences({ checksum: pack.checksum, enabled: true, volume: 0.6 });
  vi.spyOn(deletions, 'loadVoiceDeletions').mockResolvedValue({ voiceIds: ['fixture'], checksums: [pack.checksum] });
  vi.spyOn(bundled, 'loadBundledVoices').mockResolvedValue([pack]);
  vi.stubGlobal('indexedDB', { open: () => { throw new Error('blocked'); } });
  const library = new VoiceLibrary(); await library.load();
  expect(library.packages.size).toBe(0); expect(library.cleanupWarning).toContain('Browserspeicher');
  expect(readVoicePreferences().checksum).toBeNull();
});
