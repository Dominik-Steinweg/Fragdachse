import type { VoiceEventKind, VoicePackage } from './VoicePackage';
export interface VoiceScope { worldRevision: number; roundRevision: number }
export interface VoicePlayback extends VoiceScope {
  sequence: number; speakerId: string; event: VoiceEventKind; checksum: string; clipId: string; sentAt: number; expiresAt: number;
  /** Only victory can reserve playback after the current short utterance. */
  playAt?: number;
}
interface Candidate { speakerId: string; event: VoiceEventKind; at: number; notBefore: number }
const PRIORITY: VoiceEventKind[] = ['victory', 'leader', 'ultimate', 'damage_burst', 'kill', 'ready'];
/** Host-owned, transport-free speaking policy, also used by the workshop preview. */
export class VoiceDirector {
  private candidates: Candidate[] = [];
  private nextAt = 0;
  private endAt = 0;
  private sequence = 0;
  private victory = false;
  private recent = new Map<string, string[]>();
  private lastSpoke = new Map<string, number>();
  private scope: VoiceScope = { worldRevision: 0, roundRevision: 0 };
  reset(scope: VoiceScope): void {
    this.scope = scope; this.candidates = []; this.victory = false;
  }
  offer(speakerId: string, event: VoiceEventKind, now: number, notBefore = now + 150): void {
    if (this.victory && event !== 'victory') return;
    if (event === 'victory') this.candidates = this.candidates.filter(c => c.event === 'victory');
    if (this.candidates.some(c => c.speakerId === speakerId && c.event === event)) return;
    if (this.candidates.length < 64) this.candidates.push({ speakerId, event, at: now, notBefore });
  }
  cancel(event: VoiceEventKind, speakerId: string): void {
    this.candidates = this.candidates.filter(c => c.event !== event || c.speakerId !== speakerId);
  }
  select(now: number, packages: ReadonlyMap<string, VoicePackage>): VoicePlayback | null {
    this.candidates = this.candidates.filter(c => now - c.at <= (c.event === 'victory' ? 8000 : 2000));
    const sorted = [...this.candidates].sort((a, b) => PRIORITY.indexOf(a.event) - PRIORITY.indexOf(b.event)
      || (this.lastSpoke.get(a.speakerId) ?? -Infinity) - (this.lastSpoke.get(b.speakerId) ?? -Infinity) || a.at - b.at);
    for (const c of sorted) {
      if (c.event !== 'victory' && now < this.endAt + 500) continue;
      if (now < c.notBefore || (c.event !== 'victory' && now < this.nextAt) || (c.event === 'victory' && this.victory)) continue;
      if (c.event === 'kill' && sorted.some(other => other.event === 'leader' && other.speakerId === c.speakerId)) continue;
      const pack = packages.get(c.speakerId);
      const clips = pack?.manifest.clips.filter(clip => clip.event === c.event) ?? [];
      if (!pack || !clips.length) continue;
      const key = `${pack.manifest.voiceId}:${c.event}`;
      const recent = this.recent.get(key) ?? [];
      const excluded = recent.slice(-Math.min(2, clips.length - 1));
      const clip = clips.find(clip => !excluded.includes(clip.sentenceId)) ?? clips[0];
      this.recent.set(key, [...recent, clip.sentenceId].slice(-2));
      this.lastSpoke.set(c.speakerId, now);
      const playAt = c.event === 'victory' ? Math.max(now, this.endAt + 500) : now;
      this.endAt = playAt + clip.duration * 1000; this.nextAt = playAt + 10000;
      if (c.event === 'victory') this.victory = true;
      this.candidates = [];
      return { ...this.scope, speakerId: c.speakerId, event: c.event, checksum: pack.checksum, clipId: clip.id,
        sequence: ++this.sequence, sentAt: now, playAt, expiresAt: playAt + 2000 };
    }
    return null;
  }
}

/** Positive completed combat windows only; current damage never contributes to its own baseline. */
export class DamageBurstObserver {
  private history: { end: number; damage: number }[] = [];
  private samples: { at: number; damage: number }[] = [];
  private windowStart: number | null = null;
  private windowDamage = 0;
  private armed = true;
  private belowSince: number | null = null;
  private lastBurst = -Infinity;
  private phase: unknown;
  reset(phase: unknown): void {
    this.phase = phase; this.history = []; this.samples = []; this.windowStart = null;
    this.windowDamage = 0; this.armed = true; this.belowSince = null;
  }
  observe(now: number, damage: number, phase: unknown): boolean {
    if (phase !== this.phase) this.reset(phase);
    this.tick(now);
    if (!Number.isFinite(damage) || damage <= 0) return false;
    this.windowStart ??= now;
    this.samples.push({ at: now, damage }); this.windowDamage += damage;
    const reference = this.reference(now);
    const total = this.samples.reduce((sum, s) => sum + s.damage, 0);
    if (reference > 0 && total >= reference * 2.5 && this.armed && now - this.lastBurst >= 20000) {
      this.armed = false; this.belowSince = null; this.lastBurst = now; return true;
    }
    return false;
  }
  tick(now: number): void {
    this.samples = this.samples.filter(s => now - s.at < 2000);
    if (this.windowStart !== null && now - this.windowStart >= 2000) {
      if (this.windowDamage > 0) this.history = [...this.history, { end: this.windowStart + 2000, damage: this.windowDamage }].slice(-17);
      this.windowStart = null; this.windowDamage = 0;
    }
    const reference = this.reference(now);
    if (!this.armed && reference > 0 && this.samples.reduce((sum, s) => sum + s.damage, 0) < reference * 1.5) {
      this.belowSince ??= now;
      if (now - this.belowSince >= 2000) this.armed = true;
    } else this.belowSince = null;
  }
  private reference(now: number): number {
    const previous = this.history.filter(window => window.end <= now - 2000).slice(-15);
    if (previous.length < 4) return 0;
    const sorted = previous.map(w => w.damage).sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }
}
