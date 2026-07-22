/**
 * Anwendungs-Ping und Host-Zeitbasis.
 *
 * Läuft ausschließlich über den unzuverlässigen Kanal: Proben sind ersetzbar, eine verlorene
 * ist ohne Bedeutung, und eine erneut zugestellte alte Probe würde die Messung sogar
 * verfälschen. Gemessen wird bewusst der volle Anwendungspfad inklusive Frameverarbeitung –
 * die reine Leitungs-RTT liefert daneben `TransportDiagnostics` aus den WebRTC-Statistiken.
 */

/** Client → Host. Nur der Host liest ihn, daher wird er nicht an andere Clients weitergereicht. */
export const KEY_FAST_PING_PROBE = 'fpp';
const KEY_FAST_PING_ACK = 'fpa';

interface PingPlayerState {
  id: string;
  getState(key: string): unknown;
  setState(key: string, value: unknown, reliable?: boolean): void;
}

interface NetworkPingControllerDeps {
  isHost: () => boolean;
  getLocalPlayerId: () => string;
  getLocalPlayer: () => PingPlayerState;
  getPlayers: () => PingPlayerState[];
  setLocalPing: (pingMs: number) => void;
}

interface FastPingProbe {
  seq: number;
  ts: number;
}

interface FastPingAck extends FastPingProbe {
  hostTs: number;
}

function parseProbe(value: unknown): FastPingProbe | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<FastPingProbe>;
  if (!Number.isSafeInteger(raw.seq) || typeof raw.ts !== 'number') return null;
  return { seq: raw.seq!, ts: raw.ts };
}

function parseAck(value: unknown): FastPingAck | null {
  const probe = parseProbe(value);
  if (!probe || typeof (value as Partial<FastPingAck>).hostTs !== 'number') return null;
  return { ...probe, hostTs: (value as FastPingAck).hostTs };
}

export class NetworkPingController {
  private hostClockOffsetMs = 0;
  private bestClockSyncRttMs = Number.POSITIVE_INFINITY;
  private nextFastProbeSeq = 1;
  private lastFastAckSeq = 0;
  private handledHostProbeSeq = new Map<string, number>();

  constructor(private deps: NetworkPingControllerDeps) {}

  getSynchronizedNow(): number {
    return this.deps.isHost() ? Date.now() : Date.now() + this.hostClockOffsetMs;
  }

  sendPingToHost(): void {
    if (this.deps.isHost()) return;
    this.deps.getLocalPlayer().setState(KEY_FAST_PING_PROBE, {
      seq: this.nextFastProbeSeq++,
      ts: Date.now(),
    } satisfies FastPingProbe, false);
  }

  /** Host beantwortet offene Proben, Client wertet eingetroffene Antworten aus. */
  update(): void {
    if (this.deps.isHost()) {
      const localId = this.deps.getLocalPlayerId();
      for (const player of this.deps.getPlayers()) {
        if (player.id === localId) continue;
        const probe = parseProbe(player.getState(KEY_FAST_PING_PROBE));
        if (!probe || probe.seq <= (this.handledHostProbeSeq.get(player.id) ?? 0)) continue;
        this.handledHostProbeSeq.set(player.id, probe.seq);
        player.setState(KEY_FAST_PING_ACK, { ...probe, hostTs: Date.now() } satisfies FastPingAck, false);
      }
      return;
    }

    const ack = parseAck(this.deps.getLocalPlayer().getState(KEY_FAST_PING_ACK));
    if (!ack || ack.seq <= this.lastFastAckSeq) return;
    this.lastFastAckSeq = ack.seq;
    this.applyMeasurement(ack.ts, ack.hostTs);
  }

  removePlayer(playerId: string): void {
    this.handledHostProbeSeq.delete(playerId);
  }

  private applyMeasurement(sentAt: number, hostTs: number): void {
    const now = Date.now();
    const rtt = Math.max(0, now - sentAt);
    this.deps.setLocalPing(rtt);

    if (this.deps.isHost()) return;
    // Nur die schnellsten Messungen zur Zeitsynchronisation heranziehen: bei ihnen ist die
    // Annahme "Hinweg = Rueckweg = RTT/2" am wenigsten falsch.
    const estimatedOffset = hostTs - (sentAt + rtt / 2);
    if (!Number.isFinite(this.bestClockSyncRttMs)) {
      this.bestClockSyncRttMs = rtt;
      this.hostClockOffsetMs = estimatedOffset;
      return;
    }
    if (rtt <= this.bestClockSyncRttMs + 10) {
      this.bestClockSyncRttMs = Math.min(this.bestClockSyncRttMs, rtt);
      this.hostClockOffsetMs += (estimatedOffset - this.hostClockOffsetMs) * 0.35;
    }
  }
}
