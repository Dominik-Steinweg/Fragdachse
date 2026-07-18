export interface HostRoomQualityProbeResult {
  estimateMs: number | null;
  edgeRttMedianMs: number | null;
  browserRttMs: number | null;
  successfulEdgeSamples: number;
}

const PLAYROOM_EDGE_HTTP_URL = 'https://ws.joinplayroom.com/';
const PLAYROOM_EDGE_RTT_TO_PLAYER_PING_FACTOR = 2;
const PLAYROOM_EDGE_WARMUP_MAX_MS = 300;

interface NetworkPingControllerDeps {
  isHost: () => boolean;
  getLocalPlayerId: () => string;
  setLocalPing: (pingMs: number) => void;
  sendHostRpc: (type: string, payload: unknown) => void;
  broadcastRpc: (type: string, payload: unknown) => void;
  registerHostRpcHandler: (type: string, handler: (payload: unknown) => Promise<unknown> | unknown) => void;
  registerAllRpcHandler: (type: string, handler: (payload: unknown) => Promise<unknown> | unknown) => void;
}

export class NetworkPingController {
  private hostClockOffsetMs = 0;
  private bestClockSyncRttMs = Number.POSITIVE_INFINITY;
  private nextEdgeProbeId = 0;

  constructor(private deps: NetworkPingControllerDeps) {}

  getSynchronizedNow(): number {
    return this.deps.isHost() ? Date.now() : Date.now() + this.hostClockOffsetMs;
  }

  sendPingToHost(): void {
    if (this.deps.isHost()) return;
    this.deps.sendHostRpc('png', { ts: Date.now(), id: this.deps.getLocalPlayerId() });
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
      const { ts, id, hostTs } = data as { ts: number; id: string; hostTs?: number };
      if (id !== this.deps.getLocalPlayerId()) return undefined;

      const now = Date.now();
      const rtt = now - ts;
      this.deps.setLocalPing(rtt);

      if (!this.deps.isHost() && typeof hostTs === 'number') {
        const estimatedOffset = hostTs - (ts + rtt / 2);
        if (!Number.isFinite(this.bestClockSyncRttMs)) {
          this.bestClockSyncRttMs = rtt;
          this.hostClockOffsetMs = estimatedOffset;
          return undefined;
        }
        if (rtt <= this.bestClockSyncRttMs + 10) {
          this.bestClockSyncRttMs = Math.min(this.bestClockSyncRttMs, rtt);
          this.hostClockOffsetMs += (estimatedOffset - this.hostClockOffsetMs) * 0.35;
        }
      }

      return undefined;
    });
  }

  async measureHostRoomLatency(sampleCount: number, timeoutMs: number): Promise<HostRoomQualityProbeResult> {
    if (!this.deps.isHost()) {
      return {
        estimateMs: null,
        edgeRttMedianMs: null,
        browserRttMs: this.getBrowserNetworkRtt(),
        successfulEdgeSamples: 0,
      };
    }

    const browserRttMs = this.getBrowserNetworkRtt();
    const startedAt = performance.now();
    const totalBudgetMs = Math.max(1, timeoutMs);

    // Die erste HTTP-Anfrage kann DNS-/TLS-Aufbau enthalten. Sie waermt die
    // Verbindung nur auf und fliesst nicht in die Latenzprognose ein.
    await this.measureSinglePlayroomEdgeRtt(Math.min(PLAYROOM_EDGE_WARMUP_MAX_MS, totalBudgetMs));

    const remainingBudgetMs = Math.max(1, totalBudgetMs - (performance.now() - startedAt));
    const requestedSamples = Math.max(1, Math.floor(sampleCount));
    const measuredSamples = await Promise.all(
      Array.from({ length: requestedSamples }, () => this.measureSinglePlayroomEdgeRtt(remainingBudgetMs)),
    );
    const edgeRttSamples = measuredSamples.filter((value): value is number => value !== null);

    const edgeRttMedianMs = this.median(edgeRttSamples);
    const roundedEdgeRttMedianMs = edgeRttMedianMs !== null ? Math.round(edgeRttMedianMs) : null;
    const estimateMs = roundedEdgeRttMedianMs !== null
      ? Math.round(roundedEdgeRttMedianMs * PLAYROOM_EDGE_RTT_TO_PLAYER_PING_FACTOR)
      : browserRttMs;

    return {
      estimateMs,
      edgeRttMedianMs: roundedEdgeRttMedianMs,
      browserRttMs,
      successfulEdgeSamples: edgeRttSamples.length,
    };
  }

  private async measureSinglePlayroomEdgeRtt(timeoutMs: number): Promise<number | null> {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
    const probeId = `${Date.now().toString(36)}-${this.nextEdgeProbeId++}`;
    const startedAt = performance.now();
    try {
      await fetch(`${PLAYROOM_EDGE_HTTP_URL}?room-quality-probe=${probeId}`, {
        method: 'GET',
        mode: 'no-cors',
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
      });
      return performance.now() - startedAt;
    } catch {
      return null;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  private median(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];
  }

  private getBrowserNetworkRtt(): number | null {
    const nav = navigator as Navigator & {
      connection?: { rtt?: number };
      mozConnection?: { rtt?: number };
      webkitConnection?: { rtt?: number };
    };
    const rtt = nav.connection?.rtt ?? nav.mozConnection?.rtt ?? nav.webkitConnection?.rtt;
    return typeof rtt === 'number' && Number.isFinite(rtt) && rtt > 0 ? Math.round(rtt) : null;
  }
}
