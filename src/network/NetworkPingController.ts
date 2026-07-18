import type { GameplayTransportMode } from '../types';

const KEY_FAST_PING_PROBE = 'fpp';
const KEY_FAST_PING_ACK = 'fpa';

interface PingPlayerState {
  id: string;
  getState(key: string): unknown;
  setState(key: string, value: unknown, reliable?: boolean): void;
}

interface NetworkPingControllerDeps {
  isHost: () => boolean;
  getMode: () => GameplayTransportMode;
  getLocalPlayerId: () => string;
  getLocalPlayer: () => PingPlayerState;
  getPlayers: () => PingPlayerState[];
  setLocalPing: (pingMs: number) => void;
  sendHostRpc: (type: string, payload: unknown) => void;
  broadcastRpc: (type: string, payload: unknown) => void;
  registerHostRpcHandler: (type: string, handler: (payload: unknown) => Promise<unknown> | unknown) => void;
  registerAllRpcHandler: (type: string, handler: (payload: unknown) => Promise<unknown> | unknown) => void;
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
  private activeMode: GameplayTransportMode | null = null;

  constructor(private deps: NetworkPingControllerDeps) {}

  getSynchronizedNow(): number {
    return this.deps.isHost() ? Date.now() : Date.now() + this.hostClockOffsetMs;
  }

  sendPingToHost(): void {
    if (this.deps.isHost()) return;
    const mode = this.syncMode();
    if (mode === 'fast') {
      this.deps.getLocalPlayer().setState(KEY_FAST_PING_PROBE, {
        seq: this.nextFastProbeSeq++,
        ts: Date.now(),
      } satisfies FastPingProbe, false);
      return;
    }
    this.deps.sendHostRpc('png', { ts: Date.now(), id: this.deps.getLocalPlayerId() });
  }

  updateFastPath(): void {
    if (this.syncMode() !== 'fast') return;
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

  setupPingMeasurement(): void {
    this.deps.registerHostRpcHandler('png', async (data: unknown): Promise<unknown> => {
      if (this.deps.isHost()) {
        const { ts, id } = data as { ts: number; id: string };
        this.deps.broadcastRpc('pong', { ts, id, hostTs: Date.now() });
      }
      return undefined;
    });

    this.deps.registerAllRpcHandler('pong', async (data: unknown): Promise<unknown> => {
      if (this.deps.getMode() !== 'rpc') return undefined;
      const { ts, id, hostTs } = data as { ts: number; id: string; hostTs?: number };
      if (id !== this.deps.getLocalPlayerId()) return undefined;
      this.applyMeasurement(ts, hostTs);
      return undefined;
    });
  }

  private applyMeasurement(sentAt: number, hostTs?: number): void {
    const now = Date.now();
    const rtt = Math.max(0, now - sentAt);
    this.deps.setLocalPing(rtt);

    if (this.deps.isHost() || typeof hostTs !== 'number') return;
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

  private syncMode(): GameplayTransportMode {
    const mode = this.deps.getMode();
    if (mode === this.activeMode) return mode;
    this.activeMode = mode;
    this.bestClockSyncRttMs = Number.POSITIVE_INFINITY;
    this.hostClockOffsetMs = 0;
    this.lastFastAckSeq = 0;
    if (!this.deps.isHost()) this.deps.setLocalPing(0);
    return mode;
  }
}
