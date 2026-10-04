import { readVoicePreferences } from './VoiceLibrary';
import { voiceBytes, type VoicePackage } from './VoicePackage';
import type { VoicePlayback, VoiceScope } from './VoiceDirector';

const MAX_DECODED_BYTES = 96 * 1024 * 1024;
/** Independent channel on the game's already-unlocked AudioContext. Never queues an old event. */
export class VoiceAudioChannel {
  private buffers = new Map<string, AudioBuffer>();
  private bytes = 0;
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode;
  private sequence = 0;
  private generation = 0;
  private scope: VoiceScope = { worldRevision: 0, roundRevision: 0 };
  private disposed = false;
  private wanted: readonly VoicePackage[] = [];
  private preferences = readVoicePreferences();
  private victoryTimer: ReturnType<typeof setTimeout> | null = null;
  private victoryPlaying = false;
  readonly metrics = { decodedBytes: 0, prepareMs: 0, skipped: 0 };
  constructor(private readonly context: AudioContext, private readonly master: () => number) {
    this.gain = context.createGain(); this.gain.connect(context.destination);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('voice-preferences', this.refreshVolume);
    this.refreshVolume();
  }
  private readonly onVisibility = (): void => { if (document.hidden) this.stop(); };
  readonly refreshVolume = (): void => {
    const settings = readVoicePreferences();
    const changed = settings.enabled !== this.preferences.enabled;
    this.preferences = settings; this.gain.gain.value = settings.enabled ? settings.volume * this.master() : 0;
    if (!settings.enabled) this.stop();
    if (changed) void this.prepare(this.wanted);
  };
  setScope(scope: VoiceScope): void {
    const finishingVictory = (scope.roundRevision === 0 || scope.roundRevision === this.scope.roundRevision)
      && (this.victoryTimer !== null || this.victoryPlaying);
    this.scope = scope; if (!finishingVictory) this.stop();
    this.generation++; this.buffers.clear(); this.bytes = 0; this.metrics.decodedBytes = 0;
  }
  async prepare(packs: readonly VoicePackage[]): Promise<void> {
    this.wanted = packs;
    const generation = ++this.generation; const began = performance.now();
    const needed = new Set(packs.flatMap(p => p.manifest.clips.map(c => `${p.checksum}:${c.id}`)));
    for (const [key, buffer] of this.buffers) if (!needed.has(key)) { this.bytes -= buffer.length * buffer.numberOfChannels * 4; this.buffers.delete(key); }
    if (!this.preferences.enabled) { this.buffers.clear(); this.bytes = 0; this.metrics.decodedBytes = 0; return; }
    for (const pack of packs) for (const clip of pack.manifest.clips) {
      if (this.disposed || generation !== this.generation) return;
      const key = `${pack.checksum}:${clip.id}`; if (this.buffers.has(key)) continue;
      try {
        const buffer = await this.context.decodeAudioData(new Uint8Array(voiceBytes(pack.files[clip.file])).buffer);
        if (this.disposed || generation !== this.generation) return;
        const size = buffer.length * buffer.numberOfChannels * 4;
        if (buffer.duration > 6.05 || Math.abs(buffer.duration - clip.duration) > 0.1 || this.bytes + size > MAX_DECODED_BYTES) continue;
        this.buffers.set(key, buffer); this.bytes += size;
      } catch { /* An optional undecodable clip stays silent. */ }
    }
    this.metrics.decodedBytes = this.bytes; this.metrics.prepareMs = performance.now() - began;
  }
  play(event: VoicePlayback, now: number): void {
    if (event.sequence <= this.sequence) return;
    this.sequence = event.sequence;
    if (this.disposed || document.hidden || this.context.state !== 'running' || (this.source && event.event !== 'victory')
      || event.worldRevision !== this.scope.worldRevision || event.roundRevision !== this.scope.roundRevision
      || event.expiresAt < now || event.sentAt > now + 250 || !this.preferences.enabled) { this.metrics.skipped++; return; }
    const buffer = this.buffers.get(`${event.checksum}:${event.clipId}`);
    if (!buffer) { this.metrics.skipped++; return; }
    if (event.event === 'victory') {
      if (this.victoryTimer !== null || this.victoryPlaying) return;
      const playAt = event.playAt ?? event.sentAt;
      const receivedAt = performance.now();
      this.victoryTimer = setTimeout(() => {
        this.victoryTimer = null;
        if (this.disposed || document.hidden || !this.preferences.enabled || this.context.state !== 'running'
          || now + performance.now() - receivedAt > event.expiresAt
          || (this.scope.roundRevision !== 0 && event.roundRevision !== this.scope.roundRevision)) return;
        this.stop(); this.victoryPlaying = true; this.refreshVolume(); this.start(buffer);
      }, Math.max(0, playAt - now));
    } else { this.refreshVolume(); this.start(buffer); }
  }
  async preview(pack: VoicePackage): Promise<void> {
    const clip = pack.manifest.clips[0]; if (!clip) return;
    await this.context.resume();
    const buffer = await this.context.decodeAudioData(new Uint8Array(voiceBytes(pack.files[clip.file])).buffer);
    if (this.disposed || document.hidden) return;
    this.stop(); this.refreshVolume(); this.start(buffer);
  }
  private start(buffer: AudioBuffer): void {
    const source = this.context.createBufferSource(); source.buffer = buffer; source.connect(this.gain);
    this.source = source; source.onended = () => { source.disconnect(); if (this.source === source) { this.source = null; this.victoryPlaying = false; } }; source.start();
  }
  stop(): void {
    if (this.victoryTimer !== null) clearTimeout(this.victoryTimer);
    this.victoryTimer = null; this.victoryPlaying = false;
    const source = this.source; this.source = null; if (source) { source.stop(); source.disconnect(); }
  }
  destroy(): void {
    if (this.disposed) return;
    this.disposed = true; this.generation++; this.stop(); this.buffers.clear(); this.gain.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility); window.removeEventListener('voice-preferences', this.refreshVolume);
  }
}
