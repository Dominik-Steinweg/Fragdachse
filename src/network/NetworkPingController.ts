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
const MAX_PENDING_PROBES = 32;

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
  private lastAppPingMs: number | null = null;
  private handledHostProbes = new Map<string, FastPingProbe>();
  private pendingProbes = new Map<number, number>();

  constructor(private deps: NetworkPingControllerDeps) {}

  getSynchronizedNow(): number {
    return this.deps.isHost() ? Date.now() : Date.now() + this.hostClockOffsetMs;
  }

  /**
   * Zuletzt gemessene Umlaufzeit durch beide Spielschleifen. Nicht die Leitung: darin steckt
   * die Frame-Quantisierung beider Seiten. Als angezeigter Ping ungeeignet, als Maß für die
   * gefühlte Reaktionszeit aussagekräftig.
   */
  getAppPingMs(): number | null {
    return this.lastAppPingMs;
  }

  sendPingToHost(): void {
    if (this.deps.isHost()) return;
    const probe: FastPingProbe = {
      seq: this.nextFastProbeSeq++,
      ts: Date.now(),
    };
    this.pendingProbes.set(probe.seq, probe.ts);
    // Lost probes are replaceable and must not accumulate over a long connection outage.
    if (this.pendingProbes.size > MAX_PENDING_PROBES) {
      this.pendingProbes.delete(this.pendingProbes.keys().next().value!);
    }
    this.deps.getLocalPlayer().setState(KEY_FAST_PING_PROBE, probe, false);
  }

  /** Host beantwortet offene Proben, Client wertet eingetroffene Antworten aus. */
  update(): void {
    if (this.deps.isHost()) {
      const localId = this.deps.getLocalPlayerId();
      for (const player of this.deps.getPlayers()) {
        if (player.id === localId) continue;
        const probe = parseProbe(player.getState(KEY_FAST_PING_PROBE));
        const previous = this.handledHostProbes.get(player.id);
        // A resumed browser may restart its sequence while retaining the same player ID.
        if (!probe || (probe.seq === previous?.seq && probe.ts === previous.ts)) continue;
        this.handledHostProbes.set(player.id, probe);
        player.setState(KEY_FAST_PING_ACK, { ...probe, hostTs: Date.now() } satisfies FastPingAck, false);
      }
      return;
    }

    const ack = parseAck(this.deps.getLocalPlayer().getState(KEY_FAST_PING_ACK));
    if (!ack || ack.seq <= this.lastFastAckSeq || this.pendingProbes.get(ack.seq) !== ack.ts) return;
    this.lastFastAckSeq = ack.seq;
    for (const sequence of this.pendingProbes.keys()) {
      if (sequence <= ack.seq) this.pendingProbes.delete(sequence);
    }
    this.applyMeasurement(ack.ts, ack.hostTs);
  }

  removePlayer(playerId: string): void {
    this.handledHostProbes.delete(playerId);
  }

  private applyMeasurement(sentAt: number, hostTs: number): void {
    const now = Date.now();
    const rtt = Math.max(0, now - sentAt);
    this.lastAppPingMs = rtt;

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
