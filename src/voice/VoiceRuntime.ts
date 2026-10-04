import { DamageBurstObserver, VoiceDirector, type VoicePlayback, type VoiceScope } from './VoiceDirector';
import type { VoicePackage } from './VoicePackage';
import type { VoiceLibrary } from './VoiceLibrary';
import type { VoiceAudioChannel } from './VoiceAudioChannel';

export interface VoicePlayer { id: string; checksum: string | null; ready: boolean; participant: boolean; score: number; build: unknown }
export interface VoiceRuntimePort {
  now(): number; isHost(): boolean; scope(): VoiceScope; active(): boolean; lobby(): boolean;
  players(): readonly VoicePlayer[]; mode(): string; send(event: VoicePlayback): void;
}
/** Scene-lifetime presentation owner. Per-round observers and frozen assignments reset at scope boundaries. */
export class VoiceRuntime {
  private readonly director = new VoiceDirector();
  private readonly readySeen = new Set<string>();
  private readonly bursts = new Map<string, DamageBurstObserver>();
  private readonly packages = new Map<string, VoicePackage>();
  private readonly assignments = new Map<string, string | null>();
  private scopeKey = '';
  private prepareKey = '';
  private active = false;
  private leader: string | null | undefined;
  private pendingLeader: string | null = null;
  private pendingSince = 0;
  constructor(private readonly port: VoiceRuntimePort, private readonly library: VoiceLibrary, private readonly audio: VoiceAudioChannel | null) {}
  update(): void {
    const scope = this.port.scope(); const now = this.port.now(); const players = this.port.players();
    const key = `${scope.worldRevision}:${scope.roundRevision}`;
    if (key !== this.scopeKey) {
      this.scopeKey = key; this.director.reset(scope); this.audio?.setScope(scope); this.prepareKey = '';
      this.bursts.clear(); this.assignments.clear(); this.leader = undefined; this.pendingLeader = null;
    }
    const active = this.port.active();
    if (active && !this.active) {
      this.assignments.clear(); for (const p of players) this.assignments.set(p.id, p.checksum);
    }
    this.active = active;
    this.packages.clear();
    for (const p of players) {
      if (this.port.lobby()) this.assignments.set(p.id, p.checksum);
      // Late joiners get their initial assignment; existing round assignments remain frozen.
      if (!this.assignments.has(p.id)) this.assignments.set(p.id, p.checksum);
      const checksum = this.assignments.get(p.id); const pack = checksum ? this.library.packages.get(checksum) : null;
      if (pack) this.packages.set(p.id, pack);
      if (this.port.isHost() && !this.readySeen.has(p.id)) {
        if (!this.port.lobby()) this.readySeen.add(p.id);
        else if (p.ready) { this.readySeen.add(p.id); this.director.offer(p.id, 'ready', now); }
      }
      this.bursts.get(p.id)?.tick(now);
    }
    const prepareKey = [...this.packages.values()].map(p => p.checksum).sort().join(',') + `:${this.library.revision}`;
    if (prepareKey !== this.prepareKey) { this.prepareKey = prepareKey; void this.audio?.prepare([...new Set(this.packages.values())]); }
    if (!this.port.isHost()) return;
    if (active && this.port.mode() === 'deathmatch') this.updateLeader(players.filter(p => p.participant), now);
    const event = this.director.select(now, this.packages); if (event) this.port.send(event);
  }
  receive(event: VoicePlayback): void { this.audio?.play(event, this.port.now()); }
  kill(killerId: string): void { if (this.port.isHost() && this.port.active() && ['deathmatch', 'team_deathmatch'].includes(this.port.mode())) this.director.offer(killerId, 'kill', this.port.now()); }
  ultimate(playerId: string, abilityId: string): void {
    // Explicit category; utilities/right-clicks never enter this hook.
    if (VOICE_ULTIMATES.has(abilityId) && this.port.isHost() && this.port.active()) this.director.offer(playerId, 'ultimate', this.port.now());
  }
  damage(playerId: string, amount: number): void {
    if (!this.port.isHost() || !this.port.active()) return;
    const player = this.port.players().find(p => p.id === playerId); if (!player?.participant) return;
    let observer = this.bursts.get(playerId); if (!observer) { observer = new DamageBurstObserver(); this.bursts.set(playerId, observer); }
    if (observer.observe(this.port.now(), amount, player.build)) this.director.offer(playerId, 'damage_burst', this.port.now());
  }
  victory(playerIds: readonly string[]): void {
    if (!this.port.isHost()) return;
    const now = this.port.now();
    for (const id of playerIds) this.director.offer(id, 'victory', now, now);
    // Reserve the final clip before the lifecycle clears participation or replaces the World.
    const event = this.director.select(now, this.packages); if (event) this.port.send(event);
  }
  private updateLeader(players: readonly VoicePlayer[], now: number): void {
    const sorted = [...players].sort((a, b) => b.score - a.score);
    const next = sorted.length > 1 && sorted[0].score > sorted[1].score ? sorted[0].id : null;
    if (this.leader === undefined) { this.leader = next; return; }
    if (next === this.leader || next === null) {
      if (this.pendingLeader) this.director.cancel('leader', this.pendingLeader);
      this.pendingLeader = null; return;
    }
    // First establishment of a leader is silent, including an initially tied score.
    if (this.leader === null) { this.leader = next; return; }
    if (this.pendingLeader !== next) {
      if (this.pendingLeader) this.director.cancel('leader', this.pendingLeader);
      this.pendingLeader = next; this.pendingSince = now;
      this.director.offer(next, 'leader', now, now + 2000);
    } else if (now - this.pendingSince >= 2000) {
      this.director.cancel('leader', next); this.director.offer(next, 'leader', now, now);
      this.leader = next; this.pendingLeader = null;
    }
  }
  destroy(): void { this.audio?.destroy(); this.bursts.clear(); this.packages.clear(); }
}

// IDs are maintained explicitly and checked against authored Ultimate content by the contract test.
export const VOICE_ULTIMATES = new Set(['ARMAGEDDON', 'AIRSTRIKE', 'GAUSS_RIFLE', 'VOID_HUNTER_GAUSS', 'HONEY_BADGER_RAGE', 'DACHS_TUNNEL']);
