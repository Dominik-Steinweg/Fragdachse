import { isVoiceChecksum, validateVoiceBundle, voiceBytes, VOICE_LIMITS, type VoicePackage } from './VoicePackage';
import { loadBundledVoices } from './BundledVoices';

export interface VoicePreferences { checksum: string | null; enabled: boolean; volume: number }
const SETTINGS_KEY = 'fragdachse.voice.v1';
let sessionPreferences: VoicePreferences | null = null;
function normalizePreferences(value: Partial<VoicePreferences> | null): VoicePreferences {
  const volume = value?.enabled === false ? 0 : typeof value?.volume === 'number' && Number.isFinite(value.volume)
    ? Math.max(0, Math.min(1, value.volume)) : 0;
  const checksum = value?.checksum;
  return { checksum: isVoiceChecksum(checksum) ? checksum : null, enabled: volume > 0, volume };
}
export function readVoicePreferences(): VoicePreferences {
  if (sessionPreferences) return { ...sessionPreferences };
  try { return normalizePreferences(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')); }
  catch { return normalizePreferences(null); }
}
export function saveVoicePreferences(value: VoicePreferences): void {
  sessionPreferences = normalizePreferences(value);
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(sessionPreferences)); } catch { /* Session controls still work with storage disabled. */ }
  window.dispatchEvent(new Event('voice-preferences'));
}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('fragdachse-voice-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('packages', { keyPath: 'checksum' });
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('packages', mode); let request: IDBRequest<T> | void;
    try { request = action(tx.objectStore('packages')); } catch (error) { tx.abort(); db.close(); reject(error); return; }
    tx.oncomplete = () => { db.close(); resolve(request?.result); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Sprachpakete konnten nicht gespeichert werden.')); };
  });
}
/** Browser storage owns compressed files. Decoded audio belongs to the scene's VoiceAudioChannel. */
export class VoiceLibrary {
  readonly packages = new Map<string, VoicePackage>();
  private readonly bundled = new Set<string>();
  isBundled(checksum: string): boolean { return this.bundled.has(checksum); }
  revision = 0;
  private loading: Promise<void> | null = null;
  load(): Promise<void> {
    return this.loading ??= (async () => {
      for (const pack of await loadBundledVoices()) { this.packages.set(pack.checksum, pack); this.bundled.add(pack.checksum); }
      // Storage failure must not hide the voices shipped with the game.
      const stored = await transaction<VoicePackage[]>('readonly', store => store.getAll()).catch(() => []);
      for (const pack of stored ?? []) {
        try { await validateVoiceBundle({ format: 'fragdachse-voice', schema: 1, packages: [pack] }); this.packages.set(pack.checksum, pack); }
        catch { /* Corrupt optional content never prevents joining. */ }
      }
      this.revision++;
    })().catch(() => { /* IndexedDB may be disabled; voice remains optional. */ });
  }
  async import(file: File, context: BaseAudioContext): Promise<number> {
    await this.load();
    if (file.size > VOICE_LIMITS.bytes * VOICE_LIMITS.packages * 1.4) throw new Error('Sprachpaketdatei ist zu groß.');
    const bundle = await validateVoiceBundle(JSON.parse(await file.text()));
    const existing = [...this.packages.values()];
    for (const pack of bundle.packages) {
      const conflict = existing.find(p => p.manifest.packageId === pack.manifest.packageId && p.manifest.version === pack.manifest.version && p.checksum !== pack.checksum);
      if (conflict) throw new Error('Diese Paketversion existiert bereits mit anderem Inhalt.');
      // Decode serially, then release the buffer. Verify the actual duration, not the extension.
      for (const clip of pack.manifest.clips) {
        const buffer = await context.decodeAudioData(new Uint8Array(voiceBytes(pack.files[clip.file])).buffer);
        if (buffer.duration > VOICE_LIMITS.clipSeconds + 0.05 || Math.abs(buffer.duration - clip.duration) > 0.1 || buffer.numberOfChannels > 2) throw new Error('Audio und Manifest stimmen nicht überein.');
      }
    }
    if (new Set([...existing.map(p => p.checksum), ...bundle.packages.map(p => p.checksum)]).size > 30) throw new Error('Lokaler Bestand voll. Alte Paketversionen zuerst entfernen.');
    await transaction('readwrite', store => { for (const pack of bundle.packages) store.put(pack); });
    for (const pack of bundle.packages) this.packages.set(pack.checksum, pack);
    this.revision++; return bundle.packages.length;
  }
  async remove(checksum: string): Promise<void> {
    if (this.isBundled(checksum)) throw new Error('Diese Stimme ist im Spiel enthalten und kann hier nicht entfernt werden.');
    await transaction('readwrite', store => store.delete(checksum));
    this.packages.delete(checksum); this.revision++;
  }
}
export const voiceLibrary = new VoiceLibrary();
