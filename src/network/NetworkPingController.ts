export interface HostRoomQualityProbeResult {
  estimateMs: number | null;
  loopbackAverageMs: number | null;
  browserRttMs: number | null;
  successfulLoopbackSamples: number;
}

interface NetworkPingControllerDeps {
  isHost: () => boolean;
  getLocalPlayerId: () => string;
  setLocalPing: (pingMs: number) => void;
  sendHostRpc: (type: string, payload: unknown) => void;
  broadcastRpc: (type: string, payload: unknown) => void;
  registerHostRpcHandler: (type: string, handler: (payload: unknown) => Promise<unknown> | unknown) => void;
  registerAllRpcHandler: (type: string, handler: (payload: unknown) => Promise<unknown> | unknown) => void;
  callHostRpc: (type: string, payload: unknown, timeoutMs: number) => Promise<unknown>;
}

export class NetworkPingController {
  private hostClockOffsetMs = 0;
  private bestClockSyncRttMs = Number.POSITIVE_INFINITY;

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

  async measureHostRoomLoopback(sampleCount: number, timeoutMs: number): Promise<HostRoomQualityProbeResult> {
    this.deps.registerHostRpcHandler('rqp', async (): Promise<unknown> => ({ ackAt: Date.now() }));

    const browserRttMs = this.getBrowserNetworkRtt();
    const loopbackSamples: number[] = [];

    for (let index = 0; index < sampleCount; index++) {
      const measured = await this.measureSingleHostLoopback(timeoutMs);
      if (measured !== null) loopbackSamples.push(measured);
    }

    const loopbackAverageMs = loopbackSamples.length > 0
      ? loopbackSamples.reduce((sum, value) => sum + value, 0) / loopbackSamples.length
      : null;

    return {
      estimateMs: loopbackAverageMs !== null ? Math.round(loopbackAverageMs) : browserRttMs,
      loopbackAverageMs: loopbackAverageMs !== null ? Math.round(loopbackAverageMs) : null,
      browserRttMs,
      successfulLoopbackSamples: loopbackSamples.length,
    };
  }

  private async measureSingleHostLoopback(timeoutMs: number): Promise<number | null> {
    if (!this.deps.isHost()) return null;

    const startedAt = performance.now();
    try {
      await this.deps.callHostRpc('rqp', { startedAt: Date.now() }, timeoutMs);
      return performance.now() - startedAt;
    } catch {
      return null;
    }
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