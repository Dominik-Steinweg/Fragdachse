/** Private, portable runtime files. No executable archive entries or production metadata. */
export const VOICE_EVENTS = ['ready', 'kill', 'leader', 'ultimate', 'damage_burst', 'victory'] as const;
export type VoiceEventKind = typeof VOICE_EVENTS[number];
export const VOICE_LIMITS = { clips: 40, clipSeconds: 6, seconds: 120, bytes: 20 * 1024 * 1024, packages: 10 };
export interface VoiceClip {
  id: string; sentenceId: string; event: VoiceEventKind; file: string;
  sha256: string; bytes: number; duration: number; codec: 'vorbis';
}
export interface VoiceManifest {
  schema: 1; catalogVersion: number; packageId: string; version: number;
  voiceId: string; name: string; language: 'de'; missingEvents: VoiceEventKind[]; clips: VoiceClip[];
}
export interface VoicePackage { manifest: VoiceManifest; checksum: string; files: Record<string, string> }
export interface VoiceBundle { format: 'fragdachse-voice'; schema: 1; packages: VoicePackage[] }
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export async function voiceHash(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function voiceBytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), char => char.charCodeAt(0));
}
export function isVoiceChecksum(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function assert(condition: unknown): asserts condition { if (!condition) throw new Error('Ungültiges oder zu großes Sprachpaket.'); }
function exact(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  assert(value && typeof value === 'object' && !Array.isArray(value));
  assert(Object.keys(value).sort().join('|') === [...keys].sort().join('|'));
}
function id(value: unknown): boolean { return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value); }
/** Also used by the workshop exporter. Entire bundle validates before the first storage write. */
export async function validateVoiceBundle(value: unknown): Promise<VoiceBundle> {
  exact(value, ['format', 'schema', 'packages']);
  assert(value.format === 'fragdachse-voice' && value.schema === 1 && Array.isArray(value.packages));
  assert(value.packages.length > 0 && value.packages.length <= VOICE_LIMITS.packages);
  const identities = new Set<string>();
  for (const raw of value.packages) {
    exact(raw, ['manifest', 'checksum', 'files']);
    exact(raw.manifest, ['schema', 'catalogVersion', 'packageId', 'version', 'voiceId', 'name', 'language', 'missingEvents', 'clips']);
    const m = raw.manifest;
    assert(m.schema === 1 && m.language === 'de' && id(m.packageId) && id(m.voiceId));
    assert(Number.isSafeInteger(m.version) && Number(m.version) > 0 && Number.isSafeInteger(m.catalogVersion) && Number(m.catalogVersion) > 0);
    assert(typeof m.name === 'string' && m.name.trim().length > 0 && m.name.length <= 80);
    assert(Array.isArray(m.clips) && m.clips.length > 0 && m.clips.length <= VOICE_LIMITS.clips);
    assert(raw.files && typeof raw.files === 'object' && !Array.isArray(raw.files));
    const files = raw.files as Record<string, unknown>;
    const clipIds = new Set<string>(); const paths = new Set<string>(); const events = new Set<unknown>();
    let bytes = 0; let seconds = 0;
    for (const clip of m.clips) {
      exact(clip, ['id', 'sentenceId', 'event', 'file', 'sha256', 'bytes', 'duration', 'codec']);
      assert(id(clip.id) && id(clip.sentenceId) && !clipIds.has(String(clip.id)));
      assert(VOICE_EVENTS.includes(clip.event as VoiceEventKind) && clip.codec === 'vorbis');
      assert(typeof clip.file === 'string' && /^[a-zA-Z0-9_-]+\.ogg$/.test(clip.file) && !paths.has(clip.file));
      assert(Number.isSafeInteger(clip.bytes) && Number(clip.bytes) > 0);
      assert(typeof clip.duration === 'number' && Number.isFinite(clip.duration) && clip.duration > 0 && clip.duration <= VOICE_LIMITS.clipSeconds);
      bytes += Number(clip.bytes); seconds += clip.duration;
      assert(bytes <= VOICE_LIMITS.bytes && seconds <= VOICE_LIMITS.seconds);
      const encoded = files[clip.file];
      assert(typeof encoded === 'string' && encoded.length === 4 * Math.ceil(Number(clip.bytes) / 3) && /^[A-Za-z0-9+/]*={0,2}$/.test(encoded));
      const audio = voiceBytes(encoded);
      assert(audio.byteLength === clip.bytes && isVoiceChecksum(clip.sha256) && await voiceHash(audio) === clip.sha256);
      // Ogg identification packet: Vorbis, mono/stereo and bounded sample rate before decoding.
      assert(audio.length >= 58 && String.fromCharCode(...audio.slice(0, 4)) === 'OggS');
      const packet = 27 + audio[26];
      assert(audio[packet] === 1 && String.fromCharCode(...audio.slice(packet + 1, packet + 7)) === 'vorbis');
      const rate = new DataView(audio.buffer).getUint32(packet + 12, true);
      assert(audio[packet + 11] >= 1 && audio[packet + 11] <= 2 && rate >= 8000 && rate <= 48000);
      // Bound decoded duration before passing untrusted compressed bytes to a browser codec.
      const view = new DataView(audio.buffer); const serial = view.getUint32(14, true);
      let offset = 0; let finalGranule = 0n; let ended = false;
      while (offset < audio.length) {
        assert(!ended && offset + 27 <= audio.length && String.fromCharCode(...audio.slice(offset, offset + 4)) === 'OggS');
        assert(audio[offset + 4] === 0 && view.getUint32(offset + 14, true) === serial);
        const segments = audio[offset + 26]; assert(offset + 27 + segments <= audio.length);
        const granule = view.getBigUint64(offset + 6, true);
        assert(granule === 0xffffffffffffffffn || granule <= BigInt(Math.ceil(rate * 6.05)));
        if (granule !== 0xffffffffffffffffn) finalGranule = granule;
        ended = (audio[offset + 5] & 4) !== 0;
        let payload = 0; for (let i = 0; i < segments; i++) payload += audio[offset + 27 + i];
        offset += 27 + segments + payload; assert(offset <= audio.length);
      }
      assert(ended && Math.abs(Number(finalGranule) / rate - clip.duration) <= 0.1);
      clipIds.add(String(clip.id)); paths.add(clip.file); events.add(clip.event);
    }
    assert(Object.keys(files).length === paths.size);
    assert(canonicalJson(m.missingEvents) === canonicalJson(VOICE_EVENTS.filter(event => !events.has(event))));
    assert(isVoiceChecksum(raw.checksum) && raw.checksum === await voiceHash(canonicalJson(m)));
    const identity = `${m.packageId}:${m.version}`;
    assert(!identities.has(identity)); identities.add(identity);
  }
  return value as unknown as VoiceBundle;
}
